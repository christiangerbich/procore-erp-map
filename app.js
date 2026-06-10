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

  // PNPT Configuration & Tracking catalog — phases, deliverables, and the
  // per-package Configuration Workbook structure.
  const configData = await fetch("configurations.json")
    .then((r) => (r.ok ? r.json() : { phases: [], packages: [] }))
    .catch(() => ({ phases: [], packages: [] }));

  // Stroke-icon catalog used for tool nodes + capability badges in the
  // Package Builder graph. Each entry is the inner content of an SVG with
  // viewBox 0 0 24 24 — simple geometric symbols matching the semantics of
  // the Procore brand icons (pie chart for Budget, bar chart for Analytics,
  // send/receive arrows for Connect, sparkle for AI, etc).
  const PKG_ICONS = {
    "pie-chart":    '<path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M21 12A9 9 0 0 0 12 3"/>',
    "bar-chart":    '<path d="M3 3v18h18"/><path d="M7 17v-4"/><path d="M12 17V8"/><path d="M17 17v-7"/>',
    "bar-chart-3":  '<path d="M3 3v18h18"/><path d="M8 17v-5"/><path d="M13 17V9"/><path d="M18 17v-3"/>',
    "calculator":   '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6"/><path d="M9 12h.01"/><path d="M12 12h.01"/><path d="M15 12h.01"/><path d="M9 16h.01"/><path d="M12 16h.01"/><path d="M15 16h.01"/>',
    "file-check":   '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 15l2 2 4-4"/>',
    "handshake":    '<path d="M9 12l3 3 3-3 3 3 3-3-6-6-3 3-3-3-6 6 3 3z"/><path d="M12 15v3"/>',
    "receipt":      '<path d="M6 3v18l2-1 2 1 2-1 2 1 2-1 2 1V3l-2 1-2-1-2 1-2-1-2 1-2-1z"/><path d="M9 8h6"/><path d="M9 12h6"/><path d="M9 16h4"/>',
    "receipt-stack":'<path d="M4 5v18l2-1 2 1 2-1 2 1 2-1 2 1V5z"/><path d="M8 9h8"/><path d="M8 13h8"/><path d="M8 17h5"/><path d="M8 5V3h12v16"/>',
    "workflow":     '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M9 6h10a2 2 0 0 1 2 2v7"/><path d="M15 18H5a2 2 0 0 1-2-2V9"/>',
    "book":         '<path d="M4 19.5V5a2 2 0 0 1 2-2h13v18H6.5a2.5 2.5 0 0 1 0-5H19"/>',
    "users":        '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    "ruler":        '<path d="M20.7 6.7L17.3 3.3a1 1 0 0 0-1.4 0L3.3 16a1 1 0 0 0 0 1.4l3.4 3.4a1 1 0 0 0 1.4 0L20.7 8.1a1 1 0 0 0 0-1.4z"/><path d="m7 16 1.5 1.5"/><path d="m10 13 1.5 1.5"/><path d="m13 10 1.5 1.5"/><path d="m16 7 1.5 1.5"/>',
    "stamp":        '<path d="M12 2v6"/><circle cx="12" cy="11" r="3"/><path d="M5 22h14"/><path d="M5 18v-2a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v2z"/>',
    "credit-card":  '<rect x="2" y="6" width="20" height="13" rx="2"/><path d="M2 11h20"/><path d="M6 15h4"/>',
    "check-shield": '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    "send-receive": '<path d="M17 3l4 4-4 4"/><path d="M21 7H7"/><path d="M7 21l-4-4 4-4"/><path d="M3 17h14"/>',
    "sparkles":     '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 14v3"/><path d="M19 20v.01"/><path d="M5 18v.01"/>',

    // Refinements per brand-guide mapping:
    "calc-chart":   '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M5 12h14"/><path d="M9 9v-2"/><path d="M12 9v-3"/><path d="M15 9v-1"/><circle cx="9" cy="16" r=".7"/><circle cx="12" cy="16" r=".7"/><circle cx="15" cy="16" r=".7"/><circle cx="9" cy="19" r=".7"/><circle cx="12" cy="19" r=".7"/><circle cx="15" cy="19" r=".7"/>',
    "compass":      '<circle cx="12" cy="4" r="1.5"/><path d="M12 5.5 5.5 21"/><path d="M12 5.5 18.5 21"/><path d="M16 18l-8 0"/>',
    "change-cycle": '<path d="M21 12a9 9 0 0 1-15 6.7"/><path d="M3 12a9 9 0 0 1 15-6.7"/><path d="M21 4v5h-5"/><path d="M3 20v-5h5"/>',
    "doc-currency": '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 12v6"/><path d="M14.5 13h-3a1.5 1.5 0 0 0 0 3h2a1.5 1.5 0 0 1 0 3h-3.5"/>',

    // Project Execution + Resource icons
    "drawings":     '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 4l18 16"/><path d="M8 4v16"/>',
    "rfi":          '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 14a2 2 0 1 1 3 1.7c-.5.3-1 .6-1 1.3"/><path d="M11 19h.01"/>',
    "eye":          '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    "log-calendar": '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M8 14h2M14 14h2M8 18h2M14 18h2"/>',
    "mail":         '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 7l10 7 10-7"/>',
    "punchlist":    '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 9l2 2 4-4"/><path d="M9 16h6"/><path d="M9 19h4"/>',
    "clipboard":    '<rect x="7" y="4" width="10" height="3" rx="1"/><path d="M7 5.5H5a2 2 0 0 0-2 2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7.5a2 2 0 0 0-2-2h-2"/><path d="M8 13l2 2 5-5"/>',
    "cube":         '<path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4"/><path d="M21 7v10l-9 4"/><path d="M12 11v10"/>',
    "warning":      '<path d="M12 3L3 20h18L12 3z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
    "target":       '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
    "clock":        '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    "gear":         '<circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M2 12h2M20 12h2M4.9 19.1l1.5-1.5M17.6 6.4l1.5-1.5"/>',
    "people-cycle": '<circle cx="9" cy="9" r="3"/><path d="M3 18v-1a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v1"/><path d="M18 8l3 3-3 3"/><path d="M21 11h-7"/>'
  };

  function makePkgIconSvg(iconKey, size, color) {
    const inner = PKG_ICONS[iconKey];
    if (!inner) return null;
    const ns = "http://www.w3.org/2000/svg";
    const s = document.createElementNS(ns, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("width", size);
    s.setAttribute("height", size);
    s.setAttribute("x", -size / 2);
    s.setAttribute("y", -size / 2);
    s.setAttribute("fill", "none");
    s.setAttribute("stroke", color || "#fff");
    s.setAttribute("stroke-width", "2");
    s.setAttribute("stroke-linecap", "round");
    s.setAttribute("stroke-linejoin", "round");
    s.style.pointerEvents = "none";
    s.innerHTML = inner;
    return s;
  }

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

  zoomLayer
    .append("text")
    .attr("class", "column-header column-header-smoothx")
    .attr("x", rightX)
    .attr("y", 28)
    .attr("text-anchor", "middle")
    .attr("display", "none")
    .text("SmoothX");

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
    activeSource = ["agave", "smoothx", "procore"].includes(source) ? source : "procore";
    const activeErps =
      activeSource === "agave"   ? agaveERPs   :
      activeSource === "smoothx" ? smoothxERPs :
                                   procoreERPs;
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

    // All three source headers sit at leftX; only the active one is visible.
    d3.select(".column-header-procore")
      .attr("display", activeSource === "procore" ? null : "none")
      .attr("x", leftX);
    d3.select(".column-header-agave")
      .attr("display", activeSource === "agave" ? null : "none")
      .attr("x", leftX);
    d3.select(".column-header-smoothx")
      .attr("display", activeSource === "smoothx" ? null : "none")
      .attr("x", leftX);

    // Full layout viewBox — no crop needed since ERPs are always on the left.
    svg.attr("viewBox", [0, 0, layoutWidth, layoutHeight].join(" "));
    svg.call(zoom.transform, d3.zoomIdentity);
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
  // Mode toggle: ERP Connector Map  vs  PNPT Package Builder
  // ---------------------------------------------------------------------
  const modeErpBtn = document.getElementById("mode-erp");
  const modePackagesBtn = document.getElementById("mode-packages");
  const modeConfigBtn = document.getElementById("mode-config");
  const configView = document.getElementById("config-view");
  const packagesView = document.getElementById("packages-view");
  const packagesTierToggle = document.getElementById("packages-tier-toggle");
  const packagesGraphEl = document.getElementById("packages-graph");
  // The "details" body — sibling of the sticky Ask-AI bar so the bar
  // doesn't get wiped when the body re-renders.
  const packagesDetailsEl = document.getElementById("packages-details-body");

  // Wire the PNPT Ask-AI button (NotebookLM) — URL lives in packages.assistants.pnpt.
  const packagesPnptBtn = document.getElementById("packages-ai-pnpt");
  if (packagesPnptBtn) {
    const pnptUrl = packagesData.assistants && packagesData.assistants.pnpt;
    if (pnptUrl) packagesPnptBtn.href = pnptUrl;
    else packagesPnptBtn.hidden = true;
  }
  const headerTitleEl = document.getElementById("header-title");
  const headerSubtitleEl = document.getElementById("header-subtitle");
  const headerEyebrowEl = document.getElementById("header-eyebrow-text");

  // Elements that belong to the ERP view; hidden in package mode.
  const erpOnlyEls = [
    document.querySelector(".source-toggle"),
    document.getElementById("erp-legend"),
    document.getElementById("graph"),
    document.getElementById("details"),
  ];
  // The package-mode legend lives in the header (matching the ERP legend slot);
  // it's the opposite of erpOnlyEls — shown in package mode, hidden in ERP mode.
  const packagesHeaderLegend = document.getElementById("packages-legend");

  let activeVertical = "gc"; // default vertical: General Contractor
  let activePackage = null;
  let selectedPackageToolId = null; // which tool's details are shown in the side panel
  const activeTierKeys = new Set();
  // Zoom/pan state for the package graph. Persists across renders within
  // the same package; setActivePackage / vertical change resets it.
  let pkgZoom = { tx: 0, ty: 0, scale: 1 };
  function resetPkgZoom() { pkgZoom = { tx: 0, ty: 0, scale: 1 }; }

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
  function toolIdsForTier(tier) {
    if (tier.toolsByVertical && tier.toolsByVertical[activeVertical]) {
      return tier.toolsByVertical[activeVertical];
    }
    return tier.toolIds || [];
  }
  function toolsForTier(tier) {
    return toolIdsForTier(tier).map(packageToolById).filter(Boolean);
  }
  // Tiers available for the active vertical (tier.availableFor optional, e.g. PLM Owners-only).
  function tiersAvailableForActiveVertical() {
    if (!activePackage) return [];
    return activePackage.tiers.filter(
      (t) => !t.availableFor || t.availableFor.includes(activeVertical)
    );
  }
  // Tool display name, with optional per-vertical override.
  function toolNameFor(t) {
    return (t.names && t.names[activeVertical]) || t.name;
  }

  // Pick the initial package + tier from the default.
  function refreshActivePackageForVertical() {
    const avail = packagesAvailableForActiveVertical();
    if (!activePackage || !avail.includes(activePackage)) {
      activePackage = avail[0] || null;
      activeTierKeys.clear();
      selectedPackageToolId = null;
      resetPkgZoom();
    }
    if (activePackage) {
      const validTiers = tiersAvailableForActiveVertical();
      const validKeys = new Set(validTiers.map((t) => t.key));
      [...activeTierKeys].forEach((k) => { if (!validKeys.has(k)) activeTierKeys.delete(k); });
      if (activeTierKeys.size === 0 && validTiers.length) {
        activeTierKeys.add(validTiers[0].key);
      }
    }
  }
  refreshActivePackageForVertical();

  // Switch the active package, resetting tier + tool selection. Called by the package toggle.
  function setActivePackage(pkgKey) {
    const pkg = (packagesData.packages || []).find((p) => p.key === pkgKey);
    if (!pkg || pkg === activePackage) return;
    activePackage = pkg;
    activeTierKeys.clear();
    selectedPackageToolId = null;
    resetPkgZoom();
    const validTiers = tiersAvailableForActiveVertical();
    if (validTiers.length) activeTierKeys.add(validTiers[0].key);
    renderPackagesView();
  }

  function setMode(mode) {
    const isPackages = mode === "packages";
    const isConfig = mode === "config";
    const isErp = !isPackages && !isConfig;
    erpOnlyEls.forEach((el) => { if (el) el.hidden = !isErp; });
    if (packagesHeaderLegend) packagesHeaderLegend.hidden = !isPackages;
    if (packagesView) packagesView.hidden = !isPackages;
    if (configView) configView.hidden = !isConfig;

    // SOP button only in ERP mode.
    const sopTopBtn = document.getElementById("sop-open-top");
    if (sopTopBtn) sopTopBtn.hidden = !isErp || !sopTemplates;

    [
      [modeErpBtn,      isErp],
      [modePackagesBtn, isPackages],
      [modeConfigBtn,   isConfig],
    ].forEach(([btn, active]) => {
      if (!btn) return;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
    });

    // Header text adapts to the mode.
    if (isPackages) {
      if (headerEyebrowEl) headerEyebrowEl.textContent = "Professional Services";
      if (headerTitleEl) headerTitleEl.textContent = "PNPT Package Builder";
      if (headerSubtitleEl) headerSubtitleEl.textContent =
        "Pick one or more tiers to see which tools you get in each, and how the tiers differ.";
      if (activePackage) renderPackagesView();
    } else if (isConfig) {
      if (headerEyebrowEl) headerEyebrowEl.textContent = "Professional Services";
      if (headerTitleEl) headerTitleEl.textContent = "PNPT Configuration & Tracking";
      if (headerSubtitleEl) headerSubtitleEl.textContent =
        "Track the SPC configuration journey for a client, phase by phase, against the official Configuration Workbook.";
      renderConfigView();
    } else {
      if (headerEyebrowEl) headerEyebrowEl.textContent = "ERP Integrations";
      if (headerTitleEl) headerTitleEl.textContent = "ERP Connector Map";
      if (headerSubtitleEl) headerSubtitleEl.textContent =
        "ERP connectors on the left, Procore modules on the right. Click any node to see its support documentation and the data objects it syncs.";
    }
  }

  if (modeErpBtn) modeErpBtn.addEventListener("click", () => setMode("erp"));
  if (modePackagesBtn) modePackagesBtn.addEventListener("click", () => setMode("packages"));
  if (modeConfigBtn) modeConfigBtn.addEventListener("click", () => setMode("config"));

  // ---------- Packages view rendering ----------
  function renderPackagesView() {
    renderPackagesPkgToggle();
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

  function renderPackagesPkgToggle() {
    const cont = document.getElementById("packages-pkg-toggle");
    if (!cont) return;
    cont.innerHTML = "";
    const avail = packagesAvailableForActiveVertical();
    if (avail.length <= 1) return; // nothing to switch between
    const label = document.createElement("span");
    label.className = "packages-toggle-label";
    label.textContent = "Package";
    cont.appendChild(label);
    avail.forEach((pkg) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "packages-pkg-btn";
      btn.textContent = pkg.name;
      btn.title = pkg.name;
      if (pkg === activePackage) btn.classList.add("is-active");
      btn.setAttribute("aria-pressed", String(pkg === activePackage));
      btn.addEventListener("click", () => setActivePackage(pkg.key));
      cont.appendChild(btn);
    });
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
    tiersAvailableForActiveVertical().forEach((tier) => {
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
    return tiersAvailableForActiveVertical().filter((t) => activeTierKeys.has(t.key));
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
      toolIdsForTier(tier).forEach((id) => {
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

    // Zoom/pan group — every line + node is appended here instead of directly
    // to the svg, so wheel/drag/button events can transform the whole graph
    // together. pkgZoom (module-scope) persists across renders within a package.
    const zoomG = document.createElementNS(svgNS, "g");
    zoomG.setAttribute("class", "pkg-zoom-group");
    function applyPkgZoom() {
      zoomG.setAttribute(
        "transform",
        "translate(" + pkgZoom.tx + " " + pkgZoom.ty + ") scale(" + pkgZoom.scale + ")"
      );
    }
    applyPkgZoom();
    svg.appendChild(zoomG);

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

    // Compute a bezier control point that bows the connection clear of any
    // non-endpoint nodes within `PAD` perpendicular distance of the chord.
    // Strategy:
    //   - Collect all in-pad obstacles, splitting them by which side of the
    //     chord they sit on (signed perpendicular).
    //   - If both sides have obstacles, bow toward the side with the farther
    //     closest obstacle (more headroom).
    //   - Bow magnitude is sized so the curve's perpendicular deviation at
    //     each obstacle's projection >= R + SLACK clearance from the obstacle
    //     center on the AWAY side (using B(t) = chord(t) + 2t(1-t)*offset).
    //   - Obstacles exactly on the chord (perp ~= 0) force a side and a
    //     magnitude of 2*(R + SLACK).
    const BOW_R = NODE_R;
    const BOW_SLACK = 12;
    const BOW_PAD = BOW_R + BOW_SLACK;

    function planControl(x1, y1, x2, y2, srcId, tgtId) {
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / len, uy = dy / len;
      const nx = -uy, ny = ux;
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;

      let pos = [], neg = [], onLine = false;
      for (const t of activePackage.tools) {
        if (!t.position || t.id === srcId || t.id === tgtId) continue;
        const px = t.position.x - x1, py = t.position.y - y1;
        const proj = px * ux + py * uy;
        if (proj <= BOW_R || proj >= len - BOW_R) continue;
        const perp = px * nx + py * ny;
        if (Math.abs(perp) >= BOW_PAD) continue;
        const tParam = proj / len;
        if (Math.abs(perp) < 2) onLine = true;
        else if (perp > 0) pos.push({ t: tParam, p: perp });
        else neg.push({ t: tParam, p: -perp });
      }

      // Default subtle bow on a deterministic side.
      let bow = Math.max(len * 0.08, 14);
      let sign = (x1 + y1) < (x2 + y2) ? 1 : -1;

      // How much bow is needed to keep curve away from obstacles on the
      // *opposite* side (curve deviates AWAY from them by 2t(1-t)*bow).
      function clearAway(obs) {
        let need = 0;
        for (const o of obs) {
          const denom = 2 * o.t * (1 - o.t);
          if (denom <= 0.05) continue;
          // bow*denom + p > R + SLACK  =>  bow > (R + SLACK - p) / denom
          const n = (BOW_R + BOW_SLACK - o.p) / denom;
          if (n > need) need = n;
        }
        return need;
      }

      if (onLine) {
        bow = Math.max(bow, 2 * (BOW_R + BOW_SLACK));
        if (pos.length && !neg.length) sign = -1;
        else if (neg.length && !pos.length) sign = +1;
      } else if (pos.length && neg.length) {
        // Both sides — bow toward side with farther closest obstacle.
        const closestPos = pos.reduce((m, o) => Math.min(m, o.p), Infinity);
        const closestNeg = neg.reduce((m, o) => Math.min(m, o.p), Infinity);
        if (closestPos >= closestNeg) { sign = +1; bow = Math.max(bow, clearAway(neg)); }
        else                          { sign = -1; bow = Math.max(bow, clearAway(pos)); }
      } else if (pos.length) {
        sign = -1; bow = Math.max(bow, clearAway(pos));
      } else if (neg.length) {
        sign = +1; bow = Math.max(bow, clearAway(neg));
      }

      return { cx: mx + sign * nx * bow, cy: my + sign * ny * bow };
    }

    // Draw connection paths below the nodes.
    (activePackage.connections || []).forEach((conn) => {
      const ep = endpoints(conn.source, conn.target);
      if (!ep) return;
      const { cx, cy } = planControl(ep.x1, ep.y1, ep.x2, ep.y2, conn.source, conn.target);
      const path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", "M " + ep.x1 + " " + ep.y1 + " Q " + cx + " " + cy + " " + ep.x2 + " " + ep.y2);
      path.setAttribute("class", "pkg-link dir-" + (conn.direction || "to"));
      if (!isActive(conn.source) || !isActive(conn.target)) {
        path.classList.add("dimmed");
      }
      if (selectedPackageToolId) {
        const touchesSel = conn.source === selectedPackageToolId || conn.target === selectedPackageToolId;
        if (touchesSel) path.classList.add("highlighted");
        else path.classList.add("faded");
      }
      zoomG.appendChild(path);
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

      // White stroke-icon centered inside the hex (when a tool.icon is set).
      if (tool.icon) {
        const icon = makePkgIconSvg(tool.icon, 18, "#fff");
        if (icon) g.appendChild(icon);
      }

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

      // Capability badges (Procore Connect, AI/Data Grid, Analytics) sit
      // above the hex in a horizontal row. Each badge has an SVG <title>
      // tooltip so users can identify it without clicking.
      const capList = (tool.capabilities || [])
        .map((k) => (packagesData.capabilities || []).find((c) => c.key === k))
        .filter(Boolean);
      if (capList.length) {
        const BADGE_R = 7;
        const GAP = 4;
        const totalW = capList.length * (BADGE_R * 2) + (capList.length - 1) * GAP;
        const startX = -totalW / 2 + BADGE_R;
        const badgeY = -NODE_R - 10;
        capList.forEach((cap, i) => {
          const bg = document.createElementNS(svgNS, "g");
          bg.setAttribute("class", "pkg-cap-badge");
          bg.setAttribute("transform", "translate(" + (startX + i * (BADGE_R * 2 + GAP)) + "," + badgeY + ")");
          const c = document.createElementNS(svgNS, "circle");
          c.setAttribute("r", BADGE_R);
          c.setAttribute("fill", cap.color || "#000");
          bg.appendChild(c);
          // Prefer the icon — fall back to the letter if no icon configured.
          const iconSvg = cap.icon ? makePkgIconSvg(cap.icon, 9, "#fff") : null;
          if (iconSvg) {
            iconSvg.setAttribute("stroke-width", "2.4");
            bg.appendChild(iconSvg);
          } else {
            const t = document.createElementNS(svgNS, "text");
            t.textContent = cap.letter || cap.name.charAt(0);
            bg.appendChild(t);
          }
          const title = document.createElementNS(svgNS, "title");
          title.textContent = cap.name + (cap.description ? " — " + cap.description : "");
          bg.appendChild(title);
          g.appendChild(bg);
        });
      }

      g.addEventListener("click", (ev) => {
        ev.stopPropagation();
        selectPackageTool(tool.id);
      });
      zoomG.appendChild(g);
    });

    // Click on empty SVG background -> deselect (but only on a real click,
    // not the mouseup at the end of a pan drag).
    let suppressNextSvgClick = false;
    svg.addEventListener("click", () => {
      if (suppressNextSvgClick) { suppressNextSvgClick = false; return; }
      selectPackageTool(null);
    });

    // ---- Zoom & pan ----------------------------------------------------
    const Z_MIN = 0.4, Z_MAX = 4;
    function clampScale(s) { return Math.max(Z_MIN, Math.min(Z_MAX, s)); }
    function svgPointFromClient(clientX, clientY) {
      const rect = svg.getBoundingClientRect();
      return {
        x: vbX + (clientX - rect.left) * (vbW / rect.width),
        y: vbY + (clientY - rect.top)  * (vbH / rect.height),
      };
    }
    // Zoom anchored on a given svg-coordinate point so the point stays put.
    function zoomAt(svgX, svgY, factor) {
      const next = clampScale(pkgZoom.scale * factor);
      const eff = next / pkgZoom.scale;
      pkgZoom.tx = svgX - (svgX - pkgZoom.tx) * eff;
      pkgZoom.ty = svgY - (svgY - pkgZoom.ty) * eff;
      pkgZoom.scale = next;
      applyPkgZoom();
    }

    // Wheel = zoom at cursor.
    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const p = svgPointFromClient(e.clientX, e.clientY);
      zoomAt(p.x, p.y, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });

    // Drag on empty background = pan. Drag on a node = node click (no pan).
    svg.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (e.target.closest(".pkg-node")) return;
      const startX = e.clientX, startY = e.clientY;
      const startTx = pkgZoom.tx, startTy = pkgZoom.ty;
      const rect = svg.getBoundingClientRect();
      const sx = vbW / rect.width, sy = vbH / rect.height;
      let moved = false;
      function onMove(ev) {
        const dx = (ev.clientX - startX) * sx;
        const dy = (ev.clientY - startY) * sy;
        if (!moved && Math.hypot(dx, dy) < 3) return; // tiny jitter = still a click
        moved = true;
        pkgZoom.tx = startTx + dx;
        pkgZoom.ty = startTy + dy;
        applyPkgZoom();
        svg.style.cursor = "grabbing";
      }
      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        svg.style.cursor = "";
        if (moved) suppressNextSvgClick = true; // don't deselect after a pan
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    packagesGraphEl.appendChild(svg);

    // ---- Zoom control buttons (overlay) --------------------------------
    const controls = document.createElement("div");
    controls.className = "pkg-zoom-controls";
    function mkBtn(label, title, onClick) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pkg-zoom-btn";
      b.textContent = label;
      b.title = title;
      b.setAttribute("aria-label", title);
      b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
      return b;
    }
    controls.appendChild(mkBtn("+", "Zoom in", () => {
      zoomAt(vbX + vbW / 2, vbY + vbH / 2, 1.2);
    }));
    controls.appendChild(mkBtn("−", "Zoom out", () => {
      zoomAt(vbX + vbW / 2, vbY + vbH / 2, 1 / 1.2);
    }));
    controls.appendChild(mkBtn("⟳", "Reset zoom", () => {
      resetPkgZoom();
      applyPkgZoom();
    }));
    packagesGraphEl.appendChild(controls);
  }

  function selectPackageTool(id) {
    selectedPackageToolId = id;
    renderPackagesGraph();
    renderPackagesDetails();
  }

  // Shared helper: render the capability badge legend chip-row.
  function renderPackagesCapabilityLegend(parent) {
    const caps = packagesData.capabilities || [];
    if (!caps.length) return;
    const wrap = document.createElement("div");
    wrap.className = "pkg-cap-legend";
    const eyebrow = document.createElement("span");
    eyebrow.className = "pkg-cap-legend-eyebrow";
    eyebrow.textContent = "Capability badges";
    wrap.appendChild(eyebrow);
    caps.forEach((cap) => {
      const chip = document.createElement("span");
      chip.className = "pkg-cap-chip";
      chip.title = cap.description || "";
      const dot = document.createElement("span");
      dot.className = "pkg-cap-dot";
      dot.style.background = cap.color || "#000";
      // Prefer icon over letter.
      if (cap.icon && PKG_ICONS[cap.icon]) {
        const inner = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' + PKG_ICONS[cap.icon] + "</svg>";
        dot.innerHTML = inner;
      } else {
        dot.textContent = cap.letter || cap.name.charAt(0);
      }
      chip.appendChild(dot);
      const lbl = document.createElement("span");
      lbl.textContent = cap.name;
      chip.appendChild(lbl);
      wrap.appendChild(chip);
    });
    parent.appendChild(wrap);
  }

  // Helper used by the tool-detail capability list (mirrors the legend dot).
  function makeCapDot(cap, size) {
    const dot = document.createElement("span");
    dot.className = "pkg-cap-dot";
    dot.style.background = cap.color || "#000";
    if (cap.icon && PKG_ICONS[cap.icon]) {
      const px = size || 11;
      dot.innerHTML = '<svg viewBox="0 0 24 24" width="' + px + '" height="' + px + '" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' + PKG_ICONS[cap.icon] + "</svg>";
    } else {
      dot.textContent = cap.letter || cap.name.charAt(0);
    }
    return dot;
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

    // tier badges that include this tool (honor per-vertical overrides + per-tier availability)
    const includingTiers = tiersAvailableForActiveVertical().filter(
      (t) => toolIdsForTier(t).includes(tool.id)
    );
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

    // This tool's capability badges spelled out.
    const toolCaps = (tool.capabilities || [])
      .map((k) => (packagesData.capabilities || []).find((c) => c.key === k))
      .filter(Boolean);
    if (toolCaps.length) {
      const head = document.createElement("h4");
      head.style.cssText = "margin:14px 0 6px;font-family:'DM Mono',ui-monospace,monospace;font-size:10px;letter-spacing:0.06em;text-transform:uppercase;color:var(--color-text-muted);";
      head.textContent = "Capabilities";
      wrap.appendChild(head);
      const ul = document.createElement("ul");
      ul.className = "pkg-cap-list";
      toolCaps.forEach((cap) => {
        const li = document.createElement("li");
        li.appendChild(makeCapDot(cap, 11));
        const txt = document.createElement("span");
        const b = document.createElement("strong");
        b.textContent = cap.name;
        txt.appendChild(b);
        if (cap.description) txt.appendChild(document.createTextNode(" — " + cap.description));
        li.appendChild(txt);
        ul.appendChild(li);
      });
      wrap.appendChild(ul);
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

    // Capability badge legend (always visible in the default view).
    renderPackagesCapabilityLegend(packagesDetailsEl);

    const tiers = selectedTiers();
    if (!tiers.length) {
      const p = document.createElement("p");
      p.className = "packages-empty";
      p.textContent = "Select a tier above.";
      packagesDetailsEl.appendChild(p);
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

  // ===================================================================
  // PNPT Configuration & Tracking
  // ===================================================================
  // Multi-client state — v2. The wrapper holds many clients keyed by id;
  // configState is a pointer into the active client so every existing
  // renderer that mutates configState.tasks / .workbook / .deliverables
  // continues to work unchanged.
  const CONFIG_LS_KEY_V2 = "pnpt-config-tracker:v2";
  const CONFIG_LS_KEY_V1 = "pnpt-config-tracker:v1";
  let configMulti = loadMultiState();
  let configState = configMulti.clients[configMulti.activeClientId];
  let configActivePhase = (configData.phases && configData.phases[0] && configData.phases[0].key) || "initiation";

  function newClientId() {
    return "c_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }
  function defaultClient(name) {
    const firstPkg = (configData.packages && configData.packages[0]) || {};
    return {
      id: newClientId(),
      name: name || "",
      packageKey: firstPkg.key || "cost-management",
      tierKey: (firstPkg.tiers && firstPkg.tiers[0] && firstPkg.tiers[0].key) || "standard",
      createdAt: Date.now(),
      tasks: {},        // tasks[phaseKey] = { [taskIdx]: true }
      workbook: {},     // workbook[sectionKey] = { [settingIdx]: { updated, changed, notes } }
      deliverables: {}, // deliverables[key] = bool
    };
  }
  function loadMultiState() {
    // Try v2 directly.
    try {
      const raw = localStorage.getItem(CONFIG_LS_KEY_V2);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.clients && parsed.activeClientId && parsed.clients[parsed.activeClientId]) {
          return parsed;
        }
        // Heal a dangling activeClientId rather than abandoning the store —
        // falling through to "fresh start" would overwrite every saved
        // client on the next save.
        if (parsed && parsed.clients && Object.keys(parsed.clients).length) {
          parsed.activeClientId = Object.keys(parsed.clients)[0];
          return parsed;
        }
      }
    } catch (e) {}
    // Migrate v1 single-client shape.
    try {
      const v1raw = localStorage.getItem(CONFIG_LS_KEY_V1);
      if (v1raw) {
        const v1 = JSON.parse(v1raw);
        const c = defaultClient(v1.client || "");
        if (v1.packageKey) c.packageKey = v1.packageKey;
        if (v1.tierKey) c.tierKey = v1.tierKey;
        c.tasks = v1.tasks || {};
        c.workbook = v1.workbook || {};
        c.deliverables = v1.deliverables || {};
        const wrapper = { schema: "v2", activeClientId: c.id, clients: {} };
        wrapper.clients[c.id] = c;
        return wrapper;
      }
    } catch (e) {}
    // Fresh start.
    const c = defaultClient("");
    const wrapper = { schema: "v2", activeClientId: c.id, clients: {} };
    wrapper.clients[c.id] = c;
    return wrapper;
  }
  let configSaveWarned = false;
  function saveConfigState() {
    try {
      localStorage.setItem(CONFIG_LS_KEY_V2, JSON.stringify(configMulti));
    } catch (e) {
      // Storage blocked (private mode) or quota hit — changes are NOT being
      // persisted. Say so once instead of silently dropping every edit.
      if (!configSaveWarned) {
        configSaveWarned = true;
        alert("Heads up: this browser is blocking local storage, so Config Tracker changes are NOT being saved. Check private-browsing mode or storage settings.");
      }
    }
  }
  function clientList() {
    return Object.keys(configMulti.clients)
      .map((id) => configMulti.clients[id])
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }
  function switchClient(id) {
    if (!configMulti.clients[id]) return;
    configMulti.activeClientId = id;
    configState = configMulti.clients[id];
    saveConfigState();
    configActivePhase = (configData.phases && configData.phases[0] && configData.phases[0].key) || "initiation";
    renderConfigView();
  }
  function createNewClient() {
    const raw = prompt("Client name?");
    if (raw === null) return;
    const c = defaultClient((raw || "").trim());
    configMulti.clients[c.id] = c;
    configMulti.activeClientId = c.id;
    configState = c;
    saveConfigState();
    renderConfigView();
  }
  function deleteCurrentClient() {
    const ids = Object.keys(configMulti.clients);
    const current = configMulti.clients[configMulti.activeClientId];
    const label = (current && current.name) || "(unnamed)";
    if (ids.length <= 1) {
      if (!confirm("This is your only client. Reset and start fresh?")) return;
      const c = defaultClient("");
      configMulti = { schema: "v2", activeClientId: c.id, clients: {} };
      configMulti.clients[c.id] = c;
      configState = c;
      saveConfigState();
      renderConfigView();
      return;
    }
    if (!confirm('Delete client "' + label + '"? This cannot be undone.')) return;
    delete configMulti.clients[configMulti.activeClientId];
    configMulti.activeClientId = Object.keys(configMulti.clients)[0];
    configState = configMulti.clients[configMulti.activeClientId];
    saveConfigState();
    renderConfigView();
  }
  // Kept for the Reset Progress button — wipes the active client's progress
  // but preserves name / package / tier.
  function resetActiveClientProgress() {
    if (!configState) return;
    configState.tasks = {};
    configState.workbook = {};
    configState.deliverables = {};
    saveConfigState();
    renderConfigView();
  }

  function activeConfigPackage() {
    return (configData.packages || []).find((p) => p.key === configState.packageKey) || null;
  }
  function activeConfigTier() {
    const pkg = activeConfigPackage();
    if (!pkg || !pkg.tiers) return null;
    return pkg.tiers.find((t) => t.key === configState.tierKey) || pkg.tiers[0] || null;
  }
  function workbookSectionsForTier() {
    const pkg = activeConfigPackage();
    const tier = activeConfigTier();
    if (!pkg || !pkg.workbook) return [];
    const allSections = pkg.workbook.sections || [];
    const extras = (tier && tier.extraWorkbookSections) || [];
    return allSections.filter((s) => !s.enterpriseOnly || extras.includes(s.key));
  }

  function renderConfigView() {
    if (!configData || !configData.phases || !configData.phases.length) return;
    renderConfigBar();
    renderConfigPhases();
    renderConfigPhaseContent();
    renderConfigSidebar();
  }

  function renderConfigBar() {
    const titleEl = document.getElementById("config-title");
    const clientPickEl = document.getElementById("config-client-pick");
    const clientNewBtn = document.getElementById("config-client-new");
    const clientDelBtn = document.getElementById("config-client-delete");
    const clientNameEl = document.getElementById("config-client-name");
    const pkgEl = document.getElementById("config-package-pick");
    const tierEl = document.getElementById("config-tier-pick");
    const resetBtn = document.getElementById("config-reset");
    if (!titleEl || !pkgEl || !tierEl || !clientNameEl || !clientPickEl || !resetBtn) return;

    const pkg = activeConfigPackage();
    const tier = activeConfigTier();
    titleEl.textContent = pkg ? pkg.name : "—";
    let stats = titleEl.parentNode.querySelector(".config-bar-stats");
    if (!stats) {
      stats = document.createElement("p");
      stats.className = "config-bar-stats";
      titleEl.parentNode.appendChild(stats);
    }
    const parts = [];
    if (tier && tier.hours) parts.push(tier.hours + " hours");
    if (tier && tier.duration) parts.push(tier.duration);
    if (tier && tier.pricing && tier.pricing.comm != null) parts.push("COMM $" + tier.pricing.comm.toLocaleString());
    if (tier && tier.pricing && tier.pricing.smb  != null) parts.push("SMB $"  + tier.pricing.smb.toLocaleString());
    stats.textContent = parts.join("  ·  ");

    // Client picker dropdown
    clientPickEl.innerHTML = "";
    const clients = clientList();
    clients.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = (c.name || "(unnamed)") + "  ·  " + (c.packageKey || "");
      if (c.id === configMulti.activeClientId) opt.selected = true;
      clientPickEl.appendChild(opt);
    });
    clientPickEl.onchange = () => switchClient(clientPickEl.value);
    if (clientNewBtn) clientNewBtn.onclick = createNewClient;
    if (clientDelBtn) clientDelBtn.onclick = deleteCurrentClient;

    // Rename input for the active client
    clientNameEl.value = configState.name || configState.client || "";
    clientNameEl.oninput = () => {
      configState.name = clientNameEl.value;
      // Live-update the dropdown label without re-rendering everything.
      const opt = clientPickEl.querySelector('option[value="' + configMulti.activeClientId + '"]');
      if (opt) opt.textContent = (configState.name || "(unnamed)") + "  ·  " + (configState.packageKey || "");
      saveConfigState();
    };

    pkgEl.innerHTML = "";
    (configData.packages || []).forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.key; opt.textContent = p.name;
      if (p.key === configState.packageKey) opt.selected = true;
      pkgEl.appendChild(opt);
    });
    pkgEl.onchange = () => {
      configState.packageKey = pkgEl.value;
      const pkg2 = activeConfigPackage();
      configState.tierKey = (pkg2 && pkg2.tiers && pkg2.tiers[0] && pkg2.tiers[0].key) || configState.tierKey;
      saveConfigState();
      renderConfigView();
    };

    tierEl.innerHTML = "";
    (pkg && pkg.tiers ? pkg.tiers : []).forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t.key; opt.textContent = t.name;
      if (t.key === configState.tierKey) opt.selected = true;
      tierEl.appendChild(opt);
    });
    tierEl.onchange = () => { configState.tierKey = tierEl.value; saveConfigState(); renderConfigView(); };

    resetBtn.onclick = () => {
      const label = configState.name || "(unnamed)";
      if (!confirm('Reset all progress for "' + label + '"? Tasks, workbook entries, and deliverable checks will be cleared. Name / package / tier preserved.')) return;
      resetActiveClientProgress();
    };
  }

  function phaseProgress(phaseKey) {
    const phase = (configData.phases || []).find((p) => p.key === phaseKey);
    if (!phase) return { done: 0, total: 0 };
    const total = (phase.tasks || []).length;
    // Checkmarks are keyed by task index, so a client checked against an
    // older (longer) task list must not push progress past 100% after the
    // data file shrinks — count only indices that still exist.
    const stored = (configState.tasks && configState.tasks[phaseKey]) || {};
    let done = 0;
    for (let i = 0; i < total; i++) if (stored[i]) done++;
    return { done, total };
  }
  function overallProgress() {
    let done = 0, total = 0;
    (configData.phases || []).forEach((p) => {
      const pp = phaseProgress(p.key);
      done += pp.done; total += pp.total;
    });
    return { done, total };
  }

  function renderConfigPhases() {
    const cont = document.getElementById("config-phases");
    if (!cont) return;
    cont.innerHTML = "";
    (configData.phases || []).forEach((phase) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "config-phase-btn" + (phase.key === configActivePhase ? " is-active" : "");
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", String(phase.key === configActivePhase));

      const eyebrow = document.createElement("p");
      eyebrow.className = "config-phase-eyebrow";
      eyebrow.textContent = phase.eyebrow || "";
      btn.appendChild(eyebrow);

      const name = document.createElement("p");
      name.className = "config-phase-name";
      name.textContent = phase.name;
      btn.appendChild(name);

      const pp = phaseProgress(phase.key);
      const meta = document.createElement("p");
      meta.className = "config-phase-meta";
      meta.textContent = (phase.owner || "") + " · " + pp.done + " / " + pp.total + " tasks";
      btn.appendChild(meta);
      if (phase.duration) {
        const dur = document.createElement("p");
        dur.className = "config-phase-meta config-phase-meta-dur";
        dur.textContent = phase.duration;
        btn.appendChild(dur);
      }

      const bar = document.createElement("div");
      bar.className = "config-phase-bar";
      const fill = document.createElement("div");
      fill.className = "config-phase-bar-fill";
      const pct = pp.total ? Math.round((pp.done / pp.total) * 100) : 0;
      fill.style.width = pct + "%";
      bar.appendChild(fill);
      btn.appendChild(bar);

      btn.addEventListener("click", () => {
        configActivePhase = phase.key;
        renderConfigView();
      });
      cont.appendChild(btn);
    });
  }

  function renderConfigPhaseContent() {
    const cont = document.getElementById("config-content");
    if (!cont) return;
    cont.innerHTML = "";
    const phase = (configData.phases || []).find((p) => p.key === configActivePhase);
    if (!phase) return;

    const wrap = document.createElement("div");
    wrap.className = "config-phase-detail";

    const h = document.createElement("h3");
    h.textContent = phase.name;
    wrap.appendChild(h);

    const owner = document.createElement("p");
    owner.className = "config-phase-owner";
    owner.textContent = (phase.eyebrow ? phase.eyebrow + " · " : "") + (phase.owner || "");
    wrap.appendChild(owner);

    if (phase.description) {
      const desc = document.createElement("p");
      desc.className = "config-phase-desc";
      desc.textContent = phase.description;
      wrap.appendChild(desc);
    }

    // NAMER source documents for this phase (Google Drive links).
    if (Array.isArray(phase.resources) && phase.resources.length) {
      const res = document.createElement("div");
      res.className = "config-phase-resources";
      const rh = document.createElement("p");
      rh.className = "config-phase-resources-eyebrow";
      rh.textContent = "NAMER Source Documents";
      res.appendChild(rh);
      const list = document.createElement("div");
      list.className = "config-phase-resources-list";
      phase.resources.forEach((r) => {
        const a = document.createElement("a");
        a.className = "config-resource-link";
        a.href = r.url;
        a.target = "_blank";
        a.rel = "noopener";
        const ty = document.createElement("span");
        ty.className = "config-resource-type";
        ty.textContent = r.type || "Doc";
        a.appendChild(ty);
        a.appendChild(document.createTextNode(r.name));
        list.appendChild(a);
      });
      res.appendChild(list);
      wrap.appendChild(res);
    }

    const cfgPkg = activeConfigPackage();
    const cfgTier = activeConfigTier();

    // Helper: render a "GPS Frame" — a named block sourced from the top-level
    // configData (deliveryPitStop, consultationStructure, configureHeadsDown,
    // validationRR) so SPC-facing structures from GPS Slides 31/43/49/61 appear
    // inline on the relevant phases.
    function renderFrame(keyRef) {
      const frame = configData[keyRef];
      if (!frame) return;
      const wrapEl = document.createElement("div");
      wrapEl.className = "config-frame";
      const head = document.createElement("div");
      head.className = "config-frame-head";
      const eb = document.createElement("p");
      eb.className = "config-frame-eyebrow";
      eb.textContent = "GPS Frame";
      head.appendChild(eb);
      const ttl = document.createElement("h4");
      ttl.className = "config-frame-title";
      ttl.textContent = frame.name || keyRef;
      head.appendChild(ttl);
      if (frame.subtitle || frame.purpose || frame.window) {
        const sub = document.createElement("p");
        sub.className = "config-frame-sub";
        sub.textContent = frame.subtitle || frame.purpose ||
          (frame.window ? "Window: " + frame.window : "");
        head.appendChild(sub);
      }
      wrapEl.appendChild(head);

      if (Array.isArray(frame.buckets)) {
        const grid = document.createElement("div");
        grid.className = "config-frame-grid";
        frame.buckets.forEach((b, i) => {
          const card = document.createElement("div");
          card.className = "config-frame-card";
          const ix = document.createElement("p");
          ix.className = "config-frame-ix";
          ix.textContent = String(i + 1).padStart(2, "0");
          card.appendChild(ix);
          const nm = document.createElement("p");
          nm.className = "config-frame-card-name";
          nm.textContent = b.name;
          card.appendChild(nm);
          const desc = document.createElement("p");
          desc.className = "config-frame-card-desc";
          desc.textContent = b.description || "";
          card.appendChild(desc);
          grid.appendChild(card);
        });
        wrapEl.appendChild(grid);
      }
      if (Array.isArray(frame.points)) {
        if (Array.isArray(frame.levels) && frame.levels.length) {
          const stack = document.createElement("div");
          stack.className = "config-frame-levels";
          frame.levels.forEach((lv) => {
            const li = document.createElement("span");
            li.className = "config-frame-level";
            li.textContent = lv;
            stack.appendChild(li);
          });
          wrapEl.appendChild(stack);
        }
        const ol = document.createElement("ol");
        ol.className = "config-frame-points";
        frame.points.forEach((p) => {
          const li = document.createElement("li");
          const nm = document.createElement("strong");
          nm.textContent = p.name;
          li.appendChild(nm);
          if (p.description) {
            li.appendChild(document.createTextNode(" — " + p.description));
          }
          if (Array.isArray(p.items)) {
            const ul = document.createElement("ul");
            p.items.forEach((it) => {
              const ili = document.createElement("li"); ili.textContent = it; ul.appendChild(ili);
            });
            li.appendChild(ul);
          }
          ol.appendChild(li);
        });
        wrapEl.appendChild(ol);
      }
      // pillars[] (used by packageStrategy)
      if (Array.isArray(frame.pillars)) {
        const grid = document.createElement("div");
        grid.className = "config-frame-grid";
        frame.pillars.forEach((p, i) => {
          const card = document.createElement("div");
          card.className = "config-frame-card";
          const ix = document.createElement("p");
          ix.className = "config-frame-ix";
          ix.textContent = String(i + 1).padStart(2, "0");
          card.appendChild(ix);
          const nm = document.createElement("p");
          nm.className = "config-frame-card-name";
          nm.textContent = p.name;
          card.appendChild(nm);
          if (p.description) {
            const d = document.createElement("p");
            d.className = "config-frame-card-desc";
            d.textContent = p.description;
            card.appendChild(d);
          }
          if (Array.isArray(p.items)) {
            const ul = document.createElement("ul");
            ul.className = "config-frame-card-items";
            p.items.forEach((it) => {
              const li = document.createElement("li"); li.textContent = it; ul.appendChild(li);
            });
            card.appendChild(ul);
          }
          grid.appendChild(card);
        });
        wrapEl.appendChild(grid);
      }
      // subSections[] (used by configureHeadsDown after slides 50/51/52)
      if (Array.isArray(frame.subSections)) {
        frame.subSections.forEach((ss) => {
          const block = document.createElement("div");
          block.className = "config-frame-subsection";
          const h = document.createElement("p");
          h.className = "config-frame-subsection-name";
          h.textContent = ss.name;
          block.appendChild(h);
          if (Array.isArray(ss.points)) {
            const ol = document.createElement("ol");
            ol.className = "config-frame-points";
            ss.points.forEach((p) => {
              const li = document.createElement("li");
              const nm = document.createElement("strong");
              nm.textContent = p.name;
              li.appendChild(nm);
              if (p.description) li.appendChild(document.createTextNode(" — " + p.description));
              ol.appendChild(li);
            });
            block.appendChild(ol);
          }
          wrapEl.appendChild(block);
        });
      }
      // families[] (used by productCatalog) — nested SKU catalog
      if (Array.isArray(frame.families)) {
        frame.families.forEach((fam) => {
          const block = document.createElement("div");
          block.className = "config-frame-family";
          const h = document.createElement("p");
          h.className = "config-frame-family-name";
          h.textContent = fam.name;
          block.appendChild(h);
          const tbl = document.createElement("table");
          tbl.className = "config-frame-catalog-table";
          const thead = document.createElement("thead");
          const trh = document.createElement("tr");
          ["Product", "PS Package SKUs", "Verticals"].forEach((t) => {
            const th = document.createElement("th"); th.textContent = t; trh.appendChild(th);
          });
          thead.appendChild(trh);
          tbl.appendChild(thead);
          const tbody = document.createElement("tbody");
          (fam.products || []).forEach((pr) => {
            const tr = document.createElement("tr");
            const td1 = document.createElement("td"); td1.textContent = pr.product || ""; td1.className = "config-catalog-product"; tr.appendChild(td1);
            const td2 = document.createElement("td"); td2.textContent = (pr.skus || []).join(" / "); td2.className = "config-catalog-skus"; tr.appendChild(td2);
            const td3 = document.createElement("td"); td3.textContent = pr.verticals || ""; td3.className = "config-catalog-vert"; tr.appendChild(td3);
            tbody.appendChild(tr);
          });
          tbl.appendChild(tbody);
          block.appendChild(tbl);
          wrapEl.appendChild(block);
        });
      }
      // forecastSamples[] (used by initiationResourcing) — per-package PC/SPC weekly forecast tables
      if (Array.isArray(frame.forecastSamples)) {
        frame.forecastSamples.forEach((sample) => {
          const block = document.createElement("div");
          block.className = "config-frame-forecast";
          const h = document.createElement("p");
          h.className = "config-frame-forecast-name";
          h.textContent = sample.package;
          block.appendChild(h);
          const tbl = document.createElement("table");
          tbl.className = "config-frame-forecast-table";
          const thead = document.createElement("thead");
          const trh = document.createElement("tr");
          ["Role", "Weekly hours", "Total"].forEach((t) => {
            const th = document.createElement("th"); th.textContent = t; trh.appendChild(th);
          });
          thead.appendChild(trh);
          tbl.appendChild(thead);
          const tbody = document.createElement("tbody");
          (sample.rows || []).forEach((r) => {
            const tr = document.createElement("tr");
            const td1 = document.createElement("td"); td1.textContent = r.role || ""; td1.className = "config-forecast-role"; tr.appendChild(td1);
            const td2 = document.createElement("td"); td2.textContent = r.weekly || ""; td2.className = "config-forecast-weekly"; tr.appendChild(td2);
            const td3 = document.createElement("td"); td3.textContent = r.total != null ? r.total : ""; td3.className = "config-forecast-total"; tr.appendChild(td3);
            tbody.appendChild(tr);
          });
          tbl.appendChild(tbody);
          block.appendChild(tbl);
          wrapEl.appendChild(block);
        });
      }
      // items[] at the frame level (used by spcResources — resource pill list)
      if (Array.isArray(frame.items) && frame.items.length && typeof frame.items[0] === "object") {
        const list = document.createElement("ul");
        list.className = "config-frame-items";
        frame.items.forEach((it) => {
          const li = document.createElement("li");
          const nm = document.createElement("strong");
          nm.textContent = it.name;
          li.appendChild(nm);
          if (it.description) li.appendChild(document.createTextNode(" — " + it.description));
          list.appendChild(li);
        });
        wrapEl.appendChild(list);
      }
      // examples[] (used by talkTrackShifts) — paired ACD vs New SPC language
      if (Array.isArray(frame.examples)) {
        frame.examples.forEach((ex, i) => {
          const block = document.createElement("div");
          block.className = "config-frame-shift";
          const topic = document.createElement("p");
          topic.className = "config-frame-shift-topic";
          topic.textContent = String(i + 1).padStart(2, "0") + "  ·  " + (ex.topic || "");
          block.appendChild(topic);
          const grid = document.createElement("div");
          grid.className = "config-frame-shift-grid";
          [
            { label: "ACD Talk Track",  text: ex.acd, cls: "acd" },
            { label: "New Talk Track",  text: ex.new, cls: "new" }
          ].forEach((side) => {
            const col = document.createElement("div");
            col.className = "config-frame-shift-col is-" + side.cls;
            const lab = document.createElement("p");
            lab.className = "config-frame-shift-label";
            lab.textContent = side.label;
            col.appendChild(lab);
            const txt = document.createElement("p");
            txt.className = "config-frame-shift-text";
            txt.textContent = side.text || "";
            col.appendChild(txt);
            grid.appendChild(col);
          });
          block.appendChild(grid);
          wrapEl.appendChild(block);
        });
      }
      if (frame.cadence || frame.templates) {
        const meta = document.createElement("p");
        meta.className = "config-frame-meta";
        const parts = [];
        if (frame.cadence) parts.push("Cadence: " + frame.cadence);
        if (frame.templates) parts.push(frame.templates);
        meta.textContent = parts.join("  ·  ");
        wrapEl.appendChild(meta);
      }
      if (frame.pcpm || frame.spc) {
        const rr = document.createElement("div");
        rr.className = "config-frame-rr";
        [
          { label: "PC / PM", items: frame.pcpm },
          { label: "SPC",     items: frame.spc  }
        ].forEach((side) => {
          if (!side.items) return;
          const col = document.createElement("div");
          col.className = "config-frame-rr-col";
          const ll = document.createElement("p");
          ll.className = "config-frame-rr-label";
          ll.textContent = side.label;
          col.appendChild(ll);
          const ul = document.createElement("ul");
          side.items.forEach((it) => {
            const li = document.createElement("li"); li.textContent = it; ul.appendChild(li);
          });
          col.appendChild(ul);
          rr.appendChild(col);
        });
        wrapEl.appendChild(rr);
      }
      wrap.appendChild(wrapEl);
    }

    // Phase-level structured frames (from phase.structuredFrames)
    if (phase.structuredFrames) {
      Object.values(phase.structuredFrames).forEach(renderFrame);
    }

    // Kickoff phase: render the week-by-week visual timeline. Per-tier
    // override wins (CM Enterprise = 14 weeks, CM Standard = 8 weeks).
    if (phase.key === "kickoff" && cfgPkg && (cfgPkg.kickoffTimeline || (cfgTier && cfgTier.kickoffTimeline))) {
      const tl = (cfgTier && cfgTier.kickoffTimeline) || cfgPkg.kickoffTimeline;
      const wrapEl = document.createElement("div");
      wrapEl.className = "config-frame";
      const head = document.createElement("div");
      head.className = "config-frame-head";
      const eb = document.createElement("p");
      eb.className = "config-frame-eyebrow";
      eb.textContent = "Visual timeline";
      head.appendChild(eb);
      const ttl = document.createElement("h4");
      ttl.className = "config-frame-title";
      ttl.textContent = tl.name;
      head.appendChild(ttl);
      if (tl.subtitle) {
        const sub = document.createElement("p");
        sub.className = "config-frame-sub";
        sub.textContent = tl.subtitle;
        head.appendChild(sub);
      }
      wrapEl.appendChild(head);
      const list = document.createElement("div");
      list.className = "config-timeline";
      (tl.weeks || []).forEach((w) => {
        const wk = document.createElement("div");
        wk.className = "config-timeline-week";
        const wkH = document.createElement("p");
        wkH.className = "config-timeline-week-head";
        wkH.textContent = "Week " + w.week;
        wk.appendChild(wkH);
        const ul = document.createElement("ul");
        ul.className = "config-timeline-items";
        (w.items || []).forEach((it) => {
          const li = document.createElement("li"); li.textContent = it; ul.appendChild(li);
        });
        wk.appendChild(ul);
        list.appendChild(wk);
      });
      wrapEl.appendChild(list);
      wrap.appendChild(wrapEl);
    }

    // Build phase: render the per-package consultationAgenda (time-blocked).
    if (phase.key === "build" && cfgPkg && cfgPkg.consultationAgenda) {
      const ag = cfgPkg.consultationAgenda;
      const wrapEl = document.createElement("div");
      wrapEl.className = "config-frame";
      const head = document.createElement("div");
      head.className = "config-frame-head";
      const eb = document.createElement("p");
      eb.className = "config-frame-eyebrow";
      eb.textContent = "Time-blocked agenda";
      head.appendChild(eb);
      const ttl = document.createElement("h4");
      ttl.className = "config-frame-title";
      ttl.textContent = ag.name;
      head.appendChild(ttl);
      if (ag.subtitle) {
        const sub = document.createElement("p");
        sub.className = "config-frame-sub";
        sub.textContent = ag.subtitle;
        head.appendChild(sub);
      }
      wrapEl.appendChild(head);
      const tbl = document.createElement("table");
      tbl.className = "config-agenda-table";
      const thead = document.createElement("thead");
      const trh = document.createElement("tr");
      ["Time", "Type", "Topic"].forEach((h) => {
        const th = document.createElement("th"); th.textContent = h; trh.appendChild(th);
      });
      thead.appendChild(trh);
      tbl.appendChild(thead);
      const tbody = document.createElement("tbody");
      (ag.blocks || []).forEach((b) => {
        const tr = document.createElement("tr");
        tr.className = "config-agenda-row" + (b.kind === "Break" ? " is-break" : "");
        const t1 = document.createElement("td"); t1.textContent = b.time || ""; t1.className = "config-agenda-time"; tr.appendChild(t1);
        const t2 = document.createElement("td"); t2.textContent = b.kind || ""; t2.className = "config-agenda-kind"; tr.appendChild(t2);
        const t3 = document.createElement("td"); t3.textContent = b.topic || ""; tr.appendChild(t3);
        tbody.appendChild(tr);
      });
      tbl.appendChild(tbody);
      wrapEl.appendChild(tbl);
      wrap.appendChild(wrapEl);
    }

    // Build phase: surface the 6 configuration-scope categories (APRIL Slide 5).
    if (phase.key === "build" && cfgPkg && cfgPkg.configurationScope && cfgPkg.configurationScope.length) {
      const block = document.createElement("div");
      block.className = "config-tools-block";
      const eb = document.createElement("p");
      eb.className = "config-tools-eyebrow";
      eb.textContent = "Configuration scope (6 categories — every PNPT package)";
      block.appendChild(eb);
      const list = document.createElement("div");
      list.className = "config-tools-list";
      cfgPkg.configurationScope.forEach((s) => {
        const chip = document.createElement("span");
        chip.className = "config-tool-chip";
        chip.textContent = s.name;
        list.appendChild(chip);
      });
      block.appendChild(list);
      wrap.appendChild(block);
    }

    // In-scope tools block (Discovery + Build + Validate). Prefer the rich
    // toolList (with support-Diagrams URLs) when available; fall back to the
    // simpler string-array inScopeTools.
    if (phase.key === "discovery" || phase.key === "build" || phase.key === "validate") {
      const block = document.createElement("div");
      block.className = "config-tools-block";
      const eb = document.createElement("p");
      eb.className = "config-tools-eyebrow";
      eb.textContent = "In-scope tools (" + (cfgTier ? cfgTier.name : cfgPkg.name) + ")";
      block.appendChild(eb);
      const list = document.createElement("div");
      list.className = "config-tools-list";
      const richList = cfgTier && cfgTier.toolList && cfgTier.toolList.length ? cfgTier.toolList : null;
      if (richList) {
        richList.forEach((t) => {
          if (t.supportUrl) {
            const a = document.createElement("a");
            a.className = "config-tool-chip config-tool-link";
            a.href = t.supportUrl;
            a.target = "_blank";
            a.rel = "noopener";
            a.textContent = t.name;
            a.title = "Open " + t.name + " support article";
            list.appendChild(a);
          } else {
            const chip = document.createElement("span");
            chip.className = "config-tool-chip";
            chip.textContent = t.name;
            list.appendChild(chip);
          }
        });
      } else if (cfgTier && cfgTier.inScopeTools) {
        cfgTier.inScopeTools.forEach((t) => {
          const chip = document.createElement("span");
          chip.className = "config-tool-chip";
          chip.textContent = t;
          list.appendChild(chip);
        });
      }
      block.appendChild(list);
      wrap.appendChild(block);

      // Discovery-only: the per-tool discovery question checklist + AI prompts.
      if (phase.key === "discovery" && cfgPkg.toolDiscoveryPrompts && cfgPkg.toolDiscoveryPrompts.questions) {
        const qBlock = document.createElement("div");
        qBlock.className = "config-tools-block";
        const qb = document.createElement("p");
        qb.className = "config-tools-eyebrow";
        qb.textContent = "Per-tool discovery questions";
        qBlock.appendChild(qb);
        const qList = document.createElement("ul");
        qList.className = "config-prompt-list";
        cfgPkg.toolDiscoveryPrompts.questions.forEach((q) => {
          const li = document.createElement("li");
          li.textContent = q;
          qList.appendChild(li);
        });
        qBlock.appendChild(qList);
        wrap.appendChild(qBlock);
      }

      if (phase.key === "discovery" && configData.aiPrompts) {
        const aiWrap = document.createElement("div");
        aiWrap.className = "config-tools-block";
        const aieb = document.createElement("p");
        aieb.className = "config-tools-eyebrow";
        aieb.textContent = "AI prompts — run against the discovery call Gong / Notebook LM transcript";
        aiWrap.appendChild(aieb);
        [
          { key: "currentState", label: "Current State Summary" },
          { key: "desiredState", label: "Desired State Summary" }
        ].forEach((p) => {
          const ptext = configData.aiPrompts[p.key];
          if (!ptext) return;
          const det = document.createElement("details");
          det.className = "config-prompt-details";
          const sum = document.createElement("summary");
          sum.textContent = p.label;
          det.appendChild(sum);
          const pre = document.createElement("p");
          pre.className = "config-prompt-text";
          pre.textContent = ptext;
          det.appendChild(pre);
          aiWrap.appendChild(det);
        });
        wrap.appendChild(aiWrap);
      }
    }

    // Task checklist
    const ul = document.createElement("ul");
    ul.className = "config-task-list";
    (phase.tasks || []).forEach((task, idx) => {
      const checked = !!(configState.tasks[phase.key] && configState.tasks[phase.key][idx]);
      const li = document.createElement("li");
      li.className = "config-task" + (checked ? " is-done" : "");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = checked;
      cb.addEventListener("change", () => {
        configState.tasks[phase.key] = configState.tasks[phase.key] || {};
        configState.tasks[phase.key][idx] = cb.checked;
        saveConfigState();
        renderConfigView();
      });
      li.appendChild(cb);
      const span = document.createElement("span");
      span.className = "config-task-text";
      span.textContent = task.text;
      li.appendChild(span);
      li.addEventListener("click", (e) => { if (e.target !== cb) cb.click(); });
      ul.appendChild(li);
    });
    wrap.appendChild(ul);

    // Configuration Workbook only appears on the Build phase.
    if (phase.key === "build") {
      const wbWrap = document.createElement("div");
      wbWrap.className = "config-workbook";

      const wbHeader = document.createElement("h3");
      wbHeader.textContent = "Configuration Workbook";
      wbWrap.appendChild(wbHeader);

      const intro = document.createElement("p");
      intro.className = "config-workbook-intro";
      intro.textContent =
        "Per-section settings from the official PNPT Configuration Workbook. Tick 'Updated' for any setting you deviated from the default on, capture the new value, and add notes for the closeout deliverable. Only deviations need to be filled in — defaults stay implicit.";
      wbWrap.appendChild(intro);

      workbookSectionsForTier().forEach((section) => {
        const det = document.createElement("details");
        det.className = "config-wb-section";

        const sum = document.createElement("summary");
        const sumLeft = document.createElement("span");
        sumLeft.textContent = section.name;
        sum.appendChild(sumLeft);
        const sumProg = document.createElement("span");
        sumProg.className = "config-wb-section-progress";
        const sd = (section.settings || []).filter((_, i) =>
          configState.workbook[section.key] && configState.workbook[section.key][i] &&
          configState.workbook[section.key][i].updated
        ).length;
        sumProg.textContent = sd + " of " + (section.settings || []).length + " updated";
        sum.appendChild(sumProg);
        det.appendChild(sum);

        const table = document.createElement("table");
        table.className = "config-wb-table";
        const thead = document.createElement("thead");
        const trh = document.createElement("tr");
        ["Setting / Decision", "Default", "Updated?", "Changed To / Notes"].forEach((t) => {
          const th = document.createElement("th"); th.textContent = t; trh.appendChild(th);
        });
        thead.appendChild(trh);
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        (section.settings || []).forEach((setting, idx) => {
          const st = (configState.workbook[section.key] && configState.workbook[section.key][idx]) || {};
          const tr = document.createElement("tr");
          tr.className = "config-wb-row" + (st.updated ? " is-updated" : "");

          // Setting + decision logic
          const td1 = document.createElement("td");
          const nm = document.createElement("div");
          nm.className = "config-wb-name";
          nm.textContent = setting.name;
          td1.appendChild(nm);
          if (setting.decisionLogic) {
            const dl = document.createElement("div");
            dl.className = "config-wb-decision";
            dl.textContent = setting.decisionLogic;
            td1.appendChild(dl);
          }
          if (setting.notes) {
            const nt = document.createElement("div");
            nt.className = "config-wb-note";
            nt.textContent = setting.notes;
            td1.appendChild(nt);
          }
          tr.appendChild(td1);

          // Default
          const td2 = document.createElement("td");
          const def = document.createElement("div");
          def.className = "config-wb-default";
          def.textContent = setting.default || "—";
          td2.appendChild(def);
          tr.appendChild(td2);

          // Updated checkbox
          const td3 = document.createElement("td");
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = !!st.updated;
          cb.addEventListener("change", () => {
            configState.workbook[section.key] = configState.workbook[section.key] || {};
            const cur = configState.workbook[section.key][idx] || {};
            cur.updated = cb.checked;
            configState.workbook[section.key][idx] = cur;
            saveConfigState();
            tr.classList.toggle("is-updated", cb.checked);
            sumProg.textContent = (section.settings || []).filter((_, i) =>
              configState.workbook[section.key] && configState.workbook[section.key][i] &&
              configState.workbook[section.key][i].updated
            ).length + " of " + (section.settings || []).length + " updated";
          });
          td3.appendChild(cb);
          tr.appendChild(td3);

          // Changed To + Notes
          const td4 = document.createElement("td");
          const changed = document.createElement("input");
          changed.type = "text";
          changed.placeholder = "Changed to…";
          changed.value = st.changed || "";
          changed.addEventListener("input", () => {
            configState.workbook[section.key] = configState.workbook[section.key] || {};
            const cur = configState.workbook[section.key][idx] || {};
            cur.changed = changed.value;
            configState.workbook[section.key][idx] = cur;
            saveConfigState();
          });
          td4.appendChild(changed);
          const noteTa = document.createElement("textarea");
          noteTa.placeholder = "Notes (rationale, screenshot ref, etc.)";
          noteTa.style.marginTop = "6px";
          noteTa.value = st.notes || "";
          noteTa.addEventListener("input", () => {
            configState.workbook[section.key] = configState.workbook[section.key] || {};
            const cur = configState.workbook[section.key][idx] || {};
            cur.notes = noteTa.value;
            configState.workbook[section.key][idx] = cur;
            saveConfigState();
          });
          td4.appendChild(noteTa);
          tr.appendChild(td4);

          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        det.appendChild(table);
        wbWrap.appendChild(det);
      });
      wrap.appendChild(wbWrap);
    }

    cont.appendChild(wrap);
  }

  function renderConfigSidebar() {
    const fill = document.getElementById("config-progress-fill");
    const txt = document.getElementById("config-progress-text");
    const dlEl = document.getElementById("config-deliverables");
    if (!fill || !txt || !dlEl) return;
    const op = overallProgress();
    const pct = op.total ? Math.round((op.done / op.total) * 100) : 0;
    fill.style.width = pct + "%";
    txt.textContent = pct + "% complete — " + op.done + " / " + op.total + " tasks";

    dlEl.innerHTML = "";
    const eb = document.createElement("p");
    eb.className = "config-deliverables-eyebrow";
    eb.textContent = "Deliverables";
    dlEl.appendChild(eb);

    const pkg = activeConfigPackage();
    (pkg && pkg.deliverables ? pkg.deliverables : []).forEach((d) => {
      const card = document.createElement("div");
      card.className = "config-deliverable";
      const row = document.createElement("div");
      row.className = "config-deliverable-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!configState.deliverables[d.key];
      cb.addEventListener("change", () => {
        configState.deliverables[d.key] = cb.checked;
        saveConfigState();
      });
      row.appendChild(cb);
      const nm = document.createElement("span");
      nm.className = "config-deliverable-name";
      nm.textContent = d.name;
      row.appendChild(nm);
      const ow = document.createElement("span");
      ow.className = "config-deliverable-owner";
      ow.textContent = d.owner || "";
      row.appendChild(ow);
      card.appendChild(row);
      if (d.description) {
        const desc = document.createElement("p");
        desc.className = "config-deliverable-desc";
        desc.textContent = d.description;
        card.appendChild(desc);
      }
      dlEl.appendChild(card);
    });
  }
})();
