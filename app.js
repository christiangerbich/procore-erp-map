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
  const projectModules = data.nodes
    .filter((n) => n.type === "module" && n.tier === "project")
    .sort((a, b) => a.label.localeCompare(b.label));
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
  // a main label BELOW the hex (the middle column can't put labels on
  // either side without colliding with incoming lines from both ERP
  // columns). Empirical minimum to avoid one row's label overlapping
  // the next row's tool eyebrow: ~62px. We use 66 for breathing room.
  const ROW_HEIGHT = 66;
  const HEADER_HEIGHT = 56;
  const FOOTER_PAD = 28;
  const TIER_LABEL_HEIGHT = 22;
  const TIER_GAP = 18;

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

  // Three-column layout. Reserve outer gutters for labels and inner
  // gaps for line-routing space between ERP and module columns.
  const LABEL_GUTTER = 170;
  const leftX = LABEL_GUTTER;                 // Procore-native ERP hexes
  const rightX = width - LABEL_GUTTER;        // Agave Sync ERP hexes
  const middleX = Math.round(width / 2);      // Procore Modules

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
  svg.call(
    d3
      .zoom()
      .scaleExtent([0.5, 2.5])
      .on("zoom", (event) => zoomLayer.attr("transform", event.transform))
  );

  // Column headers (three columns now)
  zoomLayer
    .append("text")
    .attr("class", "column-header")
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
    if (d.via === "agave") return NODE_RADIUS.erp + 10;
    return -(NODE_RADIUS.erp + 10);
  }
  function labelY(d) {
    if (d.type === "module") return NODE_RADIUS.module + 16;
    return 4;
  }
  function labelAnchor(d) {
    if (d.type === "module") return "middle";
    if (d.via === "agave") return "start";
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
    const incidentLinks = linksByNode.get(n.id);
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
})();
