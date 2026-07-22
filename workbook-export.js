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
// Column C carries TRUE/FALSE booleans PLUS a "TRUE,FALSE" list data
// validation on every data row — Google Sheets converts exactly that
// combination into native checkboxes on import.
//
// Everything is dependency-free: a STORED (uncompressed) ZIP writer plus
// minimal SpreadsheetML. buildWorkbookXlsxBytes() is pure (runs under Node
// for tests); exportWorkbookXlsx() wraps it in a Blob download; and
// exportWorkbookToGoogleSheets() uploads with Drive-side conversion so the
// result opens directly as a native Google Sheet (requires a Google OAuth
// Client ID configured by the team — see README).

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

// Compress a sorted list of row numbers into "C6:C10 C12 C14:C20" sqref form.
function sqrefFor(rowNums) {
  const ranges = [];
  let start = null, prev = null;
  rowNums.forEach((r) => {
    if (start === null) { start = prev = r; return; }
    if (r === prev + 1) { prev = r; return; }
    ranges.push(start === prev ? "C" + start : "C" + start + ":C" + prev);
    start = prev = r;
  });
  if (start !== null) ranges.push(start === prev ? "C" + start : "C" + start + ":C" + prev);
  return ranges.join(" ");
}

// Build one worksheet's XML from a template tab (+ optional value injection).
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
  // TRUE/FALSE list validation over every checkbox cell — Google Sheets
  // renders exactly this as native checkboxes on import.
  const dvXml = dataRowsC.length
    ? '<dataValidations count="1"><dataValidation type="list" allowBlank="1" sqref="' +
      sqrefFor(dataRowsC) + '"><formula1>"TRUE,FALSE"</formula1></dataValidation></dataValidations>'
    : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0">${freeze}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15.75"/>
${colXml ? "<cols>" + colXml + "</cols>" : ""}
<sheetData>${rowsXml.join("")}</sheetData>
${mergeXml}
${dvXml}
<drawing r:id="rId1"/>
</worksheet>`;
}

// template: workbook-template.json content.
// injection: { tabName, values: { rowNumber: {c,d,e} } } or null.
export function buildWorkbookXlsxBytes(template, injection) {
  const tabs = template.tabs;
  const logoBytes = b64ToBytes(template.logoPng);
  const files = [];

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
    files.push({ name: "xl/worksheets/sheet" + n + ".xml", text: sheetXmlFor(tab, values) });
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

  return zipStore(files);
}

function exportFileName(clientName, tierName) {
  const stamp = new Date().toISOString().slice(0, 10);
  const client = (clientName || "Client").replace(/[\\/:*?"<>|]+/g, "-").trim() || "Client";
  return client + " - PNPT Configuration Workbook - " + (tierName || "Workbook") + " - " + stamp + ".xlsx";
}

// Download path. opts: { template, tabName, values, clientName, tierName }
export function exportWorkbookXlsx(opts) {
  const bytes = buildWorkbookXlsxBytes(opts.template, { tabName: opts.tabName, values: opts.values || {} });
  const fileName = exportFileName(opts.clientName, opts.tierName);
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

// ---------------------------------------------------------------------
// Direct-to-Google-Sheets path (optional). Uses Google Identity Services
// (client-side OAuth, drive.file scope — the app can only touch files it
// creates) + a Drive multipart upload with conversion, so the result opens
// as a NATIVE Google Sheet: checkboxes in Updated, Inter font, formatting
// intact. Requires a Google OAuth Client ID (configurations.json →
// export.googleClientId); see README for the one-time setup.
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
function getAccessToken(clientId) {
  return loadGis().then(() => new Promise((resolve, reject) => {
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: "https://www.googleapis.com/auth/drive.file",
      callback: (resp) => {
        if (resp && resp.access_token) resolve(resp.access_token);
        else reject(new Error(resp && resp.error ? resp.error : "No access token returned."));
      },
      error_callback: (err) => reject(new Error(err && err.type ? err.type : "OAuth popup failed."))
    });
    tc.requestAccessToken();
  }));
}

// opts: { clientId, template, tabName, values, clientName, tierName }
// Resolves with { id, url } of the created Google Sheet (also opens it).
export async function exportWorkbookToGoogleSheets(opts) {
  const bytes = buildWorkbookXlsxBytes(opts.template, { tabName: opts.tabName, values: opts.values || {} });
  const fileName = exportFileName(opts.clientName, opts.tierName).replace(/\.xlsx$/, "");
  const token = await getAccessToken(opts.clientId);

  const meta = { name: fileName, mimeType: "application/vnd.google-apps.spreadsheet" };
  const boundary = "pnptwb" + Math.random().toString(36).slice(2);
  const body = new Blob([
    "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n",
    JSON.stringify(meta),
    "\r\n--" + boundary + "\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n",
    bytes,
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
  const url = file.webViewLink || ("https://docs.google.com/spreadsheets/d/" + file.id + "/edit");
  window.open(url, "_blank", "noopener");
  return { id: file.id, url: url };
}
