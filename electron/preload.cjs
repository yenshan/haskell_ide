const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('kata', {
  list: () => ipcRenderer.invoke('problems:list'),
  create: title => ipcRenderer.invoke('problems:create', title),
  open: id => ipcRenderer.invoke('problems:open', id),
  save: (id, code) => ipcRenderer.invoke('problems:save', id, code),
  workspaceInfo: () => ipcRenderer.invoke('workspace:info'),
  chooseFolder: () => ipcRenderer.invoke('workspace:choose'),
  ghciWrite: (id, data) => ipcRenderer.invoke('ghci:write', id, data),
  ghciResize: (id, cols, rows) => ipcRenderer.invoke('ghci:resize', id, cols, rows),
  ghciStop: id => ipcRenderer.invoke('ghci:stop', id),
  codexConnect: () => ipcRenderer.invoke('codex:connect'),
  codexStatus: () => ipcRenderer.invoke('codex:status'),
  ask: (id, text, context, model, effort, source) => ipcRenderer.invoke('codex:ask', id, text, context, model, effort, source),
  stopAI: id => ipcRenderer.invoke('codex:interrupt', id),
  ghciSnapshot: id => ipcRenderer.invoke('ghci:snapshot', id),
  ghciLoad: (id, cols, rows) => ipcRenderer.invoke('ghci:load', id, cols, rows),
  ghciDiagnosticReport: id => ipcRenderer.invoke('ghci:diagnostic-report', id),
  ghciExplain: (id, token, model, effort) => ipcRenderer.invoke('ghci:explain', id, token, model, effort),
  reveal: id => ipcRenderer.invoke('problems:reveal', id),
  closeReady: () => ipcRenderer.invoke('app:close-ready'),
  onEvent: callback => { const listener = (_, event) => callback(event); ipcRenderer.on('kata:event', listener); ipcRenderer.send('app:renderer-ready'); return () => ipcRenderer.removeListener('kata:event', listener); }
});
