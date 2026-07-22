# Procore PNPT Internal Tools

A single static web app (vanilla HTML/CSS/JS, no build step) used by the PNPT
SPC team. It hosts **three modes**, switchable from the tabs in the header:

| Mode | What it is | Primary data file |
|---|---|---|
| **ERP Connector Map** | Interactive bipartite diagram of Procore's ERP connectors (left) ↔ the Procore modules/data objects they sync with (right), with data-flow direction. Toggleable by source: Procore-native / Agave Sync / SmoothX. Includes a search finder and an **SOP Builder** that generates a Word doc. | `data.json` |
| **PNPT Package Builder** | The Procore Professional Services packages (Cost Management, Project Execution, …) broken down by tier and the tools each tier includes. | `packages.json` |
| **PNPT Config Tracker** | Per-client configuration-progress tracker for SPCs, built from the PNPT Configuration & Tracking playbook (discovery → kickoff → config → validation → closeout). Multi-client, progress saved in the browser. | `configurations.json` |

Live at **https://christiangerbich.github.io/procore-erp-map/**
(password-gated — see [Access & password](#access--password)).

> **Regional scope: NAMER only.** The PNPT practice content (Package Builder +
> Config Tracker) references NAMER methodology exclusively — EU/APAC/Pubsec
> variants, alternate tool terminology (Site Diary, Defect List, Tendering), and
> non-NAMER slide citations have been removed. Each Config Tracker phase links
> its canonical NAMER source document in Google Drive, and the site-wide footer
> links the PNPT GPS Slack channel + the NAMER delivery Drive folders. When
> editing, keep content NAMER-scoped.

Built with vanilla HTML/CSS/JS as plain ES modules — zero dependencies, no
build step, no backend (both graphs are hand-rolled SVG sharing one zoom/pan
helper). Designed to be hosted on GitHub Pages and embedded in Confluence
via an Iframe macro.

---

## Run locally

Browsers block `fetch()` against `file://` URLs, so you need a tiny local
server. From this folder:

```powershell
python -m http.server 8000
```

Then open http://localhost:8000. Edit any file, save, hard-refresh
(`Ctrl+Shift+R`) to bust the browser cache.

> The password gate runs locally too. Default password: **`PNPT@2026`**.
> Append `?lock` to the URL to force the gate to re-prompt
> (e.g. `http://localhost:8000/?lock`).

---

## Architecture — what edits what

There is no framework and no build step. `index.html` defines three `<section>`
view containers; plain ES modules (served as-is) render each from its JSON file,
with `main.js` switching modes and keeping the URL hash shareable
(`#erp/<node>`, `#packages/<pkg>`, `#config`). **To change something, edit the
file in the right-hand column — you almost never need to touch more than one.**

> For *how the pieces run together* (boot sequence, mode switching, data flow,
> the offline build pipeline, state/persistence) see **[ARCHITECTURE.md](ARCHITECTURE.md)**
> — diagrams included.

| I want to change… | Edit | Notes |
|---|---|---|
| Add/remove an ERP, a link, a label, sync direction | `data.json` | `nodes[]` + `links[]`. See [Data files](#data-files). |
| ERP Map render logic (layout, hexes, columns, side panel, search, SOP) | `erp-map.js` | Vanilla SVG, 3-column Procore/Agave/SmoothX. |
| Add/edit a PNPT package, tier, or included tools | `packages.json` | |
| Package Builder render logic | `package-builder.js` → `renderPackages*` (`renderPackagesGraph`, `renderPackagesToolDetail`, `renderPackagesDetails`) | |
| Add/edit Config Tracker content, phases, frames | `configurations.json` | The dense one. See [Config Tracker schema](#config-tracker-schema). |
| Config Tracker render logic | `config-tracker.js` → `renderConfigView`, `renderConfigBar`, `renderConfigPhases`, `renderConfigPhaseContent`, `renderFrame`, `renderConfigSidebar` | `renderFrame` handles many frame shapes (`buckets[]`, `points[]`, `pillars[]`, `forecastSamples[]`, …). |
| Mode toggle, hash deep links, data loading | `main.js` | Entry module; owns `setMode()` + routing. |
| Cross-view utilities (hex geometry, zoom/pan, dialogs) | `shared.js` | Used by both graphs + the tracker dialogs. |
| SOP Builder action templates (per ERP tool) | `sop-templates.json` | The "Generate Word document" modal. |
| The official Configuration Workbook (Build-phase rows + export) | regenerate `workbook-template.json` via `tools/build-workbook-template.py` | **Generated** from the official NAMER .xlsx — don't hand-edit. |
| Search-finder corpus (the "Search connectors…" box) | `docs-index.json` | **Generated** — see [tools/](#toolsbuild-scripts). Don't hand-edit. |
| Any styling | `styles.css` | One file, all modes (incl. print). Brand palette near the top as CSS vars. |
| Password / login gate | `auth.js` | See [Access & password](#access--password). |
| Page shell, the 3 view sections, login + SOP modal markup | `index.html` | |

### File layout

```
.
├── index.html            # page shell: 3 view sections, login gate, SOP modal
├── styles.css            # ALL styling, every mode (incl. print)
├── auth.js               # password gate (deterrent-only, classic script)
│
├── main.js               # entry module: data fetch, mode toggle, hash routing
├── shared.js             # hex geometry, svgEl, zoom/pan, in-app dialogs
├── erp-map.js            # ERP map + side panel + search + SOP builder
├── package-builder.js    # Package Builder graph + details
├── config-tracker.js     # Config Tracker (clients, phases, workbook, export/import)
│
├── data.json             # ERP Connector Map: nodes + links
├── packages.json         # PNPT Package Builder
├── configurations.json   # PNPT Config Tracker schema
├── sop-templates.json    # SOP Builder per-tool action templates
├── workbook-template.json# official NAMER Configuration Workbook, 1:1 (GENERATED)
├── workbook-export.js    # dependency-free .xlsx writer + Google Sheets upload
├── docs-index.json       # search-finder corpus (GENERATED by tools/build-docs-index.py)
├── favicon.svg           # Procore-orange hex
│
├── tools/                # local-only Python build scripts (NOT run by the site)
│   ├── build-docs-index.py
│   ├── build-vertex-upload.py
│   ├── build-workbook-template.py  # official workbook xlsx -> workbook-template.json
│   ├── sync-support-site.py   # refresh local Procore support-doc mirror
│   ├── sync-agave-docs.py     # refresh local Agave sync-docs mirror
│   └── extract_docx.py
└── README.md
```

`main.js` loads the four startup JSONs **in parallel** — only `data.json` is
required (a failure shows a visible error card); the rest fail soft (the
feature that uses them just stays empty). `docs-index.json` lazy-loads on
first use of the search box:

```
data.json (required) ∥ sop-templates.json ∥ packages.json ∥ configurations.json
docs-index.json — deferred until the search box is used
```

---

## Configuration Workbook export (Config Tracker → Build phase)

The Build-phase **Configuration Workbook is the official "PNPT Configuration
Workbook _ NAMER" row-for-row** — the UI and the export both derive from
`workbook-template.json`, which `tools/build-workbook-template.py` generates
from the official .xlsx. When the official workbook changes, re-run that
script and commit the new template.

Two export paths, both producing the **full 13-tab official workbook** with
the client's Updated / Changed to / Notes filled into their tier's tab:

- **Download .xlsx** (always available) — open Google Sheets → File → Import
  → Upload (or upload to Drive and "Open with Google Sheets"). Formatting
  comes through 1:1, and the Updated column imports as **native checkboxes**
  (each C cell carries a TRUE/FALSE list validation, which Sheets renders as
  a checkbox).
- **Export to Google Sheets** (optional, one-time setup) — creates the filled
  workbook directly in the SPC's Drive as a native Sheet and opens it. To
  enable: create a Google OAuth 2.0 **Client ID** (Google Cloud console →
  APIs & Services → Credentials → Create credentials → OAuth client ID →
  *Web application*), add this site's origin (the GitHub Pages URL) under
  **Authorized JavaScript origins**, enable the **Google Drive API** on the
  project, then paste the Client ID into `configurations.json` →
  `export.googleClientId`. Scope is `drive.file` — the app can only touch
  files it creates.

---

## Data files

### data.json — ERP Connector Map

Two arrays:

- **`nodes`** — each has `id`, `label`, and `type` (`"core"`, `"erp"`, or
  `"module"`). ERP nodes also carry `connector`, `via` (`"procore"` /
  `"agave"` / `"smoothx"` — controls which column + color), `supportUrl`, and
  optional `overview`, `thingsToKnow`, `resources`, `dataMappingSections`.
  Module nodes carry `tier` (`"company"` or `"project"`).
- **`links`** — `{ source, target, direction, notes }`. `source`/`target`
  reference node `id`s. `direction` is `"bidirectional"`, `"to-erp"`
  (Procore→ERP), or `"to-procore"` (ERP→Procore). `notes` names the exact
  field on the ERP side and shows in the connection card.

To **refine data flow per ERP**, open that ERP's support page (`supportUrl`)
and correct its `links` to match exactly which Procore objects it syncs.

### packages.json — Package Builder

PNPT Professional Services packages. Each package has tiers; each tier lists the
Procore tools it includes. Rendered as the capability graph + detail panel.

### configurations.json — Config Tracker schema

The dense one — it encodes ~60 slides of the PNPT Configuration & Tracking
playbook. See the schema note below before editing.

### sop-templates.json — SOP Builder

Per-ERP-tool action templates. The SOP Builder modal (opened from an ERP node
or the top-bar button) lets an SPC assign an owner to each action and generates
a Word `.docx` client-side.

### docs-index.json — search corpus (generated)

Feeds the in-page finder ("Search connectors, data objects, errors…").
**Generated** by `tools/build-docs-index.py` from a local Procore ERP markdown
folder — do not hand-edit; rebuild instead. The site works fine without it (the
finder just falls back to the `data.json` corpus).

---

## Config Tracker schema

`configurations.json` shape (top level → leaves):

```
packages[]            # e.g. Cost Management, Project Execution
  └─ tiers[]          # e.g. Essentials / Advanced / Enterprise
       └─ phases[]    # discovery → kickoff → configuration → validation → closeout
            └─ sections[]   # workbook sections; each may reference a "frame"
```

**Frames** are the structured callouts `renderFrame` (in `config-tracker.js`) draws. A
frame is one of several shapes — `buckets[]`, `points[]`, `pillars[]`,
`subSections[]`, `examples[]`, `items[]`, `forecastSamples[]`, `families[]` —
plus per-package overrides like `kickoffTimeline` and `consultationAgenda`.
When adding content, copy an existing frame of the same shape and adjust;
`renderFrame` keys off the field names present.

Most frames trace back to a specific source slide (the playbook decks). When
you change a frame, keep it grounded in the source material so the tool stays
trustworthy.

**Per-client progress** is stored in the browser's `localStorage` under
`pnpt-config-tracker:v2` as `{ schema, activeClientId, clients: {…} }`. It
never leaves the device — there is no server. Clearing browser data wipes a
user's tracked clients.

---

## tools/ (build scripts)

Local Python helpers, **not** part of the deployed site and never run by the
browser. Run from the repo root:

- **`sync-support-site.py`** — syncs the ENTIRE v2.support.procore.com site to
  a local corpus at `~/Documents/Procore MD Files/V2 Site/` (~6.1k pages).
  Sitemap-driven and delta-aware: first run fetches everything (~9 hrs at the
  robots.txt-sanctioned 5s/request); later runs re-fetch only pages whose
  sitemap lastmod changed (minutes). Safe to interrupt — progress checkpoints
  to `_manifest.json` and the next run resumes. Run monthly-ish to stay fresh.
  Pages are filed into Procore product-family folders (ERP & Integrations,
  Financials, Preconstruction, Project Management, Resource Management,
  Quality & Safety, BIM & Coordination, Analytics & Reporting, Platform &
  Admin, General) via the ordered CATEGORY_RULES table in the script — edit
  those regexes to refine the taxonomy; the next sync re-files automatically.
- **`build-docs-index.py`** — builds `docs-index.json` from a local "Procore
  ERP" markdown folder. Strips images/markup, chunks by heading.
  `python tools/build-docs-index.py [SRC_DIR] [OUT_FILE]`
- **`build-vertex-upload.py`** — preps the support corpora for Vertex AI
  Search (the "Full docs" deep-search button in all three modes; active when a
  Vertex config id is set in `data.json`). Prefers the full `V2 Site` corpus
  when present; falls back to the older partial "Procore ERP" folder.
- **`extract_docx.py`** — docx text extraction helper.

If you don't have the source markdown folders, you can ignore `tools/`
entirely — the committed `docs-index.json` is all the site needs.

---

## Access & password

The site is gated by `auth.js` — a SHA-256 password check in client-side JS.

> ⚠️ **This is a deterrent, not real authentication.** The page is fully static
> and the password hash ships in the JS, so anyone determined can read the file
> and bypass it. It keeps casual visitors and search-engine crawlers out. **Do
> not put sensitive customer data behind it.** For real auth, host on Cloudflare
> Pages behind Cloudflare Access (Procore SSO) — that removes `auth.js` entirely.

- **Default password:** `PNPT@2026`. Share it via Slack DM, not a public channel.
- **Force re-login:** append `?lock` (or `?logout`) to the URL — clears the
  saved unlock and re-prompts. The param strips itself from the URL bar after.
- **Remember-me:** 30 days (checked) / 4 hours (unchecked), in `localStorage`.
- **Rotate the password:** follow the recipe in the header comment of
  `auth.js` — hash the new password, replace `LOCK_HASH`, commit, tell the team.
  Existing users keep access for up to 30 days; new users use the new password.

---

## Deploy

GitHub Pages serves the repo's `main` branch from root. **To publish: commit
and push to `main`.** Pages rebuilds in ~60 seconds.

```powershell
git add -A
git commit -m "…"
git push
```

Pages config (already set): **Settings → Pages → Deploy from a branch →
`main` / `(root)`**. Live URL:
`https://christiangerbich.github.io/procore-erp-map/`.

---

## Embed in Confluence

Confluence Cloud has an **Iframe** macro:

1. Type `/iframe` and select **Iframe**.
2. Paste the GitHub Pages URL.
3. Width `100%`, height ~`700` (adjust to taste).

> **Heads up:** Confluence restricts which domains can be iframed. If the iframe
> is blank, an admin must add `*.github.io` (or the specific URL) under
> **Confluence settings → Security → URL allowlist**. Admin-only.

---

## Ownership & handoff

**Current owner:** Christian Gerbich (`christian.gerbich@procore.com`).
**Repo:** `christiangerbich/procore-erp-map` (personal GitHub namespace).

**Handoff model — collaborator (keeps the URL stable):** the repo stays in the
current namespace and the successor is added as a **collaborator with write
access**, so the live URL
(`https://christiangerbich.github.io/procore-erp-map/`), every internal
bookmark, and every Confluence embed keep working unchanged.

To add a maintainer:
1. GitHub → repo → **Settings → Collaborators → Add people**.
2. Enter their GitHub username, grant **Write** (or **Maintain**).
3. They accept the invite, then `git clone` and follow [Run locally](#run-locally).

> **Known limitation of this model:** the repo lives in a personal account, so
> if that account is ever deactivated (e.g. offboarding), the site and its
> history go with it — the URL would break and the successor would have to
> re-host (forking into a Procore-controlled GitHub org or onto a custom domain,
> which changes the URL). If this tool is becoming load-bearing for the team,
> migrating it to an org-owned repo + custom domain **before** that happens is
> the durable fix. For now, collaborator access is the lowest-friction handoff.

**New-maintainer checklist:**
- [ ] Read this README top to bottom; run it locally.
- [ ] Get the access password (Slack DM from the current owner).
- [ ] Confirm GitHub collaborator access; make a trivial commit and confirm
      Pages redeploys.
- [ ] Skim the `render*` functions in the module for the mode you'll touch first
      (`erp-map.js`, `package-builder.js`, or `config-tracker.js`).
- [ ] Note the security caveat in [Access & password](#access--password) — don't
      assume the gate is secure.
