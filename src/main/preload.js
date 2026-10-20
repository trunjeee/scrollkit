const { contextBridge, ipcRenderer, webUtils } = require('electron');
const inv = (c) => (...a) => ipcRenderer.invoke(c, ...a);
const sub = (c) => (fn) => { const h = (_e, d) => fn(d); ipcRenderer.on(c, h); return () => ipcRenderer.removeListener(c, h); };
contextBridge.exposeInMainWorld('api', {
  paths: inv('app:paths'),
  pickVideo: inv('dialog:video'),
  pickDir: inv('dialog:dir'),
  pathForFile: (f) => webUtils.getPathForFile(f),
  probe: inv('video:probe'),
  estimate: inv('video:estimate'),
  buildPreview: inv('preview:build'),
  exportRun: inv('export:run'),
  exportCancel: inv('export:cancel'),
  saveProject: inv('project:save'),
  openProject: inv('project:open'),
  reveal: inv('shell:reveal'),
  open: inv('shell:open'),
  onPreviewProgress: sub('preview:progress'),
  onExportProgress: sub('export:progress')
});
