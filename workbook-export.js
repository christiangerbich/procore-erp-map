// PNPT Configuration Workbook export — builds a real .xlsx (no libraries)
// that mirrors the formatting of the official "PNPT Configuration Workbook _
// NAMER" Google Sheet: merged PROCORE title block, orange bold header row
// (Discussion Point | Default Setting | Updated | Changed to | Notes), black
// full-width tool banners, checkbox-style TRUE/FALSE "Updated" column, wide
// wrapped text columns, frozen header rows. Google Sheets opens/imports the
// file with formatting intact (File → Import, or upload to Drive and Open
// with Google Sheets); selecting the Updated column and using
// Insert → Tick box turns the booleans into native checkboxes.
//
// The writer emits a minimal OOXML package inside a STORED (uncompressed)
// ZIP, so no compression library is needed. buildWorkbookXlsxBytes() is pure
// (also runs under Node for tests); exportWorkbookXlsx() wraps it in a Blob
// download.

// ---------------------------------------------------------------------
// ZIP (store-only) + CRC32
// ---------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
// files: [{ name, text }] → Uint8Array of a stored ZIP.
function zipStore(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const DOS_TIME = 0; // 00:00:00
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01

  function u16(v) { return [v & 0xff, (v >> 8) & 0xff]; }
  function u32(v) { return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]; }

  files.forEach((f) => {
    const nameBytes = enc.encode(f.name);
    const data = enc.encode(f.text);
    const crc = crc32(data);
    const local = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04, // local file header
      ...u16(20), ...u16(0), ...u16(0), // version, flags, method=store
      ...u16(DOS_TIME), ...u16(DOS_DATE),
      ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(nameBytes.length), ...u16(0)
    ]);
    parts.push(local, nameBytes, data);
    central.push({ nameBytes, crc, size: data.length, offset });
    offset += local.length + nameBytes.length + data.length;
  });

  const centralParts = [];
  let centralSize = 0;
  central.forEach((e) => {
    const hdr = new Uint8Array([
      0x50, 0x4b, 0x01, 0x02, // central directory header
      ...u16(20), ...u16(20), ...u16(0), ...u16(0),
      ...u16(DOS_TIME), ...u16(DOS_DATE),
      ...u32(e.crc), ...u32(e.size), ...u32(e.size),
      ...u16(e.nameBytes.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(e.offset)
    ]);
    centralParts.push(hdr, e.nameBytes);
    centralSize += hdr.length + e.nameBytes.length;
  });
  const eocd = new Uint8Array([
    0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0),
    ...u16(files.length), ...u16(files.length),
    ...u32(centralSize), ...u32(offset), ...u16(0)
  ]);

  let total = 0;
  const all = parts.concat(centralParts, [eocd]);
  all.forEach((p) => { total += p.length; });
  const out = new Uint8Array(total);
  let pos = 0;
  all.forEach((p) => { out.set(p, pos); pos += p.length; });
  return out;
}

// ---------------------------------------------------------------------
// SpreadsheetML
// ---------------------------------------------------------------------
function xmlEsc(s) {
  return String(s == null ? "" : s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
const COLS = ["A", "B", "C", "D", "E"];

// Style indexes (cellXfs order below):
// 0 default · 1 title · 2 orange header · 3 black banner · 4 wrapped text
// 5 centered boolean
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4">
<font><sz val="10"/><name val="Arial"/><color rgb="FF000000"/></font>
<font><b/><sz val="20"/><name val="Arial"/><color rgb="FF000000"/></font>
<font><b/><sz val="10"/><name val="Arial"/><color rgb="FFFF5200"/></font>
<font><b/><sz val="10"/><name val="Arial"/><color rgb="FFFFFFFF"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF000000"/><bgColor rgb="FF000000"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border>
<left style="thin"><color rgb="FFD9D9D9"/></left>
<right style="thin"><color rgb="FFD9D9D9"/></right>
<top style="thin"><color rgb="FFD9D9D9"/></top>
<bottom style="thin"><color rgb="FFD9D9D9"/></bottom>
<diagonal/>
</border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function textCell(ref, style, text) {
  if (text == null || text === "") return '<c r="' + ref + '" s="' + style + '"/>';
  return '<c r="' + ref + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' +
    xmlEsc(text) + "</t></is></c>";
}
function boolCell(ref, style, value) {
  return '<c r="' + ref + '" s="' + style + '" t="b"><v>' + (value ? 1 : 0) + "</v></c>";
}

// Build the single worksheet XML from the assembled row model.
function sheetXml(sections) {
  const rows = [];
  const merges = ["A1:E2"];
  let r = 0;

  function rowXml(cells, height) {
    r += 1;
    const ht = height ? ' ht="' + height + '" customHeight="1"' : "";
    return "<row r=\"" + r + "\"" + ht + ">" + cells + "</row>";
  }

  // Title block (merged A1:E2) — the source workbook carries the PROCORE
  // wordmark here; text stands in for the logo image.
  rows.push(rowXml(textCell("A1", 1, "PROCORE"), 26));
  rows.push(rowXml(textCell("A2", 1, ""), 10));
  // Orange header row (frozen with the title block).
  rows.push(rowXml(
    ["Discussion Point", "Default Setting", "Updated", "Changed to", "Notes"]
      .map((h, i) => textCell(COLS[i] + "3", 2, h)).join(""),
    22
  ));

  sections.forEach((sec) => {
    // Black full-width tool banner (ALL CAPS, merged A:E).
    const bannerRow = r + 1;
    merges.push("A" + bannerRow + ":E" + bannerRow);
    rows.push(rowXml(textCell("A" + bannerRow, 3, String(sec.name || "").toUpperCase()), 18));
    sec.rows.forEach((row) => {
      const rr = r + 1;
      rows.push(rowXml(
        textCell("A" + rr, 4, row.discussion) +
        textCell("B" + rr, 4, row.defaultSetting) +
        boolCell("C" + rr, 5, row.updated) +
        textCell("D" + rr, 4, row.changedTo) +
        textCell("E" + rr, 4, row.notes)
      ));
    });
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="14"/>
<cols>
<col min="1" max="1" width="54" customWidth="1"/>
<col min="2" max="2" width="50" customWidth="1"/>
<col min="3" max="3" width="12" customWidth="1"/>
<col min="4" max="4" width="36" customWidth="1"/>
<col min="5" max="5" width="44" customWidth="1"/>
</cols>
<sheetData>${rows.join("")}</sheetData>
<mergeCells count="${merges.length}">${merges.map((m) => '<mergeCell ref="' + m + '"/>').join("")}</mergeCells>
</worksheet>`;
}

// Excel tab names: ≤31 chars, no []:*?/\
function safeSheetName(name) {
  const cleaned = String(name || "Workbook").replace(/[\[\]:*?\/\\]/g, "-").trim();
  return (cleaned || "Workbook").slice(0, 31);
}

// data: { sheetName, sections: [{ name, rows: [{ discussion, defaultSetting,
// updated, changedTo, notes }] }] }  →  Uint8Array (.xlsx bytes)
export function buildWorkbookXlsxBytes(data) {
  const sheetName = safeSheetName(data.sheetName);
  const files = [
    {
      name: "[Content_Types].xml",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`
    },
    {
      name: "_rels/.rels",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
    },
    {
      name: "xl/workbook.xml",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${xmlEsc(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
    },
    { name: "xl/styles.xml", text: STYLES_XML },
    { name: "xl/worksheets/sheet1.xml", text: sheetXml(data.sections) }
  ];
  return zipStore(files);
}

// Assemble the export model from Config Tracker state and download it.
// opts: { clientName, tierName, sections: [{ name, settings, keys }], store }
//   settings: configurations.json rows ({ name, decisionLogic, default, notes })
//   keys:     stable slug key per setting (same order)
//   store:    configState.workbook (per-section { key: {updated, changed, notes} })
export function exportWorkbookXlsx(opts) {
  const sections = (opts.sections || []).map((sec) => ({
    name: sec.name,
    rows: (sec.settings || []).map((setting, i) => {
      const st = (opts.store && opts.store[sec.key] && opts.store[sec.key][sec.keys[i]]) || {};
      return {
        // The tracker's decision logic rides along under the discussion point,
        // like the multi-line discussion cells in the source workbook.
        discussion: setting.name + (setting.decisionLogic ? "\n" + setting.decisionLogic : ""),
        defaultSetting: setting.default || "",
        updated: !!st.updated,
        changedTo: st.changed || "",
        // SPC's note wins; otherwise carry the workbook's own guidance note,
        // matching how the source pre-fills *guidance* in the Notes column.
        notes: st.notes || setting.notes || ""
      };
    })
  }));

  const bytes = buildWorkbookXlsxBytes({ sheetName: opts.tierName, sections: sections });
  const stamp = new Date().toISOString().slice(0, 10);
  const client = (opts.clientName || "Client").replace(/[\\/:*?"<>|]+/g, "-").trim() || "Client";
  const fileName = client + " - PNPT Configuration Workbook - " +
    (opts.tierName || "Workbook") + " - " + stamp + ".xlsx";

  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return fileName;
}
