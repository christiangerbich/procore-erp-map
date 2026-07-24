# -*- coding: utf-8 -*-
"""Distill the local Agave sync-docs corpus into sop-agave.json — the data
behind the corpus-based SOP Builder for Agave connectors.

For each supported ERP (Foundation first), every synced object's doc page is
parsed into verbatim sections:
  setup[]   — how-to / prerequisite / enablement sections
  configs[] — configuration topics & options
  errors[]  — FAQs and common error messages
plus general connector pages (Authentication, Cost Types, ...) and the
Known Limitations list. Text is the corpus's own words, trimmed — never
paraphrased — and every object carries its sync-docs URL.

Company/Project level tagging happens in the app (data.json module tiers).

Usage:  python tools/build-sop-agave.py
Reads:  ~/Documents/Procore MD Files/Agave/<folder>/
Writes: sop-agave.json (committed; lazy-loaded by the SOP Builder)
"""
import io, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS = os.path.join(os.path.expanduser("~"), "Documents", "Procore MD Files", "Agave")
OUT = os.path.join(ROOT, "sop-agave.json")

# Per-ERP: corpus folder + module-id -> page file, general pages, limitations.
ERPS = {
    "foundation": {
        "folder": "Procore and Foundation",
        "objects": {
            "vendors": "Vendors  Agave Sync.md",
            "employees": "Employees  Agave Sync.md",
            "cost-codes": "Cost Codes  Agave Sync.md",
            "project-wbs": "Sub Jobs (Phases)  Agave Sync.md",
            "jobs": "Projects (Jobs)  Agave Sync.md",
            "budgets": "Budget Line Items (Budgets)  Agave Sync.md",
            "budget-changes": "Budget Transfers  Agave Sync.md",
            "subcontracts": "Subcontracts  Agave Sync.md",
            "purchase-orders": "Purchase Orders  Agave Sync.md",
            "direct-costs": "Job Costs (Direct Costs)  Agave Sync.md",
            "sub-invoices": "AP Invoices  Agave Sync.md",
            "owner-invoices": "AR Invoices (Owner Invoices)  Agave Sync.md",
            "commitment-payments": "AP Payments  Agave Sync.md",
            "prime-contracts": "Prime Contracts  Agave Sync.md",
            "commitment-change-orders": "Subcontractor Change Orders  Agave Sync.md",
            "prime-contract-change-orders": "Prime Contract Change Orders  Agave Sync.md",
            "timecards": "Timecard Entries (Timesheets)  Agave Sync.md",
        },
        "general": [
            ("authentication", "Authentication  Agave Sync.md"),
            ("cost-types", "Cost Types (Cost Classes)  Agave Sync.md"),
            ("company-cost-codes", "Company Cost Codes  Agave Sync.md"),
            ("units-of-measure", "Units of Measure  Agave Sync.md"),
        ],
        "limitations": "Known Limitations  Agave Sync.md",
    },
}

MAX_TEXT = 700
SKIP_H2 = re.compile(r"^(visual mapping|video tutorial|video tutorials|demonstration)s?$", re.I)
# Setup = anchored how-to/enablement headings ("Exporting X…", "Enabling…",
# "Installation", prerequisites). Plain FAQ titles that merely mention "sync"
# stay configs/FAQs.
SETUP_RE = re.compile(
    r"(pre-?requisite|^(exporting|importing|syncing|enabling|setting up|set up|installation)\b|"
    r"^how to (export|import|sync|enable|set)|^(procore to|foundation to)\b)", re.I)
ERROR_RE = re.compile(r"(error|why (am|is|do|does|can)|fail|conflict|missing|invalid|cannot|troubleshoot|faq)", re.I)
# Container headings that should not become entries themselves.
CONTAINER_RE = re.compile(r"^(faqs?( and common errors?( messages)?)?|common errors?( and faqs?)?|configuration( & faqs?| options)?)$", re.I)


def clean(s):
    return re.sub(r"[​﻿]", "", str(s or "")).strip()


def parse_page(path):
    raw = io.open(path, encoding="utf-8").read()
    lines = raw.split("\n")
    title = clean(lines[0].lstrip("# ").strip()) if lines else ""
    url = ""
    for ln in lines[:6]:
        if ln.startswith("Source: "):
            url = ln[len("Source: "):].strip()
            break

    # Collect heading titles to strip the crawler's trailing TOC bullets.
    headings = set()
    for ln in lines:
        m = re.match(r"^(#{1,6})\s+(.*)$", ln)
        if m:
            headings.add(clean(m.group(2)).lower())

    # Split into (level, title, text) sections; intro = text before first ##.
    sections = []
    cur = None
    intro_lines = []
    for ln in lines[4:]:  # skip title/Source/Fetched
        m = re.match(r"^(#{2,6})\s+(.*)$", ln)
        if m:
            if cur:
                sections.append(cur)
            cur = {"level": len(m.group(1)), "t": clean(m.group(2)), "lines": []}
        elif cur:
            cur["lines"].append(ln)
        else:
            intro_lines.append(ln)
    if cur:
        sections.append(cur)

    def flatten(ls):
        out = []
        for ln in ls:
            c = clean(ln)
            if not c or c.lower() == "note":
                continue
            # drop TOC bullets that just repeat headings
            if c.startswith("- ") and c[2:].strip().lower() in headings:
                continue
            out.append(c)
        text = " ".join(out)
        text = re.sub(r"\s+", " ", text).strip()
        if len(text) > MAX_TEXT:
            text = text[:MAX_TEXT].rsplit(" ", 1)[0] + " …"
        return text

    intro = flatten(intro_lines)
    if len(intro) > 300:
        intro = intro[:300].rsplit(" ", 1)[0] + " …"

    setup, configs, errors = [], [], []
    # Only H2/H3 become entries; deeper headings (steps) fold into their parent.
    i = 0
    entries = []
    while i < len(sections):
        s = sections[i]
        if s["level"] <= 3:
            body = list(s["lines"])
            j = i + 1
            while j < len(sections) and sections[j]["level"] > s["level"]:
                body.append(sections[j]["t"])
                body.extend(sections[j]["lines"])
                j += 1
            entries.append({"t": s["t"], "x": flatten(body), "h2": s["level"] == 2})
            i += 1
        else:
            i += 1

    current_h2 = ""
    for e in entries:
        t = e["t"]
        if e["h2"]:
            current_h2 = t
            if SKIP_H2.match(t):
                continue
        if CONTAINER_RE.match(t):
            continue
        if not e["x"]:
            continue
        low = t.lower()
        if SETUP_RE.search(low):
            target = setup
        elif ERROR_RE.search(low):
            target = errors
        elif ERROR_RE.search(current_h2.lower()):
            # inside a FAQs/Common Errors block -> FAQ bucket
            target = errors
        else:
            target = configs
        target.append({"t": t, "x": e["x"]})

    return {"title": title, "url": url, "intro": intro,
            "setup": setup, "configs": configs, "errors": errors}


def parse_limitations(path):
    raw = io.open(path, encoding="utf-8").read()
    out = []
    for ln in raw.split("\n")[4:]:
        c = clean(ln)
        if c.startswith("- ") and len(c) > 8:
            item = c[2:].strip()
            if item.lower() in ("visual mapping", "known limitations"):
                continue
            out.append(item)
        elif c and not c.startswith("#") and len(c) > 40 and "sync" in c.lower():
            out.append(c)
    # de-dup preserving order
    seen = set()
    dedup = []
    for x in out:
        if x not in seen:
            seen.add(x)
            dedup.append(x)
    return dedup


result = {"_generated": "by tools/build-sop-agave.py from the local Agave sync-docs corpus"}
for erp_key, spec in ERPS.items():
    folder = os.path.join(CORPUS, spec["folder"])
    objects = {}
    for module_id, fname in spec["objects"].items():
        p = os.path.join(folder, fname)
        if not os.path.exists(p):
            print("  MISSING page for %s/%s: %s" % (erp_key, module_id, fname))
            continue
        objects[module_id] = parse_page(p)
    general = []
    for key, fname in spec["general"]:
        p = os.path.join(folder, fname)
        if not os.path.exists(p):
            print("  MISSING general page: %s" % fname)
            continue
        g = parse_page(p)
        g["key"] = key
        general.append(g)
    limitations = []
    lim_path = os.path.join(folder, spec["limitations"])
    if os.path.exists(lim_path):
        limitations = parse_limitations(lim_path)
    result[erp_key] = {"objects": objects, "general": general, "limitations": limitations}
    n_setup = sum(len(o["setup"]) for o in objects.values())
    n_cfg = sum(len(o["configs"]) for o in objects.values())
    n_err = sum(len(o["errors"]) for o in objects.values())
    print("%s: %d objects (%d setup / %d config / %d error entries), %d general pages, %d limitations" % (
        erp_key, len(objects), n_setup, n_cfg, n_err, len(general), len(limitations)))

with io.open(OUT, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, separators=(",", ":"))
print("Wrote %s (%.0f KB)" % (OUT, os.path.getsize(OUT) / 1024.0))
