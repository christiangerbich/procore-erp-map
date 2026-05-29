(async function () {
  // Fixed bipartite layout: ERPs in a column on the left, Procore modules
  // in a column on the right. The "core" Procore node and structural
  // Procore-to-module links are intentionally hidden in this view — they
  // become visual noise once the columns make the hub structure explicit.

  // Node sizes are the hexagon circumradius (distance from center to a
  // vertex). The hex extends ±NODE_RADIUS horizontally to its left/right
  // vertices, which is also where the bipartite-layout lines connect.
  const NODE_RADIUS = { erp: 17, module: 14 };

  // Procore primary palette — see Color guide page 3. The hex is the
  // central brand mark (Identity guide pages 24-28); using it filled in
  // primary colors is on-brand. Modules are always black.
  //
  // ERP color depends on which service provides the connector:
  //   via: "procore" (default) → Procore Orange (primary brand color)
  //   via: "agave"              → Metal #566578 (Procore secondary palette)
  //   via: "both"               → Orange fill + Metal stroke ring
  const NODE_COLOR = { erp: "#FF5200", module: "#000000" };
  const COLOR_PROCORE = "#FF5200"; // Procore Orange
  const COLOR_AGAVE = "#566578";   // Procore Metal (secondary palette)

  function erpFillFor(d) {
    return d.via === "agave" ? COLOR_AGAVE : COLOR_PROCORE;
  }

  // Line colors keyed by link direction. Solid vs dashed treatment lives
  // in CSS (.link-to-erp / .link-from-erp). Kept in sync with the CSS
  // variables in styles.css and the legend swatches in index.html.
  const LINK_COLORS = {
    both: "#FF5200",      // solid Procore Orange  — bidirectional
    "to-erp": "#FF5200",  // dashed Procore Orange — Procore → ERP (export)
    "from-erp": "#000000" // dashed Procore Black  — ERP → Procore (import)
  };

  // Vertices of a regular hexagon with flat top/bottom edges (per the
  // Identity guide — "Do use the hex with the flat sides at the top and
  // bottom"), centered at origin, with circumradius r. Returned as the
  // SVG `points` attribute for <polygon>.
  function hexPoints(r) {
    const h = r * Math.sqrt(3) / 2; // half-height (apothem from horizontal axis)
    return [
      [ r, 0 ],         // far right
      [ r / 2, h ],     // bottom-right
      [ -r / 2, h ],    // bottom-left
      [ -r, 0 ],        // far left
      [ -r / 2, -h ],   // top-left
      [ r / 2, -h ]     // top-right
    ].map((p) => p.join(",")).join(" ");
  }

  // The arrow symbol shown next to each item in the side panel.
  // Rendered from the perspective of the currently-selected node:
  //   "outbound" means data leaves the selected node
  //   "inbound"  means data arrives at the selected node
  const DIRECTION_SYMBOLS = {
    both: "↔",
    outbound: "→",
    inbound: "←"
  };

  const data = await fetch("data.json").then((r) => {
    if (!r.ok) throw new Error("Failed to load data.json: " + r.status);
    return r.json();
  });

  // Procore ERP support-doc chunks for the in-page finder (built by
  // tools/build-docs-index.py). Optional — the finder still works on the
  // data.json corpus alone if this file is missing.
  const extraDocs = await fetch("docs-index.json")
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);

  // SOP Builder catalog (tools, standard actions, role/permission options).
  const sopTemplates = await fetch("sop-templates.json")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

  // PNPT Professional Services packages catalog (Cost Management, etc).
  const packagesData = await fetch("packages.json")
    .then((r) => (r.ok ? r.json() : { packages: [] }))
    .catch(() => ({ packages: [] }));

  // Filter to just the nodes we render in this view. Drop the "core"
  // Procore node, and drop the Procore-to-module structural links.
  //
  // ERPs are split into two columns based on connector source:
  //   - via "procore" (default) — Procore-native connectors (left column)
  //   - via "agave"             — Agave Sync connectors      (right column)
  // The two are different companies with different sync semantics, so
  // they live in separate columns of the bipartite layout.
  const procoreERPs = data.nodes
    .filter((n) => n.type === "erp" && (!n.via || n.via === "procore"))
    .sort((a, b) => a.label.localeCompare(b.label));
  const agaveERPs = data.nodes
    .filter((n) => n.type === "erp" && n.via === "agave")
    .sort((a, b) => a.label.localeCompare(b.label));
  const erpNodes = [...procoreERPs, ...agaveERPs];

  // Procore modules are split into two tiers (Company-level vs
  // Project-level) so the column can be grouped. Each group is sorted
  // alphabetically within itself.
  const companyModules = data.nodes
    .filter((n) => n.type === "module" && n.tier === "company")
    .sort((a, b) => a.label.localeCompare(b.label));
  // Project-tier modules are sorted alphabetically EXCEPT Projects,
  // which is pinned to the top of the project-level list. The Project
  // record itself is conceptually the parent of every other project-
  // level entity, so listing it first reads more naturally.
  const projectModules = data.nodes
    .filter((n) => n.type === "module" && n.tier === "project")
    .sort((a, b) => {
      if (a.id === "jobs" && b.id !== "jobs") return -1;
      if (b.id === "jobs" && a.id !== "jobs") return 1;
      return a.label.localeCompare(b.label);
    });
  const moduleNodes = [...companyModules, ...projectModules];

  const visibleNodes = [...erpNodes, ...moduleNodes];
  const visibleLinks = data.links.filter((l) => !!l.direction);

  const nodesById = new Map(visibleNodes.map((n) => [n.id, n]));

  // Resolve string ids in links to node references (D3 force normally does
  // this for us; we have to do it ourselves since we're not using force).
  visibleLinks.forEach((l) => {
    l.source = nodesById.get(l.source);
    l.target = nodesById.get(l.target);
  });

  // Build adjacency index for quick "what is this node connected to" lookups.
  const linksByNode = new Map();
  for (const n of visibleNodes) linksByNode.set(n.id, []);
  for (const l of visibleLinks) {
    linksByNode.get(l.source.id).push(l);
    linksByNode.get(l.target.id).push(l);
  }

  // ---------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------

  const container = document.getElementById("graph");
  const width = container.clientWidth;

  // Layout constants. Module rows fit a tool eyebrow ABOVE the hex +
  // a main label BELOW the hex; ROW_HEIGHT controls the vertical
  // breathing room between rows.
  const ROW_HEIGHT = 80;
  const HEADER_HEIGHT = 64;
  const FOOTER_PAD = 32;
  const TIER_LABEL_HEIGHT = 22;
  const TIER_GAP = 22;

  // Heights of each column (taller wins for canvas sizing).
  const procoreERPHeight = procoreERPs.length * ROW_HEIGHT;
  const agaveERPHeight = agaveERPs.length * ROW_HEIGHT;
  const moduleStackHeight =
    TIER_LABEL_HEIGHT + companyModules.length * ROW_HEIGHT +
    TIER_GAP + TIER_LABEL_HEIGHT + projectModules.length * ROW_HEIGHT;
  const minHeight =
    HEADER_HEIGHT +
    Math.max(procoreERPHeight, moduleStackHeight, agaveERPHeight) +
    FOOTER_PAD;
  const height = Math.max(container.clientHeight, minHeight);

  // Bipartite layout. Active source's ERPs always live in the LEFT
  // column (Procore-native by default, Agave on toggle); Procore modules
  // sit in a column to the right. Outer gutters reserve room for labels.
  const LABEL_GUTTER = 270;
  const COLUMN_GAP = 900;                     // horizontal gap between ERP and module columns
  const leftX = LABEL_GUTTER;                 // active ERP column x
  const middleX = leftX + COLUMN_GAP;         // Procore Modules column x
  const layoutWidth = middleX + LABEL_GUTTER; // total viewBox width — tighter than container so the map fills nicely
  const rightX = layoutWidth - LABEL_GUTTER;  // legacy: where the Agave column LIVES IN data before applySource moves it; nodes hidden by default

  // Procore ERPs distribute evenly down the left column.
  const procoreSpacing = (height - HEADER_HEIGHT - FOOTER_PAD) / Math.max(procoreERPs.length, 1);
  procoreERPs.forEach((n, i) => {
    n.x = leftX;
    n.y = HEADER_HEIGHT + procoreSpacing * (i + 0.5);
  });

  // Agave ERPs distribute evenly down the right column.
  const agaveSpacing = (height - HEADER_HEIGHT - FOOTER_PAD) / Math.max(agaveERPs.length, 1);
  agaveERPs.forEach((n, i) => {
    n.x = rightX;
    n.y = HEADER_HEIGHT + agaveSpacing * (i + 0.5);
  });

  // Modules: stack the company-level group, leave a gap, then the
  // project-level group. Section header positions are stored on the
  // outer scope so the render code below can place text labels.
  const companyLabelY = HEADER_HEIGHT;
  let y = HEADER_HEIGHT + TIER_LABEL_HEIGHT + ROW_HEIGHT / 2;
  companyModules.forEach((n) => {
    n.x = middleX;
    n.y = y;
    y += ROW_HEIGHT;
  });
  const tierDividerY = y - ROW_HEIGHT / 2 + TIER_GAP / 2;
  const projectLabelY = y + TIER_GAP - TIER_LABEL_HEIGHT / 2;
  y += TIER_GAP + TIER_LABEL_HEIGHT;
  y += ROW_HEIGHT / 2 - TIER_LABEL_HEIGHT / 2; // align first project row baseline
  projectModules.forEach((n) => {
    n.x = middleX;
    n.y = y;
    y += ROW_HEIGHT;
  });

  // ---------------------------------------------------------------------
  // SVG scaffolding
  // ---------------------------------------------------------------------

  const svg = d3
    .select("#graph")
    .append("svg")
    .attr("viewBox", [0, 0, width, height])
    .attr("preserveAspectRatio", "xMidYMin meet");

  // No arrow markers — direction is conveyed by line color + dash pattern.

  // Pan & zoom — useful when the column has been resized smaller than its
  // natural height, so the user can scroll/zoom inside the SVG.
  const zoomLayer = svg.append("g");
  const zoom = d3
    .zoom()
    .scaleExtent([0.5, 2.5])
    .on("zoom", (event) => zoomLayer.attr("transform", event.transform));
  svg.call(zoom);

  // Column headers (three columns now)
  zoomLayer
    .append("text")
    .attr("class", "column-header column-header-procore")
    .attr("x", leftX)
    .attr("y", 28)
    .attr("text-anchor", "middle")
    .text("Procore Native");

  zoomLayer
    .append("text")
    .attr("class", "column-header")
    .attr("x", middleX)
    .attr("y", 28)
    .attr("text-anchor", "middle")
    .text("Procore Modules");

  zoomLayer
    .append("text")
    .attr("class", "column-header column-header-agave")
    .attr("x", rightX)
    .attr("y", 28)
    .attr("text-anchor", "middle")
    .text("Agave Sync");

  // Tier section labels on the modules side (Company / Project).
  zoomLayer
    .append("text")
    .attr("class", "tier-label")
    .attr("x", middleX)
    .attr("y", companyLabelY + TIER_LABEL_HEIGHT / 2 + 4)
    .attr("text-anchor", "middle")
    .text("Company Level");

  zoomLayer
    .append("text")
    .attr("class", "tier-label")
    .attr("x", middleX)
    .attr("y", projectLabelY + TIER_LABEL_HEIGHT / 2 + 4)
    .attr("text-anchor", "middle")
    .text("Project Level");

  // Subtle divider between tier sections, centered on the modules column.
  zoomLayer
    .append("line")
    .attr("class", "tier-divider")
    .attr("x1", middleX - 100)
    .attr("y1", tierDividerY)
    .attr("x2", middleX + 100)
    .attr("y2", tierDividerY);

  // ---------------------------------------------------------------------
  // Links
  // ---------------------------------------------------------------------

  // Compute line endpoints that sit at the edges of the node circles
  // rather than at their centers, so lines don't visually slide under the
  // node fill.
  function endpoint(d) {
    const dx = d.target.x - d.source.x;
    const dy = d.target.y - d.source.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;
    const sr = NODE_RADIUS[d.source.type];
    const tr = NODE_RADIUS[d.target.type];
    return {
      x1: d.source.x + ux * sr,
      y1: d.source.y + uy * sr,
      x2: d.target.x - ux * tr,
      y2: d.target.y - uy * tr
    };
  }

  const linkGroup = zoomLayer.append("g").attr("class", "links");
  const link = linkGroup
    .selectAll("line")
    .data(visibleLinks)
    .join("line")
    .attr("class", (d) => "link link-data link-" + d.direction)
    .attr("stroke", (d) => LINK_COLORS[d.direction])
    .attr("stroke-width", 1.6)
    .each(function (d) {
      const e = endpoint(d);
      d3.select(this).attr("x1", e.x1).attr("y1", e.y1).attr("x2", e.x2).attr("y2", e.y2);
    });

  // Re-apply a single link's directional styling (stroke color + the
  // dash-pattern class) after its direction has been toggled. Only the
  // direction tokens are touched, so highlighted/dimmed state set by the
  // current selection is preserved.
  function restyleLinkDirection(d) {
    link
      .filter((l) => l === d)
      .attr("stroke", LINK_COLORS[d.direction])
      .classed("link-to-erp", d.direction === "to-erp")
      .classed("link-from-erp", d.direction === "from-erp")
      .classed("link-both", d.direction === "both");
  }

  // ---------------------------------------------------------------------
  // Nodes
  // ---------------------------------------------------------------------

  const nodeGroup = zoomLayer.append("g").attr("class", "nodes");
  const node = nodeGroup
    .selectAll("g")
    .data(visibleNodes)
    .join("g")
    .attr("class", (d) => "node node-" + d.type)
    .attr("transform", (d) => `translate(${d.x},${d.y})`)
    .on("click", (event, d) => {
      event.stopPropagation();
      selectNode(d.id);
    });

  node
    .append("polygon")
    .attr("class", (d) => {
      const cls = ["node-hex"];
      if (d.via) cls.push("via-" + d.via);
      return cls.join(" ");
    })
    .attr("points", (d) => hexPoints(NODE_RADIUS[d.type]))
    .attr("fill", (d) => (d.type === "erp" ? erpFillFor(d) : NODE_COLOR[d.type]));

  // Inset orange hex on company-level modules — mirrors the Procore
  // logomark (black hex with orange center) per the Identity guide.
  node
    .filter((d) => d.type === "module" && d.tier === "company")
    .append("polygon")
    .attr("class", "node-hex-inner")
    .attr("points", hexPoints(NODE_RADIUS.module * 0.42))
    .attr("fill", "#FF5200");

  // (Dual-source "both" ERPs are no longer rendered as a single node
  // with a metal ring — they now exist as two separate nodes, one in
  // the Procore-native column and one in the Agave column.)

  // Labels read OUTWARD from each ERP column (Procore-native = label to
  // the left; Agave Sync = label to the right). Module labels sit
  // BELOW the hex (centered) because the middle column can't put
  // labels on either side without colliding with incoming lines from
  // the ERPs on both sides.
  //
  // When a module has a `tool` field (Directory, WBS, Project WBS) we
  // render it as a small DM Mono "eyebrow" label ABOVE the hex — making
  // the tool-architecture relationship visible (Directory ▸ Companies,
  // WBS ▸ Cost Codes, etc.).
  function labelX(d) {
    if (d.type === "module") return 0;
    return -(NODE_RADIUS.erp + 10);
  }
  function labelY(d) {
    if (d.type === "module") return NODE_RADIUS.module + 16;
    return 4;
  }
  function labelAnchor(d) {
    if (d.type === "module") return "middle";
    return "end";
  }

  node
    .filter((d) => !!d.tool)
    .append("text")
    .attr("class", "node-tool-label")
    .attr("x", (d) => (d.type === "module" ? 0 : labelX(d)))
    .attr("y", (d) => (d.type === "module" ? -(NODE_RADIUS.module + 8) : -8))
    .attr("text-anchor", (d) => (d.type === "module" ? "middle" : labelAnchor(d)))
    .text((d) => d.tool);

  node
    .append("text")
    .attr("class", "node-label")
    .attr("x", labelX)
    .attr("y", labelY)
    .attr("text-anchor", labelAnchor)
    .text((d) => d.label);

  // ---------------------------------------------------------------------
  // Side panel
  // ---------------------------------------------------------------------

  const detailsEl = document.getElementById("details");
  const titleEl = document.getElementById("details-title");
  const emptyTextEl = document.getElementById("details-empty-text");
  const contentEl = document.getElementById("details-content");
  const typeEl = document.getElementById("details-type");
  const connectorEl = document.getElementById("details-connector");
  const linkEl = document.getElementById("details-link");
  const overviewEl = document.getElementById("details-overview");
  const resourcesSectionEl = document.getElementById("details-resources-section");
  const resourcesEl = document.getElementById("details-resources");
  const ttkSectionEl = document.getElementById("details-ttk-section");
  const ttkEl = document.getElementById("details-ttk");
  const connectionsEl = document.getElementById("details-connections");

  // In-page assistant elements + NotebookLM config (data.assistants).
  const NOTEBOOKS = data.assistants || {};
  const aiContextEl = document.getElementById("details-ai-link");
  const aiAgaveEl = document.getElementById("assistant-ai-agave");
  const aiProcoreEl = document.getElementById("assistant-ai-procore");
  const searchEl = document.getElementById("assistant-search");
  const searchClearEl = document.getElementById("assistant-search-clear");
  const resultsEl = document.getElementById("assistant-results");
  const detailsMainEl = document.getElementById("details-main");

  // SOP Builder elements + state.
  const sopBuildBtn = document.getElementById("sop-build-btn");
  const sopModal = document.getElementById("sop-modal");
  let sopErpNode = null; // the ERP node the builder is scoped to

  // Connector-source filter. The map shows one company's connectors at a
  // time (Procore-native vs Agave Sync), defaulting to Procore, so the
  // canvas stays readable as more connectors are added.
  let activeSource = "procore";
  let activeErpIds = new Set(procoreERPs.map((n) => n.id));

  // Build a deep link from a connection card to the relevant docs.
  //
  // Procore-native ERPs: link to the ERP's "Detailed Data Mapping" page
  // on v2.support.procore.com, scrolled to the exact section heading
  // via the Text Fragments syntax (#:~:text=). Each ERP carries a
  // `dataMappingSections` map (module id → literal heading text).
  //
  // Agave ERPs: each data type has its own dedicated page on
  // sync-docs.agaveapi.com, so we link directly via the ERP's
  // `connectionUrls` map (module id → specific page URL). No text
  // fragment needed — the whole page is the section.
  function buildMappingUrl(link) {
    const a = link.source;
    const b = link.target;
    const erp = a.type === "erp" ? a : b.type === "erp" ? b : null;
    const mod = a.type === "module" ? a : b.type === "module" ? b : null;
    if (!erp || !mod) return null;

    // Agave path — direct URL per data type.
    if (erp.via === "agave") {
      const direct = (erp.connectionUrls || {})[mod.id];
      if (direct) return direct;
      return erp.agaveResourceUrl || erp.supportUrl || null;
    }

    // Procore-native path — Text Fragments anchor to the section heading.
    const dm = (erp.resources || []).find((r) => r.label === "Data Mapping");
    const baseUrl = dm ? dm.url : erp.supportUrl;
    if (!baseUrl) return null;

    const sections = erp.dataMappingSections || {};
    const exactHeading = sections[mod.id];

    if (exactHeading) {
      return baseUrl + "#:~:text=" + encodeURIComponent(exactHeading);
    }

    // Fallback for any link not covered by an explicit mapping: try the
    // tool name and cleaned label as candidate text fragments.
    const cleanLabel = mod.label
      .replace(/\s*\([^)]*\)/g, "")
      .split(/\s*\/\s*/)[0]
      .trim();

    const candidates = [];
    if (mod.tool) candidates.push(mod.tool);
    if (cleanLabel && cleanLabel !== mod.tool) candidates.push(cleanLabel);

    if (!candidates.length) return baseUrl;
    const fragments = candidates.map((c) => "text=" + encodeURIComponent(c)).join("&");
    return baseUrl + "#:~:" + fragments;
  }

  function symbolFor(link, fromNodeId) {
    if (link.direction === "both") return DIRECTION_SYMBOLS.both;
    const isSource = link.source.id === fromNodeId;
    if (link.direction === "from-erp") {
      return isSource ? DIRECTION_SYMBOLS.outbound : DIRECTION_SYMBOLS.inbound;
    }
    if (link.direction === "to-erp") {
      return isSource ? DIRECTION_SYMBOLS.inbound : DIRECTION_SYMBOLS.outbound;
    }
    return DIRECTION_SYMBOLS.both;
  }

  function selectNode(id) {
    const n = nodesById.get(id);
    if (!n) return;

    titleEl.textContent = n.label;
    detailsEl.classList.remove("details-empty");
    emptyTextEl.hidden = true;
    contentEl.hidden = false;

    // Retool the side panel based on what kind of node was selected.
    // - For Agave ERPs: type chip says "Agave Sync · [ERP Name]" and
    //   the panel gets a Metal accent class so CSS can paint it.
    // - For Procore-native ERPs: type chip says "Procore Native";
    //   panel gets the orange accent.
    // - For Procore modules: type chip says the tier.
    detailsEl.classList.remove("details-agave", "details-procore-native");
    if (n.type === "erp") {
      if (n.via === "agave") {
        typeEl.textContent = "Agave Sync · " + n.label;
        detailsEl.classList.add("details-agave");
      } else {
        typeEl.textContent = "Procore Native · " + n.label;
        detailsEl.classList.add("details-procore-native");
      }
    } else {
      typeEl.textContent =
        n.tier === "company" ? "Procore Tool · Company Level"
        : "Procore Tool · Project Level";
    }

    if (n.connector) {
      connectorEl.textContent = "Connector type: " + n.connector;
      connectorEl.style.display = "";
    } else {
      connectorEl.style.display = "none";
    }

    if (n.supportUrl) {
      linkEl.href = n.supportUrl;
      linkEl.style.display = "";
    } else {
      linkEl.style.display = "none";
    }

    // Context-aware NotebookLM link: Agave nodes → Agave notebook;
    // Procore-native ERPs and Procore modules → Procore notebook.
    let nbUrl = null;
    if (n.type === "erp") nbUrl = n.via === "agave" ? NOTEBOOKS.agave : NOTEBOOKS.procore;
    else nbUrl = NOTEBOOKS.procore;
    if (nbUrl) {
      aiContextEl.href = nbUrl;
      aiContextEl.textContent = "Ask the AI assistant about " + n.label + " ↗";
      aiContextEl.hidden = false;
    } else {
      aiContextEl.hidden = true;
    }

    // SOP Builder is connector-scoped: show the button only for ERP nodes.
    if (n.type === "erp" && sopTemplates && sopBuildBtn) {
      sopErpNode = n;
      sopBuildBtn.hidden = false;
      sopBuildBtn.textContent = "Build SOP document for " + n.label + " →";
    } else if (sopBuildBtn) {
      sopBuildBtn.hidden = true;
    }

    // Overview paragraph (ERP nodes only, when populated)
    if (n.overview) {
      overviewEl.textContent = n.overview;
      overviewEl.hidden = false;
    } else {
      overviewEl.hidden = true;
    }

    // Technical resources pill row
    resourcesEl.innerHTML = "";
    if (Array.isArray(n.resources) && n.resources.length) {
      n.resources.forEach((r) => {
        const a = document.createElement("a");
        a.className = "resource-pill";
        a.href = r.url;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = r.label;
        resourcesEl.appendChild(a);
      });
      resourcesSectionEl.hidden = false;
    } else {
      resourcesSectionEl.hidden = true;
    }

    // Things-to-Know list
    ttkEl.innerHTML = "";
    if (Array.isArray(n.thingsToKnow) && n.thingsToKnow.length) {
      n.thingsToKnow.forEach((t) => {
        const li = document.createElement("li");
        li.textContent = t;
        ttkEl.appendChild(li);
      });
      ttkSectionEl.hidden = false;
    } else {
      ttkSectionEl.hidden = true;
    }

    // Connections — each one rendered as a card with optional notes.
    // Only show connections to the currently-active connector source so
    // the panel matches what's on the map.
    const incidentLinks = linksByNode.get(n.id).filter((l) => {
      const erp = l.source.type === "erp" ? l.source : l.target;
      return erp && activeErpIds.has(erp.id);
    });
    connectionsEl.innerHTML = "";
    incidentLinks
      .map((l) => ({
        link: l,
        neighbor: l.source.id === n.id ? l.target : l.source
      }))
      .sort((a, b) => a.neighbor.label.localeCompare(b.neighbor.label))
      .forEach(({ link, neighbor }) => {
        const card = document.createElement("li");
        card.className = "connection-card";
        card.dataset.moduleId = neighbor.id;

        const mappingUrl = buildMappingUrl(link);
        const header = document.createElement("a");
        header.className = "connection-header";
        header.href = mappingUrl || "#";
        header.target = "_blank";
        header.rel = "noopener noreferrer";
        header.title = "Open data mapping for " + neighbor.label + " in a new tab";

        const sym = document.createElement("span");
        sym.className = "direction-symbol direction-" + link.direction;
        sym.textContent = symbolFor(link, n.id);
        const label = document.createElement("span");
        label.className = "connection-label";
        label.textContent = neighbor.label;
        const externalIcon = document.createElement("span");
        externalIcon.className = "connection-external";
        externalIcon.setAttribute("aria-hidden", "true");
        externalIcon.textContent = "↗";

        header.appendChild(sym);
        header.appendChild(label);
        header.appendChild(externalIcon);
        card.appendChild(header);

        // Configurable-direction toggle. Agave lets you choose which way
        // certain objects sync (the "one green + one grey arrow" rows in
        // Agave's sync matrix). For those links we render a 3-state
        // segmented control; flipping it updates the graph line and the
        // card's direction symbol live, in-session.
        if (link.configurable) {
          const erpNode = link.source.type === "erp" ? link.source : link.target;
          const erpName = erpNode ? erpNode.label : "ERP";

          const toggle = document.createElement("div");
          toggle.className = "direction-toggle";

          const cap = document.createElement("span");
          cap.className = "direction-toggle-cap";
          cap.textContent = "Agave-configurable direction";
          toggle.appendChild(cap);

          const group = document.createElement("div");
          group.className = "direction-toggle-buttons";
          group.setAttribute("role", "group");
          group.setAttribute("aria-label", "Sync direction for " + neighbor.label);

          const OPTIONS = [
            { dir: "to-erp",   glyph: "→", text: "Export", title: "Procore → " + erpName },
            { dir: "both",     glyph: "↔", text: "Both",   title: "Procore ↔ " + erpName },
            { dir: "from-erp", glyph: "←", text: "Import", title: erpName + " → Procore" }
          ];

          const btns = [];
          OPTIONS.forEach((opt) => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "direction-toggle-btn";
            b.dataset.dir = opt.dir;
            b.title = opt.title;
            b.innerHTML =
              '<span class="dt-glyph">' + opt.glyph + '</span>' +
              '<span class="dt-text">' + opt.text + "</span>";
            b.setAttribute("aria-pressed", String(link.direction === opt.dir));
            b.classList.toggle("is-active", link.direction === opt.dir);
            b.addEventListener("click", (ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              if (link.direction === opt.dir) return;
              link.direction = opt.dir;
              // Update graph line
              restyleLinkDirection(link);
              // Update this card's direction symbol
              sym.className = "direction-symbol direction-" + link.direction;
              sym.textContent = symbolFor(link, n.id);
              // Update button active states
              btns.forEach((bb) => {
                const on = bb.dataset.dir === link.direction;
                bb.classList.toggle("is-active", on);
                bb.setAttribute("aria-pressed", String(on));
              });
            });
            btns.push(b);
            group.appendChild(b);
          });

          toggle.appendChild(group);
          card.appendChild(toggle);
        }

        if (Array.isArray(link.notes) && link.notes.length) {
          const notes = document.createElement("ul");
          notes.className = "connection-notes";
          link.notes.forEach((noteText) => {
            const noteLi = document.createElement("li");
            noteLi.textContent = noteText;
            notes.appendChild(noteLi);
          });
          card.appendChild(notes);
        }

        connectionsEl.appendChild(card);
      });

    const neighborIds = new Set(
      incidentLinks.map((l) => (l.source.id === n.id ? l.target.id : l.source.id))
    );
    neighborIds.add(n.id);

    node.classed("selected", (d) => d.id === n.id);
    node.classed("dimmed", (d) => !neighborIds.has(d.id));
    link
      .classed("highlighted", (d) => d.source.id === n.id || d.target.id === n.id)
      .classed("dimmed", (d) => d.source.id !== n.id && d.target.id !== n.id);
  }

  function deselect() {
    detailsEl.classList.add("details-empty");
    detailsEl.classList.remove("details-agave", "details-procore-native");
    emptyTextEl.hidden = false;
    contentEl.hidden = true;
    overviewEl.hidden = true;
    resourcesSectionEl.hidden = true;
    ttkSectionEl.hidden = true;
    titleEl.textContent = "Select a node";
    node.classed("selected", false).classed("dimmed", false);
    link.classed("highlighted", false).classed("dimmed", false);
  }

  svg.on("click", function (event) {
    if (event.target === this || event.target.tagName === "svg") deselect();
  });

  // ---------------------------------------------------------------------
  // Connector-source filter (Procore-native vs Agave Sync)
  // ---------------------------------------------------------------------
  // Show one company's connectors at a time. We hide the other source's
  // nodes + links and crop the viewBox to the active half of the bipartite
  // layout, so the empty column disappears and the modules stay in view.
  function applySource(source) {
    activeSource = source === "agave" ? "agave" : "procore";
    const activeErps = activeSource === "agave" ? agaveERPs : procoreERPs;
    activeErpIds = new Set(activeErps.map((n) => n.id));

    // Hide the inactive source's nodes + links.
    node.classed("src-hidden", (d) => d.type === "erp" && !activeErpIds.has(d.id));
    link.classed("src-hidden", (d) => {
      const erp = d.source.type === "erp" ? d.source : d.target;
      return erp && !activeErpIds.has(erp.id);
    });

    // Re-layout: active ERPs always live in the LEFT column. Recompute
    // vertical spacing so 8 Agave ERPs aren't crammed at the top of a
    // column sized for 15 Procore ERPs (and vice versa).
    const activeColHeight = activeErps.length * ROW_HEIGHT;
    const layoutHeight = HEADER_HEIGHT + Math.max(activeColHeight, moduleStackHeight) + FOOTER_PAD;
    const spacing = (layoutHeight - HEADER_HEIGHT - FOOTER_PAD) / Math.max(activeErps.length, 1);
    activeErps.forEach((n, i) => {
      n.x = leftX;
      n.y = HEADER_HEIGHT + spacing * (i + 0.5);
    });

    // Refresh transforms + link endpoints for the new positions.
    node.attr("transform", (d) => "translate(" + d.x + "," + d.y + ")");
    link.each(function (d) {
      const e = endpoint(d);
      d3.select(this).attr("x1", e.x1).attr("y1", e.y1).attr("x2", e.x2).attr("y2", e.y2);
    });

    // Both source headers sit at leftX; only the active one is visible.
    d3.select(".column-header-procore")
      .attr("display", activeSource === "procore" ? null : "none")
      .attr("x", leftX);
    d3.select(".column-header-agave")
      .attr("display", activeSource === "agave" ? null : "none")
      .attr("x", leftX);

    // Full layout viewBox — no crop needed since ERPs are always on the left.
    svg.attr("viewBox", [0, 0, layoutWidth, layoutHeight].join(" "));
    svg.call(zoom.transform, d3.zoomIdentity);
    deselect();
  }

  const srcProcoreBtn = document.getElementById("src-procore");
  const srcAgaveBtn = document.getElementById("src-agave");
  function setSource(source) {
    applySource(source);
    if (srcProcoreBtn && srcAgaveBtn) {
      srcProcoreBtn.classList.toggle("is-active", activeSource === "procore");
      srcAgaveBtn.classList.toggle("is-active", activeSource === "agave");
      srcProcoreBtn.setAttribute("aria-pressed", String(activeSource === "procore"));
      srcAgaveBtn.setAttribute("aria-pressed", String(activeSource === "agave"));
    }
  }
  if (srcProcoreBtn) srcProcoreBtn.addEventListener("click", () => setSource("procore"));
  if (srcAgaveBtn) srcAgaveBtn.addEventListener("click", () => setSource("agave"));

  // Default the map to Procore's connectors.
  setSource("procore");

  // ---------------------------------------------------------------------
  // Mode toggle: ERP Connector Map  vs  PNPT Package Builder
  // ---------------------------------------------------------------------
  const modeErpBtn = document.getElementById("mode-erp");
  const modePackagesBtn = document.getElementById("mode-packages");
  const packagesView = document.getElementById("packages-view");
  const packagesTierToggle = document.getElementById("packages-tier-toggle");
  const packagesGraphEl = document.getElementById("packages-graph");
  const packagesDetailsEl = document.getElementById("packages-details");
  const headerTitleEl = document.getElementById("header-title");
  const headerSubtitleEl = document.getElementById("header-subtitle");
  const headerEyebrowEl = document.getElementById("header-eyebrow-text");

  // Elements that belong to the ERP view; hidden in package mode.
  const erpOnlyEls = [
    document.querySelector(".source-toggle"),
    document.querySelector(".legend"),
    document.getElementById("graph"),
    document.getElementById("details"),
  ];

  let activeVertical = "gc"; // default vertical: General Contractor
  let activePackage = null;
  let selectedPackageToolId = null; // which tool's details are shown in the side panel
  const activeTierKeys = new Set();

  function verticalsList() {
    return packagesData.verticals || [];
  }
  function packagesAvailableForActiveVertical() {
    return (packagesData.packages || []).filter(
      (p) => !p.availableFor || p.availableFor.includes(activeVertical)
    );
  }
  // Look a tool object up by id within the active package.
  function packageToolById(id) {
    if (!activePackage || !activePackage.tools) return null;
    return activePackage.tools.find((t) => t.id === id) || null;
  }
  // Tools the tier exposes for the active vertical.
  // toolIds (preferred new schema) reference the package-level tools array;
  // toolsByVertical can override per vertical with an array of toolIds.
  function toolsForTier(tier) {
    let ids = tier.toolIds || [];
    if (tier.toolsByVertical && tier.toolsByVertical[activeVertical]) {
      ids = tier.toolsByVertical[activeVertical];
    }
    return ids.map(packageToolById).filter(Boolean);
  }
  // Tool display name, with optional per-vertical override.
  function toolNameFor(t) {
    return (t.names && t.names[activeVertical]) || t.name;
  }

  // Pick the initial package + tier from the GC default.
  function refreshActivePackageForVertical() {
    const avail = packagesAvailableForActiveVertical();
    if (!activePackage || !avail.includes(activePackage)) {
      activePackage = avail[0] || null;
      activeTierKeys.clear();
      if (activePackage && activePackage.tiers && activePackage.tiers.length) {
        activeTierKeys.add(activePackage.tiers[0].key);
      }
    }
  }
  refreshActivePackageForVertical();

  function setMode(mode) {
    const isPackages = mode === "packages";
    erpOnlyEls.forEach((el) => { if (el) el.hidden = isPackages; });
    if (packagesView) packagesView.hidden = !isPackages;

    // SOP button only in ERP mode.
    const sopTopBtn = document.getElementById("sop-open-top");
    if (sopTopBtn) sopTopBtn.hidden = isPackages || !sopTemplates;

    if (modeErpBtn) {
      modeErpBtn.classList.toggle("is-active", !isPackages);
      modeErpBtn.setAttribute("aria-pressed", String(!isPackages));
    }
    if (modePackagesBtn) {
      modePackagesBtn.classList.toggle("is-active", isPackages);
      modePackagesBtn.setAttribute("aria-pressed", String(isPackages));
    }

    // Header text adapts to the mode.
    if (isPackages) {
      if (headerEyebrowEl) headerEyebrowEl.textContent = "Professional Services";
      if (headerTitleEl) headerTitleEl.textContent = "PNPT Package Builder";
      if (headerSubtitleEl) headerSubtitleEl.textContent =
        "Pick one or more tiers to see which tools you get in each, and how the tiers differ.";
      if (activePackage) renderPackagesView();
    } else {
      if (headerEyebrowEl) headerEyebrowEl.textContent = "ERP Integrations";
      if (headerTitleEl) headerTitleEl.textContent = "ERP Connector Map";
      if (headerSubtitleEl) headerSubtitleEl.textContent =
        "ERP connectors on the left, Procore modules on the right. Click any node to see its support documentation and the data objects it syncs.";
    }
  }

  if (modeErpBtn) modeErpBtn.addEventListener("click", () => setMode("erp"));
  if (modePackagesBtn) modePackagesBtn.addEventListener("click", () => setMode("packages"));

  // ---------- Packages view rendering ----------
  function renderPackagesView() {
    renderPackagesVerticalToggle();
    if (!activePackage) {
      document.getElementById("packages-title").textContent = "No packages for this vertical";
      packagesGraphEl.innerHTML = "<p class='packages-empty' style='padding:24px;'>No packages are available for the selected vertical yet.</p>";
      packagesDetailsEl.innerHTML = "";
      packagesTierToggle.innerHTML = "";
      return;
    }
    document.getElementById("packages-title").textContent = activePackage.name;
    renderPackagesTierToggle();
    renderPackagesGraph();
    renderPackagesDetails();
  }

  function renderPackagesVerticalToggle() {
    const cont = document.getElementById("packages-vertical-toggle");
    if (!cont) return;
    cont.innerHTML = "";
    const label = document.createElement("span");
    label.className = "packages-toggle-label";
    label.textContent = "Vertical";
    cont.appendChild(label);
    verticalsList().forEach((v) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "packages-vertical-btn";
      btn.textContent = v.shortName || v.name;
      btn.title = v.name;
      if (v.key === activeVertical) btn.classList.add("is-active");
      btn.setAttribute("aria-pressed", String(v.key === activeVertical));
      btn.addEventListener("click", () => {
        if (activeVertical === v.key) return;
        activeVertical = v.key;
        refreshActivePackageForVertical();
        renderPackagesView();
      });
      cont.appendChild(btn);
    });
  }

  function renderPackagesTierToggle() {
    packagesTierToggle.innerHTML = "";
    const label = document.createElement("span");
    label.className = "packages-toggle-label";
    label.textContent = "Tiers";
    packagesTierToggle.appendChild(label);
    activePackage.tiers.forEach((tier) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "packages-tier-btn";
      btn.textContent = tier.shortName || tier.name;
      btn.style.setProperty("--tier-color", tier.color || "#FF5200");
      if (activeTierKeys.has(tier.key)) btn.classList.add("is-active");
      btn.setAttribute("aria-pressed", String(activeTierKeys.has(tier.key)));
      btn.title = tier.name + (tier.hours ? " — " + tier.hours + " hrs" : "");
      btn.addEventListener("click", () => {
        if (activeTierKeys.has(tier.key)) {
          // Keep at least one tier selected.
          if (activeTierKeys.size > 1) activeTierKeys.delete(tier.key);
        } else {
          activeTierKeys.add(tier.key);
        }
        renderPackagesTierToggle();
        renderPackagesGraph();
        renderPackagesDetails();
      });
      packagesTierToggle.appendChild(btn);
    });
  }

  function selectedTiers() {
    return activePackage.tiers.filter((t) => activeTierKeys.has(t.key));
  }

  // Node-link diagram of the package's tools. ALL package-level tools are
  // rendered as hex nodes at their declared positions. Selected tier(s)
  // highlight their tools; non-tier tools dim. Connections between tools
  // use the ERP-map line conventions: solid orange = bidirectional,
  // dashed orange = "to" (source -> target), dashed black = "from".
  function renderPackagesGraph() {
    packagesGraphEl.innerHTML = "";
    if (!activePackage || !activePackage.tools) return;
    const tiers = selectedTiers();
    const NODE_R = 22;

    // Map: toolId -> Set of tier objects that include it (intersected with selected tiers).
    const activeTiersForTool = new Map();
    activePackage.tools.forEach((t) => activeTiersForTool.set(t.id, []));
    tiers.forEach((tier) => {
      (tier.toolIds || []).forEach((id) => {
        if (activeTiersForTool.has(id)) activeTiersForTool.get(id).push(tier);
      });
    });
    const isActive = (toolId) => (activeTiersForTool.get(toolId) || []).length > 0;
    const primaryTierFor = (toolId) => {
      const list = activeTiersForTool.get(toolId);
      return list && list.length ? list[0] : null; // tier order in JSON wins
    };

    // ViewBox: derive from the spread of tool positions so the graph fits
    // any package's layout.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    activePackage.tools.forEach((t) => {
      if (!t.position) return;
      if (t.position.x < minX) minX = t.position.x;
      if (t.position.y < minY) minY = t.position.y;
      if (t.position.x > maxX) maxX = t.position.x;
      if (t.position.y > maxY) maxY = t.position.y;
    });
    const PAD = 80;
    const vbX = minX - PAD, vbY = minY - PAD;
    const vbW = (maxX - minX) + PAD * 2;
    const vbH = (maxY - minY) + PAD * 2;

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", vbX + " " + vbY + " " + vbW + " " + vbH);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

    // Endpoints sit at the hex edges (matches the ERP map's endpoint helper).
    function endpoints(srcId, tgtId) {
      const s = packageToolById(srcId);
      const t = packageToolById(tgtId);
      if (!s || !t || !s.position || !t.position) return null;
      const sx = s.position.x, sy = s.position.y;
      const tx = t.position.x, ty = t.position.y;
      const dx = tx - sx, dy = ty - sy;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / dist, uy = dy / dist;
      return { x1: sx + ux * NODE_R, y1: sy + uy * NODE_R, x2: tx - ux * NODE_R, y2: ty - uy * NODE_R };
    }

    // Selection bookkeeping: when a tool is selected, its neighbor set stays
    // bright while everything else fades, mirroring the ERP map's highlight.
    const neighborIds = new Set();
    if (selectedPackageToolId) {
      neighborIds.add(selectedPackageToolId);
      (activePackage.connections || []).forEach((c) => {
        if (c.source === selectedPackageToolId) neighborIds.add(c.target);
        if (c.target === selectedPackageToolId) neighborIds.add(c.source);
      });
    }

    // Draw connection lines below the nodes.
    (activePackage.connections || []).forEach((conn) => {
      const ep = endpoints(conn.source, conn.target);
      if (!ep) return;
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", ep.x1);
      line.setAttribute("y1", ep.y1);
      line.setAttribute("x2", ep.x2);
      line.setAttribute("y2", ep.y2);
      line.setAttribute("class", "pkg-link dir-" + (conn.direction || "to"));
      // Dim if either endpoint isn't in the active tier(s).
      if (!isActive(conn.source) || !isActive(conn.target)) {
        line.classList.add("dimmed");
      }
      if (selectedPackageToolId) {
        const touchesSel = conn.source === selectedPackageToolId || conn.target === selectedPackageToolId;
        if (touchesSel) line.classList.add("highlighted");
        else line.classList.add("faded");
      }
      svg.appendChild(line);
    });

    // Draw nodes on top.
    activePackage.tools.forEach((tool) => {
      if (!tool.position) return;
      const g = document.createElementNS(svgNS, "g");
      g.setAttribute("transform", "translate(" + tool.position.x + "," + tool.position.y + ")");
      let cls = "pkg-node" + (isActive(tool.id) ? "" : " inactive");
      if (selectedPackageToolId) {
        if (tool.id === selectedPackageToolId) cls += " selected";
        else if (!neighborIds.has(tool.id)) cls += " faded";
      }
      g.setAttribute("class", cls);
      const tier = primaryTierFor(tool.id);
      const fill = tier ? (tier.color || "#000") : "#999";
      const poly = document.createElementNS(svgNS, "polygon");
      poly.setAttribute("points", hexPoints(NODE_R));
      poly.setAttribute("fill", fill);
      g.appendChild(poly);

      const label = document.createElementNS(svgNS, "text");
      label.setAttribute("x", 0);
      label.setAttribute("y", NODE_R + 18);
      label.setAttribute("class", "pkg-node-label");
      label.textContent = toolNameFor(tool);
      g.appendChild(label);

      if (tool.constraint) {
        const sub = document.createElementNS(svgNS, "text");
        sub.setAttribute("x", 0);
        sub.setAttribute("y", NODE_R + 32);
        sub.setAttribute("class", "pkg-node-constraint");
        sub.textContent = tool.constraint;
        g.appendChild(sub);
      }
      g.addEventListener("click", (ev) => {
        ev.stopPropagation();
        selectPackageTool(tool.id);
      });
      svg.appendChild(g);
    });

    // Click on empty SVG background -> deselect.
    svg.addEventListener("click", () => selectPackageTool(null));

    packagesGraphEl.appendChild(svg);
  }

  function selectPackageTool(id) {
    selectedPackageToolId = id;
    renderPackagesGraph();
    renderPackagesDetails();
  }

  // Default verbs when a connection doesn't supply its own — keeps the
  // relationship readable even before someone curates the wording.
  function defaultVerb(direction, isReverse) {
    if (direction === "both") return "syncs with";
    if (direction === "from") return isReverse ? "pushes data to" : "receives data from";
    // direction === "to"
    return isReverse ? "receives data from" : "pushes data to";
  }

  function renderPackagesToolDetail(toolId) {
    const tool = packageToolById(toolId);
    if (!tool) return;

    const cont = packagesDetailsEl;
    const wrap = document.createElement("section");
    wrap.className = "pkg-tool-detail";

    const back = document.createElement("button");
    back.type = "button";
    back.className = "pkg-tool-back";
    back.textContent = "← Back to package overview";
    back.addEventListener("click", () => selectPackageTool(null));
    wrap.appendChild(back);

    const h = document.createElement("h2");
    h.className = "pkg-tool-title";
    h.textContent = toolNameFor(tool);
    wrap.appendChild(h);

    // tier badges that include this tool
    const includingTiers = activePackage.tiers.filter((t) => (t.toolIds || []).includes(tool.id));
    if (includingTiers.length) {
      const tiers = document.createElement("div");
      tiers.className = "pkg-tool-tiers";
      includingTiers.forEach((tier) => {
        const b = document.createElement("span");
        b.className = "tier-badge";
        b.style.background = tier.color || "#000";
        b.textContent = tier.shortName || tier.name;
        tiers.appendChild(b);
      });
      wrap.appendChild(tiers);
    }

    if (tool.description) {
      const p = document.createElement("p");
      p.className = "pkg-tool-desc";
      p.textContent = tool.description;
      wrap.appendChild(p);
    }
    if (tool.supportUrl) {
      const a = document.createElement("a");
      a.className = "pkg-tool-link";
      a.href = tool.supportUrl;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "Open support documentation →";
      wrap.appendChild(a);
    }
    cont.appendChild(wrap);

    // Group every connection touching this tool by the verb from THIS
    // tool's perspective. e.g. Budget "receives data from" Direct Cost,
    // Budget "is created by" Estimating, Budget "syncs with" Reports.
    const groups = new Map(); // verb -> [{other, conn, arrow}]
    (activePackage.connections || []).forEach((c) => {
      if (c.source !== tool.id && c.target !== tool.id) return;
      const isSource = c.source === tool.id;
      const other = isSource ? c.target : c.source;
      let verb;
      let arrow;
      if (c.direction === "both") {
        verb = c.verbForward || c.verbReverse || defaultVerb("both");
        arrow = "↔";
      } else if (isSource) {
        verb = c.verbForward || defaultVerb(c.direction, false);
        arrow = c.direction === "to" ? "→" : "←";
      } else {
        verb = c.verbReverse || defaultVerb(c.direction, true);
        arrow = c.direction === "to" ? "←" : "→";
      }
      if (!groups.has(verb)) groups.set(verb, []);
      groups.get(verb).push({ other, conn: c, arrow });
    });

    // Render each verb group as its own section.
    groups.forEach((items, verb) => {
      const sec = document.createElement("section");
      sec.className = "pkg-rel-section";
      const head = document.createElement("h4");
      head.textContent = verb.charAt(0).toUpperCase() + verb.slice(1);
      sec.appendChild(head);
      const ul = document.createElement("ul");
      ul.className = "pkg-rel-list";
      items.forEach(({ other, conn, arrow }) => {
        const otherTool = packageToolById(other);
        const otherLabel = otherTool ? toolNameFor(otherTool) : other;
        const li = document.createElement("li");
        li.className = "pkg-rel-card";
        const headEl = document.createElement("div");
        headEl.className = "pkg-rel-card-head";
        const arr = document.createElement("span");
        arr.className = "pkg-rel-arrow";
        arr.textContent = arrow;
        headEl.appendChild(arr);
        const lbl = document.createElement("span");
        lbl.textContent = otherLabel;
        headEl.appendChild(lbl);
        li.appendChild(headEl);
        if (conn.description) {
          const desc = document.createElement("p");
          desc.className = "pkg-rel-desc";
          desc.textContent = conn.description;
          li.appendChild(desc);
        }
        li.addEventListener("click", () => selectPackageTool(other));
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      cont.appendChild(sec);
    });
  }

  function renderPackagesDetails() {
    packagesDetailsEl.innerHTML = "";

    // If a tool is selected, render its details + relationships instead of
    // the tier overview. A "Back" affordance returns to the tier view.
    if (selectedPackageToolId) {
      renderPackagesToolDetail(selectedPackageToolId);
      return;
    }

    const tiers = selectedTiers();
    if (!tiers.length) {
      packagesDetailsEl.innerHTML = "<p class='packages-empty'>Select a tier above.</p>";
      return;
    }
    tiers.forEach((tier) => {
      const sec = document.createElement("section");
      sec.className = "packages-tier-detail";
      sec.style.setProperty("--tier-color", tier.color || "#FF5200");

      const header = document.createElement("header");
      header.className = "packages-tier-header";
      const dot = document.createElement("span");
      dot.className = "packages-tier-dot";
      dot.style.background = tier.color || "#FF5200";
      header.appendChild(dot);
      const info = document.createElement("div");
      const h3 = document.createElement("h3");
      h3.textContent = tier.name;
      info.appendChild(h3);
      const stats = document.createElement("p");
      stats.className = "packages-tier-stats";
      const parts = [];
      if (tier.hours) parts.push(tier.hours + " hours");
      if (tier.duration) parts.push(tier.duration);
      if (tier.pricing) {
        if (tier.pricing.comm != null) parts.push("COMM $" + tier.pricing.comm.toLocaleString());
        if (tier.pricing.smb != null) parts.push("SMB $" + tier.pricing.smb.toLocaleString());
      }
      stats.textContent = parts.join(" · ");
      info.appendChild(stats);
      header.appendChild(info);
      sec.appendChild(header);

      if (tier.note) {
        const note = document.createElement("p");
        note.className = "packages-tier-note";
        note.textContent = tier.note;
        sec.appendChild(note);
      }

      function appendList(heading, items) {
        if (!items || !items.length) return;
        const h = document.createElement("h4");
        h.textContent = heading;
        sec.appendChild(h);
        const ul = document.createElement("ul");
        ul.className = "packages-list";
        items.forEach((s) => {
          const li = document.createElement("li");
          li.textContent = s;
          ul.appendChild(li);
        });
        sec.appendChild(ul);
      }
      appendList("Scope", tier.scope);
      appendList("Deliverables", tier.deliverables);
      packagesDetailsEl.appendChild(sec);
    });

    // Diff section: tools that are exclusive to one of the selected tiers.
    if (tiers.length > 1) {
      const counts = new Map();
      tiers.forEach((tier) => {
        toolsForTier(tier).forEach((t) => {
          const key = toolNameFor(t);
          if (!counts.has(key)) counts.set(key, new Set());
          counts.get(key).add(tier.key);
        });
      });
      const exclusiveByTier = {};
      tiers.forEach((t) => (exclusiveByTier[t.key] = []));
      counts.forEach((tierKeys, name) => {
        if (tierKeys.size === 1) {
          exclusiveByTier[Array.from(tierKeys)[0]].push(name);
        }
      });
      const diffEntries = tiers
        .map((tier) => ({ tier, list: exclusiveByTier[tier.key] }))
        .filter((e) => e.list.length);
      if (diffEntries.length) {
        const diff = document.createElement("section");
        diff.className = "packages-diff";
        const h = document.createElement("h4");
        h.textContent = "Tier-exclusive tools";
        diff.appendChild(h);
        diffEntries.forEach(({ tier, list }) => {
          const row = document.createElement("div");
          row.className = "packages-diff-tier";
          const dot = document.createElement("span");
          dot.className = "packages-tier-dot";
          dot.style.background = tier.color || "#000";
          row.appendChild(dot);
          const txt = document.createElement("span");
          const strong = document.createElement("strong");
          strong.textContent = (tier.shortName || tier.name) + " only: ";
          txt.appendChild(strong);
          txt.appendChild(document.createTextNode(list.join(", ")));
          row.appendChild(txt);
          diff.appendChild(row);
        });
        packagesDetailsEl.appendChild(diff);
      }
    }
  }

  // ---------------------------------------------------------------------
  // In-page assistant: doc finder + NotebookLM links
  // ---------------------------------------------------------------------
  // No backend or API key: a static, client-side search over the connector
  // knowledge already in data.json (overviews, things-to-know, and
  // per-connection notes). For conversational follow-up, the Ask-AI links
  // hand off to the NotebookLM notebooks (Agave / Procore corpora).

  // Wire the always-visible Ask-AI buttons.
  if (NOTEBOOKS.agave) aiAgaveEl.href = NOTEBOOKS.agave; else aiAgaveEl.hidden = true;
  if (NOTEBOOKS.procore) aiProcoreEl.href = NOTEBOOKS.procore; else aiProcoreEl.hidden = true;

  // Vertex AI Search widget (Layer 2): conversational search over the FULL
  // Procore corpus. Activates only when a Config ID is present in
  // data.assistants.vertexConfigId — otherwise the trigger stays hidden so
  // the page works with no Google Cloud dependency. The widget binds to the
  // trigger button via triggerId and opens a modal search overlay.
  const vertexTriggerEl = document.getElementById("vertex-trigger");
  if (NOTEBOOKS.vertexConfigId && vertexTriggerEl) {
    const s = document.createElement("script");
    s.src = "https://cloud.google.com/ai/gen-app-builder/client?hl=en_US";
    s.async = true;
    document.head.appendChild(s);
    const widget = document.createElement("gen-search-widget");
    widget.setAttribute("configId", NOTEBOOKS.vertexConfigId);
    widget.setAttribute("triggerId", "vertex-trigger");
    document.body.appendChild(widget);
    vertexTriggerEl.hidden = false;
  }

  function describeDirection(dir) {
    if (dir === "both") return "bidirectional two-way sync";
    if (dir === "to-erp") return "Procore to ERP export outbound one-way";
    if (dir === "from-erp") return "ERP to Procore import inbound one-way";
    return "";
  }

  // Build the searchable corpus: one document per overview, per
  // thing-to-know, and per connection note (or per bare connection).
  const searchDocs = [];
  erpNodes.forEach((erp) => {
    const via = erp.via === "agave" ? "Agave Sync" : "Procore native";
    if (erp.overview) {
      searchDocs.push({ erpId: erp.id, moduleId: null, kind: "Overview", title: erp.label,
        snippet: erp.overview, text: [erp.label, erp.connector, via, erp.overview].join(" ") });
    }
    (erp.thingsToKnow || []).forEach((t) => {
      searchDocs.push({ erpId: erp.id, moduleId: null, kind: "Things to Know", title: erp.label,
        snippet: t, text: erp.label + " " + via + " " + t });
    });
  });
  visibleLinks.forEach((l) => {
    const erp = l.source.type === "erp" ? l.source : l.target;
    const mod = l.source.type === "module" ? l.source : l.target;
    if (!erp || !mod) return;
    const dir = describeDirection(l.direction);
    const flags = l.configurable ? "configurable selectable direction" : "";
    const base = [erp.label, mod.label, dir, flags].join(" ");
    if (Array.isArray(l.notes) && l.notes.length) {
      l.notes.forEach((n) => {
        searchDocs.push({ erpId: erp.id, moduleId: mod.id, kind: "Connection",
          title: erp.label + " · " + mod.label, snippet: n, text: base + " " + n });
      });
    } else {
      searchDocs.push({ erpId: erp.id, moduleId: mod.id, kind: "Connection",
        title: erp.label + " · " + mod.label, snippet: mod.label + " — " + dir, text: base });
    }
  });
  // Full Procore ERP support-doc chunks (deeper than the data.json notes).
  (extraDocs || []).forEach((d) => {
    const title = d.title + (d.heading ? " · " + d.heading : "");
    searchDocs.push({ erpId: null, moduleId: null, kind: "Procore Doc", isDoc: true,
      title: title, snippet: d.text, body: d.text, text: title + " " + d.text });
  });

  searchDocs.forEach((d) => (d._t = d.text.toLowerCase()));

  const STOP = new Set(["the","a","an","and","or","to","of","in","on","for","is","are","with",
    "how","do","does","i","my","can","when","what","why","it","this","that","from","at","be"]);
  function tokenize(q) {
    return q.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2 && !STOP.has(t));
  }

  function runSearch(query) {
    const terms = tokenize(query);
    if (!terms.length) return [];
    const phrase = query.trim().toLowerCase();
    const scored = [];
    for (const d of searchDocs) {
      let score = 0;
      let matchedTerms = 0;
      for (const term of terms) {
        let idx = d._t.indexOf(term), occ = 0;
        while (idx !== -1) { occ++; idx = d._t.indexOf(term, idx + term.length); }
        if (occ) {
          matchedTerms++;
          score += occ;
          if (d.title.toLowerCase().includes(term)) score += 4;
        }
      }
      if (!matchedTerms) continue;
      // Reward documents that match more of the distinct query terms.
      score += matchedTerms * 2;
      if (phrase.length >= 4 && d._t.includes(phrase)) score += 8;
      scored.push({ d, score });
    }
    scored.sort((a, b) => b.score - a.score || a.d.title.localeCompare(b.d.title));
    return scored.slice(0, 16).map((s) => s.d);
  }

  function escapeHtml(s) {
    return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }
  // For long doc chunks, show a window around the first matched term.
  function excerpt(text, terms, span) {
    span = span || 180;
    if (text.length <= span) return text;
    const lower = text.toLowerCase();
    let pos = -1;
    for (const t of terms) {
      const i = lower.indexOf(t);
      if (i !== -1 && (pos === -1 || i < pos)) pos = i;
    }
    if (pos === -1) return text.slice(0, span) + "…";
    const start = Math.max(0, pos - 60);
    const end = Math.min(text.length, start + span);
    return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
  }
  function highlight(text, terms) {
    const safe = escapeHtml(text);
    if (!terms.length) return safe;
    const re = new RegExp("(" + terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "gi");
    return safe.replace(re, "<mark>$1</mark>");
  }

  function flashConnection(moduleId) {
    const card = connectionsEl.querySelector('[data-module-id="' + (window.CSS && CSS.escape ? CSS.escape(moduleId) : moduleId) + '"]');
    if (!card) return;
    card.scrollIntoView({ block: "center", behavior: "smooth" });
    card.classList.add("flash");
    setTimeout(() => card.classList.remove("flash"), 1500);
  }

  function showResults() { resultsEl.hidden = false; detailsMainEl.hidden = true; }
  function hideResults() { resultsEl.hidden = true; resultsEl.innerHTML = ""; detailsMainEl.hidden = false; }

  function renderResults(query) {
    if (!query.trim()) { hideResults(); return; }
    const hits = runSearch(query);
    const terms = tokenize(query);
    resultsEl.innerHTML = "";
    showResults();

    const head = document.createElement("div");
    head.className = "assistant-results-head";
    head.textContent = hits.length
      ? hits.length + " match" + (hits.length > 1 ? "es" : "") + " in connector data"
      : "No matches in connector data";
    resultsEl.appendChild(head);

    if (!hits.length) {
      const hint = document.createElement("p");
      hint.className = "assistant-results-empty";
      hint.textContent = "Nothing in the connector knowledge base matched “" + query.trim() +
        "”. Try the Ask-AI links above for a conversational answer from the support docs.";
      resultsEl.appendChild(hint);
      return;
    }

    hits.forEach((d) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "assistant-result";

      const kind = document.createElement("span");
      kind.className = "assistant-result-kind kind-" + d.kind.toLowerCase().replace(/\s+/g, "-");
      kind.textContent = d.kind;

      const ttl = document.createElement("span");
      ttl.className = "assistant-result-title";
      ttl.textContent = d.title;

      const snip = document.createElement("span");
      snip.className = "assistant-result-snippet";
      snip.innerHTML = highlight(d.isDoc ? excerpt(d.snippet, terms) : d.snippet, terms);

      item.appendChild(kind);
      item.appendChild(ttl);
      item.appendChild(snip);
      item.addEventListener("click", () => {
        if (d.isDoc) {
          // Toggle the full passage inline (no node / public URL to open).
          const next = item.nextElementSibling;
          if (next && next.classList.contains("assistant-result-body")) { next.remove(); return; }
          const body = document.createElement("div");
          body.className = "assistant-result-body";
          body.innerHTML = highlight(d.body, terms);
          item.after(body);
          return;
        }
        clearSearch();
        selectNode(d.erpId);
        if (d.moduleId) flashConnection(d.moduleId);
      });
      resultsEl.appendChild(item);
    });
  }

  function clearSearch() {
    searchEl.value = "";
    searchClearEl.hidden = true;
    hideResults();
  }

  searchEl.addEventListener("input", () => {
    searchClearEl.hidden = !searchEl.value;
    renderResults(searchEl.value);
  });
  searchEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { clearSearch(); searchEl.blur(); }
  });
  searchClearEl.addEventListener("click", () => { clearSearch(); searchEl.focus(); });

  // ---------------------------------------------------------------------
  // SOP Builder: assign responsibilities per financial tool, then generate
  // a Word document that also embeds the live sync direction + best-practice
  // notes for this connector. Word doc is built client-side (HTML/.doc).
  // ---------------------------------------------------------------------
  if (sopTemplates && sopBuildBtn) {
    // Lookup: which modules each ERP syncs, with direction + notes.
    const linksByErp = {};
    visibleLinks.forEach((l) => {
      const erp = l.source.type === "erp" ? l.source : l.target;
      const mod = l.source.type === "module" ? l.source : l.target;
      if (!erp || !mod || erp.type !== "erp" || mod.type !== "module") return;
      (linksByErp[erp.id] = linksByErp[erp.id] || {})[mod.id] = l;
    });

    const sopToolsEl = document.getElementById("sop-tools");
    const sopTitleEl = document.getElementById("sop-modal-title");
    const sopFootNote = document.getElementById("sop-foot-note");

    function directionPhrase(dir, erpLabel) {
      if (dir === "both") return "syncs bidirectionally (Procore ↔ " + erpLabel + ")";
      if (dir === "to-erp") return "exports one-way from Procore to " + erpLabel;
      if (dir === "from-erp") return "imports one-way from " + erpLabel + " into Procore";
      return "sync direction not specified";
    }
    function moduleOf(link) {
      return link.source.type === "module" ? link.source : link.target;
    }

    function permissionOptionsFor(tool, erp) {
      // Procore-native ERPs: per-tool list derived from Procore's QBO ERP
      // Integration permissions matrix (Read Only never appears as an
      // allowed level for ERP-relevant actions; Direct Costs is Admin only).
      // Agave-Sync ERPs: full Read Only / Standard / Admin / None list.
      if (erp && erp.via !== "agave" && Array.isArray(tool.procorePermissionOptions)) {
        return tool.procorePermissionOptions;
      }
      return sopTemplates.permissionOptions;
    }

    function makeRow(actionText, tool, erp) {
      const row = document.createElement("div");
      row.className = "sop-row";
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.checked = true; cb.className = "sop-row-inc";
      const act = document.createElement("textarea");
      act.className = "sop-act"; act.rows = 2; act.value = actionText;
      const name = document.createElement("input");
      name.type = "text"; name.className = "sop-name"; name.placeholder = "Name";
      const role = document.createElement("input");
      role.type = "text"; role.className = "sop-role"; role.placeholder = "Role";
      role.setAttribute("list", "sop-role-list");
      const perm = document.createElement("select");
      perm.className = "sop-perm";
      perm.appendChild(new Option("—", ""));
      permissionOptionsFor(tool, erp).forEach((p) => perm.appendChild(new Option(p, p)));
      row.appendChild(cb); row.appendChild(act); row.appendChild(name); row.appendChild(role); row.appendChild(perm);
      return row;
    }

    function renderSopTool(tool, erp, erpLinks) {
      const sec = document.createElement("section");
      sec.className = "sop-tool";
      sec.dataset.toolKey = tool.key;

      const head = document.createElement("div");
      head.className = "sop-tool-head";
      const h = document.createElement("h3");
      h.textContent = tool.title;
      const inc = document.createElement("label");
      inc.className = "sop-tool-include";
      const incCb = document.createElement("input");
      incCb.type = "checkbox"; incCb.checked = true; incCb.className = "sop-tool-toggle";
      inc.appendChild(incCb);
      inc.appendChild(document.createTextNode(" Include"));
      head.appendChild(h); head.appendChild(inc);
      sec.appendChild(head);

      const sync = document.createElement("p");
      sync.className = "sop-tool-sync";
      const parts = tool.modules.filter((m) => erpLinks[m]).map((m) => {
        const mod = moduleOf(erpLinks[m]);
        return "<strong>" + escapeHtml(mod.label) + "</strong>: " + escapeHtml(directionPhrase(erpLinks[m].direction, erp.label));
      });
      sync.innerHTML = "Sync — " + parts.join("; ") + ".";
      sec.appendChild(sync);

      const table = document.createElement("div");
      table.className = "sop-rows";
      const hdr = document.createElement("div");
      hdr.className = "sop-row sop-row-hdr";
      hdr.innerHTML = "<span></span><span>Action</span><span>Name</span><span>Project role</span><span>Permission</span>";
      table.appendChild(hdr);
      tool.actions.forEach((a) => table.appendChild(makeRow(a.replace(/\{ERP\}/g, erp.label), tool, erp)));
      sec.appendChild(table);

      const add = document.createElement("button");
      add.type = "button"; add.className = "sop-add-row"; add.textContent = "+ Add action";
      add.addEventListener("click", () => table.appendChild(makeRow("", tool, erp)));
      sec.appendChild(add);
      return sec;
    }

    const sopErpPick = document.getElementById("sop-erp-pick");
    let sopPickerInit = false;

    function renderSopFor(erp) {
      sopErpNode = erp;
      sopTitleEl.textContent = "SOP — Procore + " + erp.label;
      sopToolsEl.innerHTML = "";
      const erpLinks = linksByErp[erp.id] || {};
      const applicable = sopTemplates.tools.filter((t) => t.modules.some((m) => erpLinks[m]));
      if (!applicable.length) {
        sopToolsEl.innerHTML = "<p class='sop-empty'>This connector has no financial tools mapped for an SOP.</p>";
      } else {
        applicable.forEach((t) => sopToolsEl.appendChild(renderSopTool(t, erp, erpLinks)));
      }
      sopFootNote.textContent = applicable.length + " tool" + (applicable.length !== 1 ? "s" : "") +
        " · uncheck rows or tools to exclude them";
    }

    function openSopModal(erp) {
      // Populate the ERP picker once (lets the builder run from the top button
      // without first selecting a node).
      if (!sopPickerInit && sopErpPick) {
        erpNodes.slice()
          .sort((a, b) => a.label.localeCompare(b.label))
          .forEach((e) => sopErpPick.appendChild(new Option(e.label + (e.via === "agave" ? " · Agave" : ""), e.id)));
        sopErpPick.addEventListener("change", () => {
          const e = erpNodes.find((x) => x.id === sopErpPick.value);
          if (e) renderSopFor(e);
        });
        sopPickerInit = true;
      }

      const target = erp || erpNodes.find((x) => x.id === sopErpPick.value) || erpNodes[0];
      if (!target) return;
      if (sopErpPick) sopErpPick.value = target.id;

      document.getElementById("sop-date").value =
        new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

      // shared role datalist (build once)
      if (!document.getElementById("sop-role-list")) {
        const dl = document.createElement("datalist");
        dl.id = "sop-role-list";
        sopTemplates.roleOptions.forEach((r) => dl.appendChild(new Option(r, r)));
        document.body.appendChild(dl);
      }

      renderSopFor(target);
      sopModal.hidden = false;
      document.body.style.overflow = "hidden";
    }
    function closeSopModal() {
      sopModal.hidden = true;
      document.body.style.overflow = "";
    }

    function buildSopHtml(ctx) {
      const esc = escapeHtml;
      const erp = ctx.erp;
      const via = erp.via === "agave" ? "Agave Sync" : "Integration by Procore";
      let h = "";
      h += "<h1 class='doc-title'>" + esc(ctx.client) + " — Procore + " + esc(erp.label) + "</h1>";
      h += "<p class='doc-sub'>Standard Operating Procedure &nbsp;·&nbsp; ERP integration via " + esc(via) +
        (ctx.preparer ? " &nbsp;·&nbsp; Prepared by " + esc(ctx.preparer) : "") +
        (ctx.dateStr ? " &nbsp;·&nbsp; " + esc(ctx.dateStr) : "") + "</p>";
      if (erp.overview) h += "<p>" + esc(erp.overview) + "</p>";
      if (Array.isArray(erp.thingsToKnow) && erp.thingsToKnow.length) {
        h += "<h2>Connector Notes &amp; Limitations</h2><ul>";
        erp.thingsToKnow.forEach((t) => (h += "<li>" + esc(t) + "</li>"));
        h += "</ul>";
      }

      ctx.sections.forEach((s) => {
        const tool = s.tool;
        h += "<h1>" + esc(tool.title) + "</h1>";
        h += "<p>" + esc(tool.overview.replace(/\{ERP\}/g, erp.label)) + "</p>";

        h += "<h2>Roles &amp; Responsibilities</h2>";
        h += "<table class='rr'><tr><th>Action — responsible for…</th><th>Name</th><th>Project Role</th><th>Permission</th></tr>";
        s.rows.forEach((r) => {
          h += "<tr><td>" + esc(r.action) + "</td><td>" + esc(r.name || "&nbsp;") +
            "</td><td>" + esc(r.role || "&nbsp;") + "</td><td>" + esc(r.perm || "&nbsp;") + "</td></tr>";
        });
        h += "</table>";

        h += "<h2>Sync Process &amp; Best Practices</h2><ul>";
        tool.modules.filter((m) => ctx.erpLinks[m]).forEach((m) => {
          const link = ctx.erpLinks[m];
          const mod = moduleOf(link);
          h += "<li><strong>" + esc(mod.label) + ":</strong> " + esc(directionPhrase(link.direction, erp.label)) + ".";
          if (Array.isArray(link.notes) && link.notes.length) {
            h += "<ul>";
            link.notes.forEach((n) => (h += "<li>" + esc(n) + "</li>"));
            h += "</ul>";
          }
          h += "</li>";
        });
        h += "</ul>";

        if (Array.isArray(tool.keyConfigs) && tool.keyConfigs.length) {
          h += "<h2>Key Configurations</h2>";
          h += "<table class='cfg'><tr><th>Setting</th><th>Default</th><th>Notes</th></tr>";
          tool.keyConfigs.forEach((c) => {
            h += "<tr><td>" + esc(c.setting) + "</td><td>" + esc(c.default || "") + "</td><td>" + esc(c.note || "") + "</td></tr>";
          });
          h += "</table>";
        }

        if (tool.fieldsets) {
          h += "<h2>Fieldsets</h2>";
          h += "<p>Configurable fieldsets let you set fields in the " + esc(tool.title) +
            " tool to optional, required, or hidden (requires Company Admin permissions). Add any project-specific custom fields below.</p>";
          h += "<table class='fs'><tr><th>Custom Field Name</th><th>Type</th><th>Required?</th><th>Desired Outcome</th></tr>";
          h += "<tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>".repeat(3);
          h += "</table>";
        }

        h += "<h2>Permissions by Project Role</h2>";
        const perm = tool.permissions || {};
        h += "<table class='perm'><tr><th>Read Only</th><th>Standard</th><th>Admin</th></tr>";
        h += "<tr><td>" + esc(perm.readOnly || "") + "</td><td>" + esc(perm.standard || "") +
          "</td><td>" + esc(perm.admin || "") + "</td></tr>";
        h += "<tr><td>[Client permission template]</td><td>[Client permission template]</td><td>[Client permission template]</td></tr></table>";
        h += "<p class='note'>General Procore capabilities by level — confirm against your client's permission templates. Granular permissions may grant specific admin-level actions to lower levels.</p>";
      });

      const css = "body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#1a1a1a;}" +
        "h1.doc-title{font-size:22pt;margin:0 0 4pt;color:#000;}" +
        ".doc-sub{color:#566578;font-size:9.5pt;margin:0 0 16pt;}" +
        "h1{font-size:15pt;color:#FF5200;border-bottom:2px solid #FF5200;padding-bottom:2pt;margin:22pt 0 8pt;}" +
        "h2{font-size:11.5pt;color:#000;margin:14pt 0 6pt;}" +
        "table{border-collapse:collapse;width:100%;margin:6pt 0 10pt;}" +
        "th,td{border:1px solid #999;padding:5pt 7pt;text-align:left;vertical-align:top;font-size:10pt;}" +
        "th{background:#ECE0D6;}" +
        "table.rr th:first-child{width:46%;}" +
        "table.cfg th:first-child{width:34%;}table.cfg th:nth-child(2){width:18%;}" +
        "table.fs th{width:25%;}table.perm th{width:33%;}" +
        "p.note{font-size:9pt;color:#566578;margin:4pt 0 0;}" +
        "ul{margin:4pt 0 8pt;} li{margin:2pt 0;}";

      return "<html xmlns:o='urn:schemas-microsoft-com:office:office' " +
        "xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>" +
        "<head><meta charset='utf-8'><title>" + esc(ctx.client) + " Procore " + esc(erp.label) + " SOP</title>" +
        "<style>" + css + "</style></head><body>" + h + "</body></html>";
    }

    function generateSop() {
      const erp = sopErpNode;
      if (!erp) return;
      const client = (document.getElementById("sop-client").value || "[Client]").trim() || "[Client]";
      const preparer = document.getElementById("sop-preparer").value.trim();
      const dateStr = document.getElementById("sop-date").value.trim();
      const erpLinks = linksByErp[erp.id] || {};

      const sections = [];
      sopToolsEl.querySelectorAll(".sop-tool").forEach((sec) => {
        if (!sec.querySelector(".sop-tool-toggle").checked) return;
        const tool = sopTemplates.tools.find((t) => t.key === sec.dataset.toolKey);
        const rows = [];
        sec.querySelectorAll(".sop-rows .sop-row:not(.sop-row-hdr)").forEach((r) => {
          if (!r.querySelector(".sop-row-inc").checked) return;
          const action = r.querySelector(".sop-act").value.trim();
          if (!action) return;
          rows.push({
            action: action,
            name: r.querySelector(".sop-name").value.trim(),
            role: r.querySelector(".sop-role").value.trim(),
            perm: r.querySelector(".sop-perm").value.trim()
          });
        });
        if (rows.length) sections.push({ tool: tool, rows: rows });
      });

      if (!sections.length) {
        sopFootNote.textContent = "Add at least one action (with the row checked) before generating.";
        return;
      }

      const html = buildSopHtml({ erp, client, preparer, dateStr, sections, erpLinks });
      const blob = new Blob(["﻿", html], { type: "application/msword" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = client.replace(/[^\w \-]/g, "").trim() + " - Procore " + erp.label + " SOP.doc";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      sopFootNote.textContent = "Generated " + a.download;
    }

    sopBuildBtn.addEventListener("click", () => openSopModal(sopErpNode));
    const sopOpenTop = document.getElementById("sop-open-top");
    if (sopOpenTop) {
      sopOpenTop.hidden = false;
      sopOpenTop.addEventListener("click", () => openSopModal(sopErpNode));
    }
    document.getElementById("sop-close").addEventListener("click", closeSopModal);
    document.getElementById("sop-cancel").addEventListener("click", closeSopModal);
    document.getElementById("sop-generate").addEventListener("click", generateSop);
    sopModal.addEventListener("click", (e) => { if (e.target === sopModal) closeSopModal(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !sopModal.hidden) closeSopModal(); });
  }
})();
