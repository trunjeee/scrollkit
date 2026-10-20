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
  await ex(`window.__test.load(${JSON.stringify(process.env.SK_VIDEO)})`);
  await sleep(9000);
  const pvf = wc.mainFrame.frames.find((f) => f.url.includes('preview.html'));
  await pvf.executeJavaScript(`window.scrollTo(0, innerHeight*2.3)`);
  await sleep(1500);
  await shot('main');
  await ex(`document.getElementById('side').scrollTop = 1250`);
  await sleep(400);
  await shot('animation');
  await ex(`document.querySelectorAll('#devSeg button')[2].click()`);
  await sleep(1500);
  await ex(`document.getElementById('side').scrollTop = 0`);
  await pvf.executeJavaScript(`window.scrollTo(0, innerHeight*1.8)`);
  await sleep(1500);
  await shot('mobile');
  console.log('ERRS', await ex(`JSON.stringify(window.__errs||[])`));
  process.exit(0);
};
