// PNPT Configuration & Tracking — multi-client state (localStorage),
// phases, workbook, validation, deliverables, export/import, and the
// print hooks. Scoped to the tracker view.
import { appDialog, JSON_FETCH } from "./shared.js";
import {
  exportWorkbookXlsx,
  exportWorkbookToGoogleSheets,
  postToLinkedWorkbook,
  parseSpreadsheetId
} from "./workbook-export.js";

export function initConfigTracker(ctx) {
  const { configData } = ctx;

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
  if (configMulti.activeSpc == null) configMulti.activeSpc = ""; // "" = show all SPCs
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
      spc: "",          // consultant who owns this client (SPC roster filter)
      workbookUrl: "",  // the client's own PNPT Configuration Workbook (Google Sheets link)
      createdAt: Date.now(),
      tasks: {},        // tasks[phaseKey] = { [taskIdx]: true }
      workbook: {},     // workbook[sectionKey] = { [settingIdx]: { updated, changed, notes } }
      deliverables: {}, // deliverables[key] = bool
      validation: {},   // validation[sectionName] = { [leafIdx]: true }  (UAT checklist)
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
  let configSaveTimer = 0;
  let configSavePending = false;
  function persistConfigState() {
    configSavePending = false;
    try {
      localStorage.setItem(CONFIG_LS_KEY_V2, JSON.stringify(configMulti));
    } catch (e) {
      // Storage blocked (private mode) or quota hit — changes are NOT being
      // persisted. Say so once instead of silently dropping every edit.
      if (!configSaveWarned) {
        configSaveWarned = true;
        appDialog.alert(
          "This browser is blocking local storage, so Config Tracker changes are NOT being saved. Check private-browsing mode or storage settings.",
          "Changes aren't saving"
        );
      }
    }
  }
  // Debounced: the client-name input and workbook notes textareas call this
  // on every keystroke, and each save JSON.stringifies the ENTIRE
  // multi-client store. 300ms collapses a typing burst into one write; the
  // pagehide/hidden listeners flush a pending save so nothing is lost when
  // the tab closes inside that window. All renders read the in-memory
  // configMulti, never localStorage, so deferring the write is safe.
  function saveConfigState() {
    configSavePending = true;
    clearTimeout(configSaveTimer);
    configSaveTimer = setTimeout(persistConfigState, 300);
  }
  window.addEventListener("pagehide", () => {
    if (configSavePending) persistConfigState();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && configSavePending) persistConfigState();
  });
  function clientList() {
    return Object.keys(configMulti.clients)
      .map((id) => configMulti.clients[id])
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }
  // Distinct, non-empty SPC names across all clients (for the roster filter).
  function spcList() {
    const seen = {};
    Object.keys(configMulti.clients).forEach((id) => {
      const s = (configMulti.clients[id].spc || "").trim();
      if (s) seen[s] = true;
    });
    return Object.keys(seen).sort((a, b) => a.localeCompare(b));
  }
  // Clients owned by the active SPC ("" activeSpc = show all).
  function clientsForActiveSpc() {
    const spc = configMulti.activeSpc || "";
    return clientList().filter((c) => !spc || (c.spc || "") === spc);
  }
  function switchClient(id) {
    if (!configMulti.clients[id]) return;
    configMulti.activeClientId = id;
    configState = configMulti.clients[id];
    saveConfigState();
    configActivePhase = (configData.phases && configData.phases[0] && configData.phases[0].key) || "initiation";
    renderConfigView();
  }
  async function createNewClient() {
    const raw = await appDialog.prompt("Name the new client engagement.", {
      title: "New client",
      placeholder: "e.g. Acme Construction",
      okLabel: "Create"
    });
    if (raw === null) return;
    const c = defaultClient((raw || "").trim());
    if (configMulti.activeSpc) c.spc = configMulti.activeSpc; // inherit the active roster
    configMulti.clients[c.id] = c;
    configMulti.activeClientId = c.id;
    configState = c;
    saveConfigState();
    renderConfigView();
  }
  async function deleteCurrentClient() {
    const ids = Object.keys(configMulti.clients);
    const current = configMulti.clients[configMulti.activeClientId];
    const label = (current && current.name) || "(unnamed)";
    if (ids.length <= 1) {
      const ok = await appDialog.confirm("This is your only client. Reset and start fresh?", {
        title: "Reset client",
        okLabel: "Reset",
        danger: true
      });
      if (!ok) return;
      const c = defaultClient("");
      configMulti = { schema: "v2", activeClientId: c.id, clients: {} };
      configMulti.clients[c.id] = c;
      configState = c;
      saveConfigState();
      renderConfigView();
      return;
    }
    const ok = await appDialog.confirm('Delete client "' + label + '"? This cannot be undone.', {
      title: "Delete client",
      okLabel: "Delete",
      danger: true
    });
    if (!ok) return;
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
    configState.validation = {};
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
  // ---------------------------------------------------------------------
  // Official workbook template (workbook-template.json, generated 1:1 from
  // "PNPT Configuration Workbook _ NAMER.xlsx" by
  // tools/build-workbook-template.py). It is the source of truth for the
  // Build-phase Configuration Workbook: the UI rows AND the .xlsx / Google
  // Sheets export both derive from it, so what SPCs track matches the
  // official workbook exactly, row for row. Loaded lazily on first
  // Build-phase render; configurations.json's curated sections remain only
  // as a fallback if the template can't load.
  // ---------------------------------------------------------------------
  let wbTemplate = null;
  let wbTemplateFailed = false;
  let wbTemplatePromise = null;
  function loadWorkbookTemplate() {
    if (!wbTemplatePromise) {
      wbTemplatePromise = fetch("workbook-template.json", JSON_FETCH)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((t) => {
          wbTemplate = t;
          wbTemplateFailed = !t;
          return t;
        });
    }
    return wbTemplatePromise;
  }
  function templateTabForTier(tier) {
    if (!wbTemplate || !tier) return null;
    const tabName = (wbTemplate.tierTabs || {})[tier.key];
    if (!tabName) return null;
    return (wbTemplate.tabs || []).find((t) => t.name === tabName) || null;
  }
  // Tab rows → tracker sections: black banner rows open a section, gray
  // sub-group rows label the rows beneath them, and data rows become
  // settings — each keeping its exact sheet row for the export.
  const wbSectionsCache = {};
  function sectionsFromTemplateTab(tab) {
    if (wbSectionsCache[tab.name]) return wbSectionsCache[tab.name];
    // Column roles vary by tab (5-col PE/Resource vs 6-col CM/CM-Ent/PLM);
    // pull each field by its role index, never by fixed position.
    const roles = tab.roles || {};
    const iDisc = roles.discussion != null ? roles.discussion : 0;
    const iDefault = roles.default != null ? roles.default : 1;
    const iDecision = roles.decisionLogic;
    const iChanged = roles.changedTo != null ? roles.changedTo : 3;
    const iNotes = roles.notes != null ? roles.notes : 4;
    const cell = (row, i) => (row.v && i != null ? row.v[i] : undefined);
    const sections = [];
    const seen = {};
    let cur = null;
    let group = "";
    (tab.rows || []).forEach((row) => {
      const a = cell(row, iDisc);
      if (row.k === "banner") {
        let key = slugKey(a);
        if (seen[key]) { seen[key] += 1; key = key + "-" + seen[key]; } else { seen[key] = 1; }
        cur = { key: key, name: a || "", settings: [] };
        sections.push(cur);
        group = "";
      } else if (row.k === "sub") {
        group = a || "";
      } else if (row.k === "data" && a) {
        if (!cur) {
          cur = { key: "general", name: "General", settings: [] };
          sections.push(cur);
        }
        cur.settings.push({
          name: a,
          default: cell(row, iDefault) || "",
          decisionLogic: iDecision != null ? (cell(row, iDecision) || "") : "",
          group: group,
          guidanceD: cell(row, iChanged) || "",
          guidanceE: cell(row, iNotes) || "",
          row: row.r
        });
      }
    });
    wbSectionsCache[tab.name] = sections;
    return sections;
  }
  function workbookSectionsForTier() {
    const tier = activeConfigTier();
    if (wbTemplate && tier) {
      const tab = templateTabForTier(tier);
      if (tab) return sectionsFromTemplateTab(tab);
    }
    // Legacy fallback (template missing/unreachable): curated sections from
    // configurations.json.
    const pkg = activeConfigPackage();
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
    const pkgTierEl = document.getElementById("config-pkgtier-pick");
    const resetBtn = document.getElementById("config-reset");
    if (!titleEl || !pkgTierEl || !clientNameEl || !clientPickEl || !resetBtn) return;

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

    // SPC roster selector — filter the client list to one consultant.
    const spcPickEl = document.getElementById("config-spc-pick");
    if (spcPickEl) {
      spcPickEl.innerHTML = "";
      const mkOpt = (val, label, sel) => {
        const o = document.createElement("option");
        o.value = val; o.textContent = label; if (sel) o.selected = true;
        return o;
      };
      spcPickEl.appendChild(mkOpt("__all__", "All SPCs", !configMulti.activeSpc));
      spcList().forEach((name) =>
        spcPickEl.appendChild(mkOpt(name, name, name === configMulti.activeSpc)));
      spcPickEl.appendChild(mkOpt("__add__", "＋ Add SPC…", false));
      spcPickEl.onchange = async () => {
        const v = spcPickEl.value;
        if (v === "__add__") {
          const name = ((await appDialog.prompt("Your name, as it should appear in the SPC roster.", {
            title: "Add SPC",
            placeholder: "First Last",
            okLabel: "Add"
          })) || "").trim();
          if (!name) { renderConfigBar(); return; }
          configMulti.activeSpc = name;
        } else {
          configMulti.activeSpc = v === "__all__" ? "" : v;
        }
        const list = clientsForActiveSpc();
        if (configMulti.activeSpc && !list.length) {
          // brand-new roster: start this SPC with a blank client
          const c = defaultClient("");
          c.spc = configMulti.activeSpc;
          configMulti.clients[c.id] = c;
          configMulti.activeClientId = c.id;
          configState = c;
          saveConfigState();
          renderConfigView();
          return;
        }
        if (list.length && !list.some((c) => c.id === configMulti.activeClientId)) {
          switchClient(list[0].id);
          return;
        }
        saveConfigState();
        renderConfigView();
      };
    }

    // Client picker dropdown (scoped to the active SPC roster)
    clientPickEl.innerHTML = "";
    const clients = clientsForActiveSpc();
    if (!clients.length) {
      const opt = document.createElement("option");
      opt.textContent = "(no clients — click + to add)";
      opt.disabled = true; opt.selected = true;
      clientPickEl.appendChild(opt);
    }
    clients.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      let label = (c.name || "(unnamed)") + "  ·  " + (c.packageKey || "");
      if (!configMulti.activeSpc) label += "  ·  " + (c.spc || "unassigned");
      opt.textContent = label;
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

    // Owner (SPC) input — tag/claim the active client to a consultant's roster.
    const clientSpcEl = document.getElementById("config-client-spc");
    if (clientSpcEl) {
      const dl = document.getElementById("config-spc-list");
      if (dl) {
        dl.innerHTML = "";
        spcList().forEach((name) => {
          const o = document.createElement("option");
          o.value = name; dl.appendChild(o);
        });
      }
      clientSpcEl.value = configState.spc || "";
      clientSpcEl.oninput = () => {
        configState.spc = clientSpcEl.value.trim();
        saveConfigState();
      };
      // On commit the name may be new — refresh the roster dropdown + filter.
      clientSpcEl.onchange = () => renderConfigBar();
    }

    // Combined Package + Tier selector — one option per tier (each tier name
    // already reads as the full "<package> <tier>" label), grouped under its
    // package. Value encodes both keys as "packageKey::tierKey".
    pkgTierEl.innerHTML = "";
    (configData.packages || []).forEach((p) => {
      const tiers = p.tiers || [];
      let parent = pkgTierEl;
      if (tiers.length > 1) {
        parent = document.createElement("optgroup");
        parent.label = p.name;
        pkgTierEl.appendChild(parent);
      }
      tiers.forEach((t) => {
        const opt = document.createElement("option");
        opt.value = p.key + "::" + t.key;
        opt.textContent = t.name;
        if (p.key === configState.packageKey && t.key === configState.tierKey) opt.selected = true;
        parent.appendChild(opt);
      });
    });
    pkgTierEl.onchange = () => {
      const parts = pkgTierEl.value.split("::");
      configState.packageKey = parts[0];
      configState.tierKey = parts[1];
      saveConfigState();
      renderConfigView();
    };

    resetBtn.onclick = async () => {
      const label = configState.name || "(unnamed)";
      const ok = await appDialog.confirm(
        'Reset all progress for "' + label + '"? Tasks, workbook entries, and deliverable checks will be cleared. Name / package / tier preserved.',
        { title: "Reset progress", okLabel: "Reset progress", danger: true }
      );
      if (!ok) return;
      resetActiveClientProgress();
    };
  }

  // Phases 2-4 (discovery / build / validate) extend the shared methodology
  // tasks with one row per in-scope tool of the active package + tier, so each
  // SPC tracks the tools actually in their implementation (a Cost Management
  // Enterprise build lists its financial tools; a Project Execution build lists
  // Drawings / Submittals / RFIs / …). Index-keying stays valid because a
  // client's package + tier is fixed: same list → same indices. The shared
  // methodology rows keep indices 0..N-1; per-tool rows extend beyond, so
  // existing saved progress is preserved and the new rows start unchecked.
  const PER_TOOL_PHASES = {
    discovery: (n) => n + " — walk the OOTB process flow (Diagrams tab); document gaps + custom-field needs",
    build:     (n) => n + " — consult + configure: settings, permissions, templates (Sandbox → Standard Project Template)",
    validate:  (n) => n + " — configuration training walkthrough + customer validation",
  };
  function perToolTasks(phase) {
    const fn = phase && PER_TOOL_PHASES[phase.key];
    if (!fn) return [];
    const tier = activeConfigTier();
    const tools = (tier && tier.toolList) || [];
    return tools.map((t) => ({ text: fn(t.name), url: t.supportUrl, tool: t.key, id: "tool:" + t.key }));
  }
  // Ordered render list for a phase: section-header markers ({ section:"…" }),
  // task rows, and the per-tool rows spliced in at the { perTool:true } anchor
  // (or appended under an auto "In-scope tools" section when there's no anchor).
  function phaseEntries(phase) {
    const base = phase.tasks || [];
    const tools = perToolTasks(phase);
    const hasAnchor = base.some((e) => e && e.perTool);
    const out = [];
    base.forEach((e) => {
      if (e && e.perTool) tools.forEach((t) => out.push(t));
      else out.push(e);
    });
    if (!hasAnchor && tools.length) {
      out.push({ section: "In-scope tools" });
      tools.forEach((t) => out.push(t));
    }
    return out;
  }
  // Task-only list (drops section headers).
  function effectiveTasks(phase) {
    return phaseEntries(phase).filter((e) => !e.section);
  }
  // Stable progress key for a task: the baked `id` from the data, "tool:<key>"
  // for per-tool rows, else a text fallback. Keying checkmarks by this (not by
  // list position) means adding / removing / reordering tasks never disturbs
  // saved progress.
  function taskKey(task) {
    return task.id || (task.tool ? "tool:" + task.tool : "text:" + (task.text || ""));
  }
  // Stable derived keys for workbook settings + validation leaves — the same
  // hardening the phase tasks got: progress is keyed by WHAT was checked,
  // not by list position, so inserting / reordering rows in
  // configurations.json can't silently shift everyone's saved state. Keys
  // derive from names (sluggified, deduped in order), so no data-file
  // changes are needed; renaming a row is the only edit that drops its
  // saved state.
  function slugKey(s) {
    const k = String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
    return k || "item";
  }
  function dedupeKeys(rawKeys) {
    const seen = {};
    return rawKeys.map((k) => {
      if (seen[k]) { seen[k] += 1; return k + "-" + seen[k]; }
      seen[k] = 1;
      return k;
    });
  }
  // Ordered stable keys for a workbook section's settings.
  function workbookSettingKeys(section) {
    return dedupeKeys((section.settings || []).map((s) => slugKey(s.name)));
  }
  // Ordered stable keys for a validation section's leaves — path-based so
  // same-named leaves under different groups stay distinct.
  function validationLeafKeys(nodes) {
    const raw = [];
    (function walk(ns, path) {
      (ns || []).forEach((x) => {
        if (x.items) walk(x.items, path.concat(x.name));
        else raw.push(slugKey(path.concat(x.name).join(" ")));
      });
    })(nodes, []);
    return dedupeKeys(raw);
  }
  // The ordered stable keys for one client's effective task list in a phase
  // (uses that client's package/tier for the per-tool rows) — used to migrate
  // legacy index-keyed progress to id-keyed.
  function effectiveTaskKeysFor(client, phase) {
    const base = phase.tasks || [];
    let toolKeys = [];
    if (PER_TOOL_PHASES[phase.key]) {
      const pkg = (configData.packages || []).find((p) => p.key === client.packageKey);
      const tier = pkg && (pkg.tiers || []).find((t) => t.key === client.tierKey);
      toolKeys = ((tier && tier.toolList) || []).map((t) => "tool:" + t.key);
    }
    const keys = [];
    const hasAnchor = base.some((e) => e && e.perTool);
    base.forEach((e) => {
      if (e.section) return;
      if (e.perTool) toolKeys.forEach((k) => keys.push(k));
      else keys.push(taskKey(e));
    });
    if (!hasAnchor && toolKeys.length) toolKeys.forEach((k) => keys.push(k));
    return keys;
  }
  // One-time migration: convert legacy index-keyed task progress to id-keyed so
  // existing checkmarks survive the switch (maps old position → the task now at
  // that position → its stable key). Idempotent — skips already-migrated clients.
  function migrateTaskProgressToIds() {
    let changed = false;
    Object.keys(configMulti.clients).forEach((cid) => {
      const client = configMulti.clients[cid];
      if (client._taskIdsMigrated) return;
      (configData.phases || []).forEach((phase) => {
        const prog = client.tasks && client.tasks[phase.key];
        if (!prog || !Object.keys(prog).some((k) => /^\d+$/.test(k))) return;
        const keys = effectiveTaskKeysFor(client, phase);
        const next = {};
        Object.keys(prog).forEach((k) => {
          if (!prog[k]) return;
          if (/^\d+$/.test(k)) { const nk = keys[Number(k)]; if (nk) next[nk] = true; }
          else next[k] = true;
        });
        client.tasks[phase.key] = next;
      });
      client._taskIdsMigrated = true;
      changed = true;
    });
    if (changed) saveConfigState();
  }
  migrateTaskProgressToIds();

  // One-time migration: workbook + validation progress used to be keyed by
  // row index. Maps each numeric key to the derived stable key now at that
  // position (per the client's own package for workbook sections).
  // Idempotent per client (_wbValIdsMigrated); also run after Import so
  // backups taken before this change convert on the way in.
  function migrateWbValProgressToIds() {
    const sectionsByKey = {};
    (configData.packages || []).forEach((p) => {
      ((p.workbook && p.workbook.sections) || []).forEach((s) => {
        if (!sectionsByKey[s.key]) sectionsByKey[s.key] = s;
      });
    });
    const vcSections = (configData.validationChecklist && configData.validationChecklist.sections) || {};
    let changed = false;
    Object.keys(configMulti.clients).forEach((cid) => {
      const client = configMulti.clients[cid];
      if (client._wbValIdsMigrated) return;
      Object.keys(client.workbook || {}).forEach((secKey) => {
        const section = sectionsByKey[secKey];
        const prog = client.workbook[secKey];
        if (!section || !prog || !Object.keys(prog).some((k) => /^\d+$/.test(k))) return;
        const keys = workbookSettingKeys(section);
        const next = {};
        Object.keys(prog).forEach((k) => {
          const v = prog[k];
          if (!v) return;
          if (/^\d+$/.test(k)) { const nk = keys[Number(k)]; if (nk) next[nk] = v; }
          else next[k] = v;
        });
        client.workbook[secKey] = next;
      });
      Object.keys(client.validation || {}).forEach((secName) => {
        const nodes = vcSections[secName];
        const prog = client.validation[secName];
        if (!nodes || !prog || !Object.keys(prog).some((k) => /^\d+$/.test(k))) return;
        const keys = validationLeafKeys(nodes);
        const next = {};
        Object.keys(prog).forEach((k) => {
          if (!prog[k]) return;
          if (/^\d+$/.test(k)) { const nk = keys[Number(k)]; if (nk) next[nk] = true; }
          else next[k] = true;
        });
        client.validation[secName] = next;
      });
      client._wbValIdsMigrated = true;
      changed = true;
    });
    if (changed) saveConfigState();
  }
  migrateWbValProgressToIds();

  // ---------------------------------------------------------------------
  // Export / Import — JSON backup of the entire multi-client store. All SPC
  // progress lives only in this browser's localStorage, so these two buttons
  // are the insurance policy: machine swaps, profile resets, and client
  // handoffs between SPCs.
  // ---------------------------------------------------------------------
  const configExportBtn = document.getElementById("config-export");
  if (configExportBtn) {
    configExportBtn.addEventListener("click", () => {
      persistConfigState(); // flush any debounced edits before snapshotting
      const stamp = new Date().toISOString().slice(0, 10);
      const blob = new Blob([JSON.stringify(configMulti, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "pnpt-config-tracker-backup-" + stamp + ".json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });
  }
  const configImportBtn = document.getElementById("config-import");
  const configImportFile = document.getElementById("config-import-file");
  if (configImportBtn && configImportFile) {
    configImportBtn.addEventListener("click", () => {
      configImportFile.value = "";
      configImportFile.click();
    });
    configImportFile.addEventListener("change", async () => {
      const file = configImportFile.files && configImportFile.files[0];
      if (!file) return;
      let parsed = null;
      try {
        parsed = JSON.parse(await file.text());
      } catch (e) { /* handled below */ }
      const clients = parsed && parsed.clients;
      const ids = clients
        ? Object.keys(clients).filter((id) => clients[id] && typeof clients[id] === "object")
        : [];
      if (!ids.length) {
        appDialog.alert(
          '"' + file.name + '" doesn\'t look like a Config Tracker backup — expected a JSON file created by Export.',
          "Import failed"
        );
        return;
      }
      // Merge by client id: imported clients win on collision, everything
      // else is kept — restoring a backup never silently discards newer
      // clients created since that backup was taken.
      const overlap = ids.filter((id) => configMulti.clients[id]).length;
      const ok = await appDialog.confirm(
        "Import " + ids.length + " client" + (ids.length === 1 ? "" : "s") + ' from "' + file.name + '"?' +
        (overlap
          ? "\n" + overlap + " existing client" + (overlap === 1 ? "" : "s") + " with the same id will be overwritten."
          : ""),
        { title: "Import backup", okLabel: "Import" }
      );
      if (!ok) return;
      ids.forEach((id) => { configMulti.clients[id] = clients[id]; });
      if (!configMulti.clients[configMulti.activeClientId]) {
        configMulti.activeClientId = Object.keys(configMulti.clients)[0];
      }
      configState = configMulti.clients[configMulti.activeClientId];
      migrateTaskProgressToIds(); // old backups may still be index-keyed
      migrateWbValProgressToIds();
      saveConfigState();
      renderConfigView();
      appDialog.alert("Imported " + ids.length + " client" + (ids.length === 1 ? "" : "s") + ".", "Import complete");
    });
  }

  function phaseProgress(phaseKey) {
    const phase = (configData.phases || []).find((p) => p.key === phaseKey);
    if (!phase) return { done: 0, total: 0 };
    const tasks = effectiveTasks(phase);
    // Count only keys that still exist, so retiring a task can't push past 100%.
    const stored = (configState.tasks && configState.tasks[phaseKey]) || {};
    let done = 0;
    tasks.forEach((t) => { if (stored[taskKey(t)]) done++; });
    return { done, total: tasks.length };
  }
  // Deliverable completion for the active package (keys are stable strings,
  // so count only deliverables that still exist in the data).
  function deliverableProgress() {
    const pkg = activeConfigPackage();
    const list = (pkg && pkg.deliverables) || [];
    const done = list.filter((d) => configState.deliverables[d.key]).length;
    return { done, total: list.length };
  }
  // Overall progress blends phase tasks AND deliverables into one item pool.
  function overallProgress() {
    let tasksDone = 0, tasksTotal = 0;
    (configData.phases || []).forEach((p) => {
      const pp = phaseProgress(p.key);
      tasksDone += pp.done; tasksTotal += pp.total;
    });
    const dp = deliverableProgress();
    // Overall % weights the two pools 50/50 — deliverables are the
    // definition of done, so they carry equal weight to the ~85 tasks
    // rather than drowning as 5 items in a combined count. If one pool is
    // empty, the other stands alone.
    const taskPct = tasksTotal ? (tasksDone / tasksTotal) * 100 : 0;
    const delPct = dp.total ? (dp.done / dp.total) * 100 : 0;
    let pct;
    if (!dp.total)          pct = taskPct;
    else if (!tasksTotal)   pct = delPct;
    else                    pct = taskPct * 0.5 + delPct * 0.5;
    return {
      tasksDone, tasksTotal,
      delDone: dp.done, delTotal: dp.total,
      taskPct: Math.round(taskPct),
      delPct: Math.round(delPct),
      pct: Math.round(pct),
      done: tasksDone + dp.done,
      total: tasksTotal + dp.total,
    };
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
      const phasePct = pp.total ? Math.round((pp.done / pp.total) * 100) : 0;
      const meta = document.createElement("p");
      meta.className = "config-phase-meta";
      meta.textContent = (phase.owner || "") + " · " + pp.done + " / " + pp.total + " · " + phasePct + "%";
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
          { key: "desiredState", label: "Desired State Summary" },
          { key: "gapAnalysis", label: "Gap Analysis & Custom Configuration Needs" }
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

    // Select-all control + phase task tally. The checkbox mirrors the list
    // state: checked = all done, indeterminate = partly done. Refs are kept
    // so syncTaskUI() can refresh them in place after any toggle.
    let phaseSaCb = null, phaseSaTally = null;
    if (effectiveTasks(phase).length) {
      const pp = phaseProgress(phase.key);
      const pct = pp.total ? Math.round((pp.done / pp.total) * 100) : 0;
      const sa = document.createElement("div");
      sa.className = "config-task-selectall";
      const saCb = document.createElement("input");
      saCb.type = "checkbox";
      saCb.id = "config-selectall-" + phase.key;
      saCb.checked = pp.total > 0 && pp.done === pp.total;
      saCb.indeterminate = pp.done > 0 && pp.done < pp.total;
      saCb.addEventListener("change", () => {
        const all = {};
        if (saCb.checked) effectiveTasks(phase).forEach((t) => { all[taskKey(t)] = true; });
        configState.tasks[phase.key] = all;
        saveConfigState();
        syncTaskUI();
      });
      sa.appendChild(saCb);
      const saLbl = document.createElement("label");
      saLbl.htmlFor = saCb.id;
      saLbl.textContent = "Select all";
      sa.appendChild(saLbl);
      const tally = document.createElement("span");
      tally.className = "config-task-selectall-tally";
      tally.textContent = pp.done + " / " + pp.total + " tasks · " + pct + "%";
      sa.appendChild(tally);
      wrap.appendChild(sa);
      phaseSaCb = saCb;
      phaseSaTally = tally;
    }

    // Task checklist grouped into sections. Section headers come from
    // { section:"…" } markers in the data; the per-tool block is its own
    // section. Each named section gets its own select-all + tally.
    const ul = document.createElement("ul");
    ul.className = "config-task-list";
    const stored = (configState.tasks && configState.tasks[phase.key]) || {};

    // Walk the render list, keying each task by its stable id and grouping
    // tasks under the preceding section header.
    const taskSections = [];
    let curSec = { name: null, items: [] };
    phaseEntries(phase).forEach((e) => {
      if (e.section) {
        if (curSec.name || curSec.items.length) taskSections.push(curSec);
        curSec = { name: e.section, items: [] };
      } else {
        curSec.items.push({ key: taskKey(e), task: e });
      }
    });
    if (curSec.name || curSec.items.length) taskSections.push(curSec);

    const sectionCtrls = []; // per-section element refs for syncTaskUI()
    taskSections.forEach((sec) => {
      const ctrl = { headCb: null, tallyEl: null, items: [] };
      sectionCtrls.push(ctrl);
      if (sec.name) {
        const done = sec.items.filter((it) => stored[it.key]).length;
        const head = document.createElement("li");
        head.className = "config-task-section";
        const hCb = document.createElement("input");
        hCb.type = "checkbox";
        hCb.checked = sec.items.length > 0 && done === sec.items.length;
        hCb.indeterminate = done > 0 && done < sec.items.length;
        hCb.title = "Select all in this section";
        hCb.setAttribute("aria-label", "Select all in " + sec.name);
        hCb.addEventListener("change", () => {
          configState.tasks[phase.key] = configState.tasks[phase.key] || {};
          sec.items.forEach((it) => { configState.tasks[phase.key][it.key] = hCb.checked; });
          saveConfigState();
          syncTaskUI();
        });
        head.appendChild(hCb);
        const nm = document.createElement("span");
        nm.className = "config-task-section-name";
        nm.textContent = sec.name;
        head.appendChild(nm);
        const tl = document.createElement("span");
        tl.className = "config-task-section-tally";
        tl.textContent = done + " / " + sec.items.length;
        head.appendChild(tl);
        head.addEventListener("click", (e) => { if (e.target !== hCb) hCb.click(); });
        ul.appendChild(head);
        ctrl.headCb = hCb;
        ctrl.tallyEl = tl;
      }
      sec.items.forEach((it) => {
        const key = it.key, task = it.task;
        const checked = !!stored[key];
        const li = document.createElement("li");
        li.className = "config-task" + (checked ? " is-done" : "") + (task.tool ? " config-task-tool" : "");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = checked;
        cb.setAttribute("aria-label", task.text);
        cb.addEventListener("change", () => {
          configState.tasks[phase.key] = configState.tasks[phase.key] || {};
          configState.tasks[phase.key][key] = cb.checked;
          saveConfigState();
          syncTaskUI();
        });
        li.appendChild(cb);
        const span = document.createElement("span");
        span.className = "config-task-text";
        span.textContent = task.text;
        if (task.url) {
          const a = document.createElement("a");
          a.href = task.url; a.target = "_blank"; a.rel = "noopener";
          a.className = "config-task-link";
          a.textContent = " ↗";
          a.title = "Open support doc";
          a.addEventListener("click", (e) => e.stopPropagation());
          span.appendChild(a);
        }
        li.appendChild(span);
        li.addEventListener("click", (e) => { if (e.target !== cb && e.target.tagName !== "A") cb.click(); });
        ul.appendChild(li);
        ctrl.items.push({ key: key, li: li, cb: cb });
      });
    });
    wrap.appendChild(ul);

    // Targeted refresh after a task toggle: update checkboxes, row states,
    // and every tally IN PLACE instead of rebuilding the phase DOM. A full
    // renderConfigView() here used to collapse any open <details> (workbook
    // sections, validation sections, AI prompts) and drop keyboard focus +
    // scroll position on every click.
    function syncTaskUI() {
      const prog = (configState.tasks && configState.tasks[phase.key]) || {};
      let doneAll = 0, totalAll = 0;
      sectionCtrls.forEach((sc) => {
        let done = 0;
        sc.items.forEach((it) => {
          const on = !!prog[it.key];
          it.cb.checked = on;
          it.li.classList.toggle("is-done", on);
          if (on) done++;
        });
        doneAll += done;
        totalAll += sc.items.length;
        if (sc.headCb) {
          sc.headCb.checked = sc.items.length > 0 && done === sc.items.length;
          sc.headCb.indeterminate = done > 0 && done < sc.items.length;
        }
        if (sc.tallyEl) sc.tallyEl.textContent = done + " / " + sc.items.length;
      });
      if (phaseSaCb) {
        phaseSaCb.checked = totalAll > 0 && doneAll === totalAll;
        phaseSaCb.indeterminate = doneAll > 0 && doneAll < totalAll;
        const pctNow = totalAll ? Math.round((doneAll / totalAll) * 100) : 0;
        phaseSaTally.textContent = doneAll + " / " + totalAll + " tasks · " + pctNow + "%";
      }
      renderConfigPhases();  // phase rail tallies + bars (safe rebuild — no inputs live there)
      updateOverallStats();  // sidebar progress bar, summary line, deliverables tally
    }

    // Validation Script — UAT checklist (Validate phase only). Sections shown
    // are the universal foundation plus the ones mapped to the active package
    // and tier. Checkmarks persist per client in configState.validation, kept
    // separate from the weighted overall progress.
    if (phase.key === "validate" && configData.validationChecklist && cfgPkg) {
      const vc = configData.validationChecklist;
      const vmap = vc.map || {};
      const tierKey = cfgTier ? cfgTier.key : null;
      const secNames = (vmap._universal || []).concat((vmap[cfgPkg.key] || {})[tierKey] || []);
      const avail = secNames.filter((s) => vc.sections && vc.sections[s]);
      if (avail.length) {
        configState.validation = configState.validation || {};
        const vWrap = document.createElement("div");
        vWrap.className = "config-validation";
        const vh = document.createElement("h3");
        vh.textContent = vc.name || "Validation Script — UAT Checklist";
        vWrap.appendChild(vh);
        if (vc.subtitle) {
          const vs = document.createElement("p");
          vs.className = "config-validation-intro";
          vs.textContent = vc.subtitle;
          vWrap.appendChild(vs);
        }
        // Link to the live Validation Script (Smartsheet).
        if (vc.scriptUrl) {
          const link = document.createElement("a");
          link.href = vc.scriptUrl; link.target = "_blank"; link.rel = "noopener";
          link.className = "config-validation-script-link";
          link.textContent = "↗ Open the Validation Script (Smartsheet)";
          vWrap.appendChild(link);
        }
        // Whose responsibility it is to send this + the phase's action items.
        if (vc.responsibility || vc.owner) {
          const rr = document.createElement("p");
          rr.className = "config-validation-rr";
          if (vc.owner) {
            const badge = document.createElement("span");
            badge.className = "config-validation-owner";
            badge.textContent = vc.owner + " owns this";
            rr.appendChild(badge);
          }
          if (vc.responsibility) rr.appendChild(document.createTextNode(" " + vc.responsibility));
          vWrap.appendChild(rr);
        }
        avail.forEach((secName) => {
          const nodes = vc.sections[secName];
          const store = (configState.validation[secName] = configState.validation[secName] || {});
          // Stable path-derived leaf keys — see validationLeafKeys above.
          const vKeys = validationLeafKeys(nodes);
          const total = vKeys.length;
          const doneCount = () => vKeys.filter((k) => store[k]).length;

          const det = document.createElement("details");
          det.className = "config-validation-section";
          const sum = document.createElement("summary");
          const nm = document.createElement("span"); nm.textContent = secName; sum.appendChild(nm);
          const prog = document.createElement("span");
          prog.className = "config-validation-progress";
          prog.textContent = doneCount() + " / " + total;
          sum.appendChild(prog);
          det.appendChild(sum);

          const body = document.createElement("div");
          body.className = "config-validation-body";
          let leafIx = 0;
          function renderTask(node) {
            const k = vKeys[leafIx++];
            const row = document.createElement("div");
            row.className = "config-validation-task" + (store[k] ? " is-done" : "");
            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = !!store[k];
            cb.setAttribute("aria-label", node.name);
            cb.addEventListener("change", () => {
              store[k] = cb.checked;
              saveConfigState();
              row.classList.toggle("is-done", cb.checked);
              prog.textContent = doneCount() + " / " + total;
            });
            row.appendChild(cb);
            if (node.url) {
              const a = document.createElement("a");
              a.href = node.url; a.target = "_blank"; a.rel = "noopener";
              a.className = "config-validation-link";
              a.textContent = node.name;
              row.appendChild(a);
            } else {
              const sp = document.createElement("span"); sp.textContent = node.name; row.appendChild(sp);
            }
            row.addEventListener("click", (e) => { if (e.target !== cb && e.target.tagName !== "A") cb.click(); });
            body.appendChild(row);
          }
          (function renderNodes(ns) {
            ns.forEach((x) => {
              if (x.items) {
                const gh = document.createElement("p");
                gh.className = "config-validation-group";
                gh.textContent = x.name;
                body.appendChild(gh);
                renderNodes(x.items);
              } else { renderTask(x); }
            });
          })(nodes);
          det.appendChild(body);
          vWrap.appendChild(det);
        });
        wrap.appendChild(vWrap);
      }
    }

    // Configuration Workbook only appears on the Build phase.
    if (phase.key === "build") {
      const wbWrap = document.createElement("div");
      wbWrap.className = "config-workbook";

      const wbHead = document.createElement("div");
      wbHead.className = "config-workbook-head";
      const wbHeader = document.createElement("h3");
      wbHeader.textContent = "Configuration Workbook";
      wbHead.appendChild(wbHeader);
      // Export — rebuilds the ENTIRE official workbook (all 13 tabs) from
      // the template and fills this client's Updated / Changed to / Notes
      // into the exact rows of their tier's tab. Column C carries the
      // TRUE/FALSE + list-validation combo Google Sheets turns into native
      // checkboxes on import.
      function collectInjection() {
        const tier = activeConfigTier();
        const tabName = wbTemplate && tier ? (wbTemplate.tierTabs || {})[tier.key] : null;
        const values = {};
        workbookSectionsForTier().forEach((sec) => {
          const keys = workbookSettingKeys(sec);
          (sec.settings || []).forEach((s, i) => {
            if (s.row == null) return;
            const st = (configState.workbook[sec.key] || {})[keys[i]] || {};
            values[s.row] = { c: !!st.updated, d: st.changed || null, e: st.notes || null };
          });
        });
        return { tabName: tabName, values: values, tier: tier };
      }
      const wbExport = document.createElement("button");
      wbExport.type = "button";
      wbExport.className = "config-reset-btn config-wb-export";
      wbExport.textContent = "Download .xlsx";
      wbExport.title = "Download the full official workbook with this client's entries filled into their tier's tab. In Google Sheets: File → Import → Upload. Then, to get checkboxes, select column C and Insert → Tick box.";
      wbExport.addEventListener("click", async () => {
        const t = await loadWorkbookTemplate();
        if (!t) {
          appDialog.alert("workbook-template.json couldn't be loaded, so the exact-format export isn't available right now.", "Export unavailable");
          return;
        }
        const inj = collectInjection();
        if (!inj.tabName) {
          appDialog.alert("No official workbook tab is mapped for this tier.", "Export unavailable");
          return;
        }
        const fileName = exportWorkbookXlsx({
          template: t,
          tabName: inj.tabName,
          values: inj.values,
          clientName: configState.name || "Client",
          tierName: inj.tier.name
        });
        wbExport.textContent = "Exported ✓";
        wbExport.title = fileName;
        setTimeout(() => { wbExport.textContent = "Download .xlsx"; }, 2500);
      });
      // Direct-to-Google-Sheets — creates a NATIVE Google Sheet in the SPC's
      // Drive (checkboxes included) and opens it. Activated by a Google
      // OAuth Client ID in configurations.json → export.googleClientId;
      // without one, the .xlsx download + File → Import flow is the path.
      const gClientId = (configData.export && configData.export.googleClientId) || "";
      if (gClientId) {
        const wbExportGs = document.createElement("button");
        wbExportGs.type = "button";
        wbExportGs.className = "config-reset-btn config-wb-export";
        wbExportGs.textContent = "Export to Google Sheets";
        wbExportGs.title = "Creates the filled workbook as a native Google Sheet in your Drive and opens it";
        wbExportGs.addEventListener("click", async () => {
          const t = await loadWorkbookTemplate();
          if (!t) {
            appDialog.alert("workbook-template.json couldn't be loaded.", "Export unavailable");
            return;
          }
          const inj = collectInjection();
          if (!inj.tabName) {
            appDialog.alert("No official workbook tab is mapped for this tier.", "Export unavailable");
            return;
          }
          wbExportGs.disabled = true;
          wbExportGs.textContent = "Exporting…";
          try {
            const res = await exportWorkbookToGoogleSheets({
              clientId: gClientId,
              template: t,
              tabName: inj.tabName,
              values: inj.values,
              clientName: configState.name || "Client",
              tierName: inj.tier.name
            });
            // Remember the created sheet as this client's linked workbook
            // (unless one is already linked) so future updates can Post to it.
            if (res && res.url && !configState.workbookUrl) {
              configState.workbookUrl = res.url;
              saveConfigState();
            }
            wbExportGs.textContent = res && res.checkboxes ? "Opened in Sheets ✓" : "Opened (no checkboxes)";
          } catch (err) {
            appDialog.alert("Google Sheets export failed: " + (err && err.message ? err.message : err), "Export failed");
            wbExportGs.textContent = "Export to Google Sheets";
          } finally {
            wbExportGs.disabled = false;
            setTimeout(() => { wbExportGs.textContent = "Export to Google Sheets"; }, 3000);
          }
        });
        wbHead.appendChild(wbExportGs);
      }
      wbHead.appendChild(wbExport);
      wbWrap.appendChild(wbHead);

      // Linked client workbook — the client's OWN copy of the official
      // workbook in Google Sheets (e.g. "Bud Griffin PNPT Configuration
      // Workbook"). Post writes this client's checked rows + Changed to /
      // Notes into the matching rows of their tier's tab: additive only
      // (never unchecks or clears), and rows whose Discussion Point no
      // longer matches the official layout are skipped.
      const linkRow = document.createElement("div");
      linkRow.className = "config-wb-linkrow";
      const linkLabel = document.createElement("span");
      linkLabel.className = "config-wb-linklabel";
      linkLabel.textContent = "Client workbook";
      linkRow.appendChild(linkLabel);
      const linkInput = document.createElement("input");
      linkInput.type = "url";
      linkInput.placeholder = "Paste the client's PNPT Configuration Workbook link (Google Sheets)…";
      linkInput.setAttribute("aria-label", "Client workbook Google Sheets link");
      linkInput.value = configState.workbookUrl || "";
      linkRow.appendChild(linkInput);
      const linkOpen = document.createElement("a");
      linkOpen.className = "config-wb-linkopen";
      linkOpen.target = "_blank";
      linkOpen.rel = "noopener";
      linkOpen.textContent = "Open ↗";
      linkRow.appendChild(linkOpen);
      const postBtn = document.createElement("button");
      postBtn.type = "button";
      postBtn.className = "config-reset-btn config-wb-export";
      postBtn.textContent = "Post to workbook";
      postBtn.title = "Write this client's checked rows + Changed to / Notes into the linked workbook's tier tab. Additive only — nothing gets unchecked or cleared, and rows that no longer match the official layout are skipped.";
      linkRow.appendChild(postBtn);
      function syncLinkButtons() {
        const id = parseSpreadsheetId(configState.workbookUrl || "");
        linkOpen.hidden = !id;
        if (id) linkOpen.href = "https://docs.google.com/spreadsheets/d/" + id + "/edit";
        postBtn.disabled = !id;
      }
      linkInput.addEventListener("input", () => {
        configState.workbookUrl = linkInput.value.trim();
        saveConfigState();
        syncLinkButtons();
      });
      syncLinkButtons();
      postBtn.addEventListener("click", async () => {
        if (!gClientId) {
          appDialog.alert(
            "Posting into a linked workbook needs the one-time Google OAuth Client ID setup (configurations.json → export.googleClientId — see the README). Until then, use Download .xlsx and import it manually.",
            "One-time setup needed"
          );
          return;
        }
        const t = await loadWorkbookTemplate();
        if (!t) {
          appDialog.alert("workbook-template.json couldn't be loaded.", "Post unavailable");
          return;
        }
        const inj = collectInjection();
        if (!inj.tabName) {
          appDialog.alert("No official workbook tab is mapped for this tier.", "Post unavailable");
          return;
        }
        let checked = 0, changedN = 0, notesN = 0;
        Object.keys(inj.values).forEach((k) => {
          const v = inj.values[k];
          if (v.c) checked++;
          if (v.d) changedN++;
          if (v.e) notesN++;
        });
        if (!checked && !changedN && !notesN) {
          appDialog.alert("Nothing to post yet — no checked rows or entries for this client.", "Nothing to post");
          return;
        }
        const ok = await appDialog.confirm(
          "Post " + checked + " checked row" + (checked === 1 ? "" : "s") +
          (changedN ? ", " + changedN + " 'Changed to' value" + (changedN === 1 ? "" : "s") : "") +
          (notesN ? ", " + notesN + " note" + (notesN === 1 ? "" : "s") : "") +
          ' into the linked workbook’s "' + inj.tabName + '" tab?\n' +
          "Additive only — nothing in the workbook gets unchecked or cleared.",
          { title: "Post to client workbook", okLabel: "Post" }
        );
        if (!ok) return;
        postBtn.disabled = true;
        postBtn.textContent = "Posting…";
        try {
          const res = await postToLinkedWorkbook({
            clientId: gClientId,
            spreadsheetUrl: configState.workbookUrl,
            tabName: inj.tabName,
            template: t,
            values: inj.values
          });
          appDialog.alert(
            "Posted " + res.rowsPosted + " row" + (res.rowsPosted === 1 ? "" : "s") +
            " (" + res.cells + " cells) into \"" + res.spreadsheetTitle + "\" → " + res.tab + "." +
            (res.rowsSkipped
              ? "\n" + res.rowsSkipped + " row" + (res.rowsSkipped === 1 ? "" : "s") +
                " skipped — their text no longer matches the official workbook."
              : ""),
            "Posted ✓"
          );
          window.open(res.url, "_blank", "noopener");
        } catch (err) {
          appDialog.alert("Post failed: " + (err && err.message ? err.message : err), "Post failed");
        } finally {
          postBtn.textContent = "Post to workbook";
          syncLinkButtons();
        }
      });
      wbWrap.appendChild(linkRow);

      const intro = document.createElement("p");
      intro.className = "config-workbook-intro";
      intro.textContent =
        "The official PNPT Configuration Workbook, row for row, for this tier. Tick 'Updated' for any setting you deviated from the default on, capture the new value, and add notes for the closeout deliverable. Export fills your entries into the official workbook file.";
      const cbHint = document.createElement("p");
      cbHint.className = "config-workbook-hint";
      cbHint.textContent = gClientId
        ? "Download .xlsx → File → Import in Google Sheets (then select column C → Insert → Tick box for checkboxes). Or use Export to Google Sheets for a native sheet with checkboxes already set."
        : "After Download .xlsx → File → Import in Google Sheets, select column C and Insert → Tick box to turn the Updated column into checkboxes (your ticks are preserved).";
      wbWrap.appendChild(intro);
      wbWrap.appendChild(cbHint);

      // The workbook rows come from the official template — load it on the
      // first Build render and re-render when it arrives (the curated
      // legacy sections only show if the template genuinely can't load).
      const wbPending = !wbTemplate && !wbTemplateFailed;
      if (wbPending) {
        loadWorkbookTemplate().then(() => {
          if (configActivePhase === "build") renderConfigView();
        });
        const loading = document.createElement("p");
        loading.className = "config-workbook-intro";
        loading.textContent = "Loading the official workbook…";
        wbWrap.appendChild(loading);
      }

      if (!wbPending) workbookSectionsForTier().forEach((section) => {
        // Stable per-setting keys (derived from names) — see slugKey above.
        const wbKeys = workbookSettingKeys(section);
        const wbStore = () => configState.workbook[section.key] || {};
        const wbUpdatedCount = () =>
          wbKeys.filter((k) => wbStore()[k] && wbStore()[k].updated).length;

        const det = document.createElement("details");
        det.className = "config-wb-section";

        const sum = document.createElement("summary");
        const sumLeft = document.createElement("span");
        sumLeft.textContent = section.name;
        sum.appendChild(sumLeft);
        const sumProg = document.createElement("span");
        sumProg.className = "config-wb-section-progress";
        sumProg.textContent = wbUpdatedCount() + " of " + wbKeys.length + " updated";
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
        let lastGroup = null;
        (section.settings || []).forEach((setting, idx) => {
          // Gray sub-group label rows, mirroring the official workbook.
          if (setting.group !== undefined && setting.group !== lastGroup) {
            lastGroup = setting.group;
            if (setting.group) {
              const gtr = document.createElement("tr");
              gtr.className = "config-wb-group";
              const gtd = document.createElement("td");
              gtd.colSpan = 4;
              gtd.textContent = setting.group;
              gtr.appendChild(gtd);
              tbody.appendChild(gtr);
            }
          }
          const skey = wbKeys[idx];
          const st = wbStore()[skey] || {};
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
          cb.setAttribute("aria-label", "Updated — " + setting.name);
          cb.addEventListener("change", () => {
            configState.workbook[section.key] = configState.workbook[section.key] || {};
            const cur = configState.workbook[section.key][skey] || {};
            cur.updated = cb.checked;
            configState.workbook[section.key][skey] = cur;
            saveConfigState();
            tr.classList.toggle("is-updated", cb.checked);
            sumProg.textContent = wbUpdatedCount() + " of " + wbKeys.length + " updated";
          });
          td3.appendChild(cb);
          tr.appendChild(td3);

          // Changed To + Notes
          const td4 = document.createElement("td");
          const changed = document.createElement("input");
          changed.type = "text";
          changed.placeholder = setting.guidanceD || "Changed to…";
          changed.value = st.changed || "";
          changed.addEventListener("input", () => {
            configState.workbook[section.key] = configState.workbook[section.key] || {};
            const cur = configState.workbook[section.key][skey] || {};
            cur.changed = changed.value;
            configState.workbook[section.key][skey] = cur;
            saveConfigState();
          });
          td4.appendChild(changed);
          const noteTa = document.createElement("textarea");
          noteTa.placeholder = setting.guidanceE || "Notes (rationale, screenshot ref, etc.)";
          noteTa.style.marginTop = "6px";
          noteTa.value = st.notes || "";
          noteTa.addEventListener("input", () => {
            configState.workbook[section.key] = configState.workbook[section.key] || {};
            const cur = configState.workbook[section.key][skey] || {};
            cur.notes = noteTa.value;
            configState.workbook[section.key][skey] = cur;
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

  // Refresh the sidebar's aggregate numbers IN PLACE (progress bar, summary
  // line, deliverables tally) without rebuilding the deliverable cards —
  // rebuilding would destroy the checkbox the user just clicked and drop
  // keyboard focus. Called by task toggles (syncTaskUI) and deliverable
  // toggles; renderConfigSidebar delegates here after building the cards.
  function updateOverallStats() {
    const fill = document.getElementById("config-progress-fill");
    const txt = document.getElementById("config-progress-text");
    if (!fill || !txt) return;
    const op = overallProgress();
    fill.style.width = op.pct + "%";
    txt.textContent = op.pct + "% complete — tasks " + op.taskPct + "% (" +
      op.tasksDone + "/" + op.tasksTotal + ") · deliverables " + op.delPct +
      "% (" + op.delDone + "/" + op.delTotal + ")";
    const eb = document.querySelector("#config-deliverables .config-deliverables-eyebrow");
    if (eb) eb.textContent = "Deliverables · " + op.delDone + " / " + op.delTotal + " · " + op.delPct + "%";
  }

  function renderConfigSidebar() {
    const dlEl = document.getElementById("config-deliverables");
    if (!dlEl) return;

    dlEl.innerHTML = "";
    const eb = document.createElement("p");
    eb.className = "config-deliverables-eyebrow";
    dlEl.appendChild(eb);

    const legend = document.createElement("p");
    legend.className = "config-deliverables-legend";
    legend.textContent = "The owner tag on each deliverable (SPC or PM/PC) is whose responsibility it is to prepare and send that deliverable — including the Validation Script — to the customer.";
    dlEl.appendChild(legend);

    const pkg = activeConfigPackage();
    (pkg && pkg.deliverables ? pkg.deliverables : []).forEach((d) => {
      const card = document.createElement("div");
      card.className = "config-deliverable";
      const row = document.createElement("div");
      row.className = "config-deliverable-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!configState.deliverables[d.key];
      cb.setAttribute("aria-label", "Deliverable: " + d.name);
      cb.addEventListener("change", () => {
        configState.deliverables[d.key] = cb.checked;
        saveConfigState();
        // Deliverables feed the overall bar — refresh tallies in place so
        // the clicked checkbox isn't rebuilt out from under the user.
        updateOverallStats();
      });
      row.appendChild(cb);
      const nm = document.createElement("span");
      nm.className = "config-deliverable-name";
      nm.textContent = d.name;
      row.appendChild(nm);
      if (d.owner) {
        const ow = document.createElement("span");
        ow.className = "config-deliverable-owner";
        ow.textContent = d.owner + " sends";
        ow.title = d.owner + " is responsible for preparing and sending this deliverable to the customer.";
        row.appendChild(ow);
      }
      card.appendChild(row);
      if (d.description) {
        const desc = document.createElement("p");
        desc.className = "config-deliverable-desc";
        desc.textContent = d.description;
        card.appendChild(desc);
      }
      dlEl.appendChild(card);
    });
    updateOverallStats(); // fill the progress bar, summary line + eyebrow
  }

  // ---------------------------------------------------------------------
  // Printing the Config Tracker (the workbook printout doubles as the
  // closeout artifact): closed <details> don't print their content, so
  // open every collapsed section for the print run and restore after.
  // ---------------------------------------------------------------------
  let printOpenedDetails = [];
  window.addEventListener("beforeprint", () => {
    printOpenedDetails = Array.prototype.slice.call(
      document.querySelectorAll("#config-view details:not([open])")
    );
    printOpenedDetails.forEach((d) => { d.open = true; });
  });
  window.addEventListener("afterprint", () => {
    printOpenedDetails.forEach((d) => { d.open = false; });
    printOpenedDetails = [];
  });

  return { renderConfigView };
}
