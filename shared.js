// Shared utilities — hex geometry, SVG element factory, one zoom/pan
// implementation for both graphs, the in-app dialog system, and the JSON
// fetch policy. No imports; every other module imports from here.

// cache "no-cache" = always revalidate with the server (ETag → 304 when
// unchanged). GitHub Pages otherwise caches for 10 minutes, so right after
// a deploy users could get a stale — or version-mixed — data file.
const JSON_FETCH = { cache: "no-cache" };

  // Vertices of a regular hexagon with flat top/bottom edges (per the
  // Identity guide — "Do use the hex with the flat sides at the top and
  // bottom"), centered at origin, with circumradius r. Returned as the
  // SVG `points` attribute for <polygon>.
  function hexPoints(r) {
    const h = r * Math.sqrt(3) / 2; // half-height (apothem from horizontal axis)
    return [
      [ r, 0 ],         // far right
      [ r / 2, h ],     // bottom-right
      [ -r / 2, h ],    // bottom-left
      [ -r, 0 ],        // far left
      [ -r / 2, -h ],   // top-left
      [ r / 2, -h ]     // top-right
    ].map((p) => p.join(",")).join(" ");
  }

  // ---------------------------------------------------------------------
  // Shared SVG helpers — element factory + wheel-zoom/drag-pan. One
  // implementation serves both the ERP map and the Package Builder graph
  // (this replaced D3, which was only used for select + zoom).
  // ---------------------------------------------------------------------
  const SVG_NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs, text) {
    const el = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (text != null) el.textContent = text;
    return el;
  }

  // Wheel-zoom (anchored at the cursor) + drag-pan for a plain SVG whose
  // content lives in a single <g> layer. Mutates opts.state ({tx, ty, scale})
  // IN PLACE and applies it as the layer transform, so callers can persist
  // the same state object across re-renders. Drags that start on an element
  // matching opts.skipPan (a node) don't pan — they stay clicks.
  // consumeClick() returns true exactly once after a pan drag, so click
  // handlers can ignore the mouseup-click that ends the drag.
  function attachZoomPan(svg, layer, opts) {
    const state = opts.state;
    let suppressClick = false;
    function apply() {
      layer.setAttribute(
        "transform",
        "translate(" + state.tx + " " + state.ty + ") scale(" + state.scale + ")"
      );
    }
    // Client coords → svg user-space coords (pre-layer-transform).
    // getScreenCTM accounts for the live viewBox + preserveAspectRatio, so
    // this stays correct when applySource() swaps the viewBox.
    function svgPoint(clientX, clientY) {
      const m = svg.getScreenCTM();
      if (!m) return { x: clientX, y: clientY };
      return new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    }
    // Zoom anchored on a given svg-coordinate point so that point stays put.
    function zoomAt(x, y, factor) {
      const next = Math.max(opts.min, Math.min(opts.max, state.scale * factor));
      const eff = next / state.scale;
      state.tx = x - (x - state.tx) * eff;
      state.ty = y - (y - state.ty) * eff;
      state.scale = next;
      apply();
    }
    // Transient "how to zoom" toast, shown when a plain scroll passes over
    // the graph. Created lazily inside the svg's parent (which must be
    // position:relative) so it floats over the graph, not the page.
    let hintEl = null, hintTimer = 0;
    function showZoomHint() {
      if (!hintEl) {
        hintEl = document.createElement("div");
        hintEl.className = "zoom-hint";
        const mod = navigator.platform && navigator.platform.indexOf("Mac") !== -1 ? "⌘" : "Ctrl";
        hintEl.textContent = mod + " + scroll to zoom";
        (svg.parentElement || document.body).appendChild(hintEl);
      }
      hintEl.classList.add("is-visible");
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => hintEl.classList.remove("is-visible"), 1400);
    }
    svg.addEventListener("wheel", (e) => {
      // Plain scroll keeps scrolling the page — zooming needs Ctrl/⌘ held
      // (trackpad pinch also lands here: browsers report it as a wheel
      // event with ctrlKey set, so pinch-to-zoom keeps working).
      if (!e.ctrlKey && !e.metaKey) {
        showZoomHint();
        return;
      }
      e.preventDefault();
      const p = svgPoint(e.clientX, e.clientY);
      zoomAt(p.x, p.y, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });
    svg.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (opts.skipPan && e.target.closest && e.target.closest(opts.skipPan)) return;
      const start = svgPoint(e.clientX, e.clientY);
      const startTx = state.tx, startTy = state.ty;
      let moved = false;
      function onMove(ev) {
        const p = svgPoint(ev.clientX, ev.clientY);
        const dx = p.x - start.x, dy = p.y - start.y;
        if (!moved && Math.hypot(dx, dy) < 3) return; // tiny jitter = still a click
        moved = true;
        state.tx = startTx + dx;
        state.ty = startTy + dy;
        apply();
        svg.style.cursor = "grabbing";
      }
      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        svg.style.cursor = "";
        if (moved) suppressClick = true; // don't treat pan-end as a click
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
    function consumeClick() {
      const s = suppressClick;
      suppressClick = false;
      return s;
    }
    apply();
    return {
      apply: apply,
      zoomAt: zoomAt,
      reset: function () { state.tx = 0; state.ty = 0; state.scale = 1; apply(); },
      consumeClick: consumeClick
    };
  }

  // ---------------------------------------------------------------------
  // In-app dialogs — replaces native alert/confirm/prompt, which can't be
  // styled and look nothing like the product. One overlay is built lazily
  // and reused. Each helper returns a Promise:
  //   appDialog.alert(msg, title?)                          → undefined
  //   appDialog.confirm(msg, {title, okLabel, danger}?)     → boolean
  //   appDialog.prompt(msg, {title, placeholder, value, okLabel}?) → string|null
  // Escape / overlay click cancel; Enter confirms. Focus moves into the
  // dialog on open and returns to the previously-focused element on close.
  // ---------------------------------------------------------------------
  const appDialog = (() => {
    let overlay, titleEl, msgEl, inputEl, okBtn, cancelBtn;
    let active = null; // { resolve, kind, restoreFocus } while a dialog is open
    function ensureDom() {
      if (overlay) return;
      overlay = document.createElement("div");
      overlay.className = "app-dialog";
      overlay.hidden = true;
      const card = document.createElement("div");
      card.className = "app-dialog-card";
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-modal", "true");
      titleEl = document.createElement("h2");
      titleEl.className = "app-dialog-title";
      card.appendChild(titleEl);
      msgEl = document.createElement("p");
      msgEl.className = "app-dialog-msg";
      card.appendChild(msgEl);
      inputEl = document.createElement("input");
      inputEl.type = "text";
      inputEl.className = "app-dialog-input";
      card.appendChild(inputEl);
      const row = document.createElement("div");
      row.className = "app-dialog-actions";
      cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "app-dialog-btn app-dialog-btn-secondary";
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", () => close("cancel"));
      row.appendChild(cancelBtn);
      okBtn = document.createElement("button");
      okBtn.type = "button";
      okBtn.className = "app-dialog-btn app-dialog-btn-primary";
      okBtn.addEventListener("click", () => close("ok"));
      row.appendChild(okBtn);
      card.appendChild(row);
      overlay.appendChild(card);
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close("cancel"); });
      inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); close("ok"); }
      });
      document.addEventListener("keydown", (e) => {
        if (!active || overlay.hidden) return;
        if (e.key === "Escape") { e.preventDefault(); close("cancel"); }
        else if (e.key === "Enter" && document.activeElement !== inputEl) { e.preventDefault(); close("ok"); }
      });
      document.body.appendChild(overlay);
    }
    function close(action) {
      if (!active) return;
      const done = active;
      active = null;
      overlay.hidden = true;
      if (done.restoreFocus && document.contains(done.restoreFocus)) done.restoreFocus.focus();
      if (done.kind === "alert") done.resolve(undefined);
      else if (done.kind === "confirm") done.resolve(action === "ok");
      else done.resolve(action === "ok" ? inputEl.value : null);
    }
    function open(kind, message, opts) {
      opts = opts || {};
      ensureDom();
      if (active) close("cancel"); // never stack dialogs
      titleEl.textContent = opts.title ||
        (kind === "confirm" ? "Confirm" : kind === "prompt" ? "Input needed" : "Heads up");
      msgEl.textContent = message || "";
      inputEl.hidden = kind !== "prompt";
      inputEl.value = opts.value || "";
      inputEl.placeholder = opts.placeholder || "";
      cancelBtn.hidden = kind === "alert";
      okBtn.textContent = opts.okLabel || (kind === "alert" ? "OK" : kind === "confirm" ? "Confirm" : "Save");
      okBtn.classList.toggle("app-dialog-btn-danger", !!opts.danger);
      overlay.hidden = false;
      return new Promise((resolve) => {
        active = { resolve: resolve, kind: kind, restoreFocus: document.activeElement };
        (kind === "prompt" ? inputEl : okBtn).focus();
        if (kind === "prompt" && inputEl.value) inputEl.select();
      });
    }
    return {
      alert: (msg, title) => open("alert", msg, { title: title }),
      confirm: (msg, opts) => open("confirm", msg, opts),
      prompt: (msg, opts) => open("prompt", msg, opts)
    };
  })();

export { JSON_FETCH, hexPoints, SVG_NS, svgEl, attachZoomPan, appDialog };
