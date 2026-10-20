/*! ScrollKit runtime — frame-sequence animation (scroll / mouse / drag / hover / autoplay). MIT */
(function (global) {
  'use strict';

  var scriptBase = (function () {
    try {
      var s = document.currentScript;
      if (s && s.src) return s.src.replace(/[^\/]*([?#].*)?$/, '');
    } catch (e) {}
    return '';
  })();

  var DEFAULTS = {
    trigger: 'scroll',            // scroll | mouse-x | mouse-y | drag-x | drag-y | hover | autoplay
    range: [0, 1],                // which part of the frames to play (0..1)
    reverse: false,
    map: null,                    // piecewise curve [[in,out],...] input -> frame progress
    ease: 'linear',               // linear | in | out | inOut | inCubic | outCubic | inOutCubic
    smooth: 0.15,                 // inertia, seconds (0 = instant)
    breakpoint: 768,              // px: <= uses mobile frames and mobile overrides
    touchFallback: 'scroll',      // mouse/hover triggers on touch devices
    scroll: { pin: true, pinHeight: 400, startAt: 100, endAt: 0 },
    mouse: { area: 'section', rest: 0.5, returnToRest: true, sensitivity: 1 },
    drag: { sensitivity: 1, inertia: 0.92, loop: false },
    autoplay: { fps: 30, loop: true, pingpong: false, pauseOffscreen: true, delay: 0 },
    hover: { duration: 1.5 },
    render: { fit: 'cover', alignX: 0.5, alignY: 0.5, background: 'transparent', maxDpr: 2, blend: false, fadeIn: true, height: '100vh' },
    loading: { strategy: 'progressive', concurrency: 6, rootMargin: '300px', loader: 'bar' },
    a11y: { reducedMotion: 'poster', posterFrame: 0, label: '' }
  };

  var EASE = {
    linear: function (t) { return t; },
    'in': function (t) { return t * t; },
    out: function (t) { return 1 - (1 - t) * (1 - t); },
    inOut: function (t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; },
    inCubic: function (t) { return t * t * t; },
    outCubic: function (t) { return 1 - Math.pow(1 - t, 3); },
    inOutCubic: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function isObj(o) { return o && typeof o === 'object' && !Array.isArray(o); }
  function merge() {
    var out = {};
    for (var i = 0; i < arguments.length; i++) {
      var s = arguments[i];
      if (!isObj(s)) continue;
      for (var k in s) {
        if (!Object.prototype.hasOwnProperty.call(s, k)) continue;
        out[k] = isObj(s[k]) ? merge(out[k], s[k]) : s[k];
      }
    }
    return out;
  }
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  function dirOf(url) { return url.replace(/[^\/]*([?#].*)?$/, ''); }

  function applyMap(pts, x) {
    if (!pts || pts.length < 2) return x;
    if (x <= pts[0][0]) return pts[0][1];
    for (var i = 1; i < pts.length; i++) {
      if (x <= pts[i][0]) {
        var a = pts[i - 1], b = pts[i], d = b[0] - a[0];
        return d <= 0 ? b[1] : a[1] + (b[1] - a[1]) * ((x - a[0]) / d);
      }
    }
    return pts[pts.length - 1][1];
  }

  function loadOrder(n, strategy, first) {
    var out = [], seen = {};
    function add(i) { if (i >= 0 && i < n && !seen[i]) { seen[i] = 1; out.push(i); } }
    add(first);
    if (strategy === 'sequential') {
      for (var i = 0; i < n; i++) add(i);
      return out;
    }
    var step = 1;
    while (step * 2 < n && step < 32) step *= 2;
    add(n - 1);
    for (; step >= 1; step = Math.floor(step / 2)) {
      for (var j = 0; j < n; j += step) add(j);
      if (step === 1) break;
    }
    return out;
  }

  var styleInjected = false;
  function injectStyle() {
    if (styleInjected) return;
    styleInjected = true;
    var css =
      '.sk{position:relative}' +
      '.sk-stage{position:relative;width:100%;height:100%;overflow:hidden}' +
      '.sk--pin>.sk-stage{position:sticky;top:0;height:100vh;height:100svh}' +
      '.sk-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}' +
      '.sk-poster{position:absolute;inset:0;width:100%;height:100%;display:block}' +
      '.sk-content{position:absolute;inset:0;z-index:2}' +
      '.sk-loader{position:absolute;left:0;bottom:0;height:3px;width:100%;z-index:3;pointer-events:none;background:rgba(127,127,127,.2);transition:opacity .4s}' +
      '.sk-loader>i{display:block;height:100%;width:0;background:currentColor;opacity:.8}' +
      '[data-sk-from]{--sk-local:0}';
    var st = document.createElement('style');
    st.setAttribute('data-scrollkit', '');
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  var instances = [];

  function ScrollKit(el, cfg, opts) {
    injectStyle();
    this.root = el;
    this.opts = opts || {};
    this.raw = cfg;
    this.listeners = [];
    this._gen = 0;
    this._content = [];
    var kids = Array.prototype.slice.call(el.childNodes);
    this._poster = null;
    this._contentEl = null;
    this._stage = document.createElement('div');
    this._stage.className = 'sk-stage';
    var content = null;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.nodeType === 1 && k.classList.contains('sk-poster')) { this._poster = k; continue; }
      if (!content) { content = document.createElement('div'); content.className = 'sk-content'; }
      content.appendChild(k);
    }
    this._contentEl = content;
    el.classList.add('sk');
    el.appendChild(this._stage);
    this._build();
    instances.push(this);
  }

  var P = ScrollKit.prototype;

  P._resolve = function () {
    var raw = this.raw || {};
    var frames = raw.frames || {};
    var bp = raw.breakpoint != null ? raw.breakpoint : DEFAULTS.breakpoint;
    var mobile = !!frames.mobile && global.matchMedia && global.matchMedia('(max-width:' + bp + 'px)').matches;
    this.isMobile = mobile;
    this.set = mobile ? frames.mobile : (frames.desktop || frames.mobile);
    var base = {};
    for (var k in raw) if (k !== 'mobile' && k !== 'frames') base[k] = raw[k];
    var eff = merge(DEFAULTS, base, mobile ? raw.mobile : null);
    var noHover = global.matchMedia && !global.matchMedia('(hover:hover)').matches;
    if (noHover && /^(mouse|hover)/.test(eff.trigger)) {
      eff.trigger = eff.touchFallback === 'poster' ? 'none' : eff.touchFallback;
    }
    var rm = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.reduced = rm && eff.a11y.reducedMotion === 'poster';
    this.cfg = eff;
  };

  P._build = function () {
    var self = this;
    this._teardown();
    this._resolve();
    var c = this.cfg, set = this.set;
    if (!set) return;
    var gen = ++this._gen;
    var root = this.root, stage = this._stage;

    var base = this.opts.base || (raw_base(this.raw)) || '';
    var n = set.count;
    this.n = n;
    this.urls = [];
    var w = Math.max(set.pad || 4, String(n).length);
    var v = this.raw.v ? '?v=' + this.raw.v : '';
    var dir = set.dir ? set.dir.replace(/\/?$/, '/') : '';
    for (var i = 0; i < n; i++) this.urls.push(base + dir + pad(i + (set.start != null ? set.start : 1), w) + '.' + set.ext + v);

    root.classList.toggle('sk--pin', c.trigger === 'scroll' && c.scroll.pin);
    root.style.backgroundColor = c.render.background === 'transparent' ? '' : c.render.background;
    if (c.trigger === 'scroll' && c.scroll.pin) {
      root.style.height = c.scroll.pinHeight + 'vh';
      if (global.CSS && CSS.supports && CSS.supports('height', '1svh')) root.style.height = c.scroll.pinHeight + 'svh';
    } else if (c.render.height) {
      root.style.height = c.render.height;
    }
    if (c.a11y.label) { root.setAttribute('role', 'img'); root.setAttribute('aria-label', c.a11y.label); }

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'sk-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    if (c.render.fadeIn) { this.canvas.style.opacity = '0'; this.canvas.style.transition = 'opacity .5s'; }
    this.ctx = this.canvas.getContext('2d');
    stage.insertBefore(this.canvas, stage.firstChild);
    if (this._poster) { this._poster.style.display = ''; stage.insertBefore(this._poster, stage.firstChild); this._poster.style.objectFit = c.render.fit; this._poster.style.objectPosition = (c.render.alignX * 100) + '% ' + (c.render.alignY * 100) + '%'; }
    if (this._contentEl) stage.appendChild(this._contentEl);
    if (c.loading.loader === 'bar') {
      this._loader = document.createElement('div');
      this._loader.className = 'sk-loader';
      this._loader.innerHTML = '<i></i>';
      stage.appendChild(this._loader);
    }
    var touchAct = c.trigger === 'drag-x' ? 'pan-y' : c.trigger === 'drag-y' ? 'pan-x' : '';
    stage.style.touchAction = touchAct;

    this._layers = Array.prototype.slice.call(root.querySelectorAll('[data-sk-from]')).map(function (e) {
      return { el: e, from: parseFloat(e.getAttribute('data-sk-from')) || 0, to: parseFloat(e.getAttribute('data-sk-to')), on: null };
    });
    this._layers.forEach(function (l) { if (isNaN(l.to)) l.to = 1; });

    this.state = new Array(n);
    this.imgs = new Array(n);
    this.loaded = 0;
    this._lastKey = '';
    this._drawn = false;
    this._cur = null;
    this._visible = false;
    this._input = 0;
    this._target = 0;
    this._lastIdx = -1;
    this._dir = 1;
    this._playing = false;
    this._t0 = 0;
    this._dirty = true;

    this._resize();
    this._ro = global.ResizeObserver ? new ResizeObserver(function () { self._resize(); self._wake(); }) : null;
    if (this._ro) this._ro.observe(stage);

    this._bindTrigger();
    this._initInput();

    var first = clamp(Math.round(c.a11y.posterFrame || 0), 0, n - 1);
    this._order = this.reduced ? [first] : loadOrder(n, c.loading.strategy, first);
    this._qi = 0;
    this._active = 0;

    this._io = new IntersectionObserver(function (es) {
      var vis = es[0].isIntersecting;
      self._visible = vis;
      if (vis) { if (!self._loading) self._startLoading(gen); self._wake(); }
      else if (c.trigger === 'autoplay' && c.autoplay.pauseOffscreen) self._playing = false;
    }, { rootMargin: c.loading.rootMargin });
    this._io.observe(root);

    this._mq = global.matchMedia && this.raw.frames && this.raw.frames.mobile
      ? global.matchMedia('(max-width:' + (this.raw.breakpoint != null ? this.raw.breakpoint : DEFAULTS.breakpoint) + 'px)') : null;
    if (this._mq) {
      this._mqFn = function () { if (self._mq.matches !== self.isMobile) self._build(); };
      if (this._mq.addEventListener) this._mq.addEventListener('change', this._mqFn); else this._mq.addListener(this._mqFn);
    }
  };

  function raw_base(raw) { return raw && raw.base ? raw.base : ''; }

  P._on = function (target, type, fn, opt) {
    target.addEventListener(type, fn, opt);
    this.listeners.push([target, type, fn, opt]);
  };

  P._teardown = function () {
    this._gen++;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    this._running = false;
    this._loading = false;
    this.listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2], l[3]); });
    this.listeners = [];
    if (this._ro) this._ro.disconnect();
    if (this._io) this._io.disconnect();
    if (this._mq && this._mqFn) { if (this._mq.removeEventListener) this._mq.removeEventListener('change', this._mqFn); else this._mq.removeListener(this._mqFn); }
    this._mq = null;
    if (this._contentEl && this._contentEl.parentNode === this._stage) this.root.appendChild(this._contentEl);
    if (this._poster && this._poster.parentNode === this._stage) this.root.appendChild(this._poster);
    if (this._stage) { while (this._stage.firstChild) this._stage.removeChild(this._stage.firstChild); }
    if (this._contentEl && this._contentEl.parentNode === this.root) this._stage.appendChild(this._contentEl);
    if (this._poster && this._poster.parentNode === this.root) this._stage.appendChild(this._poster);
    this.imgs = null;
  };

  P._resize = function () {
    var r = this._stage.getBoundingClientRect();
    var dpr = Math.min(global.devicePixelRatio || 1, this.cfg.render.maxDpr);
    var w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
      this._lastKey = '';
    }
  };

  /* ---------- input sources ---------- */

  P._bindTrigger = function () {
    var self = this, c = this.cfg, t = c.trigger, root = this.root;
    if (this.reduced) return;
    if (t === 'scroll') {
      this._on(global, 'scroll', function () { self._wake(); }, { passive: true });
      this._on(global, 'resize', function () { self._wake(); });
    } else if (t === 'mouse-x' || t === 'mouse-y') {
      var ax = t === 'mouse-x' ? 'x' : 'y';
      var area = c.mouse.area === 'window' ? global : root;
      this._on(area === global ? document : root, 'pointermove', function (e) {
        if (e.pointerType === 'touch') return;
        var r = c.mouse.area === 'window' ? { left: 0, top: 0, width: global.innerWidth, height: global.innerHeight } : root.getBoundingClientRect();
        var v = ax === 'x' ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height;
        self._mouse = clamp(0.5 + (clamp(v, 0, 1) - 0.5) * c.mouse.sensitivity, 0, 1);
        self._wake();
      });
      if (c.mouse.returnToRest) {
        this._on(c.mouse.area === 'window' ? document.documentElement : root, 'pointerleave', function () { self._mouse = c.mouse.rest; self._wake(); });
      }
    } else if (t === 'drag-x' || t === 'drag-y') {
      var down = false, last = 0, vel = 0, hz = t === 'drag-x';
      var st = this._stage;
      this._on(st, 'pointerdown', function (e) {
        down = true; last = hz ? e.clientX : e.clientY; vel = 0;
        try { st.setPointerCapture(e.pointerId); } catch (x) {}
        st.style.cursor = 'grabbing';
      });
      this._on(st, 'pointermove', function (e) {
        if (!down) return;
        var p = hz ? e.clientX : e.clientY, size = hz ? st.clientWidth : st.clientHeight;
        var d = (p - last) / size * c.drag.sensitivity;
        last = p; vel = d;
        self._addInput(d);
        self._wake();
      });
      var up = function () { down = false; st.style.cursor = 'grab'; self._vel = vel; self._wake(); };
      this._on(st, 'pointerup', up);
      this._on(st, 'pointercancel', up);
      st.style.cursor = 'grab';
      this._vel = 0;
    } else if (t === 'hover') {
      this._on(root, 'pointerenter', function (e) { if (e.pointerType !== 'touch') { self._hoverT = 1; self._wake(); } });
      this._on(root, 'pointerleave', function () { self._hoverT = 0; self._wake(); });
    }
  };

  P._addInput = function (d) {
    var v = this._input + d;
    if (this.cfg.drag.loop) { v = v - Math.floor(v); } else v = clamp(v, 0, 1);
    this._input = v;
  };

  P._initInput = function () {
    var c = this.cfg;
    this._mouse = c.mouse.rest;
    this._hoverT = 0;
    if (c.trigger === 'mouse-x' || c.trigger === 'mouse-y') this._input = c.mouse.rest;
    if (c.trigger === 'autoplay') { this._playing = false; this._t0 = performance.now() + (c.autoplay.delay || 0) * 1000; }
  };

  P._readInput = function (dt) {
    var c = this.cfg, t = c.trigger;
    if (t === 'scroll') {
      var r = this.root.getBoundingClientRect(), vh = global.innerHeight, p;
      if (c.scroll.pin) {
        var travel = r.height - this._stage.getBoundingClientRect().height;
        p = travel > 0 ? -r.top / travel : 0;
      } else {
        var s = vh * c.scroll.startAt / 100, e = vh * c.scroll.endAt / 100;
        var total = (s - e) + r.height;
        p = total > 0 ? (s - r.top) / total : 0;
      }
      return clamp(p, 0, 1);
    }
    if (t === 'mouse-x' || t === 'mouse-y') return this._mouse;
    if (t === 'drag-x' || t === 'drag-y') {
      if (Math.abs(this._vel) > 0.00005 && c.drag.inertia > 0) {
        this._addInput(this._vel);
        this._vel *= Math.pow(c.drag.inertia, dt * 60);
      } else this._vel = 0;
      return this._input;
    }
    if (t === 'hover') {
      var step = dt / Math.max(0.05, c.hover.duration);
      var cur = this._input;
      this._input = this._hoverT > cur ? Math.min(this._hoverT, cur + step) : Math.max(this._hoverT, cur - step);
      return this._input;
    }
    if (t === 'autoplay') {
      var now = performance.now();
      if (!this._visible && c.autoplay.pauseOffscreen) return this._input;
      if (now < this._t0) return this._input;
      var a = c.autoplay, inc = dt * a.fps / Math.max(1, this.n - 1) * this._dir;
      var v = this._input + inc;
      if (v >= 1) { if (a.pingpong) { v = 1; this._dir = -1; } else if (a.loop) v -= 1; else v = 1; }
      else if (v <= 0) { if (a.pingpong && a.loop) { v = 0; this._dir = 1; } else if (a.pingpong) { v = 0; } else v = 0; }
      this._input = v;
      return v;
    }
    return 0;
  };

  P._active_ = function () {
    var t = this.cfg.trigger;
    if (t === 'autoplay') { var a = this.cfg.autoplay; return this._visible || !a.pauseOffscreen; }
    if (t === 'hover') return this._input !== this._hoverT;
    if (t === 'drag-x' || t === 'drag-y') return Math.abs(this._vel) > 0.00005;
    return false;
  };

  /* ---------- loop ---------- */

  P._wake = function () {
    if (this._running || !this._stage || !this.n) return;
    this._running = true;
    this._last = performance.now();
    var self = this, gen = this._gen;
    var step = function (now) {
      if (gen !== self._gen) return;
      var dt = Math.min(0.1, Math.max(0.001, (now - self._last) / 1000));
      self._last = now;
      var more = self._tick(dt);
      if (more) self._raf = requestAnimationFrame(step); else { self._running = false; self._raf = 0; }
    };
    this._raf = requestAnimationFrame(step);
  };

  P._tick = function (dt) {
    var c = this.cfg;
    if (this.reduced) { this._render(clamp(c.a11y.posterFrame / Math.max(1, this.n - 1), 0, 1)); return false; }
    if (this.manual != null) this._input = this.manual;
    var inp = this.manual != null ? this.manual : this._readInput(dt);
    var e = EASE[c.ease] || EASE.linear;
    var x = applyMap(c.map, e(clamp(inp, 0, 1)));
    if (c.reverse) x = 1 - x;
    var r = c.range, tgt = clamp(r[0] + (r[1] - r[0]) * x, 0, 1);
    this._target = tgt;
    if (this._cur == null) this._cur = tgt;
    var sm = c.trigger === 'autoplay' ? 0 : c.smooth;
    if (sm > 0) {
      this._cur += (tgt - this._cur) * (1 - Math.exp(-dt / sm));
      if (Math.abs(tgt - this._cur) < 0.00005) this._cur = tgt;
    } else this._cur = tgt;
    this._render(this._cur);
    return Math.abs(tgt - this._cur) > 0 || this._active_();
  };

  P._near = function (i) {
    var s = this.state, n = this.n;
    if (s[i] === 2) return i;
    for (var d = 1; d < n; d++) {
      if (i - d >= 0 && s[i - d] === 2) return i - d;
      if (i + d < n && s[i + d] === 2) return i + d;
    }
    return -1;
  };

  P._render = function (pos) {
    var n = this.n, f = pos * (n - 1), i = Math.floor(f), fr = f - i;
    var blend = this.cfg.render.blend && fr > 0.02 && i + 1 < n;
    var idx = blend ? i : Math.round(f);
    var a = this._near(idx);
    if (a < 0) return;
    var b = blend ? this._near(i + 1) : -1;
    var key = a + '|' + b + '|' + (blend ? Math.round(fr * 24) : 0) + '|' + this.canvas.width + 'x' + this.canvas.height + '|' + this.loaded;
    if (key !== this._lastKey) {
      this._lastKey = key;
      var ctx = this.ctx, cw = this.canvas.width, ch = this.canvas.height;
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, cw, ch);
      this._drawImg(this.imgs[a], cw, ch);
      if (b >= 0 && b !== a) { ctx.globalAlpha = fr; this._drawImg(this.imgs[b], cw, ch); ctx.globalAlpha = 1; }
      if (!this._drawn) {
        this._drawn = true;
        this.canvas.style.opacity = '1';
        if (this._poster) { var p = this._poster; setTimeout(function () { p.style.display = 'none'; }, this.cfg.render.fadeIn ? 600 : 0); }
      }
    }
    var ri = Math.round(f);
    if (ri !== this._lastIdx) {
      this._lastIdx = ri;
      this.root.style.setProperty('--sk-progress', pos.toFixed(4));
      this.root.dispatchEvent(new CustomEvent('scrollkit:progress', { detail: { progress: pos, frame: ri } }));
      var L = this._layers;
      for (var k = 0; k < L.length; k++) {
        var l = L[k], on = pos >= l.from && pos <= l.to;
        if (on !== l.on) { l.on = on; l.el.classList.toggle('sk-active', on); }
        if (on) l.el.style.setProperty('--sk-local', ((pos - l.from) / Math.max(0.0001, l.to - l.from)).toFixed(4));
      }
    }
  };

  P._drawImg = function (img, cw, ch) {
    var iw = img.naturalWidth, ih = img.naturalHeight;
    if (!iw) return;
    var r = this.cfg.render;
    var s = r.fit === 'contain' ? Math.min(cw / iw, ch / ih) : r.fit === 'fill' ? 0 : Math.max(cw / iw, ch / ih);
    if (r.fit === 'fill') { this.ctx.drawImage(img, 0, 0, cw, ch); return; }
    var dw = iw * s, dh = ih * s;
    this.ctx.drawImage(img, (cw - dw) * r.alignX, (ch - dh) * r.alignY, dw, dh);
  };

  /* ---------- loading ---------- */

  P._startLoading = function (gen) {
    if (this._loading) return;
    this._loading = true;
    var c = this.cfg, conc = Math.max(1, c.loading.concurrency | 0);
    for (var k = 0; k < conc; k++) this._pump(gen);
  };

  P._pump = function (gen) {
    var self = this;
    if (gen !== this._gen) return;
    if (this._qi >= this._order.length) return;
    var i = this._order[this._qi++];
    var img = new Image();
    img.decoding = 'async';
    var done = function (ok) {
      if (gen !== self._gen) return;
      self.state[i] = ok ? 2 : -1;
      if (ok) { self.imgs[i] = img; self.loaded++; }
      var total = self._order.length;
      if (self._loader) {
        self._loader.firstChild.style.width = (self.loaded / total * 100) + '%';
        if (self.loaded >= total) self._loader.style.opacity = '0';
      }
      if (self.loaded === 1 || self.loaded === total || self.loaded % 8 === 0) {
        self._lastKey = '';
        self._wake();
      }
      if (self.loaded === total) self.root.dispatchEvent(new CustomEvent('scrollkit:ready', { detail: { frames: total } }));
      self._pump(gen);
    };
    img.onload = function () {
      if (img.decode) img.decode().then(function () { done(true); }, function () { done(true); });
      else done(true);
    };
    img.onerror = function () { done(false); };
    img.src = this.urls[i];
  };

  /* ---------- public ---------- */

  P.update = function (cfg) { this.raw = cfg; this._build(); this._wake(); };
  P.setProgress = function (p) { this.manual = p == null ? null : clamp(p, 0, 1); this._wake(); };
  P.getProgress = function () { return this._cur; };
  P.destroy = function () {
    this._teardown();
    var i = instances.indexOf(this); if (i >= 0) instances.splice(i, 1);
    if (this._stage.parentNode) this._stage.parentNode.removeChild(this._stage);
    this.root.classList.remove('sk', 'sk--pin');
  };

  /* ---------- auto init ---------- */

  function init(el, cfg, opts) { return new ScrollKit(el, cfg, opts); }

  function auto(scope) {
    var els = (scope || document).querySelectorAll('[data-scrollkit]');
    Array.prototype.forEach.call(els, function (el) {
      if (el.__sk || el.__skPending) return;
      el.__skPending = true;
      var v = el.getAttribute('data-scrollkit').trim();
      var custom = el.getAttribute('data-sk-base');
      if (v.charAt(0) === '{') {
        var cfg; try { cfg = JSON.parse(v); } catch (e) { console.error('[scrollkit] bad inline config', e); return; }
        el.__sk = init(el, cfg, { base: custom || scriptBase });
        return;
      }
      var url;
      if (/\.json(\?|$)/.test(v)) url = v;
      else url = (custom ? custom.replace(/\/?$/, '/') : scriptBase) + v.replace(/\/$/, '') + '/config.json';
      fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (cfg) {
        var base = dirOf(new URL(url, document.baseURI).href);
        el.__sk = init(el, cfg, { base: base });
      }).catch(function (e) { console.error('[scrollkit] cannot load ' + url, e); });
    });
  }

  global.ScrollKit = { init: init, auto: auto, instances: instances, version: '1.0.0', defaults: DEFAULTS };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { auto(); });
  else auto();
})(window);
