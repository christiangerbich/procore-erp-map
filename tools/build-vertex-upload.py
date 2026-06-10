# -*- coding: utf-8 -*-
"""Build a clean, upload-ready folder for Vertex AI Search from the local
support corpora. Strips base64 images / markdown clutter, flattens into one
folder with descriptive filenames, and writes plain-text (.txt) files (the
format Vertex AI Search indexes most reliably).

Sources: Agave (sync-docs.agaveapi.com scrape) plus the FULL
v2.support.procore.com crawl ("V2 Site", built by tools/sync-support-site.py)
when it exists. The full-site crawl supersedes the older partial "Procore ERP"
folder — using both would double-index the ERP docs — so "Procore ERP" is only
used as a fallback when "V2 Site" hasn't been built yet."""
import os, re, sys

HOME = os.path.expanduser("~")
BASE = os.path.join(HOME, "Documents", "Procore MD Files")
V2_SITE = os.path.join(BASE, "V2 Site")
SOURCES = [("Agave", os.path.join(BASE, "Agave"))]
if os.path.isdir(V2_SITE):
    SOURCES.append(("Procore Support", V2_SITE))
else:
    SOURCES.append(("Procore ERP", os.path.join(BASE, "Procore ERP")))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HOME, "Documents", "vertex-upload")

def clean(text):
    text = re.sub(r'data:image/[^)\s"]+', '', text)        # base64 data URIs
    text = re.sub(r'!\[[^\]]*\]\([^)]*\)', '', text)        # markdown images
    text = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', text)    # markdown links -> link text
    text = text.replace('​', '')                       # zero-width spaces
    text = re.sub(r'"Direct link to[^"]*"', '', text)
    text = re.sub(r'<[^>]+>', ' ', text)                    # stray html / iframes
    text = re.sub(r'^#{1,6}\s*', '', text, flags=re.M)      # heading markers -> plain lines
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n[ \t]*\n[ \t]*\n+', '\n\n', text)     # collapse blank runs
    lines = [ln.rstrip() for ln in text.split('\n')]
    return '\n'.join(lines).strip()

def sanitize(name):
    name = re.sub(r'\s+Agave Sync$', '', name)              # drop trailing " Agave Sync"
    name = name.replace('/', '-').replace('\\', '-')
    name = re.sub(r'\s{2,}', ' ', name).strip()
    return name

if not os.path.isdir(OUT):
    os.makedirs(OUT)

written = 0
skipped = 0
total_bytes = 0
for label, root in SOURCES:
    if not os.path.isdir(root):
        print("WARNING: source not found:", root)
        continue
    for dirpath, _, files in os.walk(root):
        for f in sorted(files):
            if not f.lower().endswith('.md'):
                continue
            src = os.path.join(dirpath, f)
            body = clean(open(src, encoding='utf-8', errors='ignore').read())
            if len(body) < 40:
                skipped += 1
                continue
            # Build a descriptive flat filename: "<label> - <subfolder> - <file>.txt"
            rel = os.path.relpath(src, root)
            parts = [p for p in rel.replace('\\', '/').split('/')]
            fname = re.sub(r'\.md$', '', parts[-1])
            sub = parts[-2] if len(parts) > 1 else ''
            sub = re.sub(r'^Procore and ', '', sub)         # "Procore and Foundation" -> "Foundation"
            stem = " - ".join([p for p in [label, sub, fname] if p])
            out_name = sanitize(stem)[:180] + ".txt"
            # de-dupe collisions
            dest = os.path.join(OUT, out_name)
            n = 2
            while os.path.exists(dest):
                dest = os.path.join(OUT, sanitize(stem)[:176] + " (" + str(n) + ").txt")
                n += 1
            # Prepend the title so the topic is explicit in the indexed text.
            header = sanitize(stem).replace(" - ", " — ")
            content = header + "\n\n" + body + "\n"
            open(dest, 'w', encoding='utf-8').write(content)
            written += 1
            total_bytes += len(content.encode('utf-8'))

print("Wrote {0} files to {1}".format(written, OUT))
print("Skipped {0} (empty after cleaning)".format(skipped))
print("Total size: {0:.1f} MB".format(total_bytes / 1024 / 1024))
# safety check: any base64 left?
import glob
leftover = 0
for p in glob.glob(os.path.join(OUT, "*.txt")):
    if 'data:image' in open(p, encoding='utf-8', errors='ignore').read():
        leftover += 1
print("Files still containing base64:", leftover)
