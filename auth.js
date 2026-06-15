// Lightweight password gate for the PNPT internal tools.
// SECURITY NOTE: the page is fully static and the SHA-256 hash below is in
// client-side JS. Anyone determined can read this file and brute-force the
// hash. This gate is a DETERRENT, not real authentication — it keeps casual
// visitors and search-engine indexers out, but it is not appropriate for
// holding sensitive customer data. For real auth, host behind Cloudflare
// Access or an equivalent.
//
// LOGIN LOGGING (honor-system "who's using it"): on a successful login the
// entered email + timestamp are POSTed to LOG_ENDPOINT (a Google Apps Script
// web app that appends a row to a Sheet you own). This is SELF-REPORTED — the
// email is whatever the user typed, not verified identity. Leave LOG_ENDPOINT
// blank to disable logging (the gate still works). To enable:
//   1) New Google Sheet, e.g. "PNPT Tool Logins" (header: Timestamp | Email | Page | UA).
//   2) Extensions → Apps Script, paste:
//        function doPost(e){
//          var s = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
//          var d = JSON.parse(e.postData.contents);
//          s.appendRow([new Date(), d.email||"", d.page||"", d.ua||""]);
//          return ContentService.createTextOutput("ok");
//        }
//   3) Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
//   4) Paste the /exec URL into LOG_ENDPOINT below.
//
// Default password: PNPT@2026
//
// To rotate the password:
//   1) Pick a new password (let's call it NEWPW).
//   2) In a terminal:
//        python -c "import hashlib; print(hashlib.sha256(b'NEWPW').hexdigest())"
//      or in any browser DevTools console:
//        crypto.subtle.digest('SHA-256', new TextEncoder().encode('NEWPW'))
//          .then(b => console.log(Array.from(new Uint8Array(b))
//            .map(x => x.toString(16).padStart(2,'0')).join('')))
//   3) Replace LOCK_HASH below with the new hex string.
//   4) Tell the team. Existing users keep access for 30 days unless they
//      Cmd/Ctrl+Shift+Delete or clear localStorage; new users use the new pw.
(function () {
  const LOCK_HASH = "523703484f35c7b5e8651d1070618ca2f787bb4b874bad8b5973f50589e1fa7d";
  const LS_KEY = "pnpt-unlock:v1";
  const EMAIL_LS = "pnpt-login-email";
  const TTL_DAYS = 30;
  // Paste your Google Apps Script /exec URL here to enable login logging.
  // Blank = logging off (the gate still works normally).
  const LOG_ENDPOINT = "";

  // Fire-and-forget the login email to the logging Sheet. no-cors because the
  // Apps Script web app doesn't return CORS headers — we don't need the reply,
  // only the row write. Never blocks or fails the unlock.
  function logLogin(email) {
    if (!LOG_ENDPOINT) return;
    try {
      fetch(LOG_ENDPOINT, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          email: email,
          ts: new Date().toISOString(),
          page: location.pathname + location.search,
          ua: navigator.userAgent
        })
      }).catch(function () {});
    } catch (e) {}
  }

  function bytesToHex(buf) {
    return Array.from(new Uint8Array(buf))
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
  }
  async function sha256Hex(str) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return bytesToHex(buf);
  }
  function unlocked() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || data.hash !== LOCK_HASH) return false; // password was rotated
      if (data.expiresAt && data.expiresAt < Date.now()) return false;
      return true;
    } catch (e) { return false; }
  }
  function storeUnlock(remember) {
    try {
      const data = { hash: LOCK_HASH };
      if (remember) data.expiresAt = Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000;
      else          data.expiresAt = Date.now() + 4 * 60 * 60 * 1000; // 4 hours
      localStorage.setItem(LS_KEY, JSON.stringify(data));
    } catch (e) {}
  }
  function dismissGate() {
    document.body.classList.remove("is-locked");
    const gate = document.getElementById("login-gate");
    if (gate) gate.remove();
  }

  // Forced re-auth: ?lock or ?logout in the URL clears the unlock record.
  // Strips the param from the URL bar after handling so it's not sticky.
  function forceRelock() {
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("lock");
      url.searchParams.delete("logout");
      const clean = url.pathname + (url.search || "") + url.hash;
      window.history.replaceState({}, document.title, clean);
    } catch (e) {}
  }

  document.addEventListener("DOMContentLoaded", () => {
    const qs = new URLSearchParams(window.location.search);
    if (qs.has("lock") || qs.has("logout")) forceRelock();
    if (unlocked()) { dismissGate(); return; }

    const form = document.getElementById("login-gate-form");
    const emailInput = document.getElementById("login-gate-email");
    const input = document.getElementById("login-gate-input");
    const err = document.getElementById("login-gate-error");
    const remember = document.getElementById("login-gate-remember");
    if (!form || !input) return;

    // Pre-fill the remembered email so returning SPCs don't retype it.
    try {
      const savedEmail = localStorage.getItem(EMAIL_LS);
      if (savedEmail && emailInput) emailInput.value = savedEmail;
    } catch (e) {}

    const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      err.hidden = true;
      const email = ((emailInput && emailInput.value) || "").trim();
      const attempt = (input.value || "").trim();
      if (!attempt) return;
      if (emailInput && !EMAIL_RE.test(email)) {
        err.textContent = "Enter a valid email to continue.";
        err.hidden = false;
        emailInput.focus();
        return;
      }
      const hash = await sha256Hex(attempt);
      if (hash === LOCK_HASH) {
        try { localStorage.setItem(EMAIL_LS, email); } catch (e) {}
        logLogin(email);
        storeUnlock(remember && remember.checked);
        dismissGate();
      } else {
        err.textContent = "Incorrect password — try again.";
        err.hidden = false;
        input.value = "";
        input.focus();
      }
    });
  });
})();
