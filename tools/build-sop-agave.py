# -*- coding: utf-8 -*-
"""Distill the local Agave sync-docs corpus into sop-agave.json — the data
behind the corpus-based SOP Builder for Agave connectors.

Every Agave ERP node in data.json is covered. For each ERP we read which
objects it syncs (data.json links), auto-resolve each object to its corpus
doc page by keyword rules (folder filenames vary per ERP), and parse each
page into verbatim sections:
  setup[]   — how-to / prerequisite / enablement sections
  configs[] — configuration topics & options
  errors[]  — FAQs and common error messages
plus general connector pages (Authentication, Cost Types, ...) and the
Known Limitations list. Text is the corpus's own words, trimmed — never
paraphrased — and every object carries its sync-docs URL.

Company/Project level tagging happens in the app (data.json module tiers).

Usage:  python tools/build-sop-agave.py [--dry-run]
          --dry-run  print the per-ERP object->file resolution table and exit
Reads:  data.json  (which objects each ERP syncs)
        ~/Documents/Procore MD Files/Agave/<folder>/
Writes: sop-agave.json (committed; lazy-loaded by the SOP Builder)
"""
import io, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS = os.path.join(os.path.expanduser("~"), "Documents", "Procore MD Files", "Agave")
OUT = os.path.join(ROOT, "sop-agave.json")
SUFFIX = "  Agave Sync.md"

# Agave ERP node id -> corpus folder. Folder names are irregular so map them.
FOLDERS = {
    "foundation": "Procore and Foundation",
    "computerease": "Procore and ComputerEase",
    "acumatica-agave": "Procore and Acumatica",
    "quickbooks-desktop-agave": "Procore and QuickBooks Desktop",
    "sage-100-agave": "Procore and Sage 100 Contractor",
    "sage-intacct-agave": "Procore and Sage Intacct",
    "viewpoint-spectrum-agave": "Procore and Spectrum",
    "viewpoint-vista-agave": "Procore and Vista",
}

# module-id -> ordered filename patterns (most specific first). First pattern
# that matches any (non-rejected) file in the folder wins; among files matching
# the same pattern the first alphabetically is taken. Matched against the
# filename with the "  Agave Sync.md" suffix stripped, case-insensitively.
RULES = {
    "vendors":                      [r"^Vendors\b"],
    "employees":                    [r"^Employees\b"],
    "cost-codes":                   [r"^Cost Codes\b", r"Cost Codes\b"],  # 2nd: Acumatica "Sub Jobs (...) and Cost Codes"
    "project-wbs":                  [r"^Sub Jobs\b"],
    "jobs":                         [r"^Projects\b"],
    "budgets":                      [r"^Budget Line Items\b"],
    "budget-changes":               [r"^Budget Transfers\b", r"^Budget Changes\b"],
    "subcontracts":                 [r"^Subcontracts\b"],
    "purchase-orders":              [r"^Purchase Orders$", r"^Purchase Orders \("],  # plain first, then Vista "(Commitments)"
    "direct-costs":                 [r"^Job Costs \(Direct Costs\)", r"^Job Costs\b"],
    "sub-invoices":                 [r"^AP Invoices\b"],
    "owner-invoices":               [r"^AR Invoices\b"],
    "commitment-payments":          [r"^AP Payments\b"],
    "prime-contract-payments":      [r"^AR Payments\b"],
    "prime-contracts":              [r"^Prime Contracts\b"],
    "prime-contract-change-orders": [r"^Prime Contract Change Orders\b", r"^Prime Change Orders\b", r"^Change Orders\b"],
    "commitment-change-orders":     [r"Subcontractor Change Orders\b", r"^Change Orders\b"],
    "timecards":                    [r"^Timecard Entries\b"],
}
REJECT = {
    "cost-codes":               [r"Company Cost Codes", r"Inactive Cost Code"],
    "commitment-change-orders": [r"^Prime\b"],
}
# General connector pages: (key, pattern). Included when present in the folder.
GENERAL_CANDIDATES = [
    ("authentication",     r"Authentication\b"),
    ("cost-types",         r"^Cost Types\b"),
    ("company-cost-codes", r"^Company Cost Codes\b"),
    ("units-of-measure",   r"^Units of Measure\b"),
    ("tax-codes",          r"^Tax Codes\b"),
    ("departments",        r"^Departments\b"),
]
LIMITATIONS_PAT = r"^Known Limitations\b"


def base(fname):
    return fname[:-len(SUFFIX)] if fname.endswith(SUFFIX) else re.sub(r"\.md$", "", fname)


def resolve(patterns, files, reject=()):
    """First file matching the highest-priority pattern and no reject pattern."""
    rej = [re.compile(r, re.I) for r in reject]
    for pat in patterns:
        rx = re.compile(pat, re.I)
        for f in sorted(files):
            b = base(f)
            if rx.search(b) and not any(r.search(b) for r in rej):
                return f
    return None


def synced_modules():
    d = json.load(io.open(os.path.join(ROOT, "data.json"), encoding="utf-8"))
    agave = {n["id"] for n in d["nodes"] if n.get("via") == "agave"}
    by = {}
    for l in d["links"]:
        if l["source"] in agave:
            by.setdefault(l["source"], set()).add(l["target"])
    return by


MAX_TEXT = 700
SKIP_H2 = re.compile(r"^(visual mapping|video tutorial|video tutorials|demonstration)s?$", re.I)
# Setup = anchored how-to/enablement headings ("Exporting X…", "Enabling…",
# "Installation", prerequisites). Anchored at start so FAQ questions that merely
# contain "sync to Procore" stay in the errors/FAQ bucket. "procore to X" catches
# the reverse-direction section header used across the connector docs.
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


def build_spec(erp_key, module_ids, files):
    """Resolve objects/general/limitations filenames for one ERP."""
    objects, unresolved = {}, []
    for mid in sorted(module_ids):
        if mid not in RULES:
            unresolved.append((mid, "(no rule)"))
            continue
        f = resolve(RULES[mid], files, REJECT.get(mid, ()))
        if f:
            objects[mid] = f
        else:
            unresolved.append((mid, "(no file)"))
    general = []
    for key, pat in GENERAL_CANDIDATES:
        f = resolve([pat], files)
        if f:
            general.append((key, f))
    lim = resolve([LIMITATIONS_PAT], files)
    return objects, general, lim, unresolved


def main():
    dry = "--dry-run" in sys.argv
    by_module = synced_modules()

    result = {"_generated": "by tools/build-sop-agave.py from the local Agave sync-docs corpus"}
    any_unresolved = False
    for erp_key, folder_name in FOLDERS.items():
        folder = os.path.join(CORPUS, folder_name)
        if not os.path.isdir(folder):
            print("  MISSING folder for %s: %s" % (erp_key, folder))
            continue
        files = [f for f in os.listdir(folder) if f.lower().endswith(".md")]
        module_ids = by_module.get(erp_key, set())
        objects_map, general_map, lim_file, unresolved = build_spec(erp_key, module_ids, files)

        if dry:
            print("\n=== %s  (%s)  [%d synced objects] ===" % (erp_key, folder_name, len(module_ids)))
            for mid in sorted(objects_map):
                print("  %-30s -> %s" % (mid, base(objects_map[mid])))
            for mid, why in unresolved:
                any_unresolved = True
                print("  %-30s -> !! UNRESOLVED %s" % (mid, why))
            print("  general: %s" % ", ".join("%s=%s" % (k, base(f)) for k, f in general_map))
            print("  limitations: %s" % (base(lim_file) if lim_file else "(none)"))
            continue

        objects = {}
        for mid, fname in objects_map.items():
            objects[mid] = parse_page(os.path.join(folder, fname))
        general = []
        for key, fname in general_map:
            g = parse_page(os.path.join(folder, fname))
            g["key"] = key
            general.append(g)
        limitations = parse_limitations(os.path.join(folder, lim_file)) if lim_file else []
        result[erp_key] = {"objects": objects, "general": general, "limitations": limitations}
        n_setup = sum(len(o["setup"]) for o in objects.values())
        n_cfg = sum(len(o["configs"]) for o in objects.values())
        n_err = sum(len(o["errors"]) for o in objects.values())
        flag = "  [%d UNRESOLVED]" % len(unresolved) if unresolved else ""
        print("%-26s %2d objects (%d setup / %d config / %d error), %d general, %d limitations%s" % (
            erp_key, len(objects), n_setup, n_cfg, n_err, len(general), len(limitations), flag))
        for mid, why in unresolved:
            print("    UNRESOLVED %s %s" % (mid, why))

    if dry:
        print("\n%s" % ("!! some objects unresolved — add rules/overrides" if any_unresolved else "all objects resolved"))
        return

    with io.open(OUT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, separators=(",", ":"))
    print("Wrote %s (%.0f KB)" % (OUT, os.path.getsize(OUT) / 1024.0))


if __name__ == "__main__":
    main()
