// Lightweight password gate for the PNPT internal tools.
// SECURITY NOTE: the page is fully static and the SHA-256 hash below is in
// client-side JS. Anyone determined can read this file and brute-force the
// hash. This gate is a DETERRENT, not real authentication — it keeps casual
// visitors and search-engine indexers out, but it is not appropriate for
// holding sensitive customer data. For real auth, host behind Cloudflare
// Access or an equivalent.
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
  const TTL_DAYS = 30;

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
    const input = document.getElementById("login-gate-input");
    const err = document.getElementById("login-gate-error");
    const remember = document.getElementById("login-gate-remember");
    if (!form || !input) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      err.hidden = true;
      const attempt = (input.value || "").trim();
      if (!attempt) return;
      const hash = await sha256Hex(attempt);
      if (hash === LOCK_HASH) {
        storeUnlock(remember && remember.checked);
        dismissGate();
      } else {
        err.hidden = false;
        input.value = "";
        input.focus();
      }
    });
  });
})();
