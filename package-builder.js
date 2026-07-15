// PNPT Package Builder — package/vertical/tier toggles, the tool graph,
// and the details panel. Scoped to the packages view.
import { attachZoomPan, hexPoints } from "./shared.js";

export function initPackageBuilder(ctx) {
  const { packagesData, updateHash } = ctx;

  // Stroke-icon catalog used for tool nodes + capability badges in the
  // Package Builder graph. Each entry is the inner content of an SVG with
  // viewBox 0 0 24 24 — simple geometric symbols matching the semantics of
  // the Procore brand icons (pie chart for Budget, bar chart for Analytics,
  // send/receive arrows for Connect, sparkle for AI, etc).
  const PKG_ICONS = {
    "pie-chart":    '<path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M21 12A9 9 0 0 0 12 3"/>',
    "bar-chart":    '<path d="M3 3v18h18"/><path d="M7 17v-4"/><path d="M12 17V8"/><path d="M17 17v-7"/>',
    "bar-chart-3":  '<path d="M3 3v18h18"/><path d="M8 17v-5"/><path d="M13 17V9"/><path d="M18 17v-3"/>',
    "smartphone":   '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
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
  // Upgrade the static header capability dots with the same icons the node
  // badges use, so all three capability surfaces (node badges, header
  // legend, side-panel legend) read identically. Keyed by legend label text;
  // unmatched items keep their plain color dot.
  (packagesData.capabilities || []).forEach((cap) => {
    if (!cap.icon || !PKG_ICONS[cap.icon]) return;
    document.querySelectorAll("#packages-legend .legend-item").forEach((item) => {
      const dot = item.querySelector(".pkg-cap-dot");
      if (!dot || item.textContent.trim().indexOf(cap.name) !== 0) return;
      dot.innerHTML = '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' + PKG_ICONS[cap.icon] + "</svg>";
    });
  });

  let activeVertical = "gc"; // default vertical: General Contractor
  let activePackage = null;
  let selectedPackageToolId = null; // which tool's details are shown in the side panel
  const activeTierKeys = new Set();
  // Zoom/pan state for the package graph. Persists across renders within
  // the same package; setActivePackage / vertical change resets it.
  // MUTATED in place (never reassigned) — attachZoomPan holds a reference.
  const pkgZoom = { tx: 0, ty: 0, scale: 1 };
  function resetPkgZoom() { pkgZoom.tx = 0; pkgZoom.ty = 0; pkgZoom.scale = 1; }

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
    updateHash("packages/" + pkg.key);
  }

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
  // Balanced two-line split for node labels and constraints. Short strings
  // stay on one line; longer ones break at the space that best balances the
  // halves. A bare "/" token sticks to the word before it so splits never
  // open a line with a slash.
  function splitBalanced(str, max) {
    if (!str || str.length <= max) return [str];
    const words = str.split(" ").reduce((acc, w) => {
      if (w === "/" && acc.length) acc[acc.length - 1] += " /";
      else acc.push(w);
      return acc;
    }, []);
    if (words.length < 2) return [str];
    let best = [str], bestDiff = Infinity;
    for (let i = 1; i < words.length; i++) {
      const l1 = words.slice(0, i).join(" ");
      const l2 = words.slice(i).join(" ");
      const diff = Math.abs(l1.length - l2.length);
      if (diff <= bestDiff) { bestDiff = diff; best = [l1, l2]; }
    }
    return best;
  }

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
    // together. pkgZoom (module-scope) persists across renders within a
    // package; the shared attachZoomPan helper applies it on attach.
    const zoomG = document.createElementNS(svgNS, "g");
    zoomG.setAttribute("class", "pkg-zoom-group");
    const pkgZoomCtl = attachZoomPan(svg, zoomG, {
      state: pkgZoom,
      min: 0.4,
      max: 4,
      skipPan: ".pkg-node"
    });
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

      // Label wraps to two balanced lines when long — a 25-char single line
      // is ~175px wide and smears across neighboring nodes and links.
      const label = document.createElementNS(svgNS, "text");
      label.setAttribute("x", 0);
      label.setAttribute("class", "pkg-node-label");
      const lblLines = splitBalanced(toolNameFor(tool), 14);
      lblLines.forEach((ln, i) => {
        const ts = document.createElementNS(svgNS, "tspan");
        ts.setAttribute("x", 0);
        ts.setAttribute("y", NODE_R + 16 + i * 12);
        ts.textContent = ln;
        label.appendChild(ts);
      });
      g.appendChild(label);
      const labelBottom = NODE_R + 16 + (lblLines.length - 1) * 12;

      if (tool.constraint) {
        const sub = document.createElementNS(svgNS, "text");
        sub.setAttribute("x", 0);
        sub.setAttribute("class", "pkg-node-constraint");
        splitBalanced(tool.constraint, 26).forEach((ln, i) => {
          const ts = document.createElementNS(svgNS, "tspan");
          ts.setAttribute("x", 0);
          ts.setAttribute("y", labelBottom + 11 + i * 10);
          ts.textContent = ln;
          sub.appendChild(ts);
        });
        g.appendChild(sub);
      }

      // Capability badges (Procore Connect, AI/Data Grid, Analytics) sit
      // above the hex in a horizontal row. Each badge has an SVG <title>
      // tooltip so users can identify it without clicking.
      const capList = (tool.capabilities || [])
        .map((k) => (packagesData.capabilities || []).find((c) => c.key === k))
        .filter(Boolean);
      if (capList.length) {
        const BADGE_R = 8;
        const GAP = 5;
        const totalW = capList.length * (BADGE_R * 2) + (capList.length - 1) * GAP;
        const startX = -totalW / 2 + BADGE_R;
        const badgeY = -NODE_R - 8;
        capList.forEach((cap, i) => {
          const bg = document.createElementNS(svgNS, "g");
          bg.setAttribute("class", "pkg-cap-badge");
          bg.setAttribute("transform", "translate(" + (startX + i * (BADGE_R * 2 + GAP)) + "," + badgeY + ")");
          const c = document.createElementNS(svgNS, "circle");
          c.setAttribute("r", BADGE_R);
          c.setAttribute("fill", cap.color || "#000");
          bg.appendChild(c);
          // Prefer the icon — fall back to the letter if no icon configured.
          const iconSvg = cap.icon ? makePkgIconSvg(cap.icon, 10, "#fff") : null;
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
      // Keyboard access: package tools are focusable buttons too.
      g.setAttribute("tabindex", "0");
      g.setAttribute("role", "button");
      g.setAttribute("aria-label", "Package tool: " + toolNameFor(tool));
      g.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          selectPackageTool(tool.id);
        }
      });
      zoomG.appendChild(g);
    });

    // Click on empty SVG background -> deselect (but only on a real click,
    // not the mouseup at the end of a pan drag). Wheel-zoom + drag-pan come
    // from the shared attachZoomPan helper above.
    svg.addEventListener("click", () => {
      if (pkgZoomCtl.consumeClick()) return;
      selectPackageTool(null);
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
      pkgZoomCtl.zoomAt(vbX + vbW / 2, vbY + vbH / 2, 1.2);
    }));
    controls.appendChild(mkBtn("−", "Zoom out", () => {
      pkgZoomCtl.zoomAt(vbX + vbW / 2, vbY + vbH / 2, 1 / 1.2);
    }));
    controls.appendChild(mkBtn("⟳", "Reset zoom", () => {
      pkgZoomCtl.reset();
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

  return {
    renderPackagesView,
    setActivePackage,
    hasActivePackage: () => !!activePackage,
    getActivePackageKey: () => (activePackage ? activePackage.key : null)
  };
}
