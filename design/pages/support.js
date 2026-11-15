/* LifeOS web runtime. Runs the .dc.html pages as a normal web app.
   Implements the small slice of the Design Component format the pages use:
   {{holes}}, <sc-if>, <sc-for>, DCLogic (props, state, setState, lifecycle). */
(function () {
  'use strict';

  // ---------- logic base class ----------
  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; this._r = null; }
    setState(o, cb) {
      const p = typeof o === 'function' ? o(this.state, this.props) : o;
      if (p) this.state = Object.assign({}, this.state, p);
      this._schedule(cb);
    }
    forceUpdate(cb) { this._schedule(cb); }
    _schedule(cb) { if (this._r) this._r(cb); }
  }
  window.DCLogic = DCLogic;

  // ---------- vault bridge ----------
  const vault = {
    on: false,
    ready: null,
    async call(method, url, body) {
      const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
      let j = null; try { j = await r.json(); } catch (e) {}
      if (!r.ok) { const err = new Error((j && j.error) || ('HTTP ' + r.status)); err.status = r.status; err.data = j; throw err; }
      return j;
    },
    get(url) { return vault.call('GET', url); },
    post(url, body) { return vault.call('POST', url, body || {}); },
    del(url) { return vault.call('DELETE', url); }
  };
  // Opens the Claude desktop app in a Cowork session with the vault folder attached, so Claude can read the real files.
  vault.openChat = (prompt) => {
    const url = 'claude://cowork/new?q=' + encodeURIComponent(prompt) + (vault.path ? '&folder=' + encodeURIComponent(vault.path) : '');
    const a = document.createElement('a'); a.href = url; a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove();
  };
  // In-panel chat: asks Claude Code on this computer (read-only, inside the vault). Falls back to the Claude desktop app.
  const plain = (t) => String(t || '').replace(/```[a-z]*\n?/g, '').replace(/^#{1,6}\s+/gm, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2').replace(/`([^`\n]+)`/g, '$1').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, a, b) => b || a).replace(/^\s*[-*]\s+/gm, '\u2022 ').trim();
  const sget = () => { try { return localStorage.getItem('lifeos.chatSession') || ''; } catch (e) { return ''; } };
  const sset = (v) => { try { v ? localStorage.setItem('lifeos.chatSession', v) : localStorage.removeItem('lifeos.chatSession'); } catch (e) {} };
  vault.ask = async (text, fallbackPrompt, done, opts) => {
    const o = opts || {};
    const fall = (why) => {
      try { if (navigator.clipboard) navigator.clipboard.writeText(fallbackPrompt).catch(() => {}); } catch (e) {}
      try { vault.openChat(fallbackPrompt); } catch (e) {}
      done(why + ' I opened the Claude app instead, with your question filled in. Approve the folder prompt there, then send.');
    };
    try {
      let r = await vault.post('/api/chat', { text, session: sget(), files: o.files || [], model: o.model || '', fast: !!o.fast });
      if (!r.ok && !r.unavailable && sget()) { sset(''); r = await vault.post('/api/chat', { text, session: '', files: o.files || [], model: o.model || '', fast: !!o.fast }); }
      if (r.unavailable) return fall('Claude Code is not set up on this computer.');
      if (!r.ok) return done(r.error || "That didn't work. Try again.");
      if (r.session) sset(r.session);
      done(plain(r.text));
    } catch (e) { done(e && e.status === 429 ? 'Still answering the last question. Give it a moment.' : "Couldn't reach the server. Is the LifeOS window still open?"); }
  };
  vault.newChat = () => sset('');
  // Sends a photo or file picked in the chat to the vault (Photos or PDFs). Resolves { file: { name, path, ... } }.
  vault.upload = (file) => new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No file.'));
    if (file.size > 20 * 1024 * 1024) return reject(new Error('That file is over 20 MB.'));
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("Couldn't read that file."));
    fr.onload = () => { const data = String(fr.result || '').split(',')[1] || ''; vault.post('/api/agent/upload', { name: file.name, data }).then(resolve, reject); };
    fr.readAsDataURL(file);
  });
  vault.checked = false;
  vault.label = () => (!vault.checked ? 'checking vault…' : vault.on ? 'vault connected' : 'vault not connected');
  vault.ready = fetch('/api/health').then((r) => r.json()).then((j) => { vault.on = !!(j && j.ok); vault.path = (j && j.vault) || ''; return vault.on; }).catch(() => false).then((on) => { vault.checked = true; try { window.__dc && window.__dc._r(); } catch (e) {} return on; });
  window.vault = vault;

  // ---------- expression holes ----------
  const HOLE = /\{\{([^}]*)\}\}/g;
  function lookup(path, scope) {
    const p = path.trim();
    if (p === 'true') return true;
    if (p === 'false') return false;
    if (p === 'null' || p === 'undefined') return undefined;
    if (/^-?\d+(\.\d+)?$/.test(p)) return Number(p);
    if (/^(['"]).*\1$/.test(p)) return p.slice(1, -1);
    const parts = p.split('.');
    let v = parts[0] in scope ? scope[parts[0]] : undefined;
    for (let i = 1; i < parts.length && v != null; i++) v = v[parts[i]];
    return v;
  }
  const isWhole = (s) => /^\s*\{\{[^}]*\}\}\s*$/.test(s);
  const interp = (s, scope) => s.replace(HOLE, (_, e) => { const v = lookup(e, scope); return v == null || v === false ? '' : String(v); });

  // ---------- template -> real nodes ----------
  const SKIP_ATTR = { 'hint-placeholder-val': 1, 'hint-placeholder-count': 1, 'hint-size': 1 };
  function build(node, scope, out) {
    if (node.nodeType === 3) {
      const t = node.nodeValue;
      out.push(document.createTextNode(t.indexOf('{{') < 0 ? t : interp(t, scope)));
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.localName;
    if (tag === 'sc-if') {
      if (lookup(node.getAttribute('value').replace(/^\s*\{\{|\}\}\s*$/g, ''), scope)) for (const c of node.childNodes) build(c, scope, out);
      return;
    }
    if (tag === 'sc-for') {
      const list = lookup(node.getAttribute('list').replace(/^\s*\{\{|\}\}\s*$/g, ''), scope);
      const as = node.getAttribute('as') || 'item';
      if (Array.isArray(list)) list.forEach((item, i) => {
        const s2 = Object.create(scope); s2[as] = item; s2.$index = i;
        for (const c of node.childNodes) build(c, s2, out);
      });
      return;
    }
    const el = document.createElementNS(node.namespaceURI, tag);
    const h = {};
    for (const a of node.attributes) {
      const name = a.name;
      if (SKIP_ATTR[name]) continue;
      const raw = a.value;
      const hasHole = raw.indexOf('{{') >= 0;
      if (/^on[a-z]+$/.test(name) && hasHole && isWhole(raw)) {
        const fn = lookup(raw.replace(/^\s*\{\{|\}\}\s*$/g, ''), scope);
        if (typeof fn === 'function') { el[name] = fn; h[name] = fn; }
        continue;
      }
      let v = raw;
      if (hasHole) v = isWhole(raw) ? lookup(raw.replace(/^\s*\{\{|\}\}\s*$/g, ''), scope) : interp(raw, scope);
      if (name === 'value' && (tag === 'input' || tag === 'textarea' || tag === 'select')) { el.value = v == null ? '' : String(v); el.setAttribute('value', el.value); continue; }
      if (name === 'checked' && tag === 'input') { el.checked = !!v; continue; }
      if (v === false || v == null) { if (/^(aria-|data-)/.test(name) && v === false) el.setAttribute(name, 'false'); continue; }
      el.setAttribute(name, v === true ? (/^(aria-|data-)/.test(name) ? 'true' : '') : String(v));
    }
    el.__h = h;
    if (tag === 'textarea') {
      // value was set above; no children
    } else {
      const kids = [];
      for (const c of node.childNodes) build(c, scope, kids);
      for (const k of kids) el.appendChild(k);
    }
    out.push(el);
  }

  // ---------- morph: make the live DOM match a freshly built one ----------
  function syncEl(a, b) {
    // attributes
    for (const at of Array.from(a.attributes)) if (!b.hasAttribute(at.name)) a.removeAttribute(at.name);
    for (const at of b.attributes) if (a.getAttribute(at.name) !== at.value) {
      if (at.name === 'value' && (a.localName === 'input' || a.localName === 'textarea')) continue;
      a.setAttribute(at.name, at.value);
    }
    // handlers
    const ha = a.__h || {}, hb = b.__h || {};
    for (const n in ha) if (!(n in hb)) a[n] = null;
    for (const n in hb) a[n] = hb[n];
    a.__h = hb;
    // form values
    if (a.localName === 'input' || a.localName === 'textarea' || a.localName === 'select') {
      if (a.type === 'checkbox' || a.type === 'radio') { if (a.checked !== b.checked) a.checked = b.checked; }
      else if (a.value !== b.value) a.value = b.value;
    }
  }
  function morphChildren(a, b) {
    if (a.getAttribute && a.getAttribute('contenteditable') != null) return; // editor owns its content
    const bk = Array.from(b.childNodes);
    let i = 0;
    for (; i < bk.length; i++) {
      const nb = bk[i];
      const na = a.childNodes[i];
      if (!na) { a.appendChild(nb); continue; }
      if (na.nodeType === nb.nodeType && (na.nodeType === 3 || (na.localName === nb.localName && na.namespaceURI === nb.namespaceURI))) {
        if (na.nodeType === 3) { if (na.nodeValue !== nb.nodeValue) na.nodeValue = nb.nodeValue; }
        else { syncEl(na, nb); morphChildren(na, nb); }
      } else a.replaceChild(nb, na);
    }
    while (a.childNodes.length > bk.length) a.removeChild(a.lastChild);
  }

  // ---------- boot ----------
  function boot() {
    const host = document.querySelector('x-dc');
    const scriptEl = document.querySelector('script[data-dc-script]');
    if (!host || !scriptEl) return;
    // move <helmet> head content out
    const helmet = host.querySelector('helmet');
    if (helmet) { for (const n of Array.from(helmet.childNodes)) if (n.nodeType === 1) document.head.appendChild(n); helmet.remove(); }
    // inert copy of the template so {{...}} attributes never run as inline handlers
    const tdoc = document.implementation.createHTMLDocument('');
    tdoc.body.innerHTML = host.innerHTML;
    host.textContent = '';
    host.style.display = 'contents';
    let defaults = {};
    try { const dp = JSON.parse(scriptEl.getAttribute('data-props') || '{}'); for (const k in dp) if (dp[k] && 'default' in dp[k]) defaults[k] = dp[k].default; } catch (e) {}
    const Component = new Function('DCLogic', scriptEl.textContent + '\n;return Component;')(DCLogic);
    const inst = new Component(Object.assign({}, defaults));
    let queued = false, cbs = [], mounted = false;
    const render = () => {
      queued = false;
      let vals; try { vals = inst.renderVals ? inst.renderVals() : {}; } catch (e) { console.error('renderVals failed', e); return; }
      const out = [];
      const scope = Object.assign(Object.create(null), vals || {});
      for (const c of tdoc.body.childNodes) build(c, scope, out);
      const tmp = document.createElement('div');
      for (const o of out) tmp.appendChild(o);
      tmp.querySelectorAll('[data-vstat]').forEach((e) => { e.textContent = vault.label(); const box = e.parentElement; if (box) box.style.display = (vault.checked && !vault.on) ? '' : 'none'; }); // the status box only shows when the vault is NOT connected
      morphChildren(host, tmp);
      if (!mounted) { mounted = true; try { inst.componentDidMount && inst.componentDidMount(); } catch (e) { console.error(e); } }
      const run = cbs; cbs = []; run.forEach((f) => { try { f(); } catch (e) {} });
    };
    inst._r = (cb) => { if (cb) cbs.push(cb); if (!queued) { queued = true; Promise.resolve().then(render); } };
    window.__dc = inst;
    window.addEventListener('pagehide', () => { try { inst.componentWillUnmount && inst.componentWillUnmount(); } catch (e) {} });
    render();
    document.documentElement.setAttribute('data-dc-ready', '1');
  }

  // ---------- phone / desktop routing and fit ----------
  function route() {
    const m = location.pathname.match(/\/([A-Za-z]+?)(Phone)?\.dc\.html$/);
    const forced = (location.search.match(/[?&]view=(desktop|phone)/) || [])[1];
    const narrow = forced ? forced === 'phone' : window.matchMedia('(max-width: 760px)').matches;
    if (!m) return false;
    const base = m[1], isPhone = !!m[2] || base === 'Phone';
    let name = base, phoneName;
    if (base === 'Phone') { name = 'Main'; phoneName = 'Phone'; } else if (base === 'Main') { phoneName = 'Phone'; } else { phoneName = base + 'Phone'; }
    if (m[2]) { name = base; phoneName = base + 'Phone'; }
    const want = narrow ? phoneName : name;
    const cur = location.pathname.split('/').pop().replace('.dc.html', '');
    if (cur !== want) { location.replace('/' + want + '.dc.html' + location.search + location.hash); return true; }
    return false;
  }
  const fit = document.createElement('style');
  fit.textContent = 'html,body{margin:0;min-height:100%;background:#121212} x-dc{display:contents} @media (max-width:760px){ body > x-dc > div[style*="width: 390px"]{width:100vw!important;height:100vh!important;height:100dvh!important} }';
  document.head.appendChild(fit);
  const meta = document.createElement('meta'); meta.name = 'viewport'; meta.content = 'width=device-width, initial-scale=1, viewport-fit=cover'; document.head.appendChild(meta);
  const man = document.createElement('link'); man.rel = 'manifest'; man.href = '/manifest.webmanifest'; document.head.appendChild(man);
  const th = document.createElement('meta'); th.name = 'theme-color'; th.content = '#121212'; document.head.appendChild(th);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

  const go = () => {
    if (route()) return;
    const sc = document.createElement('script'); sc.src = '/vsync.js';
    const start = () => { vault.ready.then(() => boot(), () => boot()); };
    sc.onload = start; sc.onerror = start; document.head.appendChild(sc);
    try { const ne = document.createElement('script'); ne.src = '/noteed.js'; document.head.appendChild(ne); } catch (e) {}
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
