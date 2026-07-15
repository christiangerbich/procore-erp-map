// Entry point — loads the data payloads, initializes the three views,
// and owns the mode toggle + hash deep-link routing.
import { JSON_FETCH } from "./shared.js";
import { initErpMap } from "./erp-map.js";
import { initPackageBuilder } from "./package-builder.js";
import { initConfigTracker } from "./config-tracker.js";

  // Startup payloads fetch in PARALLEL — one round-trip instead of four.
  // docs-index.json (the ~500KB support-doc search index, the largest payload
  // in the app) is not fetched here at all: it lazy-loads on first use of the
  // search box (see loadExtraDocs below), keeping it off the critical path.
  //
  // cache "no-cache" = always revalidate with the server (ETag → 304 when
  // unchanged). GitHub Pages otherwise caches for 10 minutes, so right after
  // a deploy users could get a stale — or version-mixed — data file.
  let data, sopTemplates, packagesData, configData;
  try {
    const loaded = await Promise.all([
      fetch("data.json", JSON_FETCH).then((r) => {
        if (!r.ok) throw new Error("Failed to load data.json: " + r.status);
        return r.json();
      }),
      // SOP Builder catalog (tools, standard actions, role/permission options).
      fetch("sop-templates.json", JSON_FETCH)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      // PNPT Professional Services packages catalog (Cost Management, etc).
      fetch("packages.json", JSON_FETCH)
        .then((r) => (r.ok ? r.json() : { packages: [] }))
        .catch(() => ({ packages: [] })),
      // PNPT Configuration & Tracking catalog — phases, deliverables, and the
      // per-package Configuration Workbook structure.
      fetch("configurations.json", JSON_FETCH)
        .then((r) => (r.ok ? r.json() : { phases: [], packages: [] }))
        .catch(() => ({ phases: [], packages: [] })),
    ]);
    data = loaded[0];
    sopTemplates = loaded[1];
    packagesData = loaded[2];
    configData = loaded[3];
  } catch (err) {
    // Without data.json there is no app — say so visibly instead of dying
    // to a blank page with only a console error.
    const box = document.createElement("div");
    box.className = "app-load-error";
    const h = document.createElement("h2");
    h.textContent = "Couldn't load the app's data";
    box.appendChild(h);
    const p = document.createElement("p");
    p.textContent = "The connector dataset failed to load — usually a network/VPN hiccup or a deploy in progress. " +
      (err && err.message ? "(" + err.message + ")" : "");
    box.appendChild(p);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Reload";
    btn.addEventListener("click", () => location.reload());
    box.appendChild(btn);
    const mainEl = document.querySelector("main");
    (mainEl || document.body).prepend(box);
    throw err;
  }

  // ---------------------------------------------------------------------
  // Hash routing — shareable deep links:
  //   #erp                 ERP map          #erp/<nodeId>      + selected node
  //   #packages            Package Builder  #packages/<pkgKey> + package
  //   #config              Config Tracker
  // updateHash() stays a no-op until the initial route restore completes
  // (hashReady), so load-time renders can't clobber an incoming link; it's
  // also suppressed while a route is being applied (applyingHash) so
  // restoring a link doesn't immediately rewrite it.
  // ---------------------------------------------------------------------
  let hashReady = false;
  let applyingHash = false;
  function updateHash(h) {
    if (!hashReady || applyingHash) return;
    if (location.hash !== "#" + h) history.replaceState(null, "", "#" + h);
  }

  // Initialize the three views. Each returns its public API; everything
  // else stays private to its module.
  const erpApi = initErpMap({ data, sopTemplates, updateHash });
  const packagesApi = initPackageBuilder({ packagesData, updateHash });
  const configApi = initConfigTracker({ configData });

  // ---------------------------------------------------------------------
  // Mode toggle: ERP Connector Map  vs  PNPT Package Builder
  // ---------------------------------------------------------------------
  const modeErpBtn = document.getElementById("mode-erp");
  const modePackagesBtn = document.getElementById("mode-packages");
  const modeConfigBtn = document.getElementById("mode-config");
  const configView = document.getElementById("config-view");
  const packagesView = document.getElementById("packages-view");

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
      if (packagesApi.hasActivePackage()) packagesApi.renderPackagesView();
    } else if (isConfig) {
      if (headerEyebrowEl) headerEyebrowEl.textContent = "Professional Services";
      if (headerTitleEl) headerTitleEl.textContent = "PNPT Configuration & Tracking";
      if (headerSubtitleEl) headerSubtitleEl.textContent =
        "Track the SPC configuration journey for a client, phase by phase, against the official Configuration Workbook.";
      configApi.renderConfigView();
    } else {
      if (headerEyebrowEl) headerEyebrowEl.textContent = "ERP Integrations";
      if (headerTitleEl) headerTitleEl.textContent = "ERP Connector Map";
      if (headerSubtitleEl) headerSubtitleEl.textContent =
        "ERP connectors on the left, Procore modules on the right. Click any node to see its support documentation and the data objects it syncs.";
    }

    // Stamp the mode on <body> (print styles + any mode-scoped CSS key off
    // it) and reflect it in the shareable hash.
    document.body.dataset.mode = isPackages ? "packages" : isConfig ? "config" : "erp";
    updateHash(
      isPackages ? "packages" + (packagesApi.getActivePackageKey() ? "/" + packagesApi.getActivePackageKey() : "")
      : isConfig ? "config"
      : "erp"
    );
  }

  if (modeErpBtn) modeErpBtn.addEventListener("click", () => setMode("erp"));
  if (modePackagesBtn) modePackagesBtn.addEventListener("click", () => setMode("packages"));
  if (modeConfigBtn) modeConfigBtn.addEventListener("click", () => setMode("config"));

  // ---------------------------------------------------------------------
  // Deep-link restore. Baseline the mode first (stamps body[data-mode]),
  // then apply any incoming #route, then start writing the hash on
  // navigation. Re-applies on hashchange so Back/Forward work too.
  // ---------------------------------------------------------------------
  function applyHashRoute(h) {
    const parts = (h || "").split("/");
    const route = parts[0];
    const arg = parts[1] ? decodeURIComponent(parts[1]) : null;
    applyingHash = true;
    try {
      if (route === "packages") {
        setMode("packages");
        if (arg) packagesApi.setActivePackage(arg);
      } else if (route === "config") {
        setMode("config");
      } else if (route === "erp") {
        setMode("erp");
        if (arg) erpApi.revealNode(arg);
      }
    } finally {
      applyingHash = false;
    }
  }
  const initialRoute = (location.hash || "").replace(/^#/, "");
  applyingHash = true;
  setMode("erp"); // baseline
  applyingHash = false;
  hashReady = true;
  if (initialRoute && initialRoute !== "erp") applyHashRoute(initialRoute);
  else updateHash("erp");
  window.addEventListener("hashchange", () =>
    applyHashRoute((location.hash || "").replace(/^#/, ""))
  );
