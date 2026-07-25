# -*- coding: utf-8 -*-
"""Distill Procore's native ERP support docs into sop-procore.json — the data
behind the manual-style corpus SOP Builder for Procore-native connectors.

Unlike the Agave corpus (one page per synced object), Procore's own ERP
product manuals are manual-style: an Overview, a "Things to Know" table
(per Procore item: considerations / limitations / requirements), "Diagrams"
(set-up workflow narratives), task Tutorials, and an FAQ list. This script
pulls those verbatim into a per-ERP record keyed by the data.json node id.

Covers the 13 Procore-native ERPs that have a product manual. QuickBooks
Online (1 page, no manual) and Workday (no manual) are intentionally left
on the template SOP.

Usage:  python tools/build-sop-procore.py [--inspect <node-id>]
Reads:  ~/Documents/Procore MD Files/V2 Site/ERP & Integrations/product-manuals__<slug>__*.md
Writes: sop-procore.json  (committed; lazy-loaded by the SOP Builder)
"""
import io, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS = os.path.join(os.path.expanduser("~"), "Documents", "Procore MD Files",
                      "V2 Site", "ERP & Integrations")
OUT = os.path.join(ROOT, "sop-procore.json")

# data.json node id -> product-manual slug. acumatica-edge -> the "Construction"
# manual (Vision is the only other Acumatica manual, matched exactly); MRI
# Platform X -> mri-project-financials (confirmed by the manual's own title).
SLUGS = {
    "viewpoint-spectrum": "viewpoint-spectrum",
    "viewpoint-vista":    "vista",
    "quickbooks-desktop": "quickbooks-desktop",
    "sage-300-cre":       "sage-300-cre",
    "yardi-voyager":      "yardi-voyager",
    "netsuite":           "netsuite",
    "acumatica-edge":     "acumatica-construction",
    "acumatica-vision":   "acumatica-vision",
    "mri-platform-x":     "mri-project-financials",
    "sage-intacct":       "sage-intacct",
    "sage-100":           "sage-100",
    "cmic":               "cmic",
    "xero":               "xero",
}

# Tool-group keyword map (mirrors SOP_TOOL_GROUPS in erp-map.js) — used to file
# each task tutorial under a Procore tool. First match wins.
GROUP_RULES = [
    ("directory",   r"vendor|compan(y|ies)|director|employee|contact"),
    ("primes",      r"prime|owner (contract|invoice)|\bpcco\b|\bpco\b"),   # before commitments (PCCO)
    ("commitments", r"commitment|subcontract|purchase order|\bpo\b|\bsco\b|change order"),
    ("invoicing",   r"invoice|billing|pay app|payment|requisition"),
    ("budget",      r"budget|forecast|cost forecast"),
    ("wbs",         r"cost code|cost type|category|categories|standard cost"),
    ("projects",    r"sub ?job|\bjob\b|project"),
    ("directcosts", r"direct cost|job cost|timecard transaction"),
    ("timesheets",  r"timesheet|timecard|time entry"),
]

# Inlined glossary-tooltip definitions the support site injects mid-content.
# Any paragraph containing one of these exact snippets is dropped as noise.
GLOSSARY_SNIPPETS = [
    "is a user who has 'Admin' level permissions",
    "is an individual with the authority to accept and reject",
    "is a third-party client application developed by hh2",
    "Also called a Company Administrator",
    "has been granted the 'Can Push to Accounting'",
    "who has been granted the 'Can Push to Accounting'",
    "is a lightweight, Windows desktop application",
    "See Which ERP Integrations are supported by Procore?",
    "Granting a user ‘Admin’ level permissions",
    "Granting a user 'Admin' level permissions",
]
MAX_TEXT = 700
ZW = re.compile(r"[​﻿‘’]")  # zero-width + curly apostrophes handled below


def clean(s):
    s = str(s or "")
    s = s.replace("’", "'").replace("‘", "'")
    s = re.sub(r"[​﻿]", "", s)
    return s.strip()


def is_glossary(p):
    return any(sn in p for sn in GLOSSARY_SNIPPETS)


def path(slug, sub=None):
    name = "product-manuals__" + slug + (("__" + sub) if sub else "") + ".md"
    return os.path.join(CORPUS, name)


def read_page(slug, sub=None):
    """Return (title, url, body_lines) or None if the page is absent.
    body_lines excludes the crawler header (title / Source / Fetched)."""
    p = path(slug, sub)
    if not os.path.exists(p):
        # faq page uses a bare (no .md) variant in some crawls; try both
        if sub and os.path.exists(path(slug, sub)[:-3]):
            p = path(slug, sub)[:-3]
        else:
            return None
    raw = io.open(p, encoding="utf-8").read()
    lines = raw.split("\n")
    title = clean(lines[0].lstrip("# ")) if lines else ""
    url = ""
    for ln in lines[:6]:
        if ln.startswith("Source: "):
            url = ln[8:].strip()
            break
    return title, url, lines[4:]


def paragraphs(lines):
    """Group body lines into cleaned paragraphs, dropping glossary noise and
    the repeated ERP-name/section echo lines."""
    out, buf = [], []
    for ln in lines:
        c = clean(ln)
        if not c:
            if buf:
                out.append(" ".join(buf)); buf = []
            continue
        buf.append(c)
    if buf:
        out.append(" ".join(buf))
    return [p for p in out if not is_glossary(p)]


def cells_from_table(lines):
    """Linearized-table tokenizer: cells are separated by bare '|' lines."""
    cells, cur = [], []
    started = False
    for ln in lines:
        s = clean(ln)
        if s == "|":
            started = True
            cells.append(" ".join(cur).strip()); cur = []
            continue
        if not started:
            continue
        if s:
            # keep bullet dashes as separators inside a cell
            cur.append(s.lstrip("- ").strip() if s == "-" else s)
    if cur:
        cells.append(" ".join(cur).strip())
    return cells


def trim(t, n=MAX_TEXT):
    t = re.sub(r"\s+", " ", t).strip(" -|")
    if len(t) > n:
        t = t[:n].rsplit(" ", 1)[0] + " …"
    return t


def parse_things_to_know(slug):
    pg = read_page(slug, "things-to-know")
    if not pg:
        return []
    _, _, body = pg
    # isolate the table (after the "### Things to know about..." heading if present)
    cells = cells_from_table(body)
    # drop leading header cells until we pass the 2 column headers
    items = []
    # find header index: first cell that looks like the item-column header
    start = 0
    for i, c in enumerate(cells):
        if re.search(r"procore item|item or setting", c, re.I):
            start = i + 2  # skip both column headers
            break
    seq = [c for c in cells[start:]]
    i = 0
    while i < len(seq):
        item = clean(seq[i])
        note = clean(seq[i + 1]) if i + 1 < len(seq) else ""
        i += 2
        if not item or len(item) > 60 or is_glossary(item):
            # misaligned/empty item cell — skip just this one
            if item and len(item) > 60:
                i -= 1  # treat long cell as a note continuation; realign
            continue
        note = " ".join(s for s in re.split(r"(?<=[.!?]) ", note) if not is_glossary(s))
        note = trim(note)
        if note:
            items.append({"item": item, "note": note})
    return items


def parse_diagrams(slug):
    pg = read_page(slug, "diagrams")
    if not pg:
        return []
    _, _, body = pg
    out, cur = [], None
    for ln in body:
        m = re.match(r"^(#{3,5})\s+(.*)$", ln)
        if m:
            if cur and cur["text"]:
                out.append(cur)
            t = clean(m.group(2))
            # skip generic "Important"/"Note" callout headings as their own entry
            if re.match(r"^(important|note)!?$", t, re.I):
                cur = None
                continue
            cur = {"title": t, "buf": []}
        elif cur is not None:
            c = clean(ln)
            if c and not is_glossary(c):
                cur["buf"].append(c)
        # finalize buffer->text lazily
        if cur and "buf" in cur:
            cur["text"] = trim(" ".join(cur["buf"]))
    if cur and cur.get("text"):
        out.append(cur)
    return [{"title": d["title"], "text": d["text"]} for d in out if d.get("text")]


def group_for(title):
    low = title.lower()
    for key, pat in GROUP_RULES:
        if re.search(pat, low):
            return key
    return None


def parse_tutorials(slug):
    out = []
    prefix = "product-manuals__" + slug + "__tutorials__"
    for fn in sorted(os.listdir(CORPUS)):
        if not fn.startswith(prefix) or not fn.endswith(".md"):
            continue
        sub = fn[len("product-manuals__" + slug + "__"):-3]
        pg = read_page(slug, sub)
        if not pg:
            continue
        title, url, _ = pg
        title = clean(title)
        out.append({"title": title, "url": url, "group": group_for(title)})
    return out


def parse_faq(slug):
    pg = read_page(slug, "faq-or-troubleshooting")
    if not pg:
        return [], ""
    _, url, body = pg
    qs = []
    for ln in body:
        c = clean(ln)
        if c.startswith("- ") and len(c) > 6:
            q = c[2:].strip()
            if q and not is_glossary(q) and q.lower() not in ("faq/troubleshooting",):
                qs.append(q)
    return qs, url


def parse_overview(slug):
    pg = read_page(slug)
    if not pg:
        return "", "", ""
    _, url, body = pg
    name = ""
    for ln in body:
        m = re.match(r"^#\s+(.*)$", ln)
        if m:
            name = clean(m.group(1)); break
    ps = paragraphs(body)
    intro = ""
    for p in ps:
        if len(p) > 80 and not p.lower().startswith("overview"):
            intro = trim(p, 500); break
    return name, intro, url


def build(node_id, slug):
    name, intro, ov_url = parse_overview(slug)
    ttk = parse_things_to_know(slug)
    diagrams = parse_diagrams(slug)
    tutorials = parse_tutorials(slug)
    faq, faq_url = parse_faq(slug)
    perm = read_page(slug, "permissions")
    rec = {
        "name": name or slug,
        "url": ov_url,
        "overview": intro,
        "thingsToKnow": ttk,
        "dataFlow": diagrams,
        "tutorials": tutorials,
        "faq": faq,
        "faqUrl": faq_url,
        "permissionsUrl": perm[1] if perm else "",
    }
    return rec


def main():
    if "--inspect" in sys.argv:
        nid = sys.argv[sys.argv.index("--inspect") + 1]
        rec = build(nid, SLUGS[nid])
        print("### %s  (%s)  name=%r" % (nid, SLUGS[nid], rec["name"]))
        print("url:", rec["url"])
        print("\noverview:", rec["overview"][:400])
        print("\nthingsToKnow (%d):" % len(rec["thingsToKnow"]))
        for t in rec["thingsToKnow"]:
            print("  - [%s] %s" % (t["item"], t["note"][:160]))
        print("\ndataFlow (%d):" % len(rec["dataFlow"]))
        for d in rec["dataFlow"]:
            print("  - %s: %s" % (d["title"], d["text"][:140]))
        print("\ntutorials (%d):" % len(rec["tutorials"]))
        for t in rec["tutorials"]:
            print("  - [%s] %s" % (t["group"], t["title"]))
        print("\nfaq (%d):" % len(rec["faq"]))
        for q in rec["faq"][:6]:
            print("  - " + q)
        return

    result = {"_generated": "by tools/build-sop-procore.py from the Procore V2 ERP support docs"}
    for node_id, slug in SLUGS.items():
        rec = build(node_id, slug)
        result[node_id] = rec
        print("%-22s name=%-24s ttk=%2d flow=%2d tut=%2d faq=%2d" % (
            node_id, rec["name"][:24], len(rec["thingsToKnow"]),
            len(rec["dataFlow"]), len(rec["tutorials"]), len(rec["faq"])))
    with io.open(OUT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, separators=(",", ":"))
    print("Wrote %s (%.0f KB)" % (OUT, os.path.getsize(OUT) / 1024.0))


if __name__ == "__main__":
    main()
