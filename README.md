# Procore ERP Connector Map

An interactive force-directed graph showing Procore's ERP connectors, the Procore modules / data objects they sync, and links to each connector's support documentation.

Built with vanilla HTML + [D3.js v7](https://d3js.org/). No build step. Designed to be hosted on GitHub Pages and embedded in Confluence via an Iframe macro.

## Run locally

Browsers block `fetch()` against `file://` URLs, so you need a tiny local server. From this folder:

```powershell
# Python (already on most machines)
python -m http.server 8000
```

Then open http://localhost:8000.

## Edit the data

All ERPs, modules, and connections live in [data.json](data.json). Two arrays:

- `nodes` — each node has `id`, `label`, and `type` (`"core"`, `"erp"`, or `"module"`). ERP nodes also carry `connector` (e.g. "Direct connector") and `supportUrl`.
- `links` — `{ source, target }` pairs, both referencing node `id`s.

Reload the page after editing.

To **refine the data flow per ERP**, open each ERP's support page (linked in `supportUrl`) and update its `links` to match exactly which Procore objects it syncs. The seed data uses Procore's standard ERP sync model as a sensible default.

## Push to GitHub & enable Pages

### 1. Create the repo

```powershell
# from this folder
git init
git add .
git commit -m "Initial commit: Procore ERP connector map"

# Using GitHub CLI (gh):
gh repo create procore-erp-map --public --source=. --remote=origin --push

# Or, if you create the empty repo manually on github.com first:
git remote add origin https://github.com/<your-username>/procore-erp-map.git
git branch -M main
git push -u origin main
```

### 2. Turn on GitHub Pages

1. On GitHub, go to **Settings → Pages**.
2. Under **Source**, choose **Deploy from a branch**.
3. Pick branch `main`, folder `/ (root)`. Save.
4. Wait ~1 minute. Your page goes live at:
   `https://<your-username>.github.io/procore-erp-map/`

## Embed in Confluence

Confluence Cloud has an **Iframe** macro. On the Confluence page:

1. Type `/iframe` and select **Iframe**.
2. Paste your GitHub Pages URL.
3. Set width to `100%` and height to roughly `700` (adjust to taste).

> **Heads up:** Confluence Cloud restricts which domains can be iframed. If the iframe shows blank, your Confluence admin needs to add `*.github.io` (or your specific URL) to the **Allowlist** under Confluence settings → Security → URL allowlist. This is an admin-only setting.

Alternative: paste the page contents into the **HTML** macro (if your admin has it enabled).

## File layout

```
.
├── README.md
├── index.html      # page shell + side panel markup
├── styles.css      # all styling
├── app.js          # D3 force simulation + interactivity
└── data.json       # edit this to change the graph
```
