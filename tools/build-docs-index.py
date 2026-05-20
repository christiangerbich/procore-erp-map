# -*- coding: utf-8 -*-
"""Build docs-index.json for the in-page finder from the Procore ERP support
docs corpus. Run from the repo root; point SRC at the local 'Procore ERP'
folder. Strips base64 images / markdown clutter and chunks by heading so the
finder can surface specific passages. The full Procore product corpus
(All Tools / FIN / EST) intentionally stays out of the client-side index and
is served by Vertex AI Search instead."""
import os, re, json, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.expanduser("~"), "Documents", "Procore MD Files", "Procore ERP")
OUT = sys.argv[2] if len(sys.argv) > 2 else "docs-index.json"

def clean(text):
    text = re.sub(r'data:image/[^)\s"]+', '', text)        # base64 data URIs
    text = re.sub(r'!\[[^\]]*\]\([^)]*\)', '', text)        # markdown images
    text = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', text)    # markdown links -> text
    text = text.replace('​', '')                       # zero-width spaces
    text = re.sub(r'"Direct link to[^"]*"', '', text)
    text = re.sub(r'<[^>]+>', ' ', text)                    # stray html
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()

def nice_title(relpath):
    parts = relpath.replace(os.sep, '/').split('/')
    fname = re.sub(r'\.md$', '', parts[-1])
    fname = re.sub(r'[-_]+', ' ', fname).strip()
    fname = re.sub(r'\berp\b', 'ERP', fname, flags=re.I)
    fname = fname[:1].upper() + fname[1:]
    section = ''
    if len(parts) > 1:
        folder = parts[-2].lower()
        if 'faq' in folder:
            section = 'FAQ'
        elif 'tutorial' in folder:
            section = 'Tutorial'
    return (fname + (' — ' + section if section else '')).strip()

def window(text, size=750):
    sents = re.split(r'(?<=[.!?])\s+', text)
    chunks, cur = [], ''
    for s in sents:
        if len(cur) + len(s) + 1 > size and cur:
            chunks.append(cur.strip())
            cur = ''
        cur += (' ' if cur else '') + s
    if cur.strip():
        chunks.append(cur.strip())
    return chunks

docs = []
cid = 0
for root, _, files in os.walk(SRC):
    for f in sorted(files):
        if not f.lower().endswith('.md'):
            continue
        rel = os.path.relpath(os.path.join(root, f), SRC)
        raw = clean(open(os.path.join(root, f), encoding='utf-8', errors='ignore').read())
        if not raw:
            continue
        title = nice_title(rel)
        sections = re.split(r'\n(?=#{1,4}\s)', raw)
        for sec in sections:
            m = re.match(r'#{1,4}\s+(.*)', sec)
            heading = clean(m.group(1)) if m else ''
            body = clean(re.sub(r'^#{1,4}\s+.*', '', sec, count=1)) if m else sec
            if not body or len(body) < 40:
                continue
            for chunk in window(body):
                if len(chunk) < 40:
                    continue
                docs.append({"id": "d" + str(cid), "title": title, "heading": heading, "text": chunk})
                cid += 1

json.dump(docs, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
size = os.path.getsize(OUT)
print("Wrote {0}: {1} chunks, {2} bytes ({3:.0f} KB)".format(OUT, len(docs), size, size / 1024))
