// Dev-only smoke test: SK_SMOKE=1 npx electron .   (screenshots to $SK_OUT)
const fs = require('fs');
const path = require('path');
module.exports = async function smoke(win) {
  const out = process.env.SK_OUT || '/tmp/sk-smoke';
  fs.mkdirSync(out, { recursive: true });
  const wc = win.webContents;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (n) => fs.writeFileSync(path.join(out, n + '.png'), (await wc.capturePage()).toPNG());
  const ex = (code) => wc.executeJavaScript(code);
  await sleep(1500);
  await shot('01-empty');
  await ex(`window.__setVideo && 1`);
  await ex(`(async()=>{ const r = await window.__test.load(${JSON.stringify(process.env.SK_VIDEO)}); return r; })()`);
  await sleep(6000);
  await shot('02-loaded');
  const pvf = wc.mainFrame.frames.find((f) => f.url.includes('preview.html'));
  if (pvf) {
    await pvf.executeJavaScript(`window.scrollTo(0, innerHeight*2.2)`);
    await sleep(1200);
    await shot('03-scrolled');
    console.log('PV', await pvf.executeJavaScript(`JSON.stringify({n:ScrollKit.instances[0]&&ScrollKit.instances[0].n,loaded:ScrollKit.instances[0]&&ScrollKit.instances[0].loaded,cur:ScrollKit.instances[0]&&ScrollKit.instances[0]._cur, errs: window.__errs})`));
  }
  const logs = await ex(`JSON.stringify(window.__errs||[])`);
  console.log('ERRS', logs);
  process.exit(0);
};
