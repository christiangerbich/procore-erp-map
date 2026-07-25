# -*- coding: utf-8 -*-
"""Sync SmoothX's (SmoothLink) Procore integration knowledge base
(support.smoothx.com) to a local corpus. Sitemap-driven, delta-aware via a
manifest, resumable — mirrors tools/sync-agave-docs.py.

SmoothX documents several Procore connectors + add-on products. Each article is
foldered by the connector it applies to (Xero / QuickBooks Online / QuickBooks
Desktop / MYOB / MYOB Acumatica / ProScan / Cost Plus / Extractus / Acumatica /
Zoho), or "General" when connector-agnostic. Feature-map pages are images and
carry little text; the value is in the textual Getting-Started / Mapping /
Settings / Guides / Troubleshooting / FAQ articles.

Output (local only, never committed):
  ~/Documents/Procore MD Files/SmoothX/<Connector>/<Title>  SmoothX.md
  ~/Documents/Procore MD Files/SmoothX/_manifest.json

Usage:
  python tools/sync-smoothx-docs.py               # full sync / delta resume
  python tools/sync-smoothx-docs.py --limit 3     # test run
  python tools/sync-smoothx-docs.py --dry-run     # list pending work
"""
import argparse, hashlib, io, json, os, re, sys, time
import urllib.request, urllib.error
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from urllib.parse import urlparse
from html.parser import HTMLParser

BASE = "https://support.smoothx.com"
SITEMAP = BASE + "/sitemap.xml"
UA = "PNPT-KB-sync/1.0 (Procore internal; christian.gerbich@procore.com)"
OUT_ROOT = os.path.join(os.path.expanduser("~"), "Documents", "Procore MD Files", "SmoothX")
MANIFEST = os.path.join(OUT_ROOT, "_manifest.json")
SM_NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"

# Connector classification by slug keyword (order matters — most specific first).
CONNECTOR_RULES = [
    ("MYOB Acumatica",     r"myob-acumatica"),
    ("MYOB",               r"\bmyob\b|-myob\b|myob-"),
    ("QuickBooks Desktop", r"quickbooks-desktop|\bqbd\b|desktop"),
    ("QuickBooks Online",  r"\bqbo\b|quickbooks-online|quickbooks|-qbo\b"),
    ("Xero",               r"\bxero\b|-xero\b|xero-"),
    ("ProScan",            r"proscan"),
    ("Cost Plus",          r"cost-plus"),
    ("Extractus",          r"extractus"),
    ("Acumatica",          r"acumatica"),
    ("Zoho",               r"zoho"),
]


def fetch(url, timeout=30, retries=2):
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, b""
        except Exception as e:
            last = e
            time.sleep(3 * (attempt + 1))
    return 0, ("ERR " + str(last)).encode()


def load_sitemap():
    status, body = fetch(SITEMAP)
    if status != 200:
        sys.exit("FATAL: sitemap fetch failed with status %s" % status)
    root = ET.fromstring(body)
    out, seen = [], set()
    for u in root.findall(SM_NS + "url"):
        loc = u.findtext(SM_NS + "loc")
        lm = u.findtext(SM_NS + "lastmod") or ""
        if not loc or loc in seen:
            continue
        seen.add(loc)
        slug = urlparse(loc).path.strip("/")
        # skip the KB chrome pages
        if not slug or slug in ("kb-search-results", "kb-404", "contact-us-register"):
            continue
        out.append((loc, lm))
    return out


class TextExtractor(HTMLParser):
    """HTML -> readable text. Emits inside the article content container
    (<main>, <article>, or a div/section whose class hints 'content'/'article');
    falls back to non-chrome body text. Captures the document <title>."""
    SKIP = {"script", "style", "noscript", "nav", "header", "footer", "svg",
            "iframe", "form", "button", "select", "option", "aside"}
    BLOCK = {"p", "div", "section", "article", "tr", "ul", "ol", "table",
             "blockquote", "pre", "br", "hr"}
    CONTENT_HINT = re.compile(r"(article|content|kb-|post-body|doc-body|main)", re.I)

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.fallback = []
        self.skip_depth = 0
        self.content_depth = 0
        self.content_stack = []  # track tag depth where content started
        self.depth = 0
        self.in_title = False
        self.in_head = False
        self.title = ""

    def _emit(self, s):
        if self.content_depth > 0:
            self.parts.append(s)
        elif not self.in_head:
            self.fallback.append(s)

    def handle_starttag(self, tag, attrs):
        self.depth += 1
        if tag == "title":
            self.in_title = True
            return
        if tag == "head":
            self.in_head = True
            return
        if tag in self.SKIP:
            self.skip_depth += 1
            return
        if tag in ("main", "article"):
            self.content_depth += 1
            self.content_stack.append(self.depth)
            return
        if tag in ("div", "section") and self.content_depth == 0:
            cls = dict(attrs).get("class", "") or ""
            idv = dict(attrs).get("id", "") or ""
            if self.CONTENT_HINT.search(cls) or self.CONTENT_HINT.search(idv):
                self.content_depth += 1
                self.content_stack.append(self.depth)
                return
        if self.skip_depth:
            return
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self._emit("\n\n" + "#" * int(tag[1]) + " ")
        elif tag == "li":
            self._emit("\n- ")
        elif tag in ("td", "th"):
            self._emit(" | ")
        elif tag in self.BLOCK:
            self._emit("\n")

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        elif tag == "head":
            self.in_head = False
        elif tag in self.SKIP:
            self.skip_depth = max(0, self.skip_depth - 1)
        elif tag in self.BLOCK or tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            if not self.skip_depth:
                self._emit("\n")
        # close content container if we're leaving the tag that opened it
        if self.content_stack and self.depth == self.content_stack[-1]:
            self.content_stack.pop()
            self.content_depth = max(0, self.content_depth - 1)
        self.depth = max(0, self.depth - 1)

    def handle_data(self, data):
        if self.in_title:
            self.title += data
            return
        if self.skip_depth:
            return
        if data.strip():
            self._emit(re.sub(r"\s+", " ", data))


def html_to_text(body):
    p = TextExtractor()
    try:
        p.feed(body.decode("utf-8", "replace"))
    except Exception:
        pass
    text = "".join(p.parts) if len("".join(p.parts).strip()) > 40 else "".join(p.fallback)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" ?\n ?", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    title = re.sub(r"\s+", " ", p.title).strip()
    for suf in (" - Knowledge Base - Smoothx", " - Knowledge Base - SmoothX",
                " - Knowledge Base", " - Smoothx", " - SmoothX", " | Smoothx"):
        if title.endswith(suf):
            title = title[: -len(suf)].strip()
            break
    return title, text.strip()


def connector_for(slug):
    low = slug.lower()
    for name, pat in CONNECTOR_RULES:
        if re.search(pat, low):
            return name
    return "General"


def safe_name(title, slug):
    base = (title or slug or "page").strip()
    base = re.sub(r"[\\/:*?\"<>|]+", "-", base).strip()
    return (base + "  SmoothX")[:170] + ".md"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--delay", type=float, default=1.0)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    os.makedirs(OUT_ROOT, exist_ok=True)
    manifest = {}
    if os.path.exists(MANIFEST):
        with io.open(MANIFEST, encoding="utf-8") as f:
            manifest = json.load(f)

    print("Loading sitemap...", flush=True)
    entries = load_sitemap()
    print("KB URLs: %d | already in manifest: %d" % (len(entries), len(manifest)), flush=True)

    work = [(u, lm) for u, lm in entries
            if args.force or manifest.get(u) is None
            or manifest[u].get("lastmod") != lm or manifest[u].get("status") != 200]
    print("Pending fetches: %d" % len(work), flush=True)
    if args.dry_run:
        from collections import Counter
        c = Counter(connector_for(urlparse(u).path.strip("/")) for u, _ in entries)
        for name, n in c.most_common():
            print("  %-20s %d" % (name, n))
        return
    if not work:
        print("SmoothX corpus is up to date.")
        return

    done = errors = 0
    t0 = time.time()
    try:
        for url, lastmod in work:
            if args.limit and done >= args.limit:
                break
            status, body = fetch(url)
            rec = {"lastmod": lastmod, "status": status,
                   "fetched": datetime.now(timezone.utc).isoformat(timespec="seconds")}
            if status == 200:
                title, text = html_to_text(body)
                slug = urlparse(url).path.rstrip("/").split("/")[-1]
                folder = connector_for(slug)
                rel = os.path.join(folder, safe_name(title, slug))
                full = os.path.join(OUT_ROOT, rel)
                os.makedirs(os.path.dirname(full), exist_ok=True)
                content = "# %s\n\nSource: %s\nFetched: %s\nConnector: %s\n\n%s\n" % (
                    title or slug, url, rec["fetched"], folder, text)
                with io.open(full, "w", encoding="utf-8") as f:
                    f.write(content)
                rec["file"] = rel.replace("\\", "/")
                rec["connector"] = folder
                rec["sha1"] = hashlib.sha1(content.encode("utf-8")).hexdigest()
                rec["chars"] = len(text)
            else:
                errors += 1
            manifest[url] = rec
            done += 1
            if done % 20 == 0:
                with io.open(MANIFEST, "w", encoding="utf-8") as f:
                    json.dump(manifest, f, indent=0)
                rate = done / max(1.0, time.time() - t0)
                print("[%d/%d] errors=%d ~%.0f min left" % (
                    done, len(work), errors, (len(work) - done) / max(rate, 1e-6) / 60.0), flush=True)
            time.sleep(args.delay)
    finally:
        with io.open(MANIFEST, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=0)

    ok = sum(1 for r in manifest.values() if r.get("status") == 200)
    print("DONE: fetched=%d errors=%d | corpus pages ok=%d | %.1f min" % (
        done, errors, ok, (time.time() - t0) / 60.0), flush=True)
    print("Corpus: %s" % OUT_ROOT)


if __name__ == "__main__":
    main()
