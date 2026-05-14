(async function () {
  const NODE_RADIUS = { core: 26, erp: 16, module: 12 };
  const NODE_COLOR = { core: "#f59e0b", erp: "#2563eb", module: "#10b981" };

  // Direction symbols shown next to each item in the side panel.
  // Symbol is rendered from the perspective of the currently-selected node.
  const DIRECTION_SYMBOLS = {
    both: "↔",      // ↔
    outbound: "→",  // → (this node sends data out to the neighbor)
    inbound: "←",   // ← (this node receives data from the neighbor)
    structural: "○" // ○ (no data direction — Procore-to-module link)
  };

  const data = await fetch("data.json").then((r) => {
    if (!r.ok) throw new Error("Failed to load data.json: " + r.status);
    return r.json();
  });

  const container = document.getElementById("graph");
  const width = container.clientWidth;
  const height = container.clientHeight;

  const nodesById = new Map(data.nodes.map((n) => [n.id, n]));
  // Index links by node id so we can look up direction relative to the
  // currently selected node.
  const linksByNode = new Map();
  for (const n of data.nodes) linksByNode.set(n.id, []);
  for (const l of data.links) {
    linksByNode.get(l.source).push(l);
    linksByNode.get(l.target).push(l);
  }

  const svg = d3
    .select("#graph")
    .append("svg")
    .attr("viewBox", [0, 0, width, height])
    .attr("preserveAspectRatio", "xMidYMid meet");

  // Arrow marker definitions. Using orient="auto-start-reverse" so the
  // same marker definition works for both marker-end and marker-start —
  // SVG flips the marker 180° automatically when used as marker-start.
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
  defineArrow("arrow", "#52606d");
  defineArrow("arrow-active", "#1f2933");

  const zoomLayer = svg.append("g");
  svg.call(
    d3
      .zoom()
      .scaleExtent([0.4, 3])
      .on("zoom", (event) => zoomLayer.attr("transform", event.transform))
  );

  const linkGroup = zoomLayer.append("g").attr("class", "links");
  const nodeGroup = zoomLayer.append("g").attr("class", "nodes");

  const simulation = d3
    .forceSimulation(data.nodes)
    .force(
      "link",
      d3
        .forceLink(data.links)
        .id((d) => d.id)
        .distance((l) => {
          const a = nodesById.get(typeof l.source === "object" ? l.source.id : l.source);
          const b = nodesById.get(typeof l.target === "object" ? l.target.id : l.target);
          if (a.type === "core" || b.type === "core") return 140;
          return 90;
        })
        .strength(0.5)
    )
    .force("charge", d3.forceManyBody().strength(-260))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force(
      "collision",
      d3.forceCollide().radius((d) => NODE_RADIUS[d.type] + 6)
    );

  const link = linkGroup
    .selectAll("line")
    .data(data.links)
    .join("line")
    .attr("class", (d) => "link" + (d.direction ? " link-data" : " link-structural"))
    .attr("stroke-width", 1.2)
    .attr("marker-end", (d) => {
      if (!d.direction) return null;
      if (d.direction === "from-erp" || d.direction === "both") return "url(#arrow)";
      return null;
    })
    .attr("marker-start", (d) => {
      if (!d.direction) return null;
      if (d.direction === "to-erp" || d.direction === "both") return "url(#arrow)";
      return null;
    });

  const node = nodeGroup
    .selectAll("g")
    .data(data.nodes)
    .join("g")
    .attr("class", "node")
    .call(drag(simulation))
    .on("click", (_event, d) => selectNode(d.id));

  node
    .append("circle")
    .attr("r", (d) => NODE_RADIUS[d.type])
    .attr("fill", (d) => NODE_COLOR[d.type]);

  node
    .append("text")
    .attr("x", (d) => NODE_RADIUS[d.type] + 4)
    .attr("y", 4)
    .text((d) => d.label);

  // On each tick, shorten lines so endpoints sit at the edges of the
  // node circles rather than at their centers. This makes arrow tips
  // visible and not buried inside the target node.
  simulation.on("tick", () => {
    link
      .each(function (d) {
        const sourceRadius = NODE_RADIUS[d.source.type];
        const targetRadius = NODE_RADIUS[d.target.type];
        const dx = d.target.x - d.source.x;
        const dy = d.target.y - d.source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / dist;
        const uy = dy / dist;
        // For lines with a start marker, leave a tiny extra gap so the
        // arrowhead doesn't kiss the source circle.
        const startPad = d.direction === "to-erp" || d.direction === "both" ? 2 : 0;
        const endPad = d.direction === "from-erp" || d.direction === "both" ? 2 : 0;
        d.__sx = d.source.x + ux * (sourceRadius + startPad);
        d.__sy = d.source.y + uy * (sourceRadius + startPad);
        d.__tx = d.target.x - ux * (targetRadius + endPad);
        d.__ty = d.target.y - uy * (targetRadius + endPad);
      })
      .attr("x1", (d) => d.__sx)
      .attr("y1", (d) => d.__sy)
      .attr("x2", (d) => d.__tx)
      .attr("y2", (d) => d.__ty);

    node.attr("transform", (d) => `translate(${d.x},${d.y})`);
  });

  // Side-panel wiring
  const detailsEl = document.getElementById("details");
  const titleEl = document.getElementById("details-title");
  const emptyTextEl = document.getElementById("details-empty-text");
  const contentEl = document.getElementById("details-content");
  const typeEl = document.getElementById("details-type");
  const connectorEl = document.getElementById("details-connector");
  const linkEl = document.getElementById("details-link");
  const connectionsEl = document.getElementById("details-connections");

  // Compute the arrow symbol from the selected node's perspective.
  // direction in JSON is named relative to the ERP-as-source orientation:
  //   "to-erp"   = data flows from module (Procore) to ERP
  //   "from-erp" = data flows from ERP to module (Procore)
  //   "both"     = bidirectional
  // The link.source is always the ERP (or Procore for structural links).
  function symbolFor(link, fromNodeId) {
    if (!link.direction) return DIRECTION_SYMBOLS.structural;
    if (link.direction === "both") return DIRECTION_SYMBOLS.both;
    const isSource = link.source.id === fromNodeId || link.source === fromNodeId;
    if (link.direction === "from-erp") {
      // ERP -> module. Outbound from ERP side, inbound on module side.
      return isSource ? DIRECTION_SYMBOLS.outbound : DIRECTION_SYMBOLS.inbound;
    }
    if (link.direction === "to-erp") {
      // module -> ERP. Inbound on ERP side, outbound from module side.
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

    typeEl.textContent =
      n.type === "core" ? "Core" : n.type === "erp" ? "ERP Connector" : "Data Object / Module";

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
      .map((l) => {
        const otherId =
          (l.source.id || l.source) === n.id ? (l.target.id || l.target) : (l.source.id || l.source);
        return { link: l, neighbor: nodesById.get(otherId) };
      })
      .sort((a, b) => a.neighbor.label.localeCompare(b.neighbor.label))
      .forEach(({ link, neighbor }) => {
        const li = document.createElement("li");
        const sym = document.createElement("span");
        sym.className = "direction-symbol";
        sym.textContent = symbolFor(link, n.id);
        const label = document.createElement("span");
        label.textContent = " " + neighbor.label;
        li.appendChild(sym);
        li.appendChild(label);
        li.addEventListener("click", () => selectNode(neighbor.id));
        connectionsEl.appendChild(li);
      });

    // Visual highlight on the graph
    const neighborSet = new Set(incidentLinks.map((l) => (l.source.id || l.source) === n.id ? (l.target.id || l.target) : (l.source.id || l.source)));
    neighborSet.add(n.id);

    node.classed("selected", (d) => d.id === n.id);
    node.classed("dimmed", (d) => !neighborSet.has(d.id));
    link
      .classed("highlighted", (d) => d.source.id === n.id || d.target.id === n.id)
      .classed("dimmed", (d) => d.source.id !== n.id && d.target.id !== n.id);
  }

  // Click on empty space clears selection
  svg.on("click", function (event) {
    if (event.target === this || event.target.tagName === "svg") {
      detailsEl.classList.add("details-empty");
      emptyTextEl.hidden = false;
      contentEl.hidden = true;
      titleEl.textContent = "Select a node";
      node.classed("selected", false).classed("dimmed", false);
      link.classed("highlighted", false).classed("dimmed", false);
    }
  });

  function drag(sim) {
    return d3
      .drag()
      .on("start", (event, d) => {
        if (!event.active) sim.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) sim.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
  }
})();
