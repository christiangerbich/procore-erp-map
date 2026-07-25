# -*- coding: utf-8 -*-
"""Distill the local SmoothX (SmoothLink) knowledge-base corpus into
sop-smoothx.json — the data behind the manual-style corpus SOP Builder for
SmoothX connectors.

SmoothX's KB is category-based (Getting Started / Mapping / Settings / Guides /
Troubleshooting / FAQ), not per-object, so the corpus shape matches the
Procore-native one (overview / thingsToKnow / tutorials / faq) and reuses the
same render path in erp-map.js. Per connector we combine that connector's own
KB folder with a small curated set of connector-agnostic "General" guides.

Covers the SmoothX connectors that have KB docs. Acumatica (standalone), Zoho,
and Advanced Payments have no KB content and stay on the template SOP.

Usage:  python tools/build-sop-smoothx.py [--inspect <node-id>]
Reads:  ~/Documents/Procore MD Files/SmoothX/<Connector>/*.md
Writes: sop-smoothx.json  (committed; lazy-loaded by the SOP Builder)
"""
import io, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS = os.path.join(os.path.expanduser("~"), "Documents", "Procore MD Files", "SmoothX")
OUT = os.path.join(ROOT, "sop-smoothx.json")

# data.json SmoothX node id -> KB connector folder. Acumatica / Zoho /
# Advanced Payments have no KB folder -> omitted (template SOP).
FOLDERS = {
    "smoothx-xero": "Xero",
    "smoothx-qbo": "QuickBooks Online",
    "smoothx-qbd": "QuickBooks Desktop",
    "smoothx-myob": "MYOB",
    "smoothx-myob-acumatica": "MYOB Acumatica",
    "smoothx-proscan-plus": "ProScan",
    "smoothx-cost-plus": "Cost Plus",
}
ACCOUNTING = {"smoothx-xero", "smoothx-qbo", "smoothx-qbd", "smoothx-myob", "smoothx-myob-acumatica"}

# SmoothX KB articles are how-to focused (no marketing intro to scrape), so use
# a curated one-line overview per connector.
OVERVIEWS = {
    "smoothx-proscan-plus": "ProScan (by SmoothLink) is a Procore Marketplace app that captures supplier "
        "invoices via OCR and creates them as invoices/direct costs in Procore.",
    "smoothx-cost-plus": "Cost Plus (by SmoothLink) is a Procore Marketplace app for cost-plus / T&M "
        "client invoicing, generating head-contract progress claims from Procore project expenses.",
}
OVERVIEW_DEFAULT = ("SmoothX (by SmoothLink) is a Procore Marketplace integration that syncs financial "
                    "data — contacts, invoices/bills, commitments, cost codes and direct costs — "
                    "between Procore and {name}.")

# Curated connector-agnostic guides (by slug) pulled from the General folder for
# accounting connectors — genuinely applies to every accounting integration.
GENERIC_SLUGS = {
    "mapping-contacts", "mapping-projects", "mapping-employees", "mapping-employee-rates",
    "mapping-individual-account-codes", "project-specific-cost-codes-mapping",
    "update-project-cost-codes", "refresh-project-cost-codes",
    "settings-defaults", "how-to-set-defaults", "how-to-add-new-users",
    "getting-started-logging-in", "company-name-vs-display-name",
    "do-i-need-to-give-my-admin-access-for-procore", "do-i-need-to-turn-on-any-settings-in-procore",
    "does-the-integration-support-cost-type-tracking",
}

# Tool-group keyword map (SmoothX uses AU/NZ terms: Head Contract = Prime
# Contract, Progress Claim = invoice/pay app, Variation = change order).
GROUP_RULES = [
    ("directory",   r"contact|vendor|customer|compan(y|ies)|supplier"),
    ("primes",      r"head contract|prime|owner invoice|variation"),
    ("commitments", r"commitment|subcontract|purchase order|\bpo\b"),
    ("invoicing",   r"invoice|bill|progress claim|\bclaim\b|payment|retention|retainage|credit note"),
    ("budget",      r"budget|forecast|sov|schedule of values"),
    ("wbs",         r"cost code|account code|chart of accounts|cost type|item code"),
    ("projects",    r"sub ?job|sub-?customer|\bproject\b|\bjob\b"),
    ("directcosts", r"direct cost|payroll direct|job cost|expense"),
    ("timesheets",  r"timesheet|timecard|payroll hour|time entry|earning type"),
]

BREADCRUMB = re.compile(
    r"^(knowledge base|guides|settings|faqs?|mapping|troubleshooting|about|getting started|"
    r"dashboard|onboarding|videos?|home)$", re.I)
FAQ_START = re.compile(r"^(can|do|does|will|what|why|is|are|which|when|where|how (do|are|is|can|does|to i))\b", re.I)
MAX_NOTE = 600


def clean(s):
    s = str(s or "").replace("’", "'").replace("‘", "'")
    return re.sub(r"[​﻿]", "", s).strip()


def parse_file(path):
    raw = io.open(path, encoding="utf-8").read()
    lines = raw.split("\n")
    title = clean(lines[0].lstrip("# ")) if lines else ""
    url = slug = ""
    for ln in lines[:6]:
        if ln.startswith("Source: "):
            url = ln[8:].strip()
            slug = url.rstrip("/").split("/")[-1]
            break
    # body starts after the header block (title/Source/Fetched/Connector/blank)
    body = []
    started = False
    for ln in lines:
        if ln.startswith("Connector: "):
            started = True
            continue
        if started:
            body.append(ln)
    # first substantial paragraph, skipping breadcrumb bullets & the echoed title
    paras, buf = [], []
    for ln in body:
        c = clean(ln)
        if not c:
            if buf:
                paras.append(" ".join(buf)); buf = []
            continue
        b = c.lstrip("#-").strip()
        if BREADCRUMB.match(b) or b.lower() == title.lower() or (c.startswith("- ") and BREADCRUMB.match(b)):
            continue
        if c.startswith("#"):  # heading -> paragraph boundary, keep the heading text out of intro
            if buf:
                paras.append(" ".join(buf)); buf = []
            continue
        buf.append(c)
    if buf:
        paras.append(" ".join(buf))
    intro = ""
    for p in paras:  # prefer a real intro over a NOTE/IMPORTANT callout
        if len(p) > 55 and not re.match(r"^(note|important|tip|warning|caution)\b", p, re.I):
            intro = p; break
    if not intro:
        for p in paras:
            if len(p) > 55:
                intro = p; break
    intro = re.sub(r"\s+", " ", intro).strip()
    if len(intro) > MAX_NOTE:
        intro = intro[:MAX_NOTE].rsplit(" ", 1)[0] + " …"
    return {"title": title, "url": url, "slug": slug, "intro": intro,
            "chars": sum(len(p) for p in paras)}


def group_for(title):
    low = title.lower()
    for key, pat in GROUP_RULES:
        if re.search(pat, low):
            return key
    return None


def is_video(a):
    return "(video)" in a["title"].lower()


def is_faq(a):
    t = a["title"]
    return t.endswith("?") or t.endswith("-") or bool(FAQ_START.match(t))


def is_feature_map(a):
    return "feature map" in a["title"].lower()


def load_articles(node_id):
    folder = os.path.join(CORPUS, FOLDERS[node_id])
    arts = []
    if os.path.isdir(folder):
        for fn in sorted(os.listdir(folder)):
            if fn.endswith(".md"):
                arts.append(parse_file(os.path.join(folder, fn)))
    # pull curated generic guides for accounting connectors
    if node_id in ACCOUNTING:
        gdir = os.path.join(CORPUS, "General")
        if os.path.isdir(gdir):
            for fn in sorted(os.listdir(gdir)):
                if not fn.endswith(".md"):
                    continue
                a = parse_file(os.path.join(gdir, fn))
                if a["slug"] in GENERIC_SLUGS:
                    arts.append(a)
    return arts


def build(node_id):
    arts = load_articles(node_id)
    name = FOLDERS[node_id]
    overview, ov_url = "", ""
    thingsToKnow, tutorials, faq = [], [], []
    seen_faq = set()
    for a in arts:
        if is_feature_map(a):
            continue
        t = a["title"]
        low = t.lower()
        # keep the connecting/overview article URL for the doc's links section
        if not ov_url and re.search(r"\b(connecting|overview|onboarding|about)\b", low):
            ov_url = a["url"]
        if is_video(a):
            continue  # video pages carry almost no text
        # Settings / Mapping / requirements -> setup notes (Things to Know)
        if re.search(r"^(settings|mapping)\b|requirements?$|which .* fields", low) and a["intro"]:
            item = re.sub(r"^(settings|mapping)\s*[-–]\s*", "", t, flags=re.I).strip()
            thingsToKnow.append({"item": item[:70], "note": a["intro"]})
            continue
        if is_faq(a):
            key = t.rstrip("-? ").lower()
            if key not in seen_faq:
                seen_faq.add(key)
                faq.append(t.rstrip("-").strip() + ("" if t.endswith("?") else "?"))
            continue
        # everything else -> a guide/tutorial
        tutorials.append({"title": t, "url": a["url"], "group": group_for(t)})
    overview = OVERVIEWS.get(node_id, OVERVIEW_DEFAULT.format(name=name))
    return {
        "name": name, "url": ov_url, "overview": overview,
        "thingsToKnow": thingsToKnow, "dataFlow": [],
        "tutorials": tutorials, "faq": faq,
        "faqUrl": "https://support.smoothx.com/", "permissionsUrl": "",
    }


def main():
    if "--inspect" in sys.argv:
        nid = sys.argv[sys.argv.index("--inspect") + 1]
        r = build(nid)
        print("### %s  name=%s" % (nid, r["name"]))
        print("overview:", r["overview"][:300])
        print("\nthingsToKnow (%d):" % len(r["thingsToKnow"]))
        for t in r["thingsToKnow"]:
            print("  - [%s] %s" % (t["item"], t["note"][:140]))
        print("\ntutorials (%d):" % len(r["tutorials"]))
        for t in r["tutorials"]:
            print("  - [%s] %s" % (t["group"], t["title"]))
        print("\nfaq (%d):" % len(r["faq"]))
        for q in r["faq"]:
            print("  - " + q)
        return

    result = {"_generated": "by tools/build-sop-smoothx.py from the local SmoothX KB corpus"}
    for node_id in FOLDERS:
        r = build(node_id)
        result[node_id] = r
        print("%-26s name=%-20s ttk=%2d tut=%2d faq=%2d" % (
            node_id, r["name"], len(r["thingsToKnow"]), len(r["tutorials"]), len(r["faq"])))
    with io.open(OUT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, separators=(",", ":"))
    print("Wrote %s (%.0f KB)" % (OUT, os.path.getsize(OUT) / 1024.0))


if __name__ == "__main__":
    main()
