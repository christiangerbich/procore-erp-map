(async function () {
  const NODE_RADIUS = { core: 26, erp: 16, module: 12 };
  const NODE_COLOR = { core: "#f59e0b", erp: "#2563eb", module: "#10b981" };

  const data = await fetch("data.json").then((r) => {
    if (!r.ok) throw new Error("Failed to load data.json: " + r.status);
    return r.json();
  });

  const container = document.getElementById("graph");
  const width = container.clientWidth;
  const height = container.clientHeight;

  const nodesById = new Map(data.nodes.map((n) => [n.id, n]));
  // Build adjacency for quick lookups when a node is selected.
  const adjacency = new Map();
  for (const n of data.nodes) adjacency.set(n.id, new Set());
  for (const l of data.links) {
    adjacency.get(l.source).add(l.target);
    adjacency.get(l.target).add(l.source);
  }

  const svg = d3
    .select("#graph")
    .append("svg")
    .attr("viewBox", [0, 0, width, height])
    .attr("preserveAspectRatio", "xMidYMid meet");

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
    .attr("class", "link")
    .attr("stroke-width", 1.2);

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

  simulation.on("tick", () => {
    link
      .attr("x1", (d) => d.source.x)
      .attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x)
      .attr("y2", (d) => d.target.y);

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

    const neighborIds = Array.from(adjacency.get(n.id));
    connectionsEl.innerHTML = "";
    neighborIds
      .map((nid) => nodesById.get(nid))
      .sort((a, b) => a.label.localeCompare(b.label))
      .forEach((neighbor) => {
        const li = document.createElement("li");
        li.textContent = neighbor.label;
        li.addEventListener("click", () => selectNode(neighbor.id));
        connectionsEl.appendChild(li);
      });

    // Visual highlight on the graph
    const neighborSet = new Set(neighborIds);
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
