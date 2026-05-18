(async function () {
  // Fixed bipartite layout: ERPs in a column on the left, Procore modules
  // in a column on the right. The "core" Procore node and structural
  // Procore-to-module links are intentionally hidden in this view — they
  // become visual noise once the columns make the hub structure explicit.

  const NODE_RADIUS = { erp: 14, module: 12 };
  const NODE_COLOR = { erp: "#2563eb", module: "#10b981" };

  // Line + arrow colors keyed by link direction. Kept in sync with the
  // CSS variables in styles.css and the legend swatches in index.html.
  const LINK_COLORS = {
    both: "#6366f1",      // indigo  — bidirectional
    "to-erp": "#d97706",  // amber   — Procore → ERP (export)
    "from-erp": "#0d9488" // teal    — ERP → Procore (import)
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

  const data = await fetch("data.json").then((r) => {
    if (!r.ok) throw new Error("Failed to load data.json: " + r.status);
    return r.json();
  });

  // Filter to just the nodes we render in this view. Drop the "core"
  // Procore node, and drop the Procore-to-module structural links.
  const erpNodes = data.nodes
    .filter((n) => n.type === "erp")
    .sort((a, b) => a.label.localeCompare(b.label));
  const moduleNodes = data.nodes
    .filter((n) => n.type === "module")
    .sort((a, b) => a.label.localeCompare(b.label));
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
  // Make sure we have enough vertical room to fit all ERP rows comfortably.
  const ROW_HEIGHT = 36;
  const HEADER_HEIGHT = 56;
  const FOOTER_PAD = 24;
  const minHeight =
    HEADER_HEIGHT + FOOTER_PAD + Math.max(erpNodes.length, moduleNodes.length) * ROW_HEIGHT;
  const height = Math.max(container.clientHeight, minHeight);

  // Reserve gutter space on each side for the labels.
  const LABEL_GUTTER = 170;
  const leftX = LABEL_GUTTER;
  const rightX = width - LABEL_GUTTER;

  const erpSpacing = (height - HEADER_HEIGHT - FOOTER_PAD) / Math.max(erpNodes.length, 1);
  const moduleSpacing =
    (height - HEADER_HEIGHT - FOOTER_PAD) / Math.max(moduleNodes.length, 1);

  erpNodes.forEach((n, i) => {
    n.x = leftX;
    n.y = HEADER_HEIGHT + erpSpacing * (i + 0.5);
  });
  moduleNodes.forEach((n, i) => {
    n.x = rightX;
    n.y = HEADER_HEIGHT + moduleSpacing * (i + 0.5);
  });

  // ---------------------------------------------------------------------
  // SVG scaffolding
  // ---------------------------------------------------------------------

  const svg = d3
    .select("#graph")
    .append("svg")
    .attr("viewBox", [0, 0, width, height])
    .attr("preserveAspectRatio", "xMidYMin meet");

  const defs = svg.append("defs");
  function defineArrow(id, color) {
    defs
      .append("marker")
      .attr("id", id)
      .attr("viewBox", "0 0 10 10")
      .attr("refX", 9)
      .attr("refY", 5)
      .attr("markerWidth", 7)
      .attr("markerHeight", 7)
      .attr("orient", "auto-start-reverse")
      .append("path")
      .attr("d", "M 0 0 L 10 5 L 0 10 z")
      .attr("fill", color);
  }
  defineArrow("arrow-both", LINK_COLORS.both);
  defineArrow("arrow-to-erp", LINK_COLORS["to-erp"]);
  defineArrow("arrow-from-erp", LINK_COLORS["from-erp"]);

  // Pan & zoom — useful when the column has been resized smaller than its
  // natural height, so the user can scroll/zoom inside the SVG.
  const zoomLayer = svg.append("g");
  svg.call(
    d3
      .zoom()
      .scaleExtent([0.5, 2.5])
      .on("zoom", (event) => zoomLayer.attr("transform", event.transform))
  );

  // Column headers
  zoomLayer
    .append("text")
    .attr("class", "column-header")
    .attr("x", leftX)
    .attr("y", 28)
    .attr("text-anchor", "middle")
    .text("ERP Connectors");

  zoomLayer
    .append("text")
    .attr("class", "column-header")
    .attr("x", rightX)
    .attr("y", 28)
    .attr("text-anchor", "middle")
    .text("Procore Modules");

  // ---------------------------------------------------------------------
  // Links
  // ---------------------------------------------------------------------

  function arrowIdFor(direction) {
    return direction === "to-erp"
      ? "arrow-to-erp"
      : direction === "from-erp"
      ? "arrow-from-erp"
      : "arrow-both";
  }

  // Compute line endpoints that sit at the edges of the node circles
  // rather than at their centers. This is what lets the arrow tips
  // render cleanly without being buried inside the node fill.
  function endpoint(d) {
    const dx = d.target.x - d.source.x;
    const dy = d.target.y - d.source.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;
    const sr = NODE_RADIUS[d.source.type];
    const tr = NODE_RADIUS[d.target.type];
    const startPad = d.direction === "to-erp" || d.direction === "both" ? 2 : 0;
    const endPad = d.direction === "from-erp" || d.direction === "both" ? 2 : 0;
    return {
      x1: d.source.x + ux * (sr + startPad),
      y1: d.source.y + uy * (sr + startPad),
      x2: d.target.x - ux * (tr + endPad),
      y2: d.target.y - uy * (tr + endPad)
    };
  }

  const linkGroup = zoomLayer.append("g").attr("class", "links");
  const link = linkGroup
    .selectAll("line")
    .data(visibleLinks)
    .join("line")
    .attr("class", (d) => "link link-data link-" + d.direction)
    .attr("stroke", (d) => LINK_COLORS[d.direction])
    .attr("stroke-width", 1.4)
    .each(function (d) {
      const e = endpoint(d);
      const sel = d3.select(this);
      sel.attr("x1", e.x1).attr("y1", e.y1).attr("x2", e.x2).attr("y2", e.y2);
    })
    .attr("marker-end", (d) =>
      d.direction === "from-erp" || d.direction === "both"
        ? `url(#${arrowIdFor(d.direction)})`
        : null
    )
    .attr("marker-start", (d) =>
      d.direction === "to-erp" || d.direction === "both"
        ? `url(#${arrowIdFor(d.direction)})`
        : null
    );

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
    .append("circle")
    .attr("r", (d) => NODE_RADIUS[d.type])
    .attr("fill", (d) => NODE_COLOR[d.type]);

  // Labels read outward from the column: ERPs to the left, modules to
  // the right. The text-anchor mirrors that.
  node
    .append("text")
    .attr("x", (d) => (d.type === "erp" ? -(NODE_RADIUS.erp + 8) : NODE_RADIUS.module + 8))
    .attr("y", 4)
    .attr("text-anchor", (d) => (d.type === "erp" ? "end" : "start"))
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
  const connectionsEl = document.getElementById("details-connections");

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

    typeEl.textContent = n.type === "erp" ? "ERP Connector" : "Procore Module";

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

    const incidentLinks = linksByNode.get(n.id);
    connectionsEl.innerHTML = "";
    incidentLinks
      .map((l) => ({
        link: l,
        neighbor: l.source.id === n.id ? l.target : l.source
      }))
      .sort((a, b) => a.neighbor.label.localeCompare(b.neighbor.label))
      .forEach(({ link, neighbor }) => {
        const li = document.createElement("li");
        const sym = document.createElement("span");
        sym.className = "direction-symbol direction-" + link.direction;
        sym.textContent = symbolFor(link, n.id);
        const label = document.createElement("span");
        label.textContent = " " + neighbor.label;
        li.appendChild(sym);
        li.appendChild(label);
        li.addEventListener("click", () => selectNode(neighbor.id));
        connectionsEl.appendChild(li);
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
    emptyTextEl.hidden = false;
    contentEl.hidden = true;
    titleEl.textContent = "Select a node";
    node.classed("selected", false).classed("dimmed", false);
    link.classed("highlighted", false).classed("dimmed", false);
  }

  svg.on("click", function (event) {
    if (event.target === this || event.target.tagName === "svg") deselect();
  });
})();
