const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('kata', {
  list: () => ipcRenderer.invoke('problems:list'),
  create: title => ipcRenderer.invoke('problems:create', title),
  open: id => ipcRenderer.invoke('problems:open', id),
  save: (id, code) => ipcRenderer.invoke('problems:save', id, code),
  workspaceInfo: () => ipcRenderer.invoke('workspace:info'),
  chooseFolder: () => ipcRenderer.invoke('workspace:choose'),
  ghciStart: (id, cols, rows) => ipcRenderer.invoke('ghci:start', id, cols, rows),
  ghciWrite: (id, data) => ipcRenderer.invoke('ghci:write', id, data),
  ghciResize: (id, cols, rows) => ipcRenderer.invoke('ghci:resize', id, cols, rows),
  ghciReload: id => ipcRenderer.invoke('ghci:reload', id),
  ghciRestart: id => ipcRenderer.invoke('ghci:restart', id),
  codexConnect: () => ipcRenderer.invoke('codex:connect'),
  codexStatus: () => ipcRenderer.invoke('codex:status'),
  ask: (id, text, context, model, effort) => ipcRenderer.invoke('codex:ask', id, text, context, model, effort),
  stopAI: id => ipcRenderer.invoke('codex:interrupt', id),
  reveal: id => ipcRenderer.invoke('problems:reveal', id),
  closeReady: () => ipcRenderer.invoke('app:close-ready'),
  onEvent: callback => { const listener = (_, event) => callback(event); ipcRenderer.on('kata:event', listener); ipcRenderer.send('app:renderer-ready'); return () => ipcRenderer.removeListener('kata:event', listener); }
});
