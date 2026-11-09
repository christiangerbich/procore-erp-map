# -*- coding: utf-8 -*-
"""Build the PNPT delivery data in configurations.json from the official files.

Regenerates three blocks, each 1:1 from its source document:
  validationChecklist.sections / .map   <- "Validation Script" sheet
  projectPlans  (tier key -> phases)     <- "PC Project Plan" sheet
  schedulingTemplates (tier key -> calls)<- PNPT Call Scheduling Tool (PDF)

The Project Plan + Validation Script live in one workbook:
  "PNPT_ Project Plan Template RAID_Validation Script_2026.xlsx"

Usage:
  python tools/build-pnpt-delivery.py <plan-template.xlsx> <scheduling-tool.pdf>
Requires: openpyxl, pymupdf
"""
import io, json, os, re, sys
import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, "configurations.json")
PLAN_XLSX, SCHED_PDF = sys.argv[1], sys.argv[2]


def clean(s):
    return re.sub(r"\s+", " ", str(s or "").replace("​", "")).strip()


# ----------------------------------------------------------------------------
# 1) Validation Script
# ----------------------------------------------------------------------------
PKG_SECTIONS = ["Account Configuration", "Project Setup", "Project Execution Essentials",
                "Project Execution", "Project Execution Enterprise", "Cost Management",
                "Cost Management Enterprise", "Resource Tracking", "Resource Planning",
                "Resource Management", "Project Lifecycle Management"]
FLAT_SECTIONS = {"Account Configuration", "Project Setup"}
# PLM nests sub-package banners; these are skipped (their tools flatten into PLM).
PLM_SUBPACKAGES = {"Project Execution", "Cost Management | Analytics | 360 Reporting"}
TAN = "FFECE0D6"

wb = openpyxl.load_workbook(PLAN_XLSX)
ws = wb["Validation Script"]
sections, cur_sec, cur_tool, expect = {}, None, None, list(PKG_SECTIONS)
for r in range(4, ws.max_row + 1):
    a, c = ws.cell(row=r, column=1), ws.cell(row=r, column=3)
    text = clean(a.value)
    if not text:
        continue
    f = a.fill
    tan = f is not None and f.patternType == "solid" and str(f.fgColor.rgb) == TAN
    if tan and expect and text == expect[0]:
        cur_sec = expect.pop(0)
        sections[cur_sec] = []
        cur_tool = None
        continue
    if tan and cur_sec == "Project Lifecycle Management" and text in PLM_SUBPACKAGES:
        continue
    if tan and cur_sec not in FLAT_SECTIONS:
        cur_tool = {"name": text, "items": []}
        sections[cur_sec].append(cur_tool)
        continue
    node = {"name": text}
    link = None
    for cell in (c, a):
        if cell.hyperlink is not None and cell.hyperlink.target:
            link = cell.hyperlink.target
            break
    if link:
        node["url"] = link
    doc = clean(c.value)
    if doc and doc != text:
        node["doc"] = doc
    (cur_tool["items"] if cur_tool is not None else sections[cur_sec]).append(node)
if expect:
    sys.exit("ABORT: validation sections not found: %s" % expect)

# Derived sections for tiers the official script has no section for. Both are
# assembled verbatim from matching tool blocks elsewhere in the same script.
OWNERS_TOOLS = ["Drawings", "Observations", "Correspondence", "Punch List", "Inspections"]
pe_tools = {t["name"]: t for t in sections["Project Execution"]}
sections["Project Execution Essentials (Owners)"] = [pe_tools[n] for n in OWNERS_TOOLS]
rm_tools = {t["name"]: t for t in sections["Resource Management"]}
sections["Materials"] = [rm_tools["Materials"]]

vmap = {
    "_universal": ["Account Configuration", "Project Setup"],
    "_noUniversal": ["materials"],
    "cost-management": {"standard": ["Cost Management"], "enterprise": ["Cost Management Enterprise"]},
    "project-execution": {"pe-essentials": ["Project Execution Essentials"],
                          "pe-essentials-owners": ["Project Execution Essentials (Owners)"],
                          "pe-standard": ["Project Execution"],
                          "pe-enterprise": ["Project Execution Enterprise"]},
    "resource-management": {"rm-tracking": ["Resource Tracking"], "rm-planning": ["Resource Planning"],
                            "rm-advanced": ["Resource Management"]},
    "project-lifecycle-management": {"plm-owners": ["Project Lifecycle Management"]},
    "materials": {"materials": ["Materials"]},
}


def leaves(ns):
    return sum(leaves(x["items"]) if "items" in x else 1 for x in ns)


print("Validation Script:")
for k, v in sections.items():
    print("  %-40s leaves=%3d  links=%d" % (k, leaves(v), sum(
        1 for t in v for i in (t.get("items") or [t]) if i.get("url"))))

# ----------------------------------------------------------------------------
# 2) PC Project Plan  (cols: ... Level=F, Task=J, Type=K, Description=L, Owner=M)
# ----------------------------------------------------------------------------
PLAN_PKGS = {
    "PROJECT EXECUTION ESSENTIALS": "pe-essentials",
    "PROJECT EXECUTION ESSENTIALS - OWNERS": "pe-essentials-owners",
    "PROJECT EXECUTION": "pe-standard",
    "PROJECT EXECUTION ENTERPRISE": "pe-enterprise",
    "COST MANAGEMENT": "standard",
    "COST MANAGEMENT ENTERPRISE": "enterprise",
    "PROJECT LIFECYCLE MANAGEMENT": "plm-owners",
    "RESOURCE TRACKING": "rm-tracking",
    "RESOURCE PLANNING": "rm-planning",
    "RESOURCE MANAGEMENT": "rm-advanced",
    "PROCORE AI": "procore-ai",
    "MATERIALS CONSULTATION AND DELIVERABLE SCHEDULE": "materials",
}
PHASE_WORDS = [("kickoff", r"^kick ?off$"), ("discovery", r"^discovery"), ("build", r"^(build|configuration)$"),
               ("validate", r"^validat"), ("closeout", r"^close ?out$")]


def phase_for_heading(t):
    low = t.lower()
    for key, pat in PHASE_WORDS:
        if re.search(pat, low):
            return key
    return None


def infer_phase(task):
    low = task.lower()
    if "kickoff" in low or "kick off" in low or "committee" in low or "schedule all" in low:
        return "kickoff"
    if "closeout" in low or "close out" in low:
        return "closeout"
    if "q&a" in low or "validat" in low or "training" in low:
        return "validate"
    return "build"


ws = wb["PC Project Plan"]
plans, cur_tier, cur_phase, cur_group = {}, None, None, None
for r in range(4, ws.max_row + 1):
    task = clean(ws.cell(row=r, column=10).value)
    if not task:
        continue
    typ = clean(ws.cell(row=r, column=11).value)
    desc = clean(ws.cell(row=r, column=12).value)
    owner = clean(ws.cell(row=r, column=13).value)
    if task.upper() in PLAN_PKGS and not typ:
        cur_tier = PLAN_PKGS[task.upper()]
        plans[cur_tier] = []
        cur_phase, cur_group = None, None
        continue
    if cur_tier is None:
        continue
    ph = phase_for_heading(task) if not typ else None
    if ph:
        cur_phase, cur_group = ph, None
        continue
    if not typ and re.match(r"^phase [ivx]+$", task.lower()):
        cur_group = task
        continue
    if not typ:  # untyped meeting rows exist in the source (e.g. a 2nd discovery call)
        typ = "Meeting" if re.search(r"\b(call|workshop)\b", task.lower()) else "Task"
    phase = cur_phase or infer_phase(task)
    plans[cur_tier].append({k: v for k, v in (("phase", phase), ("group", cur_group), ("task", task),
                                               ("type", typ), ("desc", desc), ("owner", owner)) if v})

project_plans = {}
for tier, items in plans.items():
    phases = []
    for it in items:
        if not phases or phases[-1]["phase"] != it["phase"]:
            phases.append({"phase": it["phase"], "items": []})
        phases[-1]["items"].append({k: v for k, v in it.items() if k != "phase"})
    project_plans[tier] = phases
print("Project Plan:")
for t, ph in project_plans.items():
    print("  %-22s %s" % (t, ", ".join("%s(%d)" % (p["phase"], len(p["items"])) for p in ph)))

# ----------------------------------------------------------------------------
# 3) Call Scheduling Tool (PDF)
# ----------------------------------------------------------------------------
import pymupdf

SCHED_PKGS = [("Project Execution Essentials", "pe-essentials"), ("Project Execution", "pe-standard"),
              ("Project Execution Enterprise", "pe-enterprise"), ("Cost Management", "standard"),
              ("Cost Management Enterprise", "enterprise"), ("Resource Tracking", "rm-tracking"),
              ("Resource Planning", "rm-planning"), ("Resource Management", "rm-advanced"),
              ("Project Lifecycle Management", "plm-owners"), ("Materials", "materials")]
text = "\n".join(p.get_text() for p in pymupdf.open(SCHED_PDF))
lines = [l.rstrip() for l in text.split("\n")]
# Skip the cover TOC: the first run of package names. Section bodies start at the
# 2nd occurrence of the first package name.
names = [n for n, _ in SCHED_PKGS]
starts, i, want = [], 0, list(SCHED_PKGS)
seen_first = 0
for idx, l in enumerate(lines):
    s = clean(l)
    if want and s == want[0][0]:
        if want[0][0] == names[0] and seen_first == 0:
            seen_first = 1  # TOC entry
            continue
        starts.append((idx, want.pop(0)))
if want:
    sys.exit("ABORT: schedule sections not found: %s" % want)
DUR = re.compile(r"^(\d+(\.\d+)?\s*(hours?|hrs?|min(ute)?s?)|\d+\s*$)", re.I)
NOISE = {"Call Title", "Duration", "Agenda", ""}

sched = {}
for si, (start, (pname, tier)) in enumerate(starts):
    end = starts[si + 1][0] if si + 1 < len(starts) else len(lines)
    body = [l for l in lines[start + 1:end] if not l.startswith("===== PAGE")]
    blocks, curb = [], []
    for l in body:
        if "​" in l and not clean(l):
            if curb:
                blocks.append(curb)
            curb = []
        elif clean(l) not in NOISE:
            curb.append(clean(l))
    if curb:
        blocks.append(curb)
    calls = []
    for b in blocks:
        di = next((k for k, x in enumerate(b) if DUR.match(x)), None)
        if di is None:
            continue
        dur = b[di]
        nxt = b[di + 1] if di + 1 < len(b) else ""
        if re.fullmatch(r"\d+", dur) and re.match(r"min", nxt, re.I):
            dur, rest = dur + " " + nxt, b[di + 2:]
        else:
            rest = b[di + 1:]
        title = " ".join(b[:di])
        title = re.sub(r"^Procore\s*\|\s*Customer\s*Name\s*:?\s*", "", title)
        title = re.sub(r"^Customer\s*Name\s*[:|]?\s*", "", title).strip(" |:")
        blob = " ".join(rest)
        commercial = "*Commercial Only" in title or "*Commercial Only" in blob
        title = clean(title.replace("*Commercial Only", ""))
        # PDF artifact: a zero-width char splits "Call" into "Cal ... )l".
        title = re.sub(r"Discovery Cal \((after SPC Discovery)- (week \d+)\)l", r"Discovery Call (\1 — \2)", title)
        internal = bool(re.search(r"internal", title + " " + blob[:80], re.I))
        tools = None
        m = re.search(r"(Tools [Cc]overed|PDFs in scope)\s*:\s*(.+?)(?=Please note|$)", blob)
        if m:
            tools = clean(m.group(2))
        call = {"title": title, "duration": re.sub(r"\s+", " ", dur).strip()}
        if tools:
            call["tools"] = tools
        if internal:
            call["internal"] = True
        if commercial:
            call["commercialOnly"] = True
        calls.append(call)
    sched[tier] = calls
print("Scheduling Tool:")
for t, cs in sched.items():
    print("  %-14s %2d calls: %s" % (t, len(cs), " / ".join("%s [%s]" % (c["title"][:28], c["duration"]) for c in cs)[:220]))

# ----------------------------------------------------------------------------
# Write
# ----------------------------------------------------------------------------
cfg = json.load(io.open(CONFIG, encoding="utf-8"))
vc = cfg["validationChecklist"]
vc["sections"] = sections
vc["map"] = vmap
cfg["projectPlans"] = project_plans
cfg["schedulingTemplates"] = sched
with io.open(CONFIG, "w", encoding="utf-8", newline="") as f:
    f.write(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n")
print("Wrote", CONFIG)
