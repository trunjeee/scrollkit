const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const ff = require('./ffmpeg');
const { exportProject } = require('./exporter');

let win = null;
const previewJobs = {};
let exportAbort = null;
const previewRoot = path.join(os.tmpdir(), 'scrollkit-preview-' + process.pid);

function createWindow() {
  win = new BrowserWindow({
    width: 1480, height: 940, minWidth: 1100, minHeight: 700,
    backgroundColor: '#0e0e10',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (process.env.SK_SMOKE) win.webContents.once('did-finish-load', () => require('../../test/smoke')(win));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }
  ]));
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
app.on('quit', () => { fs.rmSync(previewRoot, { recursive: true, force: true }); });

ipcMain.handle('app:paths', () => ({
  runtime: pathToFileURL(path.join(__dirname, '..', '..', 'runtime', 'scrollkit.js')).href,
  home: app.getPath('documents'),
  platform: process.platform,
  version: app.getVersion()
}));

ipcMain.handle('dialog:video', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'mxf', 'gif'] }] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialog:dir', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('project:save', async (_e, S) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: (S.name || 'project') + '.scrollkit.json', filters: [{ name: 'ScrollKit project', extensions: ['json'] }] });
  if (r.canceled) return null;
  await fs.promises.writeFile(r.filePath, JSON.stringify(S, null, 2));
  return r.filePath;
});
ipcMain.handle('project:open', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'ScrollKit project', extensions: ['json'] }] });
  if (r.canceled) return null;
  return JSON.parse(await fs.promises.readFile(r.filePaths[0], 'utf8'));
});
ipcMain.handle('shell:reveal', (_e, p) => { shell.showItemInFolder(p); });
ipcMain.handle('shell:open', (_e, p) => shell.openPath(p));

ipcMain.handle('video:probe', async (_e, file) => {
  try { return { ok: true, info: await ff.probe(file) }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});

ipcMain.handle('video:estimate', async (_e, o) => {
  try { return { ok: true, ...(await ff.sampleSize(o)) }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});

// low-res preview frames; a newer request for the same kind cancels the previous one
ipcMain.handle('preview:build', async (_e, req) => {
  const { kind, rid } = req;
  if (previewJobs[kind]) previewJobs[kind].abort();
  const ac = new AbortController();
  previewJobs[kind] = ac;
  const outDir = path.join(previewRoot, kind + '-' + rid);
  try {
    const r = await ff.extractFrames({ ...req.o, outDir, format: 'jpg', quality: 85, signal: ac.signal, maxCount: 300,
      onProgress: (p) => win && win.webContents.send('preview:progress', { kind, p }) });
    // clean older dirs of this kind
    for (const d of await fs.promises.readdir(previewRoot).catch(() => [])) {
      if (d.startsWith(kind + '-') && d !== kind + '-' + rid) fs.promises.rm(path.join(previewRoot, d), { recursive: true, force: true });
    }
    return { ok: true, base: pathToFileURL(previewRoot).href + '/', dir: kind + '-' + rid, count: r.count, width: r.width, height: r.height, bytes: r.bytes };
  } catch (e) {
    return e.cancelled ? { ok: false, cancelled: true } : { ok: false, error: String(e.message || e) };
  } finally { if (previewJobs[kind] === ac) delete previewJobs[kind]; }
});

ipcMain.handle('export:run', async (_e, S) => {
  exportAbort = new AbortController();
  try {
    const outRoot = S.x.outDir;
    const res = await exportProject(S, outRoot, {
      signal: exportAbort.signal,
      onProgress: (p) => win && win.webContents.send('export:progress', p)
    });
    return { ok: true, ...res };
  } catch (e) {
    return e.cancelled ? { ok: false, cancelled: true } : { ok: false, error: String(e.message || e) };
  } finally { exportAbort = null; }
});
ipcMain.handle('export:cancel', () => { if (exportAbort) exportAbort.abort(); });
