import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Plus, Search, ChevronDown, ChevronRight, ArrowUp, ArrowUpRight, Check, Circle, Code2, Command, FileCode2, FolderOpen, Loader2, PanelLeftClose, PanelRightClose, Play, RotateCcw, Save, Sparkles, Square, Terminal, Trash2, X, Zap, CheckCheck, BookOpen } from 'lucide-react';
import { Editor } from './Editor';
import type { AppEvent, CodexStatus, Message, Problem, Run, Summary, WorkspaceInfo } from './types';

const api = window.kata;
const time = (date:string) => new Date(date).toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit' });
const fileDate = (value:string) => new Date(value).toLocaleDateString('ja-JP', { year:'numeric', month:'2-digit', day:'2-digit' });
function Logo({ small = false }:{ small?:boolean }) { return <span className={`haskell-logo ${small?'small':''}`}>λ<span>=</span></span>; }

export function App() {
  const [items,setItems] = useState<Summary[]>([]); const [problem,setProblem] = useState<Problem|null>(null);
  const problemRef = useRef<Problem|null>(null); const codeRef = useRef(''); const dirtyRef = useRef(false);
  const folderEpoch = useRef(0);
  const [code,setCode] = useState(''); const [dirty,setDirty] = useState(false); const [saving,setSaving] = useState(false);
  const [query,setQuery] = useState('');
  const [newOpen,setNewOpen] = useState(false); const [newTitle,setNewTitle] = useState('');
  const [left,setLeft] = useState(true); const [right,setRight] = useState(true);
  const [vimEnabled,setVimEnabled] = useState(() => localStorage.getItem('kata-vim') !== 'off');
  const [mode,setMode] = useState('NORMAL'); const [cursor,setCursor] = useState([1,1]);
  const [logs,setLogs] = useState<Record<string,Run[]>>({}); const [busy,setBusy] = useState<Record<string,boolean>>({});
  const [dead,setDead] = useState<Record<string,boolean>>({}); const [command,setCommand] = useState('');
  const [commandHistory,setCommandHistory] = useState<Record<string,string[]>>({}); const historyIndex = useRef(-1);
  const [status,setStatus] = useState<CodexStatus>({ state:'disconnected', message:'未接続', models:[] });
  const [model,setModel] = useState(''); const [question,setQuestion] = useState(''); const [attach,setAttach] = useState(false);
  const [chatMap,setChatMap] = useState<Record<string,Message[]>>({});
  const [folder,setFolder] = useState<WorkspaceInfo|null>(null); const [choosingFolder,setChoosingFolder] = useState(false);
  const [toast,setToast] = useState(''); const [loading,setLoading] = useState(true); const switching = useRef(false);
  const [help,setHelp] = useState(false); const logBottom = useRef<HTMLDivElement>(null); const chatBottom = useRef<HTMLDivElement>(null);
  const commandInput = useRef<HTMLTextAreaElement>(null); const questionInput = useRef<HTMLTextAreaElement>(null); const split = useRef<HTMLDivElement>(null);
  const id = problem?.id || ''; const currentLogs = logs[id] || [];
  const messages = chatMap[id] || problem?.messages || []; const aiBusy = messages.some(x => x.pending);
  const lastResult = currentLogs.at(-1); const lastError = [...currentLogs].reverse().find(x => x.failed);
  const notify = useCallback((error:unknown) => setToast(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /,'') : String(error)), []);
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
  const save = useCallback(async () => {
    const p = problemRef.current; if (!p || !dirtyRef.current) return;
    const text = codeRef.current; setSaving(true);
    try {
      await api.save(p.id, text);
      if (problemRef.current?.id === p.id && codeRef.current === text) { dirtyRef.current = false; setDirty(false); }
      await refresh();
    } finally { setSaving(false); }
  }, [refresh]);
  const activate = useCallback(async (p:Problem) => {
    problemRef.current = p; codeRef.current = p.code; dirtyRef.current = false;
    setProblem(p); setCode(p.code); setDirty(false); setCommand(''); historyIndex.current = -1;
    setQuestion(''); setAttach(false); setChatMap(prev => ({ ...prev, [p.id]:p.messages }));
    localStorage.setItem('kata-last',p.id);
    setBusy(prev => ({ ...prev, [p.id]:true }));
    try { await api.ghciStart(p.id); setDead(prev => ({ ...prev, [p.id]:false })); }
    catch (e) { setDead(prev => ({ ...prev, [p.id]:true })); notify(e); }
    finally { setBusy(prev => ({ ...prev, [p.id]:false })); }
  }, [notify]);
  const open = useCallback(async (next:string) => {
    if (switching.current || next === problemRef.current?.id) return;
    switching.current = true;
    try { while (dirtyRef.current) await save(); await activate(await api.open(next)); }
    catch (e) { notify(e); } finally { switching.current = false; }
  }, [activate,save,notify]);
  useEffect(() => {
    if (!api) { setLoading(false); return; }
    const unsub = api.onEvent((event:AppEvent) => {
      if (event.type === 'before-close') {
        (async () => { if (dirtyRef.current && problemRef.current) await api.save(problemRef.current.id,codeRef.current); await api.closeReady(); })().catch(notify);
      }
      if (event.type === 'workspace-changed') refresh().catch(notify);
      if (event.type === 'ghci-result') setLogs(prev => ({ ...prev, [event.id]:[...(prev[event.id] || []), event.result].slice(-150) }));
      if (event.type === 'ghci-exit') setDead(prev => ({ ...prev, [event.id]:true }));
      if (event.type === 'codex-status') setStatus(event.status);
      if (event.type === 'notice') notify(event.message);
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
        setStatus(await api.codexStatus());
      } catch (e) { if (!disposed) notify(e); } finally { if (!disposed) setLoading(false); }
    })();
    return () => { disposed = true; unsub(); };
  }, [activate,notify,refresh]);
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => { save().catch(notify); }, 700);
    return () => clearTimeout(timer);
  }, [code,dirty,save,notify]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''),6500); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { logBottom.current?.scrollIntoView({ block:'nearest' }); }, [currentLogs.length,id]);
  useEffect(() => { chatBottom.current?.scrollIntoView({ block:'nearest' }); }, [messages.at(-1)?.text,id]);
  const run = useCallback(async (expression?:string) => {
    const p = problemRef.current; if (!p || busy[p.id]) return;
    setBusy(prev => ({ ...prev,[p.id]:true }));
    try {
      await save();
      if (dead[p.id]) { const result = await api.ghciRestart(p.id); if (result.failed) return; }
      else { const result = await api.ghciRun(p.id, ':reload'); if (result.failed) return; }
      if (expression?.trim()) {
        await api.ghciRun(p.id, expression.trim());
        setCommandHistory(prev => ({ ...prev, [p.id]:[expression.trim(),...(prev[p.id] || []).filter(x => x !== expression.trim())].slice(0,100) }));
      }
      setDead(prev => ({ ...prev,[p.id]:false }));
    } catch (e) { notify(e); } finally { setBusy(prev => ({ ...prev,[p.id]:false })); }
  }, [busy,dead,save,notify]);
  useEffect(() => {
    const handler = (e:KeyboardEvent) => {
      if (e.defaultPrevented || !(e.metaKey || e.ctrlKey)) return;
      if (e.key === 's') { e.preventDefault(); save().catch(notify); }
      if (e.key === 'Enter') { e.preventDefault(); void run(); }
      if (e.key === 'n') { e.preventDefault(); setNewOpen(true); }
      if (e.key === 'j') { e.preventDefault(); commandInput.current?.focus(); }
      if (e.key === '/') { e.preventDefault(); setHelp(prev => !prev); }
    };
    window.addEventListener('keydown',handler); return () => window.removeEventListener('keydown',handler);
  }, [save,run,notify]);
  useEffect(() => {
    const flush = () => { if (dirtyRef.current && problemRef.current) void api.save(problemRef.current.id,codeRef.current); };
    window.addEventListener('blur',flush); window.addEventListener('beforeunload',flush);
    return () => { window.removeEventListener('blur',flush); window.removeEventListener('beforeunload',flush); };
  }, []);
  async function create() {
    if (switching.current) return; switching.current = true;
    try { while (dirtyRef.current) await save(); const p = await api.create(newTitle.trim() || 'Untitled.hs'); setNewOpen(false); setNewTitle(''); await refresh(); await activate(p); }
    catch (e) { notify(e); } finally { switching.current = false; }
  }
  async function sendQuestion(text = question, withError = attach) {
    if (!text.trim() || !id || aiBusy) return;
    const target = id; setQuestion(''); setAttach(false);
    try { await save(); await api.ask(target,text,withError && lastResult ? `> ${lastResult.command}\n${lastResult.output}` : '', model); }
    catch (e) { notify(e); }
  }
  function askError(result:Run) {
    setRight(true); setAttach(true);
    setQuestion(`このGHCiのエラーの原因と、修正のヒントを教えてください。\n\n> ${result.command}\n${result.output}`);
    setTimeout(() => questionInput.current?.focus(), 0);
  }
  async function restart() {
    if (!id || busy[id]) return; setBusy(prev => ({ ...prev,[id]:true }));
    try { await save(); await api.ghciRestart(id); setDead(prev => ({ ...prev,[id]:false })); }
    catch (e) { notify(e); } finally { setBusy(prev => ({ ...prev,[id]:false })); }
  }
  async function chooseFolder() {
    if (switching.current) return;
    switching.current = true; setChoosingFolder(true);
    try {
      while (dirtyRef.current) await save();
      const info = await api.chooseFolder(); if (!info) return;
      folderEpoch.current++;
      problemRef.current = null; codeRef.current = ''; dirtyRef.current = false;
      setProblem(null); setCode(''); setDirty(false); setFolder(info); setQuery('');
      setLogs({}); setBusy({}); setDead({}); setChatMap({}); setQuestion(''); setAttach(false); setCommand(''); setCommandHistory({});
      const list = await api.list(); setItems(list); setStatus(await api.codexStatus());
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
    <header className="titlebar"><div className="titlebar-brand"><Logo small/><span>kata</span><span className="brand-separator">/</span><span className="workspace-label">Haskell workspace</span></div><div className="titlebar-right"><span className="local-indicator"/>Local workspace<span className="titlebar-divider"/><button title="左サイドバー" className="icon-button" onClick={() => setLeft(!left)}><PanelLeftClose size={15}/></button><button title="AIサイドバー" className="icon-button" onClick={() => setRight(!right)}><PanelRightClose size={15}/></button></div></header>
    <div className="layout">
      {left && <aside className="sidebar">
        <div className="sidebar-heading"><span>FILES</span><span className="count-pill">{items.length}</span></div>
        <button className="folder-setting" aria-label="フォルダー設定" title={folder?.path || 'フォルダーを選択'} disabled={choosingFolder} onClick={() => void chooseFolder()}>{choosingFolder?<Loader2 className="spin" size={15}/>:<FolderOpen size={15}/>}<span><strong>{folder?.name || 'フォルダーを設定'}</strong><small>{folder?.path || '.hs ファイルの保存先を選択'}</small></span><ChevronDown size={12}/></button>
        <button className="new-button" onClick={() => setNewOpen(true)}><Plus size={16}/><span>新しいファイル</span><kbd>⌘ N</kbd></button>
        <label className="search-box"><Search size={14}/><input aria-label="ファイルを検索" placeholder="ファイルを検索…" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button className="icon-button" aria-label="検索をクリア" onClick={() => setQuery('')}><X size={12}/></button>}</label>
        <div className="problem-list">{filtered.map(item => <button key={item.id} title={item.fileName} data-problem-id={item.id} aria-current={item.id===id?'page':undefined} onClick={() => void open(item.id)} className={`problem-item ${item.id===id?'selected':''}`}><span className="file-name">{item.fileName}</span><time className="file-date" dateTime={item.updatedAt} title="更新日">{fileDate(item.updatedAt)}</time></button>)}{!filtered.length && <div className="list-empty">ファイルが見つかりません</div>}</div>
        <div className="sidebar-bottom"><button className="sidebar-help" onClick={() => setHelp(true)}><Command size={14}/><span>キーボードショートカット</span><kbd>⌘ /</kbd></button></div>
      </aside>}
      <main className="main-workspace">
        {problem ? <>
        <div ref={split} className="split-workspace">
          <section className="editor-panel"><div className="editor-tabs"><div className="editor-tab"><Logo small/><span>{problem.fileName}</span>{dirty ? <span className="dirty-dot"/> : <span className="tab-saved"><Check size={12}/></span>}</div><div className="editor-tools"><button title="Finderでファイルを表示" className="icon-button" onClick={() => api.reveal(id).catch(notify)}><FolderOpen size={14}/></button><span className="tool-divider"/><button className={`vim-toggle ${vimEnabled?'on':''}`} onClick={() => { setVimEnabled(!vimEnabled); localStorage.setItem('kata-vim',vimEnabled?'off':'on'); }} title="Vimキーバインドを切り替え">vim <span>{vimEnabled?'ON':'OFF'}</span></button><span className="tool-divider"/><button title="保存 (⌘S / :w)" className="icon-button" onClick={() => save().catch(notify)}><Save size={14}/></button><button className="run-button" disabled={busy[id]} onClick={() => void run()}>{busy[id]?<Loader2 className="spin" size={12}/>:<Play size={11} fill="currentColor"/>}<span>再読込</span><kbd>⌘ ↵</kbd></button></div></div>
          <Editor id={id} code={code} vimEnabled={vimEnabled} onChange={text => { codeRef.current = text; dirtyRef.current = true; setCode(text); setDirty(true); }} onSave={() => save().catch(notify)} onRun={() => void run()} onMode={setMode} onCursor={(line,col) => setCursor([line,col])}/>
          <div className="editor-status"><span className={`mode-indicator ${mode.toLowerCase()}`}>{mode}</span><span>{vimEnabled?'Vim keybindings':'Standard keybindings'}</span><div className="editor-status-right"><span>Ln {cursor[0]}, Col {cursor[1]}</span><span>UTF-8</span><span>Haskell</span></div></div></section>
          <div className="split-handle" role="separator" aria-label="エディタとGHCiの高さを調整" aria-orientation="horizontal" aria-valuemin={25} aria-valuemax={78} aria-valuenow={60} tabIndex={0} onPointerDown={resize} onKeyDown={e => { if (!['ArrowUp','ArrowDown'].includes(e.key)) return; e.preventDefault(); const el=split.current; if (el) el.style.setProperty('--editor-height', `${Math.max(25,Math.min(78,parseFloat(el.style.getPropertyValue('--editor-height') || '60')+(e.key==='ArrowDown'?3:-3)))}%`); }}><span/></div>
          <section className="ghci-panel"><div className="ghci-header"><div className="panel-label"><Terminal size={14}/><strong>GHCi</strong><span className={`connection-dot ${dead[id]?'offline':''}`}/><span className="session-label">{busy[id]?'実行中…':dead[id]?'停止中':problem.fileName}</span></div><div className="ghci-tools">{lastError && <button className="ask-error-button" onClick={() => askError(lastError)}><Sparkles size={12}/>エラーをAIに聞く</button>}{busy[id] && <button title="実行を中断" className="icon-button" onClick={() => api.ghciInterrupt(id).catch(notify)}><Square size={12}/></button>}<button title="GHCiを再起動" className="icon-button" disabled={busy[id]} onClick={() => void restart()}><RotateCcw size={13}/></button><button title="表示をクリア" className="icon-button" onClick={() => setLogs(prev => ({ ...prev,[id]:[] }))}><Trash2 size={13}/></button></div></div>
            <div className="terminal-output" aria-live="polite"><div className="terminal-welcome"><span>GHCi</span><span>Haskell interactive environment</span></div>{currentLogs.map((log,index) => <div className={`terminal-entry ${log.failed?'failed':''}`} key={index}><div className="terminal-command"><span className="prompt">λ&gt;</span><code>{log.command.startsWith(':load')?`:load ${problem.fileName}`:log.command}</code><span className="terminal-time">{time(log.at)}</span></div><pre>{log.output || (log.command.startsWith(':')?`✓ ${problem.fileName} loaded`:'✓ Done')}</pre>{log.failed && <button className="inline-ask" onClick={() => askError(log)}><Sparkles size={11}/>このエラーを相談<ArrowUpRight size={11}/></button>}</div>)}{dead[id] && <div className="terminal-dead">GHCiが停止しています。右上の ↻ で再起動できます。</div>}<div ref={logBottom}/></div>
            <form className="terminal-input" onSubmit={e => { e.preventDefault(); if (!command.trim() || busy[id]) return; const text=command; setCommand(''); historyIndex.current=-1; void run(text); }}><span className="prompt">λ&gt;</span><textarea ref={commandInput} rows={1} aria-label="GHCiコマンド" placeholder="式を入力…  :t / :info / :reload" value={command} onChange={e => setCommand(e.target.value)} onKeyDown={e => {
              if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); }
              if (e.key==='ArrowUp' && !command.includes('\n')) { const history=commandHistory[id] || []; if (history.length) { e.preventDefault(); historyIndex.current=Math.min(historyIndex.current+1,history.length-1); setCommand(history[historyIndex.current]); } }
              if (e.key==='ArrowDown' && !command.includes('\n')) { e.preventDefault(); historyIndex.current=Math.max(-1,historyIndex.current-1); setCommand((commandHistory[id] || [])[historyIndex.current] || ''); }
              if (e.key==='c' && e.ctrlKey) { e.preventDefault(); void api.ghciInterrupt(id); }
            }}/><button type="submit" title="実行" disabled={!command.trim() || busy[id]}><ArrowUp size={14}/></button></form><div className="terminal-footer"><span><kbd>↵</kbd> 実行 <span className="hint-gap"/><kbd>⇧ ↵</kbd> 改行 <span className="hint-gap"/><kbd>↑ ↓</kbd> 履歴</span><button onClick={() => { setCommand(':t solution'); commandInput.current?.focus(); }}>型を調べる <ChevronRight size={11}/></button></div>
          </section>
        </div></> : <div className="workspace-empty"><Logo/><h2>{loading?'ワークスペースを読み込み中…':'.hs ファイルを選択するか、新しく作成してください。'}</h2><button className="new-button" onClick={() => setNewOpen(true)}><Plus size={16}/>新しいファイル</button></div>}
      </main>
      {right && <aside className="ai-sidebar"><div className="ai-heading"><div><Sparkles size={16}/><strong>学習アシスタント</strong></div><span className="codex-badge">CODEX</span></div><div className="ai-connection"><button title={status.message} onClick={() => api.codexConnect().then(setStatus).catch(notify)}><span className={`connection-dot ${status.state!=='connected'?'offline':''}`}/><span>{status.state==='connected'?(status.authenticated?'app-server 接続済み':'ログインが必要'):status.state==='connecting'?'接続中…':'Codex に接続'}</span><ChevronDown size={11}/></button><button className="icon-button" title="再接続" onClick={() => api.codexConnect().then(setStatus).catch(notify)}><RotateCcw size={12}/></button></div>
        <div className="chat-area" aria-live="polite">{!messages.length ? <div className="ai-empty"><div className="ai-orbit"><Sparkles size={23}/></div><span className="eyebrow">A THINKING PARTNER</span><h2>ひとりで考える。<br/>行き詰まったら、一緒に。</h2><p>コードの疑問も、GHCiのエラーも。<br/>今開いている問題をもとに相談できます。</p><div className="suggestions"><button onClick={() => { setQuestion('答えを直接示さずに、この問題を解くヒントをください。'); questionInput.current?.focus(); }}><BookOpen size={14}/><span>解き方のヒントをもらう</span><ArrowUpRight size={13}/></button><button onClick={() => { setQuestion('現在のコードの型と、それぞれの関数の役割を説明してください。'); questionInput.current?.focus(); }}><Code2 size={14}/><span>型と関数を理解する</span><ArrowUpRight size={13}/></button><button onClick={() => { setQuestion('このコードをよりHaskellらしく書く方法を、理由とともに教えてください。'); questionInput.current?.focus(); }}><Zap size={14}/><span>よりよい書き方を考える</span><ArrowUpRight size={13}/></button></div><div className="ai-tip"><Terminal size={14}/><span>実行に失敗したら、GHCiの<br/><b>「エラーをAIに聞く」</b>をクリック。</span></div></div> : <div className="messages">{messages.map(m => <div key={m.id} className={`message ${m.role}`}><div className="message-author">{m.role==='assistant'?<><Sparkles size={12}/><span>Codex</span></>:<><span className="user-avatar">Y</span><span>You</span></>}<time>{time(m.at)}</time></div><div className="markdown">{m.pending && !m.text ? <span className="thinking"><span/><span/><span/>考えています</span>:<ReactMarkdown>{m.text}</ReactMarkdown>}{m.pending && m.text && <span className="stream-cursor"/>}</div></div>)}</div>}<div ref={chatBottom}/></div>
        <div className="composer-area"><div className="context-chip"><FileCode2 size={12}/><span>{problem?`${problem.fileName} をコンテキストに使用`:'ファイルを開いてください'}</span><span className="context-dot"/></div><form className="composer" onSubmit={e => { e.preventDefault(); void sendQuestion(); }}>{attach && <div className="attached-error"><Terminal size={11}/><span>GHCiの実行結果を添付</span><button type="button" className="icon-button" aria-label="添付を外す" onClick={() => setAttach(false)}><X size={11}/></button></div>}<textarea ref={questionInput} aria-label="AIへの質問" rows={3} value={question} placeholder="コードについて聞いてみる…" disabled={!problem} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key==='Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}/><div className="composer-bottom"><select aria-label="Codexモデル" value={model} onChange={e => setModel(e.target.value)}><option value="">Codex · デフォルト</option>{status.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>{aiBusy?<button type="button" className="send-button stop" title="応答を停止" onClick={() => api.stopAI(id).catch(notify)}><Square size={12} fill="currentColor"/></button>:<button className="send-button" type="submit" title="送信" disabled={!question.trim() || !problem}><ArrowUp size={16}/></button>}</div></form><p className="composer-hint">Enter で送信 <span>·</span> Shift + Enter で改行</p></div>
      </aside>}
    </div>
    <footer className="app-status"><div><span className="connection-dot"/><span>Local workspace</span><span className="footer-divider"/><Logo small/><span>Haskell</span></div><div>{saving?<><Loader2 size={11} className="spin"/>保存中</>:dirty?<><Circle size={7}/>未保存</>:<><CheckCheck size={12}/>すべて保存済み</>}<span className="footer-divider"/><button onClick={() => setHelp(true)}><Command size={11}/><span>ショートカット</span></button></div></footer>
    {toast && <div className="toast" role="status"><span>{toast}</span><button className="icon-button" aria-label="通知を閉じる" onClick={() => setToast('')}><X size={14}/></button></div>}
    {newOpen && <div className="modal-backdrop" onMouseDown={e => { if (e.target===e.currentTarget) setNewOpen(false); }}><form className="modal new-modal" onSubmit={e => { e.preventDefault(); void create(); }}><button type="button" className="modal-close icon-button" aria-label="閉じる" onClick={() => setNewOpen(false)}><X size={17}/></button><Logo/><span className="eyebrow">NEW HASKELL FILE</span><h2>新しいファイル</h2><p>選択中のフォルダーに .hs ファイルを作成します。</p><label>ファイル名<input autoFocus placeholder="例：SumOfOddNumbers.hs" value={newTitle} onChange={e => setNewTitle(e.target.value)} maxLength={160}/></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setNewOpen(false)}>キャンセル</button><button className="primary-button" type="submit"><Plus size={14}/>ファイルを作成</button></div></form></div>}
    {help && <div className="modal-backdrop" onMouseDown={e => { if (e.target===e.currentTarget) setHelp(false); }}><div className="modal help-modal"><button className="modal-close icon-button" aria-label="ヘルプを閉じる" onClick={() => setHelp(false)}><X size={17}/></button><Command size={23}/><h2>キーボードで、軽やかに。</h2>{[['新しいファイル','⌘ N'],['ファイルを保存','⌘ S / :w'],['保存してGHCiを再読込','⌘ Enter'],['GHCiにフォーカス','⌘ J'],['Vim 挿入 / ノーマルモード','i / Esc'],['Vim 検索 / 元に戻す','/ / u'],['GHCi 実行を中断','Ctrl C'],['このヘルプ','⌘ /']].map(([label,key]) => <div className="shortcut" key={label}><span>{label}</span><kbd>{key}</kbd></div>)}<p>Windows / Linux では ⌘ の代わりに Ctrl を使用します。</p></div></div>}
  </div>;
}
