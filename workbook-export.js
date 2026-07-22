// PNPT Configuration Workbook export — rebuilds the ENTIRE official
// "PNPT Configuration Workbook _ NAMER" workbook (all 13 tabs) from
// workbook-template.json (generated 1:1 from the real file by
// tools/build-workbook-template.py) and injects the active client's tracked
// Updated / Changed to / Notes values into the exact rows of their tier's
// tab. Formatting mirrors the source exactly: Inter font, orange bold
// header row, black tool banners, gray sub-group rows, no cell borders
// (gridlines only), per-tab column widths, 15.75pt rows, frozen rows 1-3,
// and the PROCORE logo image anchored on every tab.
//
// Column C ("Updated") is a plain TRUE/FALSE boolean — byte-for-byte what
// Google Sheets itself writes when it exports a checkbox to .xlsx (checkboxes
// are a Sheets-native feature that does NOT survive the .xlsx format). So:
//   - Download .xlsx path: column C imports as TRUE/FALSE; one click in Sheets
//     (select column C → Insert → Tick box) turns them into checked/unchecked
//     boxes, state preserved.
//   - Export to Google Sheets path: after the Drive upload/conversion, a
//     Sheets-API batchUpdate sets REAL native checkboxes on column C of the
//     tier tab — zero manual steps.
//
// Everything is dependency-free: a STORED (uncompressed) ZIP writer plus
// minimal SpreadsheetML. buildWorkbookXlsxBytes() is pure (runs under Node
// for tests); exportWorkbookXlsx() wraps it in a Blob download; and
// exportWorkbookToGoogleSheets() uploads with Drive-side conversion + the
// checkbox pass (requires a Google OAuth Client ID configured by the team —
// see README).

// ---------------------------------------------------------------------
// ZIP (store-only) + CRC32 — supports text and binary parts.
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
// files: [{ name, text }] or [{ name, bytes }] → Uint8Array of a stored ZIP.
function zipStore(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const DOS_TIME = 0;
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01

  function u16(v) { return [v & 0xff, (v >> 8) & 0xff]; }
  function u32(v) { return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]; }

  files.forEach((f) => {
    const nameBytes = enc.encode(f.name);
    const data = f.bytes ? f.bytes : enc.encode(f.text);
    const crc = crc32(data);
    const local = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04,
      ...u16(20), ...u16(0), ...u16(0),
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
      0x50, 0x4b, 0x01, 0x02,
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

function b64ToBytes(b64) {
  const bin = typeof atob === "function"
    ? atob(b64)
    : Buffer.from(b64, "base64").toString("binary");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
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

// Styles replicated from the source workbook (see build-workbook-template):
// fonts all "Inter"; NO cell borders (the grid look is Sheets gridlines).
// cellXfs: 0 default · 1 header (11 bold #FF5200 centered) · 2 banner
// (10 bold white on black) · 3 sub-group (10 bold on #E5E5E5) · 4 data
// (10, top-aligned, wrapped)
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4">
<font><sz val="10"/><name val="Inter"/><color rgb="FF000000"/></font>
<font><b/><sz val="11"/><name val="Inter"/><color rgb="FFFF5200"/></font>
<font><b/><sz val="10"/><name val="Inter"/><color rgb="FFFFFFFF"/></font>
<font><b/><sz val="10"/><name val="Inter"/><color rgb="FF000000"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF000000"/><bgColor rgb="FF000000"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE5E5E5"/><bgColor rgb="FFE5E5E5"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function boolCell(ref, style, value) {
  return '<c r="' + ref + '" s="' + style + '" t="b"><v>' + (value ? 1 : 0) + "</v></c>";
}
// Type-preserving cell emitter: booleans → t="b", numbers → t="n",
// text → inline string; null/empty → styled empty cell. The source
// workbook mixes types (numeric defaults, stray booleans in D, literal
// "N/A" in checkbox cells) and an exact match must keep them.
function valueCell(ref, style, v) {
  if (v == null || v === "") return '<c r="' + ref + '" s="' + style + '"/>';
  if (typeof v === "boolean") return boolCell(ref, style, v);
  if (typeof v === "number" && isFinite(v)) {
    return '<c r="' + ref + '" s="' + style + '" t="n"><v>' + v + "</v></c>";
  }
  return '<c r="' + ref + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' +
    xmlEsc(v) + "</t></is></c>";
}
const textCell = valueCell;

// Group ascending row numbers into contiguous [start,end] runs. Used to set
// native checkboxes (BOOLEAN data validation) on column C via the Sheets API
// on the direct-to-Sheets path — .xlsx cannot carry Google checkboxes (Google
// Sheets' own xlsx export flattens a checkbox to a plain boolean with no
// validation), so the download path leaves column C as TRUE/FALSE and the
// Sheets path adds real checkboxes after upload.
function contiguousRuns(rowNums) {
  const runs = [];
  let start = null, prev = null;
  rowNums.forEach((r) => {
    if (start === null) { start = prev = r; return; }
    if (r === prev + 1) { prev = r; return; }
    runs.push([start, prev]);
    start = prev = r;
  });
  if (start !== null) runs.push([start, prev]);
  return runs;
}

// Build one worksheet's XML from a template tab (+ optional value injection).
// Returns { xml, dataRows } — dataRows are the 1-based rows whose column C is
// a boolean checkbox cell (for the Sheets-API checkbox pass).
function sheetXmlFor(tab, values) {
  const merges = [];
  const dataRowsC = [];
  const rowsXml = tab.rows.map((row) => {
    const r = row.r;
    const ht = row.h ? ' ht="' + row.h + '" customHeight="1"' : "";
    let cells = "";
    if (row.k === "title") {
      if (r === 1 && row.m) merges.push("A1:E2");
      cells = textCell("A" + r, 0, row.a);
    } else if (row.k === "header") {
      const vals = [row.a, row.b, row.c, row.d, row.e];
      cells = vals.map((v, i) => textCell(COLS[i] + r, 1, v)).join("");
    } else if (row.k === "banner" || row.k === "sub") {
      // Fill spans A:E via per-cell styling (the source rarely merges these).
      const style = row.k === "banner" ? 2 : 3;
      if (row.m) merges.push("A" + r + ":E" + r);
      const vals = [row.a, row.b, row.c, row.d, row.e];
      cells = vals.map((v, i) => textCell(COLS[i] + r, style, v)).join("");
    } else {
      // data row — C is the checkbox boolean; D/E may be overridden by the
      // tracker's captured values for the exported tier's tab. Rows whose C
      // holds literal text ("N/A") keep it verbatim — unless the SPC checked
      // Updated, in which case their TRUE wins — and only boolean C cells
      // join the checkbox validation range.
      const inj = values ? values[r] : null;
      const dVal = inj && inj.d != null && inj.d !== "" ? inj.d : row.d;
      const eVal = inj && inj.e != null && inj.e !== "" ? inj.e : row.e;
      let cCell;
      const cRaw = row.c;
      const cIsVerbatim = cRaw != null && cRaw !== "" && typeof cRaw !== "boolean";
      if (cIsVerbatim && !(inj && inj.c)) {
        // literal text ("N/A") or stray numbers in the source stay verbatim
        cCell = valueCell("C" + r, 4, cRaw);
      } else {
        // Plain boolean — byte-for-byte what Google Sheets writes for a
        // checkbox on xlsx export. The Sheets path upgrades these to real
        // checkboxes after upload; the download path leaves them as
        // TRUE/FALSE (one click in Sheets — select column C, Insert →
        // Tick box — turns them into checked/unchecked boxes).
        dataRowsC.push(r);
        cCell = boolCell("C" + r, 4, inj ? !!inj.c : !!cRaw);
      }
      cells =
        valueCell("A" + r, 4, row.a) +
        valueCell("B" + r, 4, row.b) +
        cCell +
        valueCell("D" + r, 4, dVal) +
        valueCell("E" + r, 4, eVal);
    }
    return '<row r="' + r + '"' + ht + ">" + cells + "</row>";
  });

  const widths = tab.widths || {};
  const colXml = Object.keys(widths).map((L) => {
    const idx = L.charCodeAt(0) - 64;
    return '<col min="' + idx + '" max="' + idx + '" width="' + widths[L] + '" customWidth="1"/>';
  }).join("");

  const freeze = tab.freeze
    ? '<pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/>'
    : "";
  const mergeXml = merges.length
    ? '<mergeCells count="' + merges.length + '">' +
      merges.map((m) => '<mergeCell ref="' + m + '"/>').join("") + "</mergeCells>"
    : "";

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0">${freeze}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15.75"/>
${colXml ? "<cols>" + colXml + "</cols>" : ""}
<sheetData>${rowsXml.join("")}</sheetData>
${mergeXml}
<drawing r:id="rId1"/>
</worksheet>`;
  return { xml: xml, dataRows: dataRowsC };
}

// template: workbook-template.json content.
// injection: { tabName, values: { rowNumber: {c,d,e} } } or null.
// Returns { bytes, activeTabIndex, activeTabDataRows } — the last two describe
// the injected tab's column-C checkbox rows so the Sheets path can set native
// checkboxes there after upload.
export function buildWorkbookXlsxBytes(template, injection) {
  const tabs = template.tabs;
  const logoBytes = b64ToBytes(template.logoPng);
  const files = [];
  let activeTabIndex = -1;
  let activeTabDataRows = [];

  const overrides = tabs.map((_, i) =>
    '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/drawings/drawing' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>'
  ).join("");
  files.push({
    name: "[Content_Types].xml",
    text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${overrides}
</Types>`
  });
  files.push({
    name: "_rels/.rels",
    text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
  });
  files.push({
    name: "xl/workbook.xml",
    text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>` + tabs.map((t, i) =>
      '<sheet name="' + xmlEsc(t.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'
    ).join("") + `</sheets>
</workbook>`
  });
  files.push({
    name: "xl/_rels/workbook.xml.rels",
    text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      tabs.map((_, i) =>
        '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'
      ).join("") +
      '<Relationship Id="rId' + (tabs.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      `</Relationships>`
  });
  files.push({ name: "xl/styles.xml", text: STYLES_XML });
  files.push({ name: "xl/media/image1.png", bytes: logoBytes });

  tabs.forEach((tab, i) => {
    const n = i + 1;
    const values = injection && injection.tabName === tab.name ? injection.values : null;
    const built = sheetXmlFor(tab, values);
    if (values) { activeTabIndex = i; activeTabDataRows = built.dataRows; }
    files.push({ name: "xl/worksheets/sheet" + n + ".xml", text: built.xml });
    files.push({
      name: "xl/worksheets/_rels/sheet" + n + ".xml.rels",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${n}.xml"/>
</Relationships>`
    });
    // The PROCORE logo, anchored exactly as in the source (verbatim drawing).
    files.push({ name: "xl/drawings/drawing" + n + ".xml", text: template.drawingXml });
    files.push({
      name: "xl/drawings/_rels/drawing" + n + ".xml.rels",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
</Relationships>`
    });
  });

  return {
    bytes: zipStore(files),
    activeTabIndex: activeTabIndex,
    activeTabDataRows: activeTabDataRows
  };
}

function exportFileName(clientName, tierName) {
  const stamp = new Date().toISOString().slice(0, 10);
  const client = (clientName || "Client").replace(/[\\/:*?"<>|]+/g, "-").trim() || "Client";
  return client + " - PNPT Configuration Workbook - " + (tierName || "Workbook") + " - " + stamp + ".xlsx";
}

// Download path. opts: { template, tabName, values, clientName, tierName }
export function exportWorkbookXlsx(opts) {
  const built = buildWorkbookXlsxBytes(opts.template, { tabName: opts.tabName, values: opts.values || {} });
  const fileName = exportFileName(opts.clientName, opts.tierName);
  const blob = new Blob([built.bytes], {
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

// ---------------------------------------------------------------------
// Direct-to-Google-Sheets path (optional). Google Identity Services
// (client-side OAuth) + a Drive multipart upload with conversion creates a
// NATIVE Google Sheet with the formatting intact, then a Sheets-API
// batchUpdate sets REAL checkboxes on column C of the client's tier tab (the
// only way to get checkboxes — .xlsx cannot carry them). Scopes: drive.file
// (create the file) + spreadsheets (set the checkboxes on it). Requires a
// Google OAuth Client ID (configurations.json → export.googleClientId); see
// README for the one-time setup.
// ---------------------------------------------------------------------
let gisLoaded = null;
function loadGis() {
  if (gisLoaded) return gisLoaded;
  gisLoaded = new Promise((resolve, reject) => {
    if (typeof google !== "undefined" && google.accounts && google.accounts.oauth2) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Couldn't load Google Identity Services (network/CSP)."));
    document.head.appendChild(s);
  });
  return gisLoaded;
}
const SHEETS_SCOPES =
  "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets";
function getAccessToken(clientId) {
  return loadGis().then(() => new Promise((resolve, reject) => {
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SHEETS_SCOPES,
      callback: (resp) => {
        if (resp && resp.access_token) resolve(resp.access_token);
        else reject(new Error(resp && resp.error ? resp.error : "No access token returned."));
      },
      error_callback: (err) => reject(new Error(err && err.type ? err.type : "OAuth popup failed."))
    });
    tc.requestAccessToken();
  }));
}

// Set native checkboxes on column C for the given 1-based data rows of the
// sheet at gridSheetId, via one Sheets-API batchUpdate (BOOLEAN validation
// over each contiguous run of rows). Best-effort: the sheet already exists,
// so a failure here just means the user tick-boxes column C themselves.
async function applyCheckboxes(spreadsheetId, gridSheetId, dataRows, token) {
  if (!dataRows || !dataRows.length) return;
  const requests = contiguousRuns(dataRows).map(([start, end]) => ({
    setDataValidation: {
      range: {
        sheetId: gridSheetId,
        startRowIndex: start - 1, endRowIndex: end,   // 0-based, end-exclusive
        startColumnIndex: 2, endColumnIndex: 3        // column C
      },
      rule: {
        condition: { type: "BOOLEAN" },
        strict: true, showCustomUi: true
      }
    }
  }));
  const resp = await fetch(
    "https://sheets.googleapis.com/v4/spreadsheets/" + spreadsheetId + ":batchUpdate",
    {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ requests: requests })
    }
  );
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error("checkbox pass failed (" + resp.status + "): " + detail.slice(0, 200));
  }
}

// Look up the gridId of the sheet/tab at a given index (Drive conversion keeps
// tab order, but sheetId is assigned by Sheets, not our index).
async function sheetGridId(spreadsheetId, tabIndex, token) {
  const resp = await fetch(
    "https://sheets.googleapis.com/v4/spreadsheets/" + spreadsheetId +
      "?fields=sheets.properties(sheetId,index)",
    { headers: { Authorization: "Bearer " + token } }
  );
  if (!resp.ok) return null;
  const data = await resp.json();
  const match = (data.sheets || []).find((s) => s.properties && s.properties.index === tabIndex);
  return match ? match.properties.sheetId : null;
}

// Parse a Google Sheets URL (or a bare spreadsheet id) into the id.
export function parseSpreadsheetId(url) {
  const s = String(url || "").trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
  return null;
}

// Post the tracker's captured values into the client's OWN linked workbook
// copy (an existing Google Sheet) — additive writes only: checked rows go in
// as TRUE (ticking the copy's native checkboxes), and non-empty Changed to /
// Notes text is written; nothing is ever unchecked or cleared. Before
// writing, column A of the tier tab is read and each target row's Discussion
// Point must still match the official template — rows that don't match are
// skipped, so an inserted/deleted row in the client's copy can't shift the
// writes onto the wrong settings.
// opts: { clientId, spreadsheetUrl, tabName, template, values }
// Resolves with { spreadsheetTitle, tab, rowsPosted, rowsSkipped, cells, url }.
export async function postToLinkedWorkbook(opts) {
  const spreadsheetId = parseSpreadsheetId(opts.spreadsheetUrl);
  if (!spreadsheetId) throw new Error("That doesn't look like a Google Sheets link.");
  const tab = ((opts.template && opts.template.tabs) || []).find((t) => t.name === opts.tabName);
  if (!tab) throw new Error('No official template tab named "' + opts.tabName + '".');

  // Rows worth posting: checked, or carrying Changed to / Notes text.
  const rows = [];
  Object.keys(opts.values || {}).forEach((k) => {
    const v = opts.values[k];
    if (v && (v.c || (v.d != null && v.d !== "") || (v.e != null && v.e !== ""))) {
      rows.push(Number(k));
    }
  });
  rows.sort((a, b) => a - b);
  if (!rows.length) {
    throw new Error("Nothing to post yet — no checked rows or entries for this client.");
  }

  const token = await getAccessToken(opts.clientId);

  // The linked workbook must have the tier's tab.
  const metaResp = await fetch(
    "https://sheets.googleapis.com/v4/spreadsheets/" + spreadsheetId +
      "?fields=properties.title,sheets.properties(title,sheetId)",
    { headers: { Authorization: "Bearer " + token } }
  );
  if (!metaResp.ok) {
    throw new Error(metaResp.status === 404
      ? "Workbook not found — check the link."
      : "Couldn't open the linked workbook (" + metaResp.status + "). Do you have edit access?");
  }
  const metaData = await metaResp.json();
  const sheet = (metaData.sheets || []).find((s) => s.properties && s.properties.title === opts.tabName);
  if (!sheet) {
    const titles = (metaData.sheets || []).map((s) => s.properties.title).join(", ");
    throw new Error('The linked workbook has no "' + opts.tabName + '" tab. Tabs found: ' + titles.slice(0, 220));
  }

  // Safety rail: read column A once and verify each target row still matches.
  const q = "'" + opts.tabName.replace(/'/g, "''") + "'";
  const maxRow = rows[rows.length - 1];
  const colResp = await fetch(
    "https://sheets.googleapis.com/v4/spreadsheets/" + spreadsheetId + "/values/" +
      encodeURIComponent(q + "!A1:A" + maxRow),
    { headers: { Authorization: "Bearer " + token } }
  );
  if (!colResp.ok) throw new Error("Couldn't read the linked workbook (" + colResp.status + ").");
  const colData = await colResp.json();
  const colA = (colData.values || []).map((r) => (r && r[0] != null ? String(r[0]) : ""));
  const byRow = {};
  (tab.rows || []).forEach((r) => { byRow[r.r] = r; });
  const squash = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

  const data = [];
  let posted = 0;
  let skipped = 0;
  rows.forEach((rn) => {
    const tRow = byRow[rn];
    if (!tRow || squash(colA[rn - 1]) !== squash(tRow.a)) { skipped++; return; }
    const v = opts.values[rn];
    if (v.c) data.push({ range: q + "!C" + rn, values: [["TRUE"]] });
    if (v.d != null && v.d !== "") data.push({ range: q + "!D" + rn, values: [[v.d]] });
    if (v.e != null && v.e !== "") data.push({ range: q + "!E" + rn, values: [[v.e]] });
    posted++;
  });
  if (!data.length) {
    throw new Error("No rows matched the official workbook layout in the linked file — nothing was written" +
      (skipped ? " (" + skipped + " rows skipped because their text didn't match)." : "."));
  }

  const writeResp = await fetch(
    "https://sheets.googleapis.com/v4/spreadsheets/" + spreadsheetId + "/values:batchUpdate",
    {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: data })
    }
  );
  if (!writeResp.ok) {
    const detail = await writeResp.text().catch(() => "");
    throw new Error("Write failed (" + writeResp.status + "). " + detail.slice(0, 200));
  }
  const res = await writeResp.json();
  return {
    spreadsheetTitle: (metaData.properties && metaData.properties.title) || "workbook",
    tab: opts.tabName,
    rowsPosted: posted,
    rowsSkipped: skipped,
    cells: res.totalUpdatedCells || data.length,
    url: "https://docs.google.com/spreadsheets/d/" + spreadsheetId + "/edit#gid=" + sheet.properties.sheetId
  };
}

// opts: { clientId, template, tabName, values, clientName, tierName }
// Resolves with { id, url, checkboxes } of the created Google Sheet (opens it).
export async function exportWorkbookToGoogleSheets(opts) {
  const built = buildWorkbookXlsxBytes(opts.template, { tabName: opts.tabName, values: opts.values || {} });
  const fileName = exportFileName(opts.clientName, opts.tierName).replace(/\.xlsx$/, "");
  const token = await getAccessToken(opts.clientId);

  const meta = { name: fileName, mimeType: "application/vnd.google-apps.spreadsheet" };
  const boundary = "pnptwb" + Math.random().toString(36).slice(2);
  const body = new Blob([
    "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n",
    JSON.stringify(meta),
    "\r\n--" + boundary + "\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n",
    built.bytes,
    "\r\n--" + boundary + "--"
  ]);
  const resp = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "multipart/related; boundary=" + boundary
      },
      body: body
    }
  );
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error("Drive upload failed (" + resp.status + "). " + detail.slice(0, 300));
  }
  const file = await resp.json();

  // Turn the tier tab's column-C booleans into real checkboxes. Best-effort:
  // the sheet is already created + usable if this step fails.
  let checkboxes = false;
  try {
    const gridId = await sheetGridId(file.id, built.activeTabIndex, token);
    if (gridId != null) {
      await applyCheckboxes(file.id, gridId, built.activeTabDataRows, token);
      checkboxes = true;
    }
  } catch (e) { /* leave checkboxes false; sheet still opens */ }

  const url = file.webViewLink || ("https://docs.google.com/spreadsheets/d/" + file.id + "/edit");
  window.open(url, "_blank", "noopener");
  return { id: file.id, url: url, checkboxes: checkboxes };
}
