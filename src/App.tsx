import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Plus, Search, ChevronDown, ArrowUp, Check, Circle, Command, FolderOpen, Loader2, PanelLeftClose, PanelLeftOpen, Play, RotateCcw, Save, Sparkles, Square, Terminal, X, CheckCheck, Type, PanelBottom, PanelRight } from 'lucide-react';
import { Editor } from './Editor';
import { GhciTerminal, type TerminalHandle } from './GhciTerminal';
import { SidebarResizer } from './SidebarResizer';
import { FontSettings } from './FontSettings';
import { fontSettingsKey, loadFontSettings } from './fonts';
import { editorThemeKey, loadEditorTheme } from './editorThemes';
import { usePaneNavigation } from './usePaneNavigation';
import type { AppEvent, CodexStatus, Message, Problem, Diagnostic, Summary, WorkspaceInfo, GhciReport } from './types';

const api = window.kata;
const time = (date:string) => new Date(date).toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit' });
const fileDate = (value:string) => new Date(value).toLocaleDateString('ja-JP', { year:'numeric', month:'2-digit', day:'2-digit' });
function Logo({ small = false }:{ small?:boolean }) { return <span className={`haskell-logo ${small?'small':''}`}>λ<span>=</span></span>; }

type SidebarWidths = { left:number; right:number };
type GhciLoadState = { source:string; phase:'loading'|'analyzing'|'done'|'error'; report?:GhciReport; note?:string };
const noInlineDiagnostics:GhciReport['diagnostics'] = [];
function initialSidebarWidths():SidebarWidths {
  const fallback = { left:window.innerWidth >= 1500 ? 254 : window.innerWidth <= 1200 ? 216 : 244,right:window.innerWidth >= 1500 ? 380 : 330 };
  try {
    const saved = JSON.parse(localStorage.getItem('kata-sidebar-widths') || 'null');
    return { left:Number.isFinite(saved?.left) ? Math.max(180,Math.min(480,saved.left)) : fallback.left,
      right:Number.isFinite(saved?.right) ? Math.max(280,Math.min(640,saved.right)) : fallback.right };
  } catch { return fallback; }
}
function initialAssistantOpen() {
  try { return localStorage.getItem('kata-ai-sidebar-open') !== 'off'; } catch { return true; }
}
function initialAISettings():{ model:string; effort:string } {
  try {
    const saved = JSON.parse(localStorage.getItem('kata-ai-settings') || 'null');
    return { model:typeof saved?.model === 'string' ? saved.model : '',effort:typeof saved?.effort === 'string' ? saved.effort : '' };
  } catch { return { model:'',effort:'' }; }
}

export function App() {
  const [items,setItems] = useState<Summary[]>([]); const [problem,setProblem] = useState<Problem|null>(null);
  const problemRef = useRef<Problem|null>(null); const codeRef = useRef(''); const dirtyRef = useRef(false);
  const folderEpoch = useRef(0);
  const [code,setCode] = useState(''); const [dirty,setDirty] = useState(false); const [saving,setSaving] = useState(false);
  const [query,setQuery] = useState('');
  const [newOpen,setNewOpen] = useState(false); const [newTitle,setNewTitle] = useState('');
  const [left,setLeft] = useState(true);
  const [right,setRight] = useState(initialAssistantOpen);
  const [ghciSide,setGhciSide] = useState(() => {
    try { return localStorage.getItem('kata-ghci-layout') === 'side'; } catch { return false; }
  });
  const [preferredGhciWidth,setPreferredGhciWidth] = useState(() => {
    try { const saved = Number(localStorage.getItem('kata-ghci-width')); return saved >= 220 && saved <= 1200 ? saved : 380; } catch { return 380; }
  });
  const [preferredWidths,setPreferredWidths] = useState(initialSidebarWidths);
  const [layoutWidth,setLayoutWidth] = useState(window.innerWidth);
  const layoutRef=useRef<HTMLDivElement>(null);
  const leftMax = Math.max(180,Math.min(480,layoutWidth-467));
  const leftWidth = left ? Math.min(preferredWidths.left,leftMax) : 42;
  const workspaceWidth = layoutWidth-leftWidth-(left ? 5 : 0)-42;
  const rightMax = Math.max(280,Math.min(640,workspaceWidth+42));
  const assistantWidth = Math.min(preferredWidths.right,rightMax);
  const ghciMax = Math.max(220,workspaceWidth-225);
  const ghciWidth = Math.min(preferredGhciWidth,ghciMax);
  const [vimEnabled,setVimEnabled] = useState(() => localStorage.getItem('kata-vim') !== 'off');
  const [fontSettings,setFontSettings] = useState(loadFontSettings);
  const [editorTheme,setEditorTheme] = useState(loadEditorTheme);
  const [fontSettingsOpen,setFontSettingsOpen] = useState(false);
  const [mode,setMode] = useState('NORMAL'); const [cursor,setCursor] = useState([1,1]);
  const [diagnostics,setDiagnostics] = useState<Record<string,Diagnostic>>({}); const [busy,setBusy] = useState<Record<string,boolean>>({});
  const [loads,setLoads] = useState<Record<string,GhciLoadState>>({});
  const loadVersions = useRef<Record<string,number>>({});
  const loadingGhci = useRef(new Set<string>());
  const [dead,setDead] = useState<Record<string,boolean>>({}); const [generation,setGeneration] = useState<Record<string,number>>({});
  const [question,setQuestion] = useState('');
  const [aiSettings,setAISettings] = useState(initialAISettings);
  const [codexStatus,setCodexStatus] = useState<CodexStatus>({ state:'disconnected',message:'未接続',models:[] });
  const selectedModel = codexStatus.models.find(model => model.id === aiSettings.model) || codexStatus.models.find(model => model.id === codexStatus.defaultModel) || codexStatus.models.find(model => model.isDefault) || codexStatus.models[0];
  const model = selectedModel?.id || '';
  const efforts = selectedModel?.supportedReasoningEfforts || [];
  const defaultEffort = model === codexStatus.defaultModel && efforts.some(option => option.effort === codexStatus.defaultReasoningEffort) ? codexStatus.defaultReasoningEffort : selectedModel?.defaultReasoningEffort;
  const effort = efforts.find(option => option.effort === aiSettings.effort)?.effort || efforts.find(option => option.effort === defaultEffort)?.effort || efforts[0]?.effort || '';
  const [chatMap,setChatMap] = useState<Record<string,Message[]>>({});
  const sendingQuestions = useRef(new Set<string>());
  const [folder,setFolder] = useState<WorkspaceInfo|null>(null); const [choosingFolder,setChoosingFolder] = useState(false);
  const [toast,setToast] = useState(''); const [loading,setLoading] = useState(true); const switching = useRef(false);
  const [help,setHelp] = useState(false); const chatArea = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<TerminalHandle>(null); const questionInput = useRef<HTMLInputElement>(null); const split = useRef<HTMLDivElement>(null);
  const id = problem?.id || '';
  const messages = chatMap[id] || problem?.messages || []; const aiBusy = messages.some(x => x.pending);
  const lastError = diagnostics[id];
  const loadState = loads[id];
  const [dismissedLoadStatus,setDismissedLoadStatus] = useState<GhciLoadState|null>(null);
  useEffect(() => {
    if (!loadState || !['done','error'].includes(loadState.phase)) return;
    const timer = setTimeout(() => setDismissedLoadStatus(loadState),6500);
    return () => clearTimeout(timer);
  },[loadState]);
  const notify = useCallback((error:unknown) => setToast(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /,'') : String(error)), []);
  const connectCodex = useCallback(async () => {
    const epoch = folderEpoch.current;
    try { const status = await api.codexConnect(); if (epoch === folderEpoch.current) setCodexStatus(status); }
    catch (error) { if (epoch === folderEpoch.current) { setCodexStatus(prev => ({ ...prev,state:'error',message:String(error) })); notify(error); } }
  },[notify]);
  useEffect(() => {
    if (api && id && codexStatus.state === 'disconnected') void connectCodex();
  },[id,codexStatus.state,connectCodex]);
  useEffect(() => {
    try { localStorage.setItem('kata-ai-settings',JSON.stringify(aiSettings)); } catch { notify('AIモデル設定を保存できませんでした。'); }
  },[aiSettings,notify]);
  useEffect(() => {
    try { localStorage.setItem(fontSettingsKey,JSON.stringify(fontSettings)); }
    catch { notify('フォント設定を保存できませんでした。'); }
  },[fontSettings,notify]);
  useEffect(() => {
    try { localStorage.setItem(editorThemeKey,editorTheme); }
    catch { notify('配色テーマを保存できませんでした。'); }
  },[editorTheme,notify]);
  useEffect(() => {
    const layout=layoutRef.current; if (!layout) return;
    const update=() => setLayoutWidth(layout.clientWidth);
    update(); const observer=new ResizeObserver(update); observer.observe(layout);
    return () => observer.disconnect();
  },[]);
  useEffect(() => {
    const timer=setTimeout(() => { try { localStorage.setItem('kata-sidebar-widths',JSON.stringify(preferredWidths)); } catch {} },200);
    return () => clearTimeout(timer);
  },[preferredWidths]);
  useEffect(() => {
    try { localStorage.setItem('kata-ghci-width',String(preferredGhciWidth)); } catch {}
  },[preferredGhciWidth]);
  useEffect(() => {
    try { localStorage.setItem('kata-ghci-layout',ghciSide ? 'side' : 'bottom'); } catch {}
  },[ghciSide]);
  useEffect(() => {
    try { localStorage.setItem('kata-ai-sidebar-open',right ? 'on' : 'off'); } catch {}
  },[right]);
  const refresh = useCallback(async () => {
    const epoch = folderEpoch.current;
    const list = await api.list(); if (epoch !== folderEpoch.current) return;
    setItems(list);
    const current = problemRef.current;
    if (!current || dirtyRef.current) return;
    if (!list.some(item => item.id === current.id)) {
      problemRef.current = null; codeRef.current = ''; setProblem(null); setCode('');
      return;
    }
    const latest = await api.open(current.id);
    if (epoch === folderEpoch.current && problemRef.current?.id === current.id && !dirtyRef.current && codeRef.current !== latest.code) {
      problemRef.current = latest; codeRef.current = latest.code; setProblem(latest); setCode(latest.code);
    }
  }, []);
  const clearLoadMessages = useCallback((target:string) => {
    loadVersions.current[target] = (loadVersions.current[target] || 0)+1;
    setLoads(prev => { const next = { ...prev }; delete next[target]; return next; });
  },[]);
  const save = useCallback(async (clearMessages = true) => {
    const p = problemRef.current; if (!p) return;
    if (!dirtyRef.current) { if (clearMessages) clearLoadMessages(p.id); return; }
    const text = codeRef.current; setSaving(true);
    try {
      await api.save(p.id, text);
      if (clearMessages) clearLoadMessages(p.id);
      if (problemRef.current?.id === p.id && codeRef.current === text) { dirtyRef.current = false; setDirty(false); }
      await refresh();
    } finally { setSaving(false); }
  }, [refresh,clearLoadMessages]);
  const activate = useCallback(async (p:Problem) => {
    problemRef.current = p; codeRef.current = p.code; dirtyRef.current = false;
    setProblem(p); setCode(p.code); setDirty(false);
    setQuestion(''); setChatMap(prev => ({ ...prev, [p.id]:p.messages }));
    localStorage.setItem('kata-last',p.id);
  }, []);
  const confirmDiscard = useCallback(() => !dirtyRef.current || window.confirm('未保存の変更があります。保存せずに続けますか？\n保存する場合はキャンセルして、⌘S / Ctrl+S を押してください。'),[]);
  const open = useCallback(async (next:string) => {
    if (switching.current || next === problemRef.current?.id || !confirmDiscard()) return;
    switching.current = true;
    try { await activate(await api.open(next)); }
    catch (e) { notify(e); } finally { switching.current = false; }
  }, [activate,confirmDiscard,notify]);
  useEffect(() => {
    if (!api) { setLoading(false); return; }
    const unsub = api.onEvent((event:AppEvent) => {
      if (event.type === 'before-close') {
        if (confirmDiscard()) api.closeReady().catch(notify);
      }
      if (event.type === 'workspace-changed') refresh().catch(notify);
      if (event.type === 'ghci-diagnostic') { setDiagnostics(prev => ({ ...prev,[event.id]:event.diagnostic })); analyzeDiagnosticRef.current(event.id); }
      if (event.type === 'ghci-exit') setDead(prev => ({ ...prev, [event.id]:true }));
      if (event.type === 'notice') notify(event.message);
      if (event.type === 'codex-status') setCodexStatus(event.status);
      if (event.type === 'ai-messages') setChatMap(prev => ({ ...prev, [event.id]:event.messages }));
      if (event.type === 'ai-message') setChatMap(prev => {
        const list = prev[event.id] || [];
        return { ...prev, [event.id]:list.some(m => m.id === event.message.id) ? list.map(m => m.id === event.message.id ? event.message : m) : [...list,event.message] };
      });
    });
    let disposed = false;
    (async () => {
      try {
        const [list,info] = await Promise.all([api.list(),api.workspaceInfo()]); if (disposed) return; setItems(list); setFolder(info);
        if (info.warning) notify(info.warning);
        const last = localStorage.getItem('kata-last'); const selected = list.find(x => x.id === last) || list[0];
        if (selected) await activate(await api.open(selected.id));
        if (!disposed) setCodexStatus(await api.codexStatus());
      } catch (e) { if (!disposed) notify(e); } finally { if (!disposed) setLoading(false); }
    })();
    return () => { disposed = true; unsub(); };
  }, [activate,notify,refresh,confirmDiscard]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''),6500); return () => clearTimeout(t); }, [toast]);
  useEffect(() => {
    if (chatArea.current) chatArea.current.scrollTop = chatArea.current.scrollHeight;
  },[messages.at(-1)?.text,id]);
  useEffect(() => {
    const area = chatArea.current;
    if (!area) return;
    const observer = new ResizeObserver(() => { area.scrollTop = area.scrollHeight; });
    observer.observe(area); return () => observer.disconnect();
  },[id]);
  const focusGhci = useCallback(() => {
    setRight(false);
    requestAnimationFrame(() => terminalRef.current?.focus());
  },[]);
  const analyzeDiagnosticRef = useRef<(target:string)=>void>(() => {});
  const run = useCallback(async (restartSession = false, diagnosticId?:string) => {
    const p = diagnosticId ? items.find(item => item.id === diagnosticId) : problemRef.current;
    if (!p || loadingGhci.current.has(p.id)) return;
    const epoch = folderEpoch.current;
    const source = p.id === problemRef.current?.id ? codeRef.current : '';
    const version = (loadVersions.current[p.id] || 0)+1;
    loadVersions.current[p.id] = version;
    loadingGhci.current.add(p.id);
    const update = (state:GhciLoadState) => {
      if (epoch === folderEpoch.current && loadVersions.current[p.id] === version) setLoads(prev => ({ ...prev,[p.id]:state }));
    };
    update({ source,phase:diagnosticId ? 'analyzing' : 'loading' });
    setBusy(prev => ({ ...prev,[p.id]:true }));
    let report:GhciReport|undefined;
    try {
      if (diagnosticId) report = await api.ghciDiagnosticReport(p.id);
      else {
        await save(false);
        if (epoch !== folderEpoch.current || problemRef.current?.id !== p.id || codeRef.current !== source) {
          update({ source,phase:'error',note:'コードが変更されました。もう一度読み込んでください。' }); return;
        }
        if (restartSession) {
          await api.ghciStop(p.id);
          setGeneration(prev => ({ ...prev,[p.id]:(prev[p.id] || 0)+1 }));
        }
        const size = terminalRef.current?.dimensions();
        report = await api.ghciLoad(p.id,size?.cols,size?.rows);
      }
      if (epoch !== folderEpoch.current) return;
      const errors = report.diagnostics.some(d => d.severity === 'error');
      if (report.success) setDiagnostics(prev => { const next = { ...prev }; delete next[p.id]; return next; });
      update({ source:report.source,phase:errors ? 'analyzing' : 'done',report });
      if (errors) {
        report = await api.ghciExplain(p.id,report.token,model,effort);
        update({ source:report.source,phase:'done',report });
      }
    } catch (error) {
      update({ source:report?.source ?? source,phase:'error',report,note:`${report ? 'AI解析に失敗しました。GHCiのエラーを表示しています。' : ''}${error instanceof Error ? error.message : String(error)}` });
    } finally {
      loadingGhci.current.delete(p.id);
      if (epoch === folderEpoch.current) setBusy(prev => ({ ...prev,[p.id]:false }));
    }
  },[save,model,effort,items]);
  analyzeDiagnosticRef.current = target => { void run(false,target); };
  useEffect(() => {
    const loadKey = (event:KeyboardEvent) => {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || event.altKey || event.isComposing || document.querySelector('dialog[open],.modal-backdrop')) return;
      // Handle this before Vim and xterm consume Enter or turn it into input.
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) void run();
    };
    window.addEventListener('keydown',loadKey,true);
    return () => window.removeEventListener('keydown',loadKey,true);
  },[run]);
  useEffect(() => {
    const close = (event:KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || !right || document.querySelector('dialog[open],.modal-backdrop')) return;
      event.preventDefault(); setRight(false);
      if (document.activeElement?.closest('#assistant-panel')) requestAnimationFrame(() => document.querySelector<HTMLElement>('.cm-content')?.focus());
    };
    window.addEventListener('keydown',close); return () => window.removeEventListener('keydown',close);
  },[right]);
  useEffect(() => {
    const handler = (e:KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if (e.defaultPrevented || !(e.metaKey || e.ctrlKey)) return;
      if ((e.target as HTMLElement).closest('.ghci-terminal') && !e.metaKey && !e.shiftKey) return;
      if (e.key === 's') { e.preventDefault(); save().catch(notify); }
      if (e.key === 'n') { e.preventDefault(); setNewOpen(true); }
      if (e.key.toLowerCase() === 'j' && (e.metaKey || e.shiftKey)) { e.preventDefault(); focusGhci(); }
      if (e.key === '/') { e.preventDefault(); setHelp(prev => !prev); }
    };
    window.addEventListener('keydown',handler); return () => window.removeEventListener('keydown',handler);
  }, [save,run,notify,focusGhci]);
  async function create() {
    if (switching.current || !confirmDiscard()) return; switching.current = true;
    try { const p = await api.create(newTitle.trim() || 'Untitled.hs'); setNewOpen(false); setNewTitle(''); await refresh(); await activate(p); }
    catch (e) { notify(e); } finally { switching.current = false; }
  }
  async function sendQuestion(text = question, context = '') {
    if (!text.trim() || !id || aiBusy || sendingQuestions.current.has(id)) return;
    const target = id; sendingQuestions.current.add(target); setQuestion('');
    try { await api.ask(target,text,context,model,effort,codeRef.current); }
    catch (e) { notify(e); }
    finally { sendingQuestions.current.delete(target); }
  }
  usePaneNavigation(() => { if (lastError) void run(false,id); },ghciSide,pane => {
    setRight(pane === 'assistant');
  });
  async function chooseFolder() {
    if (switching.current || !confirmDiscard()) return;
    switching.current = true; setChoosingFolder(true);
    try {
      const info = await api.chooseFolder(); if (!info) return;
      folderEpoch.current++;
      setLoads({});
      problemRef.current = null; codeRef.current = ''; dirtyRef.current = false;
      setProblem(null); setCode(''); setDirty(false); setFolder(info); setQuery('');
      setDiagnostics({}); setBusy({}); setDead({}); setGeneration({}); setChatMap({}); setQuestion('');
      setCodexStatus(await api.codexStatus());
      const list = await api.list(); setItems(list);
      if (list[0]) await activate(await api.open(list[0].id));
    } catch (e) { notify(e); }
    finally { switching.current = false; setChoosingFolder(false); }
  }
  function resize(e:React.PointerEvent) {
    e.preventDefault(); const element = split.current; if (!element) return;
    const rect = element.getBoundingClientRect();
    const move = (event:PointerEvent) => { const ratio = Math.max(25,Math.min(78,(event.clientY - rect.top) / rect.height * 100)); element.style.setProperty('--editor-height',`${ratio}%`); };
    const end = () => { document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',end); document.body.classList.remove('resizing'); };
    document.body.classList.add('resizing'); document.addEventListener('pointermove',move); document.addEventListener('pointerup',end);
  }
  const filtered = items.filter(x => x.fileName.toLowerCase().includes(query.toLowerCase()));
  if (!api) return <div className="browser-notice"><Logo/><h1>Kata</h1><p>このアプリはElectronで起動してください。</p><code>npm run dev</code></div>;
  return <div className="app">
    <div className="layout" ref={layoutRef}>
      <aside className={`sidebar ${left ? '' : 'collapsed'}`} id="file-sidebar" aria-label="ファイルサイドバー" style={{ width:leftWidth }}>
        <div className="sidebar-heading"><span hidden={!left}>FILES</span><button className="icon-button" title={left ? 'サイドバーを閉じる' : 'サイドバーを開く'} aria-label={left ? 'サイドバーを閉じる' : 'サイドバーを開く'} aria-expanded={left} aria-controls="file-sidebar-content" onClick={() => setLeft(!left)}>{left ? <PanelLeftClose size={15}/> : <PanelLeftOpen size={15}/>}</button></div>
        <div className="sidebar-content" id="file-sidebar-content" hidden={!left}>
        <button className="folder-setting" aria-label="フォルダー設定" title={folder?.path || 'フォルダーを選択'} disabled={choosingFolder} onClick={() => void chooseFolder()}>{choosingFolder?<Loader2 className="spin" size={15}/>:<FolderOpen size={15}/>}<span><strong>{folder?.name || 'フォルダーを設定'}</strong><small>{folder?.path || '.hs ファイルの保存先を選択'}</small></span><ChevronDown size={12}/></button>
        <button className="new-button" onClick={() => setNewOpen(true)}><Plus size={16}/><span>新しいファイル</span><kbd>⌘ N</kbd></button>
        <label className="search-box"><Search size={14}/><input aria-label="ファイルを検索" placeholder="ファイルを検索…" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button className="icon-button" aria-label="検索をクリア" onClick={() => setQuery('')}><X size={12}/></button>}</label>
        <div className="problem-list">{filtered.map(item => <button key={item.id} title={item.fileName} data-problem-id={item.id} aria-current={item.id===id?'page':undefined} onClick={() => void open(item.id)} className={`problem-item ${item.id===id?'selected':''}`}><span className="file-name">{item.fileName}</span><time className="file-date" dateTime={item.updatedAt} title="更新日">{fileDate(item.updatedAt)}</time></button>)}{!filtered.length && <div className="list-empty">ファイルが見つかりません</div>}</div>
        </div>
        <div className="sidebar-bottom"><button title="エディタ設定（フォント・配色）" aria-label="エディタ設定" className="sidebar-settings" onClick={() => setFontSettingsOpen(true)}><Type size={16}/><span hidden={!left}>フォント・配色設定</span></button></div>
      </aside>
      {left && <SidebarResizer side="left" controls="file-sidebar" width={leftWidth} min={180} max={leftMax} onResize={width => setPreferredWidths(prev => ({ ...prev,left:width }))}/>}
      <div className="workspace-area">
      <main className="main-workspace">
        {problem ? <>
        <div ref={split} className={`split-workspace ${ghciSide ? 'ghci-at-side' : ''}`}>
          <section className="editor-panel"><div className="editor-tabs"><div className="editor-tab"><Logo small/><span>{problem.fileName}</span>{dirty ? <span className="dirty-dot"/> : <span className="tab-saved"><Check size={12}/></span>}</div><div className="editor-tools"><button className="load-button" aria-label="GHCiで読込" title="保存してGHCiで読込・エラーをAI解析 (⌘Enter)" disabled={loadingGhci.current.has(id)} onClick={() => void run()}>{loadingGhci.current.has(id) ? <Loader2 size={12} className="spin"/> : <CheckCheck size={12}/>}<span>GHCi読込</span><kbd>⌘ ↵</kbd></button><span className="tool-divider"/><button title="Finderでファイルを表示" className="icon-button" onClick={() => api.reveal(id).catch(notify)}><FolderOpen size={14}/></button><span className="tool-divider"/><button className={`vim-toggle ${vimEnabled?'on':''}`} onClick={() => { setVimEnabled(!vimEnabled); localStorage.setItem('kata-vim',vimEnabled?'off':'on'); }} title="Vimキーバインドを切り替え">vim <span>{vimEnabled?'ON':'OFF'}</span></button><span className="tool-divider"/><button title="保存 (⌘S / :w)" className="icon-button" onClick={() => save().catch(notify)}><Save size={14}/></button></div></div>
          <Editor id={id} code={code} diagnostics={loadState?.report?.diagnostics || noInlineDiagnostics} vimEnabled={vimEnabled} fontSettings={fontSettings} theme={editorTheme} onChange={text => { codeRef.current = text; dirtyRef.current = true; setCode(text); setDirty(true); }} onSave={() => save().catch(notify)} onRun={() => void run()} onMode={setMode} onCursor={(line,col) => setCursor([line,col])}/>
          </section>
          {!ghciSide && <div className="split-handle" role="separator" aria-label="エディタと下部パネルの高さを調整" aria-orientation="horizontal" aria-valuemin={25} aria-valuemax={78} aria-valuenow={60} tabIndex={0} onPointerDown={resize} onKeyDown={e => { if (!['ArrowUp','ArrowDown'].includes(e.key)) return; e.preventDefault(); const el=split.current; if (el) el.style.setProperty('--editor-height', `${Math.max(25,Math.min(78,parseFloat(el.style.getPropertyValue('--editor-height') || '60')+(e.key==='ArrowDown'?3:-3)))}%`); }}><span/></div>}
          {ghciSide && <SidebarResizer side="right" controls="ghci-panel" label="GHCiの幅を調整" width={ghciWidth} min={220} max={ghciMax} onResize={setPreferredGhciWidth}/>}
          <section id="ghci-panel" className="lower-pane ghci-panel" aria-labelledby="ghci-heading" style={ghciSide ? { width:ghciWidth,flex:'0 0 auto' } : undefined}>
            <div className="lower-header"><h2 id="ghci-heading"><Terminal size={13}/>GHCi</h2>
              <div className="ghci-tools"><button className="icon-button" aria-label={ghciSide ? 'GHCiをエディタの下に移動' : 'GHCiをエディタの右に移動'} title={ghciSide ? 'GHCiをエディタの下に移動' : 'GHCiをエディタの右に移動'} onClick={() => setGhciSide(!ghciSide)}>{ghciSide ? <PanelBottom size={14}/> : <PanelRight size={14}/>}</button>{lastError && <button className="ask-error-button" aria-label="GHCiのエラーを解析" title="GHCiのエラーを裏でAI解析 (Ctrl-J → e)" disabled={busy[id]} onClick={() => void run(false,id)}><Sparkles size={12}/><span>エラーを解析</span></button>}<button className="run-button" title="GHCiを起動して読込／再読込・エラーをAI解析 (⌘Enter)" disabled={busy[id]} onClick={() => void run()}>{busy[id]?<Loader2 className="spin" size={12}/>:<Play size={11} fill="currentColor"/>}<span>{dead[id] === false ? '再読込' : '読込'}</span><kbd>⌘ ↵</kbd></button><button title="GHCiを再起動" className="icon-button" disabled={busy[id]} onClick={() => void run(true)}><RotateCcw size={13}/></button></div>
            </div>
            <GhciTerminal ref={terminalRef} id={id} generation={generation[id] || 0} onError={notify} onState={alive => setDead(prev => ({ ...prev,[id]:!alive }))}/>
          </section>
        </div></> : <div className="workspace-empty"><Logo/><h2>{loading?'ワークスペースを読み込み中…':'.hs ファイルを選択するか、新しく作成してください。'}</h2><button className="new-button" onClick={() => setNewOpen(true)}><Plus size={16}/>新しいファイル</button></div>}
      </main>
      {!right && <button className="assistant-launcher" title="AIアシスタントを開く" aria-label="AIサイドバーを開く" aria-expanded={false} aria-controls="assistant-panel" onClick={() => { setRight(true); requestAnimationFrame(() => questionInput.current?.focus()); }}><Sparkles size={14}/><span>AIアシスタント</span>{aiBusy && <Loader2 size={12} className="spin"/>}</button>}
      <div className="assistant-overlay" style={{ width:assistantWidth }} hidden={!right}>
        <SidebarResizer side="right" controls="assistant-panel" label="AIアシスタントの幅を調整" className="assistant-resizer" width={assistantWidth} min={280} max={rightMax} onResize={width => setPreferredWidths(prev => ({ ...prev,right:width }))}/>
        <aside id="assistant-panel" className="ai-sidebar" aria-label="AIアシスタント">
        <div className="lower-header ai-sidebar-heading"><h2 id="assistant-heading"><Sparkles size={13}/>AIアシスタント{aiBusy && <Loader2 size={12} className="spin"/>}</h2><button className="icon-button" aria-label="AIサイドバーを閉じる" title="AIアシスタントを閉じる (Esc)" aria-expanded={right} aria-controls="ai-sidebar-content" onClick={() => { setRight(false); requestAnimationFrame(() => document.querySelector<HTMLElement>('.cm-content')?.focus()); }}><X size={15}/></button></div>
        <div id="ai-sidebar-content" className="ai-sidebar-content" aria-labelledby="assistant-heading" hidden={!right}>
          <div className="ai-settings-row">
              <div className="ai-model-settings">
                <select aria-label="Codexモデル" title="AIモデル" value={model} disabled={aiBusy || codexStatus.state === 'connecting' || !codexStatus.models.length} onChange={e => {
                  const next = codexStatus.models.find(option => option.id === e.target.value);
                  setAISettings({ model:e.target.value,effort:next?.defaultReasoningEffort || '' });
                }}>{!codexStatus.models.length && <option value="">{codexStatus.state === 'connecting' ? 'モデルを読込中…' : 'デフォルト'}</option>}{codexStatus.models.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select>
                <select aria-label="推論レベル" title="推論レベル" value={effort} disabled={aiBusy || codexStatus.state === 'connecting' || !efforts.length} onChange={e => setAISettings({ model,effort:e.target.value })}>{!efforts.length && <option value="">推論: デフォルト</option>}{efforts.map(option => <option key={option.effort} value={option.effort} title={option.description}>推論: {option.effort}</option>)}</select>
                {(codexStatus.state === 'error' || (codexStatus.state === 'connected' && !codexStatus.authenticated)) && <button className="icon-button" aria-label="Codexに再接続" title={codexStatus.message} onClick={() => void connectCodex()}><RotateCcw size={13}/></button>}
              </div>
            </div>
              <div ref={chatArea} className="chat-area" role="log" aria-label="チャット履歴" aria-live="polite"><div className="messages">{messages.map(m => <div key={m.id} className={`message ${m.role}`}><div className="message-author"><span>{m.role === 'assistant' ? 'Codex' : 'You'}</span><time>{time(m.at)}</time></div><div className="markdown">{m.pending && !m.text ? <Loader2 size={14} className="spin" aria-label="応答中"/> : <ReactMarkdown>{m.text}</ReactMarkdown>}{m.pending && m.text && <span className="stream-cursor"/>}</div></div>)}</div></div>
              <div className="composer-area">
                <form className="composer" onSubmit={e => { e.preventDefault(); void sendQuestion(); }}>
                  <input ref={questionInput} aria-label="AIへの質問" value={question} placeholder="質問を入力…" disabled={!problem} maxLength={50000} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.keyCode === 229)) e.preventDefault(); }}/>
                  {aiBusy ? <button type="button" className="send-button stop" aria-label="応答を停止" onClick={() => api.stopAI(id).catch(notify)}><Square size={12} fill="currentColor"/></button> : <button className="send-button" type="submit" aria-label="送信" disabled={!question.trim() || !problem}><ArrowUp size={16}/></button>}
                </form>
              </div>
        </div>
        </aside>
      </div>
      </div>
    </div>
    <footer className="app-status">
      <div><span className="connection-dot"/><span>Local workspace</span>{problem && <><span className="footer-divider"/><span className={`mode-indicator ${mode.toLowerCase()}`}>{mode}</span><span>{vimEnabled?'Vim keybindings':'Standard keybindings'}</span></>}</div>
      <div>{problem && <><span>Ln {cursor[0]}, Col {cursor[1]}</span><span>UTF-8</span><Logo small/><span>Haskell</span><span className="footer-divider"/></>}{saving?<><Loader2 size={11} className="spin"/>保存中</>:dirty?<><Circle size={7}/>未保存</>:<><CheckCheck size={12}/>すべて保存済み</>}</div>
    </footer>
    {loadState && loadState !== dismissedLoadStatus && !(loadState.phase === 'done' && loadState.report?.success) && <div className="ghci-status-popup" role="status" aria-live="polite" aria-atomic="true" aria-label="GHCiの処理状況">
      {loadState.phase === 'loading' || loadState.phase === 'analyzing' ? <Loader2 size={16} className="spin"/> : <Sparkles size={16}/>}
      <div className="ghci-status-message">
      <span>{loadState.phase === 'loading' ? 'GHCiで読み込み中…' : loadState.phase === 'analyzing' ? 'GHCiのエラーをAIが解析中…' : loadState.note || `GHCiでエラー${loadState.report?.diagnostics.some(d => d.severity === 'error') ? ` · ${loadState.report.diagnostics.filter(d => d.severity === 'error').length}件のエラー` : ' · GHCiの出力を確認してください'}`}{loadState.phase === 'done' && loadState.report?.diagnostics.some(d => (d.displayLine ?? d.line) > 0 && d.explanation) && ' · AIの説明を該当行に表示しています'}</span>
      {loadState.report?.diagnostics.filter(d => (d.displayLine ?? d.line) === 0 && d.explanation).map((d,index) => <p key={index}>{d.explanation}</p>)}
      </div>
      <button className="icon-button" aria-label="GHCiの通知を閉じる" onClick={() => setDismissedLoadStatus(loadState)}><X size={14}/></button>
    </div>}
    {toast && <div className="toast" role="status"><span>{toast}</span><button className="icon-button" aria-label="通知を閉じる" onClick={() => setToast('')}><X size={14}/></button></div>}
    {fontSettingsOpen && <FontSettings settings={fontSettings} theme={editorTheme} onThemeChange={setEditorTheme} onChange={setFontSettings} onClose={() => setFontSettingsOpen(false)}/>}
    {newOpen && <div className="modal-backdrop" onMouseDown={e => { if (e.target===e.currentTarget) setNewOpen(false); }}><form className="modal new-modal" onSubmit={e => { e.preventDefault(); void create(); }}><button type="button" className="modal-close icon-button" aria-label="閉じる" onClick={() => setNewOpen(false)}><X size={17}/></button><Logo/><span className="eyebrow">NEW HASKELL FILE</span><h2>新しいファイル</h2><p>選択中のフォルダーに .hs ファイルを作成します。</p><label>ファイル名<input autoFocus placeholder="例：SumOfOddNumbers.hs" value={newTitle} onChange={e => setNewTitle(e.target.value)} maxLength={160}/></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setNewOpen(false)}>キャンセル</button><button className="primary-button" type="submit"><Plus size={14}/>ファイルを作成</button></div></form></div>}
    {help && <div className="modal-backdrop" onMouseDown={e => { if (e.target===e.currentTarget) setHelp(false); }}><div className="modal help-modal"><button className="modal-close icon-button" aria-label="ヘルプを閉じる" onClick={() => setHelp(false)}><X size={17}/></button><Command size={23}/><h2>キーボードで、軽やかに。</h2>{[['新しいファイル','⌘ N'],['ファイルを保存','⌘ S / :w'],['GHCiで読込／再読込・エラーをAI解析','⌘ Enter / ⌘ ⇧ Enter'],['領域移動（左 / 下 / 上 / 右）','Ctrl J → h / j / k / l'],['GHCiのエラーを裏でAI解析','Ctrl J → e'],['GHCiにフォーカス','⌘ J / Ctrl Shift J'],['ファイル内の単語で補完','Ctrl Space / Tab / Enter'],['Vim 挿入 / ノーマルモード','i / Esc'],['Vim 検索 / 元に戻す','/ / u'],['GHCi 実行を中断','Ctrl C'],['このヘルプ','⌘ /']].map(([label,key]) => <div className="shortcut" key={label}><span>{label}</span><kbd>{key}</kbd></div>)}<p>Windows / Linux では ⌘ の代わりに Ctrl を使用します。領域移動は全OS共通です。</p></div></div>}
  </div>;
}
