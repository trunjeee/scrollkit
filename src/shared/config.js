/* Shared between main (require) and renderer (script tag): project defaults + runtime config builder. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SKShared = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function defaults() {
    return {
      name: 'hero',
      src: { desktop: null, mobile: null },
      info: { desktop: null, mobile: null },
      trim: { start: 0, end: 0 },
      d: { format: 'webp', quality: 80, width: 1920, mode: 'count', count: 120, fps: 24 },
      m: {
        enabled: true, source: 'same', format: 'webp', quality: 72, width: 720,
        mode: 'count', count: 60, fps: 12, aspect: '9:16', cropX: 0.5, cropY: 0.5, breakpoint: 768
      },
      a: {
        trigger: 'scroll',
        range: [0, 1],
        reverse: false,
        map: [[0, 0], [1, 1]],
        ease: 'linear',
        smooth: 0.15,
        touchFallback: 'scroll',
        scroll: { pin: true, pinHeight: 400, startAt: 100, endAt: 0 },
        mouse: { area: 'section', rest: 0.5, returnToRest: true, sensitivity: 1 },
        drag: { sensitivity: 1, inertia: 0.92, loop: false },
        autoplay: { fps: 30, loop: true, pingpong: false, pauseOffscreen: true, delay: 0 },
        hover: { duration: 1.5 },
        render: { fit: 'cover', alignX: 0.5, alignY: 0.5, background: 'transparent', maxDpr: 2, blend: false, fadeIn: true, height: '100vh' },
        loading: { strategy: 'progressive', concurrency: 6, rootMargin: '300px', loader: 'bar' },
        a11y: { reducedMotion: 'poster', posterFrame: 0, label: '' }
      },
      am: { trigger: '', pinHeight: 0, smooth: -1, fit: '' },
      x: { outDir: '', publicPath: '/assets/scrollkit/' }
    };
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function mobileOverrides(am) {
    var o = {};
    if (am.trigger) o.trigger = am.trigger;
    if (am.pinHeight > 0) o.scroll = { pinHeight: am.pinHeight };
    if (am.smooth >= 0) o.smooth = am.smooth;
    if (am.fit) o.render = { fit: am.fit };
    return o;
  }

  // frames: { desktop:{dir,count,ext,pad,start,width,height}, mobile?:{...} }
  function buildConfig(S, frames, extra) {
    var cfg = {
      version: 1,
      name: S.name,
      v: (extra && extra.v) || undefined,
      breakpoint: S.m.breakpoint,
      frames: frames
    };
    var a = clone(S.a);
    for (var k in a) cfg[k] = a[k];
    if (cfg.map && cfg.map.length === 2 && cfg.map[0][0] === 0 && cfg.map[0][1] === 0 && cfg.map[1][0] === 1 && cfg.map[1][1] === 1) delete cfg.map;
    var mo = mobileOverrides(S.am);
    if (Object.keys(mo).length && frames.mobile) cfg.mobile = mo;
    return cfg;
  }

  function slug(s) {
    return String(s || 'section').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
  }

  return { defaults: defaults, clone: clone, buildConfig: buildConfig, slug: slug, mobileOverrides: mobileOverrides };
});
