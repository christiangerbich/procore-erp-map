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
  // primary colors is on-brand. ERPs in orange, modules in black.
  const NODE_COLOR = { erp: "#FF5200", module: "#000000" };

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
  const erpNodes = data.nodes
    .filter((n) => n.type === "erp")
    .sort((a, b) => a.label.localeCompare(b.label));

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

  // Layout constants — same scale for ERPs and modules, with extra room
  // for the tier section labels and divider on the modules side.
  const ROW_HEIGHT = 36;
  const HEADER_HEIGHT = 56;
  const FOOTER_PAD = 28;
  const TIER_LABEL_HEIGHT = 22;
  const TIER_GAP = 18;

  // The modules side needs space for two tier labels + a gap between
  // sections; the ERP side just stacks evenly. We compute both heights
  // and take the taller as the canvas height.
  const erpStackHeight = erpNodes.length * ROW_HEIGHT;
  const moduleStackHeight =
    TIER_LABEL_HEIGHT + companyModules.length * ROW_HEIGHT +
    TIER_GAP + TIER_LABEL_HEIGHT + projectModules.length * ROW_HEIGHT;
  const minHeight = HEADER_HEIGHT + Math.max(erpStackHeight, moduleStackHeight) + FOOTER_PAD;
  const height = Math.max(container.clientHeight, minHeight);

  // Reserve gutter space on each side for the labels.
  const LABEL_GUTTER = 180;
  const leftX = LABEL_GUTTER;
  const rightX = width - LABEL_GUTTER;

  // ERPs distribute evenly down the column.
  const erpSpacing = (height - HEADER_HEIGHT - FOOTER_PAD) / Math.max(erpNodes.length, 1);
  erpNodes.forEach((n, i) => {
    n.x = leftX;
    n.y = HEADER_HEIGHT + erpSpacing * (i + 0.5);
  });

  // Modules: stack the company-level group, leave a gap, then the
  // project-level group. Section header positions are stored on the
  // outer scope so the render code below can place text labels.
  const companyLabelY = HEADER_HEIGHT;
  let y = HEADER_HEIGHT + TIER_LABEL_HEIGHT + ROW_HEIGHT / 2;
  companyModules.forEach((n) => {
    n.x = rightX;
    n.y = y;
    y += ROW_HEIGHT;
  });
  const tierDividerY = y - ROW_HEIGHT / 2 + TIER_GAP / 2;
  const projectLabelY = y + TIER_GAP - TIER_LABEL_HEIGHT / 2;
  y += TIER_GAP + TIER_LABEL_HEIGHT;
  y += ROW_HEIGHT / 2 - TIER_LABEL_HEIGHT / 2; // align first project row baseline
  projectModules.forEach((n) => {
    n.x = rightX;
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

  // Tier section labels on the modules side (Company / Project).
  zoomLayer
    .append("text")
    .attr("class", "tier-label")
    .attr("x", rightX)
    .attr("y", companyLabelY + TIER_LABEL_HEIGHT / 2 + 4)
    .attr("text-anchor", "middle")
    .text("Company Level");

  zoomLayer
    .append("text")
    .attr("class", "tier-label")
    .attr("x", rightX)
    .attr("y", projectLabelY + TIER_LABEL_HEIGHT / 2 + 4)
    .attr("text-anchor", "middle")
    .text("Project Level");

  // Subtle divider between tier sections, centered on the modules column.
  zoomLayer
    .append("line")
    .attr("class", "tier-divider")
    .attr("x1", rightX - LABEL_GUTTER * 0.55)
    .attr("y1", tierDividerY)
    .attr("x2", rightX + LABEL_GUTTER * 0.55)
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
    .attr("class", "node-hex")
    .attr("points", (d) => hexPoints(NODE_RADIUS[d.type]))
    .attr("fill", (d) => NODE_COLOR[d.type]);

  // Inset orange hex on company-level modules — mirrors the Procore
  // logomark (black hex with orange center) per the Identity guide.
  node
    .filter((d) => d.type === "module" && d.tier === "company")
    .append("polygon")
    .attr("class", "node-hex-inner")
    .attr("points", hexPoints(NODE_RADIUS.module * 0.42))
    .attr("fill", "#FF5200");

  // Labels read outward from the column: ERPs to the left, modules to
  // the right. The text-anchor mirrors that.
  node
    .append("text")
    .attr("x", (d) => (d.type === "erp" ? -(NODE_RADIUS.erp + 10) : NODE_RADIUS.module + 10))
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
  const overviewEl = document.getElementById("details-overview");
  const resourcesSectionEl = document.getElementById("details-resources-section");
  const resourcesEl = document.getElementById("details-resources");
  const ttkSectionEl = document.getElementById("details-ttk-section");
  const ttkEl = document.getElementById("details-ttk");
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

    typeEl.textContent =
      n.type === "erp" ? "ERP Connector"
      : n.tier === "company" ? "Procore Tool · Company Level"
      : "Procore Tool · Project Level";

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

        const header = document.createElement("div");
        header.className = "connection-header";
        header.title = "Click to view " + neighbor.label;

        const sym = document.createElement("span");
        sym.className = "direction-symbol direction-" + link.direction;
        sym.textContent = symbolFor(link, n.id);
        const label = document.createElement("span");
        label.className = "connection-label";
        label.textContent = neighbor.label;
        header.appendChild(sym);
        header.appendChild(label);
        header.addEventListener("click", () => selectNode(neighbor.id));
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
