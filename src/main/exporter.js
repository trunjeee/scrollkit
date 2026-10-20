const fs = require('fs');
const path = require('path');
const { extractFrames } = require('./ffmpeg');
const shared = require('../shared/config');

const RUNTIME = path.join(__dirname, '..', '..', 'runtime', 'scrollkit.js');

async function minify(code) {
  try {
    const { minify: tmin } = require('terser');
    const r = await tmin(code, { compress: true, mangle: true, format: { comments: /^!/ } });
    return r.code || code;
  } catch (e) { return code; }
}

const norm = (p) => (p || '/').replace(/\\/g, '/').replace(/\/?$/, '/');

function snippets(S, cfg, slug, posterExt) {
  const pub = norm(S.x.publicPath);
  const poster = posterExt ? `\n  <img class="sk-poster" src="${pub}${slug}/poster.${posterExt}" alt="">` : '';
  const a = cfg.trigger === 'scroll' && cfg.scroll.pin ? '' : '';
  const html =
`<!-- ScrollKit · ${slug} -->
<div data-scrollkit="${slug}">${poster}
  <!-- optional overlay content: <div data-sk-from="0.2" data-sk-to="0.6">Text</div> -->
</div>
<script src="${pub}scrollkit.min.js" defer></script>`;
  const inline =
`<div data-scrollkit='${JSON.stringify(cfg).replace(/'/g, '&#39;')}' data-sk-base="${pub}${slug}/">${poster}
</div>
<script src="${pub}scrollkit.min.js" defer></script>`;
  return { html, inline };
}

function demoPage(S, cfg, slug, posterExt) {
  const poster = posterExt ? `<img class="sk-poster" src="poster.${posterExt}" alt="">` : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ScrollKit demo · ${slug}</title>
<style>
  body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#0b0b0d;color:#eee}
  .pad{min-height:70vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;color:#888}
  [data-sk-from]{position:absolute;left:8%;bottom:12%;max-width:420px;font-size:28px;opacity:0;transition:opacity .4s}
  [data-sk-from].sk-active{opacity:1}
</style></head>
<body>
<div class="pad">↓ scroll down / scroll-demo ↓</div>
<div data-scrollkit='${JSON.stringify(cfg).replace(/'/g, '&#39;')}' data-sk-base="./">${poster}
  <div data-sk-from="0.1" data-sk-to="0.5">Overlay text appears at 10–50%</div>
</div>
<div class="pad">The end</div>
<script src="../scrollkit.min.js"></script>
</body></html>
`;
}

async function exportProject(S, outRoot, opts) {
  const { onProgress, signal } = opts;
  const slug = shared.slug(S.name);
  const dir = path.join(outRoot, slug);
  await fs.promises.mkdir(dir, { recursive: true });

  const jobs = [];
  const base = {
    start: S.trim.start || 0, end: S.trim.end || 0,
    format: S.d.format, signal
  };
  jobs.push({
    key: 'desktop',
    o: { ...base, input: S.src.desktop, srcDuration: S.info.desktop.duration, mode: S.d.mode, count: S.d.count, fps: S.d.fps, width: S.d.width, quality: S.d.quality, outDir: path.join(dir, 'desktop') }
  });
  if (S.m.enabled) {
    const useOwn = S.m.source === 'file' && S.src.mobile;
    const info = useOwn ? S.info.mobile : S.info.desktop;
    jobs.push({
      key: 'mobile',
      o: { ...base, format: S.m.format, input: useOwn ? S.src.mobile : S.src.desktop, srcDuration: info.duration, mode: S.m.mode, count: S.m.count, fps: S.m.fps, width: S.m.width, quality: S.m.quality, crop: { aspect: S.m.aspect, x: S.m.cropX, y: S.m.cropY }, outDir: path.join(dir, 'mobile') }
    });
  }

  const frames = {};
  let total = 0;
  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i];
    const r = await extractFrames({ ...j.o, onProgress: (p) => onProgress && onProgress({ stage: j.key, p: (i + p) / jobs.length }) });
    frames[j.key] = { dir: j.key, count: r.count, ext: r.ext, pad: Math.max(4, String(r.count).length), start: 1, width: r.width, height: r.height };
    total += r.bytes;
  }

  // poster = chosen frame of desktop set
  const pf = frames.desktop;
  const pIdx = Math.min(pf.count, Math.max(1, (S.a.a11y.posterFrame || 0) + 1));
  const pName = String(pIdx).padStart(pf.pad, '0') + '.' + pf.ext;
  let posterExt = null;
  try {
    await fs.promises.copyFile(path.join(dir, 'desktop', pName), path.join(dir, 'poster.' + pf.ext));
    posterExt = pf.ext;
  } catch (e) {}

  const cfg = shared.buildConfig(S, frames, { v: Date.now().toString(36) });
  await fs.promises.writeFile(path.join(dir, 'config.json'), JSON.stringify(cfg, null, 2));

  const code = await fs.promises.readFile(RUNTIME, 'utf8');
  await fs.promises.writeFile(path.join(outRoot, 'scrollkit.js'), code);
  await fs.promises.writeFile(path.join(outRoot, 'scrollkit.min.js'), await minify(code));

  const sn = snippets(S, cfg, slug, posterExt);
  await fs.promises.writeFile(path.join(dir, 'embed.html'), sn.html + '\n\n<!-- Variant B: inline config (no fetch) -->\n' + sn.inline + '\n');
  await fs.promises.writeFile(path.join(dir, 'demo.html'), demoPage(S, cfg, slug, posterExt));
  await fs.promises.writeFile(path.join(dir, 'project.scrollkit.json'), JSON.stringify(S, null, 2));

  return { dir, outRoot, slug, frames, bytes: total, snippet: sn.html, snippetInline: sn.inline, config: cfg };
}

module.exports = { exportProject };
