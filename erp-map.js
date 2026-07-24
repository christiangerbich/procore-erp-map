// ERP Connector Map — bipartite graph, side panel, knowledge-base search
// (with the lazy deep-doc index), and the SOP builder. Everything here is
// scoped to the map view; main.js owns the mode toggle and routing.
import { svgEl, attachZoomPan, hexPoints, JSON_FETCH } from "./shared.js";

export function initErpMap(ctx) {
  const { data, sopTemplates, updateHash } = ctx;

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
  const COLOR_SMOOTHX = "#8D6E5B"; // Procore Earth (secondary palette)

  function erpFillFor(d) {
    if (d.via === "agave") return COLOR_AGAVE;
    if (d.via === "smoothx") return COLOR_SMOOTHX;
    return COLOR_PROCORE;
  }

  // Line colors keyed by link direction. Solid vs dashed treatment lives
  // in CSS (.link-to-erp / .link-from-erp). Kept in sync with the CSS
  // variables in styles.css and the legend swatches in index.html.
  const LINK_COLORS = {
    both: "#FF5200",      // solid Procore Orange  — bidirectional
    "to-erp": "#FF5200",  // dashed Procore Orange — Procore → ERP (export)
    "from-erp": "#000000" // dashed Procore Black  — ERP → Procore (import)
  };

  // The arrow symbol shown next to each item in the side panel.
  // Rendered from the perspective of the currently-selected node:
  //   "outbound" means data leaves the selected node
  //   "inbound"  means data arrives at the selected node
  const DIRECTION_SYMBOLS = {
    both: "↔",
    outbound: "→",
    inbound: "←"
  };

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
  const smoothxERPs = data.nodes
    .filter((n) => n.type === "erp" && n.via === "smoothx")
    .sort((a, b) => a.label.localeCompare(b.label));
  const erpNodes = [...procoreERPs, ...agaveERPs, ...smoothxERPs];

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
  const smoothxERPHeight = smoothxERPs.length * ROW_HEIGHT;
  const moduleStackHeight =
    TIER_LABEL_HEIGHT + companyModules.length * ROW_HEIGHT +
    TIER_GAP + TIER_LABEL_HEIGHT + projectModules.length * ROW_HEIGHT;
  const minHeight =
    HEADER_HEIGHT +
    Math.max(procoreERPHeight, moduleStackHeight, agaveERPHeight, smoothxERPHeight) +
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

  // SmoothX ERPs share the right column staging area; applySource() repositions
  // them to the active LEFT column when SmoothX is selected.
  const smoothxSpacing = (height - HEADER_HEIGHT - FOOTER_PAD) / Math.max(smoothxERPs.length, 1);
  smoothxERPs.forEach((n, i) => {
    n.x = rightX;
    n.y = HEADER_HEIGHT + smoothxSpacing * (i + 0.5);
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

  const svg = svgEl("svg", {
    viewBox: "0 0 " + width + " " + height,
    preserveAspectRatio: "xMidYMin meet"
  });
  container.appendChild(svg);

  // No arrow markers — direction is conveyed by line color + dash pattern.

  // Pan & zoom — useful when the column has been resized smaller than its
  // natural height, so the user can scroll/zoom inside the SVG.
  const zoomLayer = svgEl("g");
  svg.appendChild(zoomLayer);
  const erpZoom = attachZoomPan(svg, zoomLayer, {
    state: { tx: 0, ty: 0, scale: 1 },
    min: 0.5,
    max: 2.5,
    skipPan: ".node"
  });

  // Column headers (three columns now). Source-header refs are kept so
  // applySource() can toggle which one shows at the active left column.
  function headerText(cls, x, text, hidden) {
    const t = svgEl("text", {
      class: cls ? "column-header " + cls : "column-header",
      x: x, y: 28, "text-anchor": "middle"
    }, text);
    if (hidden) t.setAttribute("display", "none");
    zoomLayer.appendChild(t);
    return t;
  }
  const headerProcoreEl = headerText("column-header-procore", leftX, "Procore Native", false);
  headerText("", middleX, "Procore Modules", false);
  const headerAgaveEl = headerText("column-header-agave", rightX, "Agave Sync", false);
  const headerSmoothxEl = headerText("column-header-smoothx", rightX, "SmoothX", true);

  // Tier section labels on the modules side (Company / Project).
  zoomLayer.appendChild(svgEl("text", {
    class: "tier-label", x: middleX,
    y: companyLabelY + TIER_LABEL_HEIGHT / 2 + 4, "text-anchor": "middle"
  }, "Company Level"));

  zoomLayer.appendChild(svgEl("text", {
    class: "tier-label", x: middleX,
    y: projectLabelY + TIER_LABEL_HEIGHT / 2 + 4, "text-anchor": "middle"
  }, "Project Level"));

  // Subtle divider between tier sections, centered on the modules column.
  zoomLayer.appendChild(svgEl("line", {
    class: "tier-divider",
    x1: middleX - 100, y1: tierDividerY,
    x2: middleX + 100, y2: tierDividerY
  }));

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

  const linkGroup = svgEl("g", { class: "links" });
  zoomLayer.appendChild(linkGroup);
  visibleLinks.forEach((d) => {
    const e = endpoint(d);
    d._el = svgEl("line", {
      class: "link link-data link-" + d.direction,
      stroke: LINK_COLORS[d.direction],
      "stroke-width": 1.6,
      x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2
    });
    linkGroup.appendChild(d._el);
  });

  // Bulk class toggle across every link element (replaces d3's
  // selection.classed(name, predicate)).
  function setLinkClass(cls, pred) {
    visibleLinks.forEach((l) => l._el.classList.toggle(cls, !!pred(l)));
  }

  // Re-apply a single link's directional styling (stroke color + the
  // dash-pattern class) after its direction has been toggled. Only the
  // direction tokens are touched, so highlighted/dimmed state set by the
  // current selection is preserved.
  function restyleLinkDirection(d) {
    d._el.setAttribute("stroke", LINK_COLORS[d.direction]);
    d._el.classList.toggle("link-to-erp", d.direction === "to-erp");
    d._el.classList.toggle("link-from-erp", d.direction === "from-erp");
    d._el.classList.toggle("link-both", d.direction === "both");
  }

  // ---------------------------------------------------------------------
  // Nodes
  // ---------------------------------------------------------------------

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

  const nodeGroup = svgEl("g", { class: "nodes" });
  zoomLayer.appendChild(nodeGroup);
  visibleNodes.forEach((d) => {
    const g = svgEl("g", {
      class: "node node-" + d.type,
      transform: "translate(" + d.x + "," + d.y + ")",
      // Keyboard access: nodes act as buttons (Tab to reach, Enter/Space to
      // select). Hidden-source nodes are display:none, so they drop out of
      // the tab order automatically.
      tabindex: "0",
      role: "button",
      "aria-label": (d.type === "erp" ? "ERP connector: " : "Procore tool: ") + d.label
    });
    g.addEventListener("click", (event) => {
      event.stopPropagation();
      selectNode(d.id);
    });
    g.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectNode(d.id);
      }
    });

    g.appendChild(svgEl("polygon", {
      class: d.via ? "node-hex via-" + d.via : "node-hex",
      points: hexPoints(NODE_RADIUS[d.type]),
      fill: d.type === "erp" ? erpFillFor(d) : NODE_COLOR[d.type]
    }));

    // Inset orange hex on company-level modules — mirrors the Procore
    // logomark (black hex with orange center) per the Identity guide.
    if (d.type === "module" && d.tier === "company") {
      g.appendChild(svgEl("polygon", {
        class: "node-hex-inner",
        points: hexPoints(NODE_RADIUS.module * 0.42),
        fill: "#FF5200"
      }));
    }

    if (d.tool) {
      g.appendChild(svgEl("text", {
        class: "node-tool-label",
        x: d.type === "module" ? 0 : labelX(d),
        y: d.type === "module" ? -(NODE_RADIUS.module + 8) : -8,
        "text-anchor": d.type === "module" ? "middle" : labelAnchor(d)
      }, d.tool));
    }

    g.appendChild(svgEl("text", {
      class: "node-label",
      x: labelX(d), y: labelY(d), "text-anchor": labelAnchor(d)
    }, d.label));

    d._el = g;
    nodeGroup.appendChild(g);
  });

  // Bulk class toggle across every node element.
  function setNodeClass(cls, pred) {
    visibleNodes.forEach((n) => n._el.classList.toggle(cls, !!pred(n)));
  }

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

    // SmoothX path — single integration page covers all data objects, so
    // every connection card links back to the same SmoothX page.
    if (erp.via === "smoothx") {
      return erp.supportUrl || null;
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
    detailsEl.classList.remove("details-agave", "details-procore-native", "details-smoothx");
    if (n.type === "erp") {
      if (n.via === "agave") {
        typeEl.textContent = "Agave Sync · " + n.label;
        detailsEl.classList.add("details-agave");
      } else if (n.via === "smoothx") {
        typeEl.textContent = "SmoothX · " + n.label;
        detailsEl.classList.add("details-smoothx");
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
    // SmoothX doesn't have a NotebookLM; fall back to the Procore notebook.
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

    setNodeClass("selected", (d) => d.id === n.id);
    setNodeClass("dimmed", (d) => !neighborIds.has(d.id));
    setLinkClass("highlighted", (d) => d.source.id === n.id || d.target.id === n.id);
    setLinkClass("dimmed", (d) => d.source.id !== n.id && d.target.id !== n.id);
    updateHash("erp/" + n.id);
  }

  function deselect() {
    detailsEl.classList.add("details-empty");
    detailsEl.classList.remove("details-agave", "details-procore-native", "details-smoothx");
    emptyTextEl.hidden = false;
    contentEl.hidden = true;
    overviewEl.hidden = true;
    resourcesSectionEl.hidden = true;
    ttkSectionEl.hidden = true;
    titleEl.textContent = "Select a node";
    setNodeClass("selected", () => false);
    setNodeClass("dimmed", () => false);
    setLinkClass("highlighted", () => false);
    setLinkClass("dimmed", () => false);
    updateHash("erp");
  }

  svg.addEventListener("click", (event) => {
    if (erpZoom.consumeClick()) return; // mouseup at the end of a pan drag
    if (event.target === svg) deselect();
  });

  // ---------------------------------------------------------------------
  // Connector-source filter (Procore-native vs Agave Sync)
  // ---------------------------------------------------------------------
  // Show one company's connectors at a time. We hide the other source's
  // nodes + links and crop the viewBox to the active half of the bipartite
  // layout, so the empty column disappears and the modules stay in view.
  function applySource(source) {
    activeSource = ["agave", "smoothx", "procore"].includes(source) ? source : "procore";
    const activeErps =
      activeSource === "agave"   ? agaveERPs   :
      activeSource === "smoothx" ? smoothxERPs :
                                   procoreERPs;
    activeErpIds = new Set(activeErps.map((n) => n.id));

    // Hide the inactive source's nodes + links.
    setNodeClass("src-hidden", (d) => d.type === "erp" && !activeErpIds.has(d.id));
    setLinkClass("src-hidden", (d) => {
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
    visibleNodes.forEach((d) => {
      d._el.setAttribute("transform", "translate(" + d.x + "," + d.y + ")");
    });
    visibleLinks.forEach((d) => {
      const e = endpoint(d);
      d._el.setAttribute("x1", e.x1);
      d._el.setAttribute("y1", e.y1);
      d._el.setAttribute("x2", e.x2);
      d._el.setAttribute("y2", e.y2);
    });

    // All three source headers sit at leftX; only the active one is visible.
    [
      [headerProcoreEl, "procore"],
      [headerAgaveEl,   "agave"],
      [headerSmoothxEl, "smoothx"]
    ].forEach(([el, key]) => {
      if (activeSource === key) el.removeAttribute("display");
      else el.setAttribute("display", "none");
      el.setAttribute("x", leftX);
    });

    // Full layout viewBox — no crop needed since ERPs are always on the left.
    svg.setAttribute("viewBox", "0 0 " + layoutWidth + " " + layoutHeight);
    erpZoom.reset();
    deselect();
  }

  const srcProcoreBtn = document.getElementById("src-procore");
  const srcAgaveBtn = document.getElementById("src-agave");
  const srcSmoothxBtn = document.getElementById("src-smoothx");
  function setSource(source) {
    applySource(source);
    const buttons = [
      [srcProcoreBtn, "procore"],
      [srcAgaveBtn,   "agave"],
      [srcSmoothxBtn, "smoothx"],
    ];
    buttons.forEach(([btn, key]) => {
      if (!btn) return;
      btn.classList.toggle("is-active", activeSource === key);
      btn.setAttribute("aria-pressed", String(activeSource === key));
    });
  }
  if (srcProcoreBtn) srcProcoreBtn.addEventListener("click", () => setSource("procore"));
  if (srcAgaveBtn) srcAgaveBtn.addEventListener("click", () => setSource("agave"));
  if (srcSmoothxBtn) srcSmoothxBtn.addEventListener("click", () => setSource("smoothx"));

  // Default the map to Procore's connectors.
  setSource("procore");

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
    const via =
      erp.via === "agave"   ? "Agave Sync" :
      erp.via === "smoothx" ? "SmoothX"    :
                              "Procore native";
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
    clearTimeout(searchDebounce); // a pending render would resurrect stale results
    searchEl.value = "";
    searchClearEl.hidden = true;
    hideResults();
  }

  // Lazy-load the deep support-doc search index (built by
  // tools/build-docs-index.py; ~824 chunks, ~90KB gzipped — the largest
  // payload in the app) the first time the search box is used. It only
  // powers "Procore Doc" results, so it stays off the startup critical path.
  // Optional — the finder still works on the data.json corpus alone if the
  // file is missing.
  let extraDocsRequested = false;
  function loadExtraDocs() {
    if (extraDocsRequested) return;
    extraDocsRequested = true;
    fetch("docs-index.json", JSON_FETCH)
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [])
      .then((chunks) => {
        (chunks || []).forEach((d) => {
          const title = d.title + (d.heading ? " · " + d.heading : "");
          const doc = { erpId: null, moduleId: null, kind: "Procore Doc", isDoc: true,
            title: title, snippet: d.text, body: d.text, text: title + " " + d.text };
          doc._t = doc.text.toLowerCase();
          searchDocs.push(doc);
        });
        // If a query is already typed, refresh so doc results appear.
        if (searchEl.value.trim()) renderResults(searchEl.value);
      });
  }
  searchEl.addEventListener("focus", loadExtraDocs, { once: true });

  // Debounced: the search scans every corpus doc (824 doc chunks once the
  // deep index is in) with several indexOf passes per term — per keystroke
  // that's wasted work and can jank fast typists. 140ms trails typing
  // imperceptibly while collapsing bursts into one scan.
  let searchDebounce = 0;
  searchEl.addEventListener("input", () => {
    loadExtraDocs(); // no-op after the first call; covers paths where focus never fired
    searchClearEl.hidden = !searchEl.value;
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => renderResults(searchEl.value), 140);
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

    // -------------------------------------------------------------------
    // Corpus-based SOP (Agave connectors). sop-agave.json is generated from
    // the local sync-docs corpus by tools/build-sop-agave.py; ERPs with an
    // entry get the corpus-driven SOP — tool-grouped sections tagged
    // Company/Project level, verbatim setup / configuration / FAQ content
    // per synced object, and an embedded data-flow map image rendered from
    // the LIVE link directions (including any configurable toggles flipped
    // this session). Connectors without corpus data keep the template SOP.
    // -------------------------------------------------------------------
    let sopCorpus = null;
    let sopCorpusPromise = null;
    function loadSopCorpus() {
      if (!sopCorpusPromise) {
        sopCorpusPromise = fetch("sop-agave.json", JSON_FETCH)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
          .then((c) => { sopCorpus = c; return c; });
      }
      return sopCorpusPromise;
    }
    function corpusFor(erp) {
      return erp && sopCorpus ? sopCorpus[erp.id] || null : null;
    }

    // Procore-tool grouping for corpus SOPs (module id -> tool group);
    // Company/Project level comes from data.json module tiers.
    const SOP_TOOL_GROUPS = [
      { key: "directory",   title: "Directory",                ids: ["vendors", "employees"] },
      { key: "wbs",         title: "Work Breakdown Structure", ids: ["cost-codes"] },
      { key: "projects",    title: "Portfolio / Projects",     ids: ["jobs", "project-wbs"] },
      { key: "budget",      title: "Budget",                   ids: ["budgets", "budget-changes"] },
      { key: "commitments", title: "Commitments",              ids: ["subcontracts", "purchase-orders", "commitment-change-orders", "commitment-payments"] },
      { key: "primes",      title: "Prime Contracts",          ids: ["prime-contracts", "prime-contract-change-orders", "prime-contract-payments"] },
      { key: "invoicing",   title: "Invoicing",                ids: ["sub-invoices", "owner-invoices"] },
      { key: "directcosts", title: "Direct Costs",             ids: ["direct-costs"] },
      { key: "timesheets",  title: "Timesheets",               ids: ["timecards"] },
    ];
    function levelLabel(level) {
      return level === "company" ? "Company level"
           : level === "project" ? "Project level"
           : "Company + Project";
    }
    function corpusGroupsFor(erp, corpus) {
      const erpLinks = linksByErp[erp.id] || {};
      const groups = [];
      SOP_TOOL_GROUPS.forEach((g) => {
        const objects = [];
        g.ids.forEach((mid) => {
          const link = erpLinks[mid];
          if (!link) return;
          const mod = moduleOf(link);
          objects.push({
            moduleId: mid,
            label: mod.label,
            tier: mod.tier || "project",
            link: link,
            doc: (corpus.objects || {})[mid] || null
          });
        });
        if (objects.length) {
          const tiers = objects.map((o) => o.tier);
          groups.push({
            key: g.key,
            title: g.title,
            level: tiers.every((t) => t === "company") ? "company"
                 : tiers.every((t) => t === "project") ? "project" : "mixed",
            objects: objects
          });
        }
      });
      return groups;
    }

    function corpusSection(key, title, level) {
      const sec = document.createElement("section");
      sec.className = "sop-tool";
      sec.dataset.groupKey = key;
      const head = document.createElement("div");
      head.className = "sop-tool-head";
      const h = document.createElement("h3");
      h.textContent = title;
      const lvl = document.createElement("span");
      lvl.className = "sop-level-chip sop-level-" + level;
      lvl.textContent = levelLabel(level);
      const inc = document.createElement("label");
      inc.className = "sop-tool-include";
      const incCb = document.createElement("input");
      incCb.type = "checkbox"; incCb.checked = true; incCb.className = "sop-tool-toggle";
      inc.appendChild(incCb);
      inc.appendChild(document.createTextNode(" Include"));
      head.appendChild(h); head.appendChild(lvl); head.appendChild(inc);
      sec.appendChild(head);
      return sec;
    }
    function corpusRowsTable(sec, erp) {
      const table = document.createElement("div");
      table.className = "sop-rows";
      const hdr = document.createElement("div");
      hdr.className = "sop-row sop-row-hdr";
      hdr.innerHTML = "<span></span><span>Action</span><span>Name</span><span>Project role</span><span>Permission</span>";
      table.appendChild(hdr);
      sec.appendChild(table);
      const add = document.createElement("button");
      add.type = "button"; add.className = "sop-add-row"; add.textContent = "+ Add action";
      add.addEventListener("click", () => table.appendChild(makeRow("", null, erp)));
      sec.appendChild(add);
      return table;
    }

    function renderSopCorpusMode(erp, corpus) {
      const groups = corpusGroupsFor(erp, corpus);

      // Connector setup (Authentication, Cost Types, UoM, …) — company level.
      if (corpus.general && corpus.general.length) {
        const sec = corpusSection("connector-setup", "Connector Setup (Agave)", "company");
        const sync = document.createElement("p");
        sync.className = "sop-tool-sync";
        sync.textContent = "Company-level integration setup from the Agave sync-docs: " +
          corpus.general.map((g) => g.title).join(", ") + ".";
        sec.appendChild(sync);
        const table = corpusRowsTable(sec, erp);
        corpus.general.forEach((g) => {
          table.appendChild(makeRow("Complete '" + g.title + "' setup and verify with the client", null, erp));
        });
        sopToolsEl.appendChild(sec);
      }

      groups.forEach((grp) => {
        const sec = corpusSection(grp.key, grp.title, grp.level);
        const sync = document.createElement("p");
        sync.className = "sop-tool-sync";
        sync.innerHTML = "Sync — " + grp.objects.map((o) =>
          "<strong>" + escapeHtml(o.label) + "</strong>: " +
          escapeHtml(directionPhrase(o.link.direction, erp.label))
        ).join("; ") + ".";
        sec.appendChild(sync);
        const table = corpusRowsTable(sec, erp);
        grp.objects.forEach((o) => {
          table.appendChild(makeRow(
            "Own the " + o.label + " sync — " + directionPhrase(o.link.direction, erp.label) +
            "; monitor errors and resolve blocked records", null, erp));
        });
        sopToolsEl.appendChild(sec);
      });

      const n = groups.length + (corpus.general && corpus.general.length ? 1 : 0);
      sopFootNote.textContent = n + " tool section" + (n !== 1 ? "s" : "") +
        " from the Agave sync-docs corpus · flow map + configurations embed in the document";
    }

    // ---- Flow map (SVG → PNG) -----------------------------------------
    // A one-connector bipartite map reflecting the LIVE directions —
    // Company-level and Project-level lanes, map color/dash conventions,
    // arrowheads showing which way data moves.
    function buildFlowMapSvg(erp) {
      const erpLinks = linksByErp[erp.id] || {};
      const mods = moduleNodes.filter((m) => erpLinks[m.id]);
      const company = mods.filter((m) => m.tier === "company");
      const project = mods.filter((m) => m.tier !== "company");
      const ROW = 30, HDR = 26, TOP = 64, W = 920;
      const leftX = 170, rightX = 620;
      const rowsH = (company.length ? HDR + company.length * ROW + 10 : 0) +
                    (project.length ? HDR + project.length * ROW : 0);
      const H = TOP + rowsH + 56;

      const svg = svgEl("svg", {
        xmlns: "http://www.w3.org/2000/svg",
        width: W, height: H, viewBox: "0 0 " + W + " " + H,
        "font-family": "Arial, Helvetica, sans-serif"
      });
      svg.appendChild(svgEl("rect", { x: 0, y: 0, width: W, height: H, fill: "#ffffff" }));
      svg.appendChild(svgEl("text", {
        x: W / 2, y: 28, "text-anchor": "middle", "font-size": 15,
        "font-weight": "bold", fill: "#000"
      }, "Procore ↔ " + erp.label + " — Data Flow (as configured)"));

      const midY = TOP + rowsH / 2;
      const hex = svgEl("polygon", { points: hexPoints(30), fill: "#566578" });
      const g = svgEl("g", { transform: "translate(" + leftX + "," + midY + ")" });
      g.appendChild(hex);
      svg.appendChild(g);
      svg.appendChild(svgEl("text", {
        x: leftX, y: midY + 50, "text-anchor": "middle", "font-size": 13,
        "font-weight": "bold", fill: "#000"
      }, erp.label));
      svg.appendChild(svgEl("text", {
        x: leftX, y: midY + 66, "text-anchor": "middle", "font-size": 10, fill: "#566578"
      }, "via Agave Sync"));

      function arrow(x, y, dirLeft, color) {
        const s = 6;
        const pts = dirLeft
          ? (x + s) + "," + (y - s / 1.4) + " " + x + "," + y + " " + (x + s) + "," + (y + s / 1.4)
          : (x - s) + "," + (y - s / 1.4) + " " + x + "," + y + " " + (x - s) + "," + (y + s / 1.4);
        svg.appendChild(svgEl("polyline", {
          points: pts, fill: "none", stroke: color, "stroke-width": 2,
          "stroke-linecap": "round", "stroke-linejoin": "round"
        }));
      }

      let y = TOP;
      function lane(title, list) {
        if (!list.length) return;
        svg.appendChild(svgEl("text", {
          x: rightX, y: y + 12, "font-size": 10.5, "font-weight": "bold",
          fill: "#566578", "letter-spacing": "1"
        }, title.toUpperCase()));
        y += HDR;
        list.forEach((m) => {
          const link = erpLinks[m.id];
          const cy = y + ROW / 2 - 4;
          const color = link.direction === "from-erp" ? "#000000" : "#FF5200";
          const line = svgEl("line", {
            x1: leftX + 34, y1: midY, x2: rightX - 26, y2: cy,
            stroke: color, "stroke-width": 1.8
          });
          if (link.direction !== "both") line.setAttribute("stroke-dasharray", "6 4");
          svg.appendChild(line);
          // Arrowheads at the receiving end(s): to-erp -> into the ERP,
          // from-erp -> into the module, both -> both ends.
          const ang = Math.atan2(cy - midY, (rightX - 26) - (leftX + 34));
          if (link.direction === "to-erp" || link.direction === "both") {
            arrow(leftX + 34, midY + Math.sin(ang) * 0, true, color);
          }
          if (link.direction === "from-erp" || link.direction === "both") {
            arrow(rightX - 26, cy, false, color);
          }
          const mhx = svgEl("g", { transform: "translate(" + (rightX - 12) + "," + cy + ")" });
          mhx.appendChild(svgEl("polygon", {
            points: hexPoints(9),
            fill: m.tier === "company" ? "#000000" : "#000000"
          }));
          if (m.tier === "company") {
            mhx.appendChild(svgEl("polygon", { points: hexPoints(4), fill: "#FF5200" }));
          }
          svg.appendChild(mhx);
          svg.appendChild(svgEl("text", {
            x: rightX + 4, y: cy + 4, "font-size": 12, fill: "#000"
          }, m.label));
          y += ROW;
        });
        y += 10;
      }
      lane("Company level", company);
      lane("Project level", project);

      // Legend
      const ly = H - 18;
      function legend(x, color, dash, label) {
        const l = svgEl("line", { x1: x, y1: ly - 4, x2: x + 30, y2: ly - 4, stroke: color, "stroke-width": 2 });
        if (dash) l.setAttribute("stroke-dasharray", "6 4");
        svg.appendChild(l);
        svg.appendChild(svgEl("text", { x: x + 36, y: ly, "font-size": 10, fill: "#333" }, label));
      }
      legend(60, "#FF5200", false, "Bidirectional");
      legend(240, "#FF5200", true, "Procore → " + erp.label);
      legend(470, "#000000", true, erp.label + " → Procore");
      return { svg: svg, width: W, height: H };
    }

    function svgToPngBase64(built) {
      return new Promise((resolve, reject) => {
        const xml = new XMLSerializer().serializeToString(built.svg);
        const img = new Image();
        img.onload = () => {
          try {
            const c = document.createElement("canvas");
            c.width = built.width * 2;
            c.height = built.height * 2;
            const g2 = c.getContext("2d");
            g2.fillStyle = "#ffffff";
            g2.fillRect(0, 0, c.width, c.height);
            g2.drawImage(img, 0, 0, c.width, c.height);
            resolve(c.toDataURL("image/png").split(",")[1]);
          } catch (e) { reject(e); }
        };
        img.onerror = () => reject(new Error("flow map raster failed"));
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
      });
    }

    // Word-friendly single-file web archive: HTML part + PNG part. Word
    // opens it as a .doc and renders the embedded flow map.
    function mhtmlDoc(html, pngBase64) {
      const B = "----=_NextPart_PNPT_SOP";
      return [
        "MIME-Version: 1.0",
        'Content-Type: multipart/related; boundary="' + B + '"; type="text/html"',
        "",
        "--" + B,
        'Content-Type: text/html; charset="utf-8"',
        "Content-Location: sop.html",
        "",
        html,
        "",
        "--" + B,
        "Content-Type: image/png",
        "Content-Transfer-Encoding: base64",
        "Content-Location: flowmap.png",
        "",
        pngBase64.replace(/(.{76})/g, "$1\r\n"),
        "",
        "--" + B + "--",
        ""
      ].join("\r\n");
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
    let sopPrevFocus = null; // element to return focus to when the modal closes

    function renderSopFor(erp) {
      sopErpNode = erp;
      sopTitleEl.textContent = "SOP — Procore + " + erp.label;
      sopToolsEl.innerHTML = "";
      // Corpus-driven SOP when this connector has sync-docs data.
      const corpus = corpusFor(erp);
      if (corpus) {
        renderSopCorpusMode(erp, corpus);
        return;
      }
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

    async function openSopModal(erp) {
      // Corpus data loads once, lazily — needed before the first render so
      // Agave connectors get the corpus-based sections.
      await loadSopCorpus();
      // Populate the ERP picker once (lets the builder run from the top button
      // without first selecting a node).
      if (!sopPickerInit && sopErpPick) {
        erpNodes.slice()
          .sort((a, b) => a.label.localeCompare(b.label))
          .forEach((e) => {
            const suffix =
              e.via === "agave"   ? " · Agave"   :
              e.via === "smoothx" ? " · SmoothX" :
                                    "";
            sopErpPick.appendChild(new Option(e.label + suffix, e.id));
          });
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
      sopPrevFocus = document.activeElement;
      sopModal.hidden = false;
      document.body.style.overflow = "hidden";
      // Move focus into the dialog so keyboard users land where the action is.
      const firstField = document.getElementById("sop-client");
      if (firstField) firstField.focus();
    }
    function closeSopModal() {
      sopModal.hidden = true;
      document.body.style.overflow = "";
      if (sopPrevFocus && document.contains(sopPrevFocus)) sopPrevFocus.focus();
      sopPrevFocus = null;
    }

    function buildSopHtml(ctx) {
      const esc = escapeHtml;
      const erp = ctx.erp;
      const via =
        erp.via === "agave"   ? "Agave Sync"            :
        erp.via === "smoothx" ? "SmoothX"               :
                                "Integration by Procore";
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
          // Empty cells fall back to a raw &nbsp; — it must NOT go through
          // esc(), or the "&" escapes and Word prints the literal text "&nbsp;".
          h += "<tr><td>" + esc(r.action) + "</td><td>" + (r.name ? esc(r.name) : "&nbsp;") +
            "</td><td>" + (r.role ? esc(r.role) : "&nbsp;") + "</td><td>" + (r.perm ? esc(r.perm) : "&nbsp;") + "</td></tr>";
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

      return sopDocShell(esc(ctx.client) + " Procore " + esc(erp.label) + " SOP", h);
    }

    // Shared Word-doc shell + styles for both SOP builders.
    const SOP_DOC_CSS = "body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#1a1a1a;}" +
      "h1.doc-title{font-size:22pt;margin:0 0 4pt;color:#000;}" +
      ".doc-sub{color:#566578;font-size:9.5pt;margin:0 0 16pt;}" +
      "h1{font-size:15pt;color:#FF5200;border-bottom:2px solid #FF5200;padding-bottom:2pt;margin:22pt 0 8pt;}" +
      "h2{font-size:11.5pt;color:#000;margin:14pt 0 6pt;}" +
      "h3{font-size:10.5pt;color:#000;margin:10pt 0 4pt;}" +
      "table{border-collapse:collapse;width:100%;margin:6pt 0 10pt;}" +
      "th,td{border:1px solid #999;padding:5pt 7pt;text-align:left;vertical-align:top;font-size:10pt;}" +
      "th{background:#ECE0D6;}" +
      "table.rr th:first-child{width:46%;}" +
      "table.cfg th:first-child{width:34%;}table.cfg th:nth-child(2){width:18%;}" +
      "table.cfg2 th:first-child{width:30%;}" +
      "table.fs th{width:25%;}table.perm th{width:33%;}" +
      "p.note{font-size:9pt;color:#566578;margin:4pt 0 0;}" +
      ".lvl{font-size:9pt;color:#FFFFFF;background:#566578;padding:1pt 6pt;font-weight:normal;}" +
      ".lvl2{font-size:8.5pt;color:#566578;font-weight:normal;}" +
      "img{border:1pt solid #DDDDDD;}" +
      "ul{margin:4pt 0 8pt;} li{margin:2pt 0;}";
    function sopDocShell(title, bodyHtml) {
      return "<html xmlns:o='urn:schemas-microsoft-com:office:office' " +
        "xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>" +
        "<head><meta charset='utf-8'><title>" + title + "</title>" +
        "<style>" + SOP_DOC_CSS + "</style></head><body>" + bodyHtml + "</body></html>";
    }

    // Link notes minus internal provenance/maintenance annotations — the SOP
    // is a client-facing document.
    function clientFacingNotes(link) {
      return (Array.isArray(link.notes) ? link.notes : []).filter((n) =>
        !/corrected per|re-crawl|per Agave MD|useagave\.com|catalog default|Added 2026|per the live/i.test(n));
    }

    function buildSopCorpusHtml(ctx) {
      const esc = escapeHtml;
      const erp = ctx.erp;
      const corpus = ctx.corpus;
      let h = "";
      h += "<h1 class='doc-title'>" + esc(ctx.client) + " — Procore + " + esc(erp.label) + "</h1>";
      h += "<p class='doc-sub'>Standard Operating Procedure &nbsp;·&nbsp; ERP integration via Agave Sync" +
        (ctx.preparer ? " &nbsp;·&nbsp; Prepared by " + esc(ctx.preparer) : "") +
        (ctx.dateStr ? " &nbsp;·&nbsp; " + esc(ctx.dateStr) : "") +
        " &nbsp;·&nbsp; Content sourced from the Agave sync-docs</p>";
      if (erp.overview) h += "<p>" + esc(erp.overview) + "</p>";

      if (ctx.hasMap) {
        h += "<h2>Data Flow Map</h2>";
        h += "<p><img src='flowmap.png' width='690' alt='Procore / " + esc(erp.label) + " data flow map'/></p>";
        h += "<p class='note'>Directions as configured in the ERP Connector Map at export time — including any Agave-configurable direction choices made for this client.</p>";
      }

      const lims = (corpus.limitations && corpus.limitations.length)
        ? corpus.limitations
        : (erp.thingsToKnow || []);
      if (lims.length) {
        h += "<h2>Known Limitations</h2><ul>";
        lims.forEach((t) => (h += "<li>" + esc(t) + "</li>"));
        h += "</ul>";
      }

      function rrTable(rows) {
        if (!rows.length) return "";
        let t = "<h2>Roles &amp; Responsibilities</h2>" +
          "<table class='rr'><tr><th>Action — responsible for…</th><th>Name</th><th>Project Role</th><th>Permission</th></tr>";
        rows.forEach((r) => {
          t += "<tr><td>" + esc(r.action) + "</td><td>" + (r.name ? esc(r.name) : "&nbsp;") +
            "</td><td>" + (r.role ? esc(r.role) : "&nbsp;") + "</td><td>" + (r.perm ? esc(r.perm) : "&nbsp;") + "</td></tr>";
        });
        return t + "</table>";
      }
      function entryTable(title, entries) {
        if (!entries || !entries.length) return "";
        let t = "<h3>" + esc(title) + "</h3>" +
          "<table class='cfg2'><tr><th>Topic</th><th>Guidance (from the sync-docs)</th></tr>";
        entries.forEach((e2) => {
          t += "<tr><td>" + esc(e2.t) + "</td><td>" + (e2.x ? esc(e2.x) : "&nbsp;") + "</td></tr>";
        });
        return t + "</table>";
      }

      ctx.sections.forEach((s) => {
        if (s.key === "connector-setup") {
          h += "<h1>Connector Setup (Agave) <span class='lvl'>Company level</span></h1>";
          h += rrTable(s.rows);
          (corpus.general || []).forEach((g) => {
            h += "<h2>" + esc(g.title) + "</h2>";
            if (g.intro) h += "<p>" + esc(g.intro) + "</p>";
            h += entryTable("Setup", g.setup);
            h += entryTable("Configuration", g.configs);
            h += entryTable("FAQs &amp; Common Errors", (g.errors || []).slice(0, 8));
            if (g.url) h += "<p class='note'>Full guide: " + esc(g.url) + "</p>";
          });
          return;
        }
        const grp = ctx.byKey[s.key];
        if (!grp) return;
        h += "<h1>" + esc(grp.title) + " <span class='lvl'>" + esc(levelLabel(grp.level)) + "</span></h1>";
        h += rrTable(s.rows);
        grp.objects.forEach((o) => {
          const d = o.doc || {};
          h += "<h2>" + esc(o.label) +
            (d.title && d.title !== o.label ? " — " + esc(d.title) + " in " + esc(erp.label) : "") +
            " <span class='lvl2'>" + esc(o.tier === "company" ? "Company level" : "Project level") + "</span></h2>";
          h += "<p><strong>Sync:</strong> " + esc(directionPhrase(o.link.direction, erp.label)) + ".</p>";
          const notes = clientFacingNotes(o.link);
          if (notes.length) {
            h += "<ul>";
            notes.forEach((n) => (h += "<li>" + esc(n) + "</li>"));
            h += "</ul>";
          }
          if (d.intro) h += "<p>" + esc(d.intro) + "</p>";
          h += entryTable("Setup &amp; Prerequisites", d.setup);
          h += entryTable("Key Configurations", d.configs);
          h += entryTable("FAQs &amp; Common Errors", (d.errors || []).slice(0, 8));
          if ((d.errors || []).length > 8) {
            h += "<p class='note'>" + ((d.errors || []).length - 8) + " more in the full guide.</p>";
          }
          if (d.url) h += "<p class='note'>Full guide: " + esc(d.url) + "</p>";
        });
      });

      return sopDocShell(esc(ctx.client) + " Procore " + esc(erp.label) + " SOP", h);
    }

    async function generateSopCorpus(erp, corpus, client, preparer, dateStr) {
      const groups = corpusGroupsFor(erp, corpus);
      const byKey = {};
      groups.forEach((g) => { byKey[g.key] = g; });
      const sections = [];
      sopToolsEl.querySelectorAll(".sop-tool").forEach((sec) => {
        if (!sec.querySelector(".sop-tool-toggle").checked) return;
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
        sections.push({ key: sec.dataset.groupKey, rows: rows });
      });
      if (!sections.length) {
        sopFootNote.textContent = "Include at least one tool section before generating.";
        return;
      }

      sopFootNote.textContent = "Rendering flow map…";
      let png = "";
      try {
        png = await svgToPngBase64(buildFlowMapSvg(erp));
      } catch (e) {
        // The document still generates without the image.
      }
      const html = buildSopCorpusHtml({
        erp: erp, corpus: corpus, client: client, preparer: preparer,
        dateStr: dateStr, sections: sections, byKey: byKey, hasMap: !!png
      });
      const payload = png ? mhtmlDoc(html, png) : "﻿" + html;
      const blob = new Blob([payload], { type: "application/msword" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = client.replace(/[^\w \-]/g, "").trim() + " - Procore " + erp.label + " SOP.doc";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      sopFootNote.textContent = "Generated " + a.download + (png ? " (flow map embedded)" : "");
    }

    async function generateSop() {
      const erp = sopErpNode;
      if (!erp) return;
      const client = (document.getElementById("sop-client").value || "[Client]").trim() || "[Client]";
      const preparer = document.getElementById("sop-preparer").value.trim();
      const dateStr = document.getElementById("sop-date").value.trim();
      // Corpus-based connectors generate the corpus document (with the
      // embedded flow map); everything else keeps the template document.
      const corpus = corpusFor(erp);
      if (corpus) {
        await generateSopCorpus(erp, corpus, client, preparer, dateStr);
        return;
      }
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

  // Deep-link entry: switch the connector source if the node lives in a
  // different one, then select it. Used by main.js hash routing.
  function revealNode(id) {
    const n = nodesById.get(id);
    if (!n) return;
    if (n.type === "erp" && (n.via || "procore") !== activeSource) {
      setSource(n.via || "procore");
    }
    selectNode(n.id);
  }

  return { selectNode, deselect, setSource, revealNode };
}
