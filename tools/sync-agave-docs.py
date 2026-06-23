# -*- coding: utf-8 -*-
"""Sync Agave's Procore sync-docs (sync-docs.agaveapi.com) to the local Agave
corpus. Mirrors tools/sync-support-site.py: sitemap-driven, delta-aware via a
manifest, resumable. Only the /docs/procore* pages are fetched (the Procore
integration docs: per-ERP object field mappings, configs, filters, limitations,
troubleshooting, FAQs).

Output (local only, never committed):
  ~/Documents/Procore MD Files/Agave/<folder>/<Title>  Agave Sync.md
  ~/Documents/Procore MD Files/Agave/_manifest.json

Usage:
  python tools/sync-agave-docs.py               # full sync / delta resume
  python tools/sync-agave-docs.py --limit 3     # test run
  python tools/sync-agave-docs.py --dry-run     # list pending work
  python tools/sync-agave-docs.py --orphans     # list local files not on the live site
"""
import argparse, hashlib, io, json, os, re, sys, time
import urllib.request, urllib.error
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.parse import urlparse

BASE = "https://sync-docs.agaveapi.com"
SITEMAP = BASE + "/sitemap.xml"
UA = "PNPT-KB-sync/1.0 (Procore internal; christian.gerbich@procore.com)"
OUT_ROOT = os.path.join(os.path.expanduser("~"), "Documents", "Procore MD Files", "Agave")
MANIFEST = os.path.join(OUT_ROOT, "_manifest.json")
SM_NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"

ERP_NAMES = {
    "acumatica": "Acumatica", "computerease": "ComputerEase", "foundation": "Foundation",
    "quickbooks-desktop": "QuickBooks Desktop", "sage-100-contractor": "Sage 100 Contractor",
    "sage-intacct": "Sage Intacct", "spectrum": "Spectrum", "vista": "Vista",
}


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
        if "/docs/procore" not in loc:
            continue
        out.append((loc, lm))
    return out


class TextExtractor(HTMLParser):
    """HTML -> readable text. Emits only inside <main> (Docusaurus article body);
    falls back to all non-chrome body text if the page has no <main>. Captures the
    document <title> (page name lives there; the visible <h1> is inside a skipped
    <header>)."""
    SKIP = {"script", "style", "noscript", "nav", "header", "footer", "svg",
            "iframe", "form", "button", "select", "option"}
    BLOCK = {"p", "div", "section", "article", "tr", "ul", "ol", "table",
             "blockquote", "pre", "br", "hr"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.fallback = []
        self.skip_depth = 0
        self.main_depth = 0
        self.in_title = False
        self.in_head = False
        self.title = ""

    def _emit(self, s):
        if self.main_depth > 0:
            self.parts.append(s)
        elif not self.in_head:
            self.fallback.append(s)

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self.in_title = True
            return
        if tag == "head":
            self.in_head = True
            return
        if tag in self.SKIP:
            self.skip_depth += 1
            return
        if tag == "main":
            self.main_depth += 1
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
            return
        if tag == "head":
            self.in_head = False
            return
        if tag in self.SKIP:
            self.skip_depth = max(0, self.skip_depth - 1)
            return
        if tag == "main":
            self.main_depth = max(0, self.main_depth - 1)
            return
        if self.skip_depth:
            return
        if tag in self.BLOCK or tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self._emit("\n")

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
    text = "".join(p.parts) if p.parts else "".join(p.fallback)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" ?\n ?", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    title = re.sub(r"\s+", " ", p.title).strip()
    for suf in (" | Agave Sync", "| Agave Sync", " - Agave Sync", " | Agave"):
        if title.endswith(suf):
            title = title[: -len(suf)].strip()
            break
    return title, text.strip()


def titleize(seg):
    return " ".join(w.upper() if w.lower() in ("faqs", "ap", "ar") else w.capitalize()
                     for w in seg.split("-"))


def folder_for(path):
    seg = path.strip("/").split("/")[1] if path.strip("/").count("/") >= 1 else path.strip("/").split("/")[-1]
    # path is /docs/<seg>/<page...>  ->  seg is the integration / section
    parts = path.strip("/").split("/")
    seg = parts[1] if len(parts) > 1 else parts[0]
    if seg == "procore":
        return "Procore & Basics"
    if seg.startswith("procore-and-"):
        erp = seg[len("procore-and-"):]
        return "Procore and " + ERP_NAMES.get(erp, titleize(erp))
    if seg == "procore-basics":
        return "Procore & Basics"
    return "Procore - " + titleize(seg[len("procore-"):]) if seg.startswith("procore-") else "Procore - General"


def safe_name(title, slug):
    base = (title or slug or "page").strip()
    base = re.sub(r"[\\/:*?\"<>|]+", "-", base).strip()
    return (base + "  Agave Sync")[:170] + ".md"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--delay", type=float, default=1.0)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--orphans", action="store_true", help="list local .md not written by the latest crawl")
    args = ap.parse_args()

    os.makedirs(OUT_ROOT, exist_ok=True)
    manifest = {}
    if os.path.exists(MANIFEST):
        with io.open(MANIFEST, encoding="utf-8") as f:
            manifest = json.load(f)

    if args.orphans:
        written = {r["file"] for r in manifest.values() if r.get("file")}
        for dirpath, _, files in os.walk(OUT_ROOT):
            for fn in files:
                if not fn.endswith(".md"):
                    continue
                rel = os.path.relpath(os.path.join(dirpath, fn), OUT_ROOT).replace("\\", "/")
                if rel not in written:
                    print("ORPHAN", rel)
        return

    print("Loading sitemap...", flush=True)
    entries = load_sitemap()
    print("Procore doc URLs: %d | already in manifest: %d" % (len(entries), len(manifest)), flush=True)

    work = [(u, lm) for u, lm in entries
            if args.force or manifest.get(u) is None
            or manifest[u].get("lastmod") != lm or manifest[u].get("status") != 200]
    print("Pending fetches: %d" % len(work), flush=True)
    if args.dry_run:
        for u, _ in work[:30]:
            print("  would fetch:", u)
        return
    if not work:
        print("Agave corpus is up to date.")
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
                folder = folder_for(urlparse(url).path)
                rel = os.path.join(folder, safe_name(title, slug))
                full = os.path.join(OUT_ROOT, rel)
                os.makedirs(os.path.dirname(full), exist_ok=True)
                content = "# %s\n\nSource: %s\nFetched: %s\n\n%s\n" % (title or slug, url, rec["fetched"], text)
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
                print("[%d/%d] errors=%d ~%.0f min left (%s)" % (
                    done, len(work), errors, (len(work) - done) / max(rate, 1e-6) / 60.0,
                    urlparse(url).path[:64]), flush=True)
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
