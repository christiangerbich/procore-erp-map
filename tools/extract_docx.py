# -*- coding: utf-8 -*-
"""Extract readable text + tables from a .docx using only stdlib, preserving
document order (paragraphs and tables interleaved)."""
import sys, zipfile, re
import xml.etree.ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

def para_text(p):
    return "".join(t.text or "" for t in p.iter(W + "t")).strip()

def para_style(p):
    pPr = p.find(W + "pPr")
    if pPr is not None:
        ps = pPr.find(W + "pStyle")
        if ps is not None:
            return ps.get(W + "val", "")
    return ""

def walk(path):
    z = zipfile.ZipFile(path)
    xml = z.read("word/document.xml")
    root = ET.fromstring(xml)
    body = root.find(W + "body")
    out = []
    for el in body:
        tag = el.tag.replace(W, "")
        if tag == "p":
            txt = para_text(el)
            if txt:
                style = para_style(el)
                prefix = ("[" + style + "] ") if style else ""
                out.append(prefix + txt)
        elif tag == "tbl":
            out.append("--- TABLE ---")
            for tr in el.findall(W + "tr"):
                cells = []
                for tc in tr.findall(W + "tc"):
                    cell_txt = " ".join(para_text(p) for p in tc.findall(W + "p")).strip()
                    cells.append(cell_txt)
                out.append(" | ".join(cells))
            out.append("--- END TABLE ---")
    return "\n".join(out)

if __name__ == "__main__":
    print(walk(sys.argv[1]))
