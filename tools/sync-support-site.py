# -*- coding: utf-8 -*-
"""Sync the whole v2.support.procore.com site to a local text corpus.

Sitemap-driven and delta-aware: the first run fetches everything; later runs
re-fetch only pages whose sitemap <lastmod> changed (or that previously
errored). Safe to interrupt at any point - progress is checkpointed to a
manifest and the next run resumes where it left off.

Politeness: robots.txt declares "Request-rate: 1/5" and "Crawl-delay: 5",
so the default delay is 5 seconds per request. /release-notes is disallowed
by robots.txt and is skipped. The User-Agent identifies this as an internal
Procore tool with a contact address.

Output (all local, never committed to the repo):
  ~/Documents/Procore MD Files/V2 Site/<bucket>/<slug>.md
  ~/Documents/Procore MD Files/V2 Site/_manifest.json

Usage:
  python tools/sync-support-site.py                # full sync / delta resume
  python tools/sync-support-site.py --limit 20     # test run, 20 pages
  python tools/sync-support-site.py --dry-run      # show pending work only
  python tools/sync-support-site.py --delay 5      # override politeness delay
"""
import argparse
import hashlib
import io
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.parse import urlparse

BASE = "https://v2.support.procore.com"
SITEMAP = BASE + "/sitemap.xml"
UA = "PNPT-KB-sync/1.0 (Procore internal; christian.gerbich@procore.com)"
OUT_ROOT = os.path.join(os.path.expanduser("~"), "Documents", "Procore MD Files", "V2 Site")
MANIFEST = os.path.join(OUT_ROOT, "_manifest.json")
SM_NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
DISALLOWED_PREFIXES = ("/release-notes",)  # per robots.txt


def fetch(url, timeout=30, retries=2):
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, b""
        except Exception as e:  # URLError, timeout, connection reset...
            last = e
            time.sleep(3 * (attempt + 1))
    return 0, ("ERR " + str(last)).encode()


def load_sitemap():
    """Return [(url, lastmod)] from the sitemap (recursing into indexes)."""
    status, body = fetch(SITEMAP)
    if status != 200:
        sys.exit("FATAL: sitemap fetch failed with status %s" % status)
    root = ET.fromstring(body)
    entries = []
    if root.tag == SM_NS + "sitemapindex":
        subs = [e.findtext(SM_NS + "loc") for e in root.findall(SM_NS + "sitemap")]
        for sub in subs:
            s2, b2 = fetch(sub)
            if s2 != 200:
                print("WARN: sub-sitemap %s -> %s" % (sub, s2))
                continue
            r2 = ET.fromstring(b2)
            for u in r2.findall(SM_NS + "url"):
                entries.append((u.findtext(SM_NS + "loc"), u.findtext(SM_NS + "lastmod") or ""))
    else:
        for u in root.findall(SM_NS + "url"):
            entries.append((u.findtext(SM_NS + "loc"), u.findtext(SM_NS + "lastmod") or ""))
    seen, out = set(), []
    for loc, lm in entries:
        if not loc or loc in seen:
            continue
        seen.add(loc)
        path = urlparse(loc).path or "/"
        if any(path.startswith(p) for p in DISALLOWED_PREFIXES):
            continue
        out.append((loc, lm))
    return out


class TextExtractor(HTMLParser):
    """Crude but dependable HTML -> readable text. Prefers <main> content;
    drops chrome (nav/header/footer/script/svg/forms)."""
    SKIP = {"script", "style", "noscript", "nav", "header", "footer", "svg",
            "iframe", "form", "button", "select", "option"}
    BLOCK = {"p", "div", "section", "article", "tr", "ul", "ol", "table",
             "blockquote", "pre", "br", "hr"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip_depth = 0
        self.main_depth = 0
        self.saw_main = False
        self.in_title = False
        self.title = ""

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self.in_title = True
        if tag in self.SKIP:
            self.skip_depth += 1
            return
        if tag == "main":
            self.saw_main = True
            self.main_depth += 1
            return
        if self.skip_depth:
            return
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.parts.append("\n\n" + "#" * int(tag[1]) + " ")
        elif tag == "li":
            self.parts.append("\n- ")
        elif tag in ("td", "th"):
            self.parts.append(" | ")
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        if tag in self.SKIP:
            self.skip_depth = max(0, self.skip_depth - 1)
            return
        if tag == "main":
            self.main_depth = max(0, self.main_depth - 1)
            return
        if self.skip_depth:
            return
        if tag in self.BLOCK or tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.parts.append("\n")

    def handle_data(self, data):
        if self.in_title and not self.title:
            self.title = data.strip()
        if self.skip_depth:
            return
        # If the page has <main>, only keep text inside it.
        if self.saw_main and not self.main_depth:
            return
        if data.strip():
            self.parts.append(re.sub(r"\s+", " ", data))


def html_to_text(body):
    p = TextExtractor()
    try:
        p.feed(body.decode("utf-8", "replace"))
    except Exception:
        pass
    text = "".join(p.parts)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" ?\n ?", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return p.title, text.strip()


# Category taxonomy — Procore product families. Rules are ordered: the first
# matching category wins, so the more specific families (ERP, BIM, Resource
# Management, Quality & Safety) are checked before the broad ones. Matched
# against the full lowercase URL path, which covers tool slugs
# (product-manuals/<tool>/...) and keyword-style FAQ slugs alike.
CATEGORY_RULES = [
    ("ERP & Integrations",
     r"erp|sage|intacct|viewpoint|vista|spectrum|quickbooks|acumatica|xero|"
     r"netsuite|yardi|\bmri\b|computerease|cmic|foundation-software|agave|ryvit|"
     r"integration|\bsynced\b|mulesoft"),
    ("BIM & Coordination",
     r"models?-(project|ios|android|company)|coordination-issue|clash|navisworks|"
     r"\bbim\b|revit"),
    ("Resource Management",
     r"resource-planning|resource-tracking|resource-management|timesheet|"
     r"timecard|time-clock|my-time|crew|equipment|tm-ticket|t-m-ticket|"
     r"workforce|field-productivity"),
    ("Quality & Safety",
     r"inspection|observation|incident|punch-list|punch_list|action-plan|"
     r"safety|swppp|permit"),
    ("Preconstruction",
     r"bidding|bid-board|bid-management|tender|estimat|takeoff|cost-catalog|"
     r"prequal|planroom|\bbids?\b|bid-room|bid-form|bid-submission"),
    ("Financials",
     r"portfolio-financials|procore-pay|payment|payor|payee|disburs|invoic|"
     r"billing|budget|prime-contract|commitment|change-event|change-order|"
     r"direct-cost|funding|client-contract|\bsov\b|cash-flow|forecast|"
     r"compliance-tab|lien|\bwbs\b|cost-code|custom-segment|cost-tracker|"
     r"financial"),
    ("Analytics & Reporting",
     r"analytic|report|360|dashboard|data-extract|insight|extract"),
    ("Project Management",
     r"drawing|submittal|\brfi\b|rfis|daily-log|photo|document|specification|"
     r"meeting|correspond|transmittal|email|schedule|task|home-project|"
     r"location|instruction|forms?-(project|ios|android|company)|"
     r"forms-offline|conversation|unearth|procore-maps?|punch|markup|"
     r"\bforms?\b|fillable|folder|upload-large-files"),
    ("Platform & Admin",
     r"admin|directory|permission|workflow|portfolio|login|account|password|"
     r"marketplace|procore-imports|procore-drive|mobile|android|\bios\b|"
     r"\bapi\b|sso|authentication|webhook|sandbox|project-overview|"
     r"language|two-factor|support|construction-network|web-app|template"),
]
_CATEGORY_RES = [(name, re.compile(pat)) for name, pat in CATEGORY_RULES]

def categorize(path):
    p = path.strip("/").lower()
    for name, rx in _CATEGORY_RES:
        if rx.search(p):
            return name
    return "General"

def bucket_for(path):
    # The slug keeps the FULL path (first segment included) so filenames are
    # globally unique — the same tool slug can exist under both
    # product-manuals/ and process-guides/, and category folders merge what
    # used to be separate bucket directories.
    path = path.strip("/")
    if not path:
        return categorize(path), "home"
    return categorize(path), path.replace("/", "__")


def safe_name(slug):
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", slug).strip("-")
    return (slug or "page")[:180] + ".md"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--delay", type=float, default=5.0, help="seconds between requests (robots.txt asks 5)")
    ap.add_argument("--limit", type=int, default=0, help="stop after N fetches (testing)")
    ap.add_argument("--dry-run", action="store_true", help="report pending work, fetch nothing")
    ap.add_argument("--force", action="store_true", help="refetch everything regardless of lastmod")
    args = ap.parse_args()

    os.makedirs(OUT_ROOT, exist_ok=True)
    manifest = {}
    if os.path.exists(MANIFEST):
        with io.open(MANIFEST, encoding="utf-8") as f:
            manifest = json.load(f)

    print("Loading sitemap...", flush=True)
    entries = load_sitemap()
    print("Sitemap URLs (after robots filter): %d | already in manifest: %d" % (len(entries), len(manifest)), flush=True)

    work = []
    for url, lastmod in entries:
        rec = manifest.get(url)
        if args.force or rec is None or rec.get("lastmod") != lastmod or rec.get("status") != 200:
            work.append((url, lastmod))
    print("Pending fetches: %d (unchanged-and-ok skipped: %d)" % (len(work), len(entries) - len(work)), flush=True)
    if args.dry_run:
        for u, _ in work[:20]:
            print("  would fetch:", u)
        return
    if not work:
        print("Corpus is up to date.")
        return

    eta_min = len(work) * args.delay / 60.0
    print("Politeness delay %.1fs -> worst-case ~%.0f min for this run." % (args.delay, eta_min), flush=True)

    done = errors = 0
    t0 = time.time()
    try:
        for i, (url, lastmod) in enumerate(work):
            if args.limit and done >= args.limit:
                break
            status, body = fetch(url)
            path = urlparse(url).path
            bucket, slug = bucket_for(path)
            rec = {"lastmod": lastmod, "status": status,
                   "fetched": datetime.now(timezone.utc).isoformat(timespec="seconds")}
            if status == 200:
                title, text = html_to_text(body)
                rel = os.path.join(bucket, safe_name(slug))
                full = os.path.join(OUT_ROOT, rel)
                os.makedirs(os.path.dirname(full), exist_ok=True)
                content = "# %s\n\nSource: %s\nFetched: %s\n\n%s\n" % (
                    title or slug, url, rec["fetched"], text)
                with io.open(full, "w", encoding="utf-8") as f:
                    f.write(content)
                rec["file"] = rel.replace("\\", "/")
                rec["sha1"] = hashlib.sha1(content.encode("utf-8")).hexdigest()
            else:
                errors += 1
            manifest[url] = rec
            done += 1
            if done % 20 == 0:
                with io.open(MANIFEST, "w", encoding="utf-8") as f:
                    json.dump(manifest, f, indent=0)
                rate = done / max(1.0, time.time() - t0)
                remaining = (len(work) - done) / max(rate, 1e-6) / 60.0
                print("[%d/%d] errors=%d  ~%.0f min left  (last: %s)" % (
                    done, len(work), errors, remaining, urlparse(url).path[:70]), flush=True)
            time.sleep(args.delay)
    finally:
        with io.open(MANIFEST, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=0)

    ok = sum(1 for r in manifest.values() if r.get("status") == 200)
    print("DONE this run: fetched=%d errors=%d | corpus pages ok=%d | elapsed %.1f min" % (
        done, errors, ok, (time.time() - t0) / 60.0), flush=True)
    print("Corpus: %s" % OUT_ROOT)


if __name__ == "__main__":
    main()
