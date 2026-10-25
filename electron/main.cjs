const { app, BrowserWindow, ipcMain, shell, Menu, nativeTheme, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { Workspace } = require('./workspace.cjs');
const { Ghci } = require('./ghci.cjs');
const { Codex } = require('./codex.cjs');
const root = path.resolve(__dirname, '..');
if (!app.isPackaged) {
  const runtime = process.env.KATA_RUNTIME || path.join(root, '.runtime'); fs.mkdirSync(runtime, { recursive:true });
  app.setPath('userData', runtime); app.setPath('sessionData', runtime);
}
// Finder-launched macOS apps do not inherit the interactive shell PATH.
process.env.PATH = [...new Set([path.join(os.homedir(), '.ghcup/bin'), path.join(os.homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', ...(process.env.PATH || '').split(path.delimiter)])].join(path.delimiter);
let win, store, workspace, watcher, watchTimer, ghci, codex, closeAllowed = false, rendererReady = false;
const emit = event => { if (win && !win.isDestroyed()) win.webContents.send('kata:event', event); };
app.whenReady().then(async () => {
  nativeTheme.themeSource = 'light';
  workspace = new Workspace(process.env.KATA_WORKSPACE || (app.isPackaged ? path.join(app.getPath('userData'),'workspace') : path.join(root,'workspace')), app.getPath('userData'), process.env.KATA_WORKSPACE);
  await workspace.init(); store = workspace.store;
  function makeCodex() {
    const client = new Codex(store,event => { if (codex === client) emit(event); },process.env.KATA_CODEX || 'codex');
    return client;
  }
  function watchFolder() {
    watcher?.close(); clearTimeout(watchTimer);
    try {
      watcher = fs.watch(store.root,(_, name) => {
        if (name && !/\.hs$/i.test(name.toString())) return;
        clearTimeout(watchTimer);
        watchTimer = setTimeout(() => emit({ type:'workspace-changed' }),180);
      });
      watcher.on('error',error => emit({ type:'notice', message:`フォルダーの監視に失敗しました: ${error.message}` }));
    } catch (error) { emit({ type:'notice', message:error.message }); }
  }
  ghci = new Ghci(emit, process.env.KATA_GHCI || 'ghci'); codex = makeCodex(); watchFolder();
  const handlers = {
    'problems:list': () => store.list(),
    'problems:create': (_, title) => store.create(title),
    'problems:open': (_, id) => store.open(id),
    'problems:save': (_, id, code) => store.save(id, code),
    'workspace:info': () => workspace.info(),
    'workspace:choose': async () => {
      const result = await dialog.showOpenDialog(win,{ title:'Haskellファイルのフォルダーを選択', defaultPath:store.root, properties:['openDirectory','createDirectory'] });
      if (result.canceled || !result.filePaths[0]) return null;
      const previous = store.root;
      const info = await workspace.setFolder(result.filePaths[0]);
      if (info.path === previous) return null;
      ghci.close(); codex.close(); store = workspace.store;
      ghci = new Ghci(emit,process.env.KATA_GHCI || 'ghci'); codex = makeCodex(); watchFolder();
      return info;
    },
    'problems:reveal': (_, id) => shell.showItemInFolder(store.file(id)),
    'ghci:start': (_, id) => ghci.start(id, store.file(id)),
    'ghci:run': (_, id, cmd) => { if (typeof cmd !== 'string' || cmd.length > 50000 || !cmd.trim()) throw new Error('実行式を入力してください'); return ghci.run(id, cmd); },
    'ghci:interrupt': (_, id) => ghci.interrupt(id),
    'ghci:restart': async (_, id) => { const s = ghci.sessions.get(id); if (s) { ghci.stop(id); await new Promise(resolve => { if (s.closed) resolve(); else s.proc.once('exit', resolve); }); } return ghci.start(id, store.file(id)); },
    'codex:connect': () => codex.connect(),
    'codex:status': () => codex.status,
    'codex:ask': (_, id, text, context, model) => codex.ask(id, text, context, model),
    'codex:interrupt': (_, id) => codex.interrupt(id),
    'app:close-ready': async () => { await store.writes; closeAllowed = true; win.close(); }
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== win?.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Unknown sender');
    return handler(event, ...args);
  });
  ipcMain.on('app:renderer-ready', event => { if (event.sender === win?.webContents) rendererReady = true; });
  function createWindow() {
    closeAllowed = false; rendererReady = false;
    win = new BrowserWindow({ width:1512, height:980, minWidth:1100, minHeight:700, backgroundColor:'#ffffff', title:'Kata — Haskell workspace', titleBarStyle:'hiddenInset', trafficLightPosition:{ x:20, y:20 }, webPreferences:{ preload:path.join(__dirname,'preload.cjs'), contextIsolation:true, nodeIntegration:false, sandbox:true } });
    win.webContents.setWindowOpenHandler(() => ({ action:'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('render-process-gone', () => { rendererReady = false; });
    win.on('close', event => {
      if (closeAllowed || !rendererReady) return;
      event.preventDefault();
      emit({ type:'before-close' });
    });
    if (process.env.KATA_DEV_URL) win.loadURL(process.env.KATA_DEV_URL); else win.loadFile(path.join(root,'dist/index.html'));
    win.on('closed', () => { watcher?.close(); clearTimeout(watchTimer); ghci.close(); codex.close(); win = null; });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label:'Kata', submenu:[{ role:'about' }, { type:'separator' }, { role:'hide' }, { role:'quit' }] },
    { label:'Edit', submenu:[{ role:'undo' }, { role:'redo' }, { type:'separator' }, { role:'cut' }, { role:'copy' }, { role:'paste' }, { role:'selectAll' }] },
    { label:'View', submenu:[{ role:'reload' }, { role:'toggleDevTools' }, { role:'resetZoom' }, { role:'zoomIn' }, { role:'zoomOut' }, { role:'togglefullscreen' }] }
  ]));
  createWindow(); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
}).catch(error => { console.error(error); app.quit(); });
app.on('window-all-closed', () => app.quit());
