const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../electron/store.cjs');
const { Ghci, diagnosticText } = require('../electron/ghci.cjs');
const { Codex } = require('../electron/codex.cjs');
const { GhciDiagnostics,parseDiagnostics } = require('../electron/ghci-diagnostics.cjs');
const { Workspace, migrateLegacy } = require('../electron/workspace.cjs');
async function temporary(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(),'kata-test-')); t.after(() => fs.rm(root,{ recursive:true,force:true })); return root; }

test('window state survives restart and remains visible after display changes or corrupt settings', async t => {
  const { EventEmitter } = require('node:events');
  const { restoreWindowState,trackWindowState } = require('../electron/window-state.cjs');
  const file = path.join(await temporary(t),'window-state.json');
  const primary = { workArea:{ x:0,y:25,width:1440,height:875 } };
  const secondary = { workArea:{ x:-1920,y:0,width:1920,height:1080 } };
  let displays = [primary,secondary];
  const screen = { getAllDisplays:() => displays,getPrimaryDisplay:() => primary };
  const win = new EventEmitter();
  let minimized = false, maximized = true;
  Object.assign(win,{
    isDestroyed:() => false,isMinimized:() => minimized,isFullScreen:() => false,isMaximized:() => maximized,
    getNormalBounds:() => ({ x:-1800,y:80,width:1200,height:800 })
  });
  trackWindowState(win,file,{ maximized:false });
  win.emit('resize'); win.emit('close');
  assert.deepEqual(restoreWindowState(file,screen).bounds,win.getNormalBounds());
  assert.equal(restoreWindowState(file,screen).maximized,true);
  minimized = true; maximized = false; win.emit('close');
  assert.equal(restoreWindowState(file,screen).maximized,true,'minimizing does not lose maximized state');
  win.emit('closed');
  displays = [primary];
  assert.deepEqual(restoreWindowState(file,screen).bounds,{ x:120,y:63,width:1200,height:800 });
  await fs.writeFile(file,JSON.stringify({ x:1400,y:850,width:3000,height:2000 }));
  assert.deepEqual(restoreWindowState(file,screen).bounds,{ x:0,y:25,width:1440,height:875 });
  await fs.writeFile(file,'broken JSON');
  assert.deepEqual(restoreWindowState(file,screen).bounds,{ x:0,y:25,width:1440,height:875 });
});

test('opens existing Haskell files sorted by modification date and saves only .hs files', async t => {
  const root = await temporary(t);
  await fs.writeFile(path.join(root,'Older.hs'),'older = 1');
  await fs.writeFile(path.join(root,'Newer.hs'),'newer = 2');
  await fs.utimes(path.join(root,'Older.hs'),100,100);
  await fs.utimes(path.join(root,'Newer.hs'),200,200);
  await fs.writeFile(path.join(root,'notes.txt'),'leave me alone');
  await fs.mkdir(path.join(root,'nested'));
  await fs.writeFile(path.join(root,'nested','Hidden.hs'),'hidden = 3');
  const store = new Store(root); await store.init();
  let list = await store.list();
  assert.deepEqual(list.map(x => x.fileName),['Newer.hs','Older.hs']);
  const old = list[1]; assert.equal((await store.open(old.id)).code,'older = 1');
  await store.save(old.id,'older = 42');
  list = await store.list(); assert.equal(list[0].id,old.id);
  await Promise.all([store.save(old.id,'older = 43'),store.save(old.id,'older = 44')]);
  const created = await store.create('日本語'); assert.equal(created.fileName,'日本語.hs');
  assert.equal((await store.open(old.id)).code,'older = 44');
  assert.equal(await fs.readFile(path.join(root,'notes.txt'),'utf8'),'leave me alone');
  assert.deepEqual((await fs.readdir(root)).sort(),['Newer.hs','Older.hs','nested','notes.txt','日本語.hs'].sort());
  const reopened = new Store(root); await reopened.init();
  assert.equal((await reopened.open(old.id)).code,'older = 44');
  await fs.unlink(path.join(root,'Newer.hs'));
  assert.equal((await reopened.list()).some(x => x.fileName==='Newer.hs'),false);
  assert.throws(() => reopened.file('../../secret'),/見つかりません/);
});

test('empty folders stay empty, duplicate names never overwrite, invalid paths are rejected', async t => {
  const root = await temporary(t); const store = new Store(root); await store.init();
  assert.deepEqual(await store.list(),[]);
  const item = await store.create('Example.hs','answer = 42');
  await assert.rejects(store.create('Example.hs','answer = 99'),/同じ名前/);
  assert.equal((await store.open(item.id)).code,'answer = 42');
  for (const name of ['../escape','nested/file','', '..','CON.hs','bad:name']) await assert.rejects(store.create(name),/ファイル名/);
  assert.deepEqual(await fs.readdir(root),['Example.hs']);
  const at = (await fs.stat(item.id)).mtimeMs;
  await store.save(item.id,'answer = 42');
  assert.equal((await fs.stat(item.id)).mtimeMs,at,'saving unchanged content does not change ordering');
});

test('folder selection survives restart, keeps settings outside the folder, and fails without replacing it', async t => {
  const root = await temporary(t); const defaults=path.join(root,'default'), config=path.join(root,'config'), external=path.join(root,'existing');
  await fs.mkdir(external); await fs.writeFile(path.join(external,'Existing.hs'),'existing = 7');
  const workspace = new Workspace(defaults,config); await workspace.init();
  assert.deepEqual(await workspace.store.list(),[]);
  await workspace.setFolder(external);
  assert.equal(workspace.info().path,await fs.realpath(external));
  assert.deepEqual(await fs.readdir(external),['Existing.hs']);
  const reopened = new Workspace(defaults,config); await reopened.init();
  assert.equal(reopened.info().path,await fs.realpath(external));
  assert.equal((await reopened.store.list())[0].fileName,'Existing.hs');
  await assert.rejects(reopened.setFolder(path.join(root,'missing')));
  assert.equal(reopened.info().path,await fs.realpath(external));
  await fs.rm(external,{ recursive:true });
  const fallback = new Workspace(defaults,config); await fallback.init();
  assert.equal(fallback.info().path,await fs.realpath(defaults));
  assert.ok(fallback.info().warning);
});

test('legacy code is migrated without overwrites and originals are retained outside the source folder', async t => {
  const root=await temporary(t), source=path.join(root,'source'),config=path.join(root,'settings');
  const id='44509081-deeb-44dd-bbbb-1469df8ebd97';
  await fs.mkdir(path.join(source,id),{ recursive:true });
  await fs.writeFile(path.join(source,id,'Solution.hs'),'answer = 42');
  await fs.writeFile(path.join(source,id,'revisions.json'),'[]');
  await fs.writeFile(path.join(source,'index.json'),JSON.stringify([{ id,title:'Example' }]));
  await fs.writeFile(path.join(source,'Example.hs'),'answer = 99');
  const archive = await migrateLegacy(source,config);
  assert.deepEqual((await fs.readdir(source)).sort(),['Example 2.hs','Example.hs']);
  assert.equal(await fs.readFile(path.join(source,'Example.hs'),'utf8'),'answer = 99');
  assert.equal(await fs.readFile(path.join(source,'Example 2.hs'),'utf8'),'answer = 42');
  assert.equal(await fs.readFile(path.join(archive,id,'Solution.hs'),'utf8'),'answer = 42');
  assert.equal(await fs.readFile(path.join(archive,id,'revisions.json'),'utf8'),'[]');
  assert.equal(await migrateLegacy(source,config),undefined);
});

const example = 'module Solution where\nsolution :: Integer -> Integer\nsolution n = sum [x | x <- [1 .. n-1], x `mod` 3 == 0 || x `mod` 5 == 0]\n';

async function waitFor(predicate, timeout=7000) {
  const deadline=Date.now()+timeout;
  while (Date.now()<deadline) { const value=predicate(); if(value) return value; await new Promise(resolve=>setTimeout(resolve,15)); }
  throw new Error('Timed out waiting for GHCi terminal output');
}
async function ghciHarness(t) {
  const root=await temporary(t); const store=new Store(root); await store.init();
  const item=await store.create('Solution.hs',example); const events=[], output={};
  const ghci=new Ghci(event=>{ events.push(event); if(event.type==='ghci-data') output[event.id]=(output[event.id] || '')+event.data; },process.env.KATA_GHCI || 'ghci',{ env:{ HOME:root } });
  t.after(()=>ghci.close());
  ghci.start(item.id,store.file(item.id)); await waitFor(()=>/ghci>/.test(output[item.id] || ''));
  async function send(command,pattern,id=item.id) {
    const offset=(output[id] || '').length;
    ghci.write(id,command);
    return waitFor(()=>{ const text=diagnosticText((output[id] || '').slice(offset)); return pattern.test(text) && text; });
  }
  return { root,store,item,ghci,events,output,send };
}

test('real PTY GHCi evaluates, captures diagnostics, reloads, resizes, and isolates files', { timeout:25000 }, async t=>{
  const { store,item,ghci,events,output,send }=await ghciHarness(t);
  await send('solution 10\r',/(?:^|\n)23(?:\n|$)/);
  await send(':t solution\r',/solution :: Integer -> Integer/);
  await send('solution "ten"\r',/Couldn't match/);
  await waitFor(()=>events.some(e=>e.type==='ghci-diagnostic' && /Couldn't match/.test(e.diagnostic.output)));
  await send('head ([] :: [Int])\r',/Exception: Prelude.head/);
  await waitFor(()=>events.some(e=>e.type==='ghci-diagnostic' && /Exception: Prelude.head/.test(e.diagnostic.output)));
  await store.save(item.id,'module Solution where\nsolution :: Integer -> Integer\nsolution n = n * 2\n');
  const beforeReload=output[item.id].length;
  await ghci.reload(item.id); await waitFor(()=>/Ok, one module loaded/.test(output[item.id].slice(beforeReload)));
  await send('solution 10\r',/(?:^|\n)20(?:\n|$)/);
  ghci.resize(item.id,100,30);
  await send(':! stty size\r',/30 100/);
  const snapshot=ghci.start(item.id,store.file(item.id));
  assert.equal(snapshot.cols,100); assert.equal(snapshot.rows,30); assert.ok(snapshot.seq>0); assert.match(snapshot.data,/solution/);
  const other=await store.create('Other'); ghci.start(other.id,store.file(other.id));
  await waitFor(()=>/ghci>/.test(output[other.id] || ''));
  await send('solve [1,2,3]\r',/(?:^|\n)6(?:\n|$)/,other.id);
  await send('solution 5\r',/(?:^|\n)10(?:\n|$)/);
  await send(':{\rlet double x =\r      x * 2\r:}\r',/ghci>/);
  await send('double 4\r',/(?:^|\n)8(?:\n|$)/);
  await store.save(item.id,'module Solution where\nsolution = missingName\n');
  await send(':reload\r',/not in scope.*missingName/i);
});

test('real PTY supports interactive getLine, Ctrl+C recovery, :quit and restart', { timeout:20000 }, async t=>{
  const { store,item,ghci,output,send }=await ghciHarness(t);
  ghci.write(item.id,'getLine >>= (putStrLn . ("INPUT:" ++))\r');
  await new Promise(resolve=>setTimeout(resolve,250));
  await send('hello\r',/INPUT:hello/);
  ghci.write(item.id,'sum [1..]\r'); await new Promise(resolve=>setTimeout(resolve,250));
  await send('\x03',/Interrupted|Exception.*interrupt/i);
  await send('1 + 1\r',/(?:^|\n)2(?:\n|$)/);
  await send(':quit\r',/Leaving GHCi/);
  await waitFor(()=>!ghci.sessions.has(item.id));
  output[item.id]=''; await ghci.restart(item.id,store.file(item.id));
  await waitFor(()=>/ghci>/.test(output[item.id] || ''));
  await send('solution 7\r',/(?:^|\n)14(?:\n|$)/);
});

test('GHCi native Tab completion and arrow-key history', { timeout:15000 }, async t=>{
  // Haskeline needs /dev/tty even when inherited descriptors are all TTYs.
  // The Codex sandbox can forbid opening that device; report this as a skip.
  const pty=require('node-pty');
  let probeOutput='';
  const probe=pty.spawn(process.execPath,['-e',"try { require('node:fs').closeSync(require('node:fs').openSync('/dev/tty','r+')); console.log('TTY_OK'); } catch(e) { console.log('TTY_BLOCKED:'+e.code); }"],{name:'xterm-256color'});
  probe.onData(data=>probeOutput+=data);
  await new Promise(resolve=>probe.onExit(resolve));
  if(!probeOutput.includes('TTY_OK')) { t.skip('Haskeline terminal device unavailable: '+probeOutput.trim()); return; }
  const { send,output,item }=await ghciHarness(t);
  await send('solu\t 10\r',/(?:^|\n)23(?:\n|$)/);
  await send('\x1b[A\r',/(?:^|\n)23(?:\n|$)/);
  assert.doesNotMatch(output[item.id],/Tab character found/);
});

test('Codex streams ephemeral chats, discovers model efforts, and applies live search and per-turn settings', { timeout:10000 }, async t => {
  const root = await temporary(t); const store = new Store(root); await store.init();
  const script = path.join(root,'fake-codex.cjs');
  await fs.writeFile(script,`#!/usr/bin/env node
const rl = require('node:readline').createInterface({ input:process.stdin });
const fs = require('node:fs');
fs.writeFileSync('argv.log',JSON.stringify(process.argv));
const send = x => process.stdout.write(JSON.stringify(x)+'\\n');
let initialized = false;
rl.on('line', line => { const m = JSON.parse(line); let result = {}; fs.appendFileSync('rpc.log',line+'\\n');
  if (m.method === 'initialize') result = { userAgent:'test' };
  else if (m.method === 'initialized') { initialized = true; return; }
  else if (!initialized) return send({ id:m.id,error:{ message:'Not initialized' } });
  else if (m.method === 'account/read') result = { requiresOpenaiAuth:false,account:null };
  else if (m.method === 'model/list') result = m.params.cursor ? { data:[{ id:'fast',model:'fast',displayName:'Fast',isDefault:false,defaultReasoningEffort:'low',supportedReasoningEfforts:[{ reasoningEffort:'low',description:'Fast' },{ reasoningEffort:'high',description:'Deep' }] }] } : { data:[{ id:'test',model:'test',displayName:'Test',isDefault:true,defaultReasoningEffort:'medium',supportedReasoningEfforts:[{ reasoningEffort:'medium',description:'Balanced' },{ reasoningEffort:'high',description:'Deep' }] }],nextCursor:'second' };
  else if (m.method === 'config/read') result = { config:{ model:'test',model_reasoning_effort:'medium' } };
  else if (m.method === 'thread/start') { if(m.params.sandbox!=='read-only' || !m.params.ephemeral) process.exit(8); result = { thread:{ id:'thread-test' } }; }
  else if (m.method === 'thread/resume') result = { thread:{ id:m.params.threadId } };
  else if (m.method === 'turn/start') {
    if (!m.params.input[0].text.includes('現在のHaskellコード')) process.exit(9);
    result = { turn:{ id:'turn-test',status:'inProgress' } };
    setTimeout(() => {
      send({ method:'turn/started',params:{ threadId:m.params.threadId,turn:{ id:'turn-test' } } });
      send({ method:'item/agentMessage/delta',params:{ threadId:m.params.threadId,delta:'型を' } });
      send({ method:'item/agentMessage/delta',params:{ threadId:m.params.threadId,delta:'確認しましょう。' } });
      send({ method:'turn/completed',params:{ threadId:m.params.threadId,turn:{ id:'turn-test',status:'completed' } } });
    },40);
  }
  if(m.id !== undefined) send({ id:m.id,result });
});`,{ mode:0o755 });
  const events = []; const codex = new Codex(store,e => events.push(e),script); t.after(() => codex.close());
  const item = await store.create('Solution.hs',example); await codex.connect(); assert.equal(codex.status.state,'connected');
  assert.deepEqual(codex.status.models.map(model => model.id),['test','fast']);
  assert.deepEqual(codex.status.models[0].supportedReasoningEfforts.map(option => option.effort),['medium','high']);
  assert.equal(codex.status.defaultModel,'test');
  await codex.ask(item.id,'ヒントをください','solution 10\n23','test','high',example+'\n-- unsaved chat context');
  await new Promise(r => setTimeout(r,100));
  assert.equal(store.find(item.id).threadId,'thread-test');
  assert.equal(store.find(item.id).messages.at(-1).text,'型を確認しましょう。');
  assert.equal(store.find(item.id).messages.at(-1).pending,false);
  assert.ok(events.some(x => x.type==='ai-message'));
  codex.loaded.clear();
  await codex.ask(item.id,'もう少し詳しく','','');
  await new Promise(r => setTimeout(r,100));
  assert.equal(store.find(item.id).messages.length,4);
  await codex.ask(item.id,'別のモデルで','','fast','high');
  await new Promise(r => setTimeout(r,100));
  await codex.ask(item.id,'標準の推論レベルで','','fast');
  await new Promise(r => setTimeout(r,100));
  await assert.rejects(codex.ask(item.id,'未対応の推論','','fast','ultra'),/推論レベル/);
  assert.equal(store.find(item.id).messages.at(-1).pending,false);
  const requests = (await fs.readFile(path.join(root,'rpc.log'),'utf8')).trim().split('\n').map(JSON.parse);
  const turns = requests.filter(request => request.method === 'turn/start').map(request => request.params);
  assert.deepEqual(turns.map(turn => [turn.model,turn.effort]),[['test','high'],['test','medium'],['fast','high'],['fast','low']]);
  assert.match(turns[0].input[0].text,/unsaved chat context/);
  assert.equal((await store.open(item.id)).code,example,'asking about unsaved code does not save it');
  for (const request of requests.filter(request => ['thread/start','thread/resume'].includes(request.method))) {
    assert.equal(request.params.config.web_search,'live');
    assert.equal(request.params.config['features.shell_tool'],false);
  }
  const instructions = requests.find(request => request.method === 'thread/start').params.developerInstructions;
  assert.match(instructions,/may use the built-in web search/);
  const argv = JSON.parse(await fs.readFile(path.join(root,'argv.log'),'utf8'));
  assert.ok(argv.includes('web_search="live"'));
  assert.ok(argv.includes('features.shell_tool=false'));
  await store.writes;
  const reopened = new Store(root); await reopened.init();
  assert.deepEqual(reopened.find(item.id).messages,[]);
  assert.equal(reopened.find(item.id).threadId,null);
  assert.equal((await fs.readdir(root)).some(name => name.endsWith('.json')),false);
});

test('GHCi starts on explicit load, reloads the same session, and analyzes only current output', { timeout:15000 }, async t => {
  const root = await temporary(t), store = new Store(root); await store.init();
  const item = await store.create('Load.hs','module Load where\nanswer :: Int\nanswer = 42\n');
  const events = [], ghci = new Ghci(e => events.push(e),process.env.KATA_GHCI || 'ghci',{ env:{ HOME:root } });
  t.after(() => ghci.close());
  const diagnostics = new GhciDiagnostics(store,ghci);
  assert.equal(ghci.peek(item.id),null,'reading a snapshot does not start GHCi');
  await store.open(item.id); assert.equal(ghci.sessions.size,0,'opening a file does not start GHCi');
  const success = await diagnostics.load(item.id,100,30);
  assert.equal(success.success,true,success.output);
  assert.deepEqual(success.diagnostics,[]);
  const session = ghci.sessions.get(item.id), pid = session.proc.pid;
  assert.equal(ghci.peek(item.id).cols,100);
  const never = { explainDiagnostics:() => { throw new Error('must not call AI on success'); } };
  assert.equal(await diagnostics.explain(item.id,success.token,never),success);
  await store.save(item.id,'module Load where\nanswer :: Int\nanswer = "wrong"\n');
  const failure = await diagnostics.load(item.id);
  assert.equal(ghci.sessions.get(item.id).proc.pid,pid,'reload preserves the PTY process');
  assert.equal(failure.success,false,failure.output);
  assert.equal(failure.diagnostics[0].line,3);
  assert.equal(failure.diagnostics[0].severity,'error');
  assert.match(failure.diagnostics[0].message,/Couldn't match/);
  const ai = { explainDiagnostics:async report => { assert.equal(report.source,failure.source); return new Map([[0,{ displayLine:2,explanation:'Intが必要な場所に文字列があります。数値に直してください。' }]]); } };
  const enriched = await diagnostics.explain(item.id,failure.token,ai);
  assert.match(enriched.diagnostics[0].explanation,/Int/);
  assert.equal(enriched.diagnostics[0].line,3,'preserve the original GHCi location');
  assert.equal(enriched.diagnostics[0].displayLine,2,'use the AI-selected location for display');
  await assert.rejects(diagnostics.explain(item.id,success.token,ai),/再読み込み/);
  await store.save(item.id,'module Load where\nanswer = 42\n');
  await assert.rejects(diagnostics.explain(item.id,failure.token,ai),/再読み込み/);
  const recovered = await diagnostics.load(item.id);
  assert.equal(recovered.success,true,recovered.output);
  assert.doesNotMatch(recovered.output,/Couldn't match/,'old errors are excluded from new load output');
  assert.deepEqual(recovered.diagnostics,[]);
  // Errors from direct terminal input also become reports, with no invented source line.
  ghci.write(item.id,'head ([] :: [Int])\r');
  await waitFor(() => events.some(e => e.type === 'ghci-diagnostic' && /Exception: Prelude.head/.test(e.diagnostic.output)));
  const runtime = await diagnostics.latest(item.id);
  assert.equal(runtime.success,false); assert.equal(runtime.diagnostics[0].line,0);
  assert.match(runtime.output,/Exception: Prelude.head/);
  // Literal prompt-looking source output must not finish an in-flight load.
  assert.deepEqual(await fs.readdir(root),['Load.hs']);
  await ghci.stop(item.id);
  assert.equal(ghci.peek(item.id),null);
  await store.save(item.id,'module Load where\nanswer :: Int\nanswer = "bad on first load"\n');
  const firstFailure = await diagnostics.load(item.id);
  assert.equal(firstFailure.success,false,'a new GHCi session also captures initial load failures');
  assert.equal(firstFailure.diagnostics[0].line,3);
  await store.save(item.id,'module Load where\nanswer = 42\n');
  assert.equal((await diagnostics.load(item.id)).success,true,'the restarted session can recover by reloading');
});

test('GHCi diagnostics parse ranges and warnings without assigning dependency errors to the open file', () => {
  const file = path.resolve('/tmp/日本語.hs');
  const output = 'Other.hs:1:1: error: dependency\n日本語.hs:(2,3)-(3,4): error: [GHC-12345]\n  bad type\n日本語.hs:3:1-9: warning: unused\n';
  const parsed = parseDiagnostics(output,file,'module X where\nx = 1\ny = 2\n');
  assert.deepEqual(parsed.map(d => [d.line,d.column,d.severity]),[[2,3,'error'],[3,1,'warning']]);
  assert.match(parsed[0].message,/bad type/);
  assert.deepEqual(parseDiagnostics('日本語.hs:20:1: error: out of range',file,'x = 1'),[]);
});

test('background AI uses structured output, isolates chat, validates indexes and handles failures', { timeout:10000 }, async t => {
  const root = await temporary(t), store = new Store(root); await store.init();
  const script = path.join(root,'diagnostic-codex.cjs');
  await fs.writeFile(script,`#!/usr/bin/env node
const fs = require('node:fs');
const send = x => process.stdout.write(JSON.stringify(x)+'\\n');
let serial = 0;
require('node:readline').createInterface({ input:process.stdin }).on('line',line => {
  const m = JSON.parse(line); let result = {};
  fs.appendFileSync('requests.log',line+'\\n');
  if (m.method === 'account/read') result = { requiresOpenaiAuth:false };
  if (m.method === 'model/list') result = { data:[] };
  if (m.method === 'config/read') result = { config:{} };
  if (m.method === 'thread/start') result = { thread:{ id:'thread-'+(++serial) } };
  if (m.method === 'turn/start') {
    result = { turn:{ id:'turn-'+serial } };
    setTimeout(() => {
      const threadId=m.params.threadId, source=m.params.input[0].text;
      if (source.includes('DISCONNECT')) return process.exit(1);
      if (m.params.outputSchema) {
        const text = source.includes('MALFORMED') ? 'invalid JSON' : JSON.stringify({ diagnostics:[...(source.includes('BAD_LINES') ? [] : [{ index:0,displayLine:source.includes('UNLOCATED') ? 0 : 1,explanation:source.includes('LONG_MESSAGE') ? '説明'.repeat(400)+'全文の末尾' : 'Intが必要ですが文字列になっています。数値に直してください。' }]),{ index:999,displayLine:1,explanation:'invalid index' },{ index:1,displayLine:1,explanation:'warning is not an error' },...[-1,1.5,999,'2',null,undefined].map(displayLine => ({ index:0,displayLine,explanation:'invalid location' }))] });
        send({ method:'item/agentMessage/delta',params:{ threadId,delta:'This is a preamble.' } });
        send({ method:'item/completed',params:{ threadId,item:{ type:'agentMessage',text } } });
      } else send({ method:'item/agentMessage/delta',params:{ threadId,delta:'チャットの応答' } });
      send({ method:'turn/completed',params:{ threadId,turn:{ status:source.includes('FAILED') ? 'failed' : 'completed',error:{ message:'test failure' } } } });
    },30);
  }
  if (m.id !== undefined) send({ id:m.id,result });
});`,{ mode:0o755 });
  const events = [], codex = new Codex(store,e => events.push(e),script); t.after(() => codex.close());
  const item = await store.create('Solution.hs');
  const report = { source:'module Solution where\nx = "wrong"',diagnostics:[{ line:2,column:1,severity:'error',message:'type mismatch' },{ line:1,column:1,severity:'warning',message:'warning' }] };
  const [explanations] = await Promise.all([codex.explainDiagnostics(report),codex.ask(item.id,'ヒント','','','')]);
  await waitFor(() => !store.find(item.id).messages.at(-1).pending);
  assert.equal(explanations.size,1);
  assert.match(explanations.get(0).explanation,/Int/);
  assert.equal(explanations.get(0).displayLine,1,'AI can choose a different line from GHCi line 2');
  assert.equal(item.messages.length,2);
  assert.equal(item.messages.at(-1).text,'チャットの応答');
  assert.ok(events.filter(e => e.type === 'ai-message').every(e => !e.message.text.includes('Int')));
  assert.equal(codex.active.size,0);
  await assert.rejects(codex.explainDiagnostics({ ...report,source:'MALFORMED' }),/JSON/);
  await assert.rejects(codex.explainDiagnostics({ ...report,source:'FAILED' }),/test failure/);
  await assert.rejects(codex.explainDiagnostics({ ...report,source:'BAD_LINES' }),/説明を取得できません/);
  const unlocated = await codex.explainDiagnostics({ ...report,source:'UNLOCATED' });
  assert.equal(unlocated.get(0).displayLine,0,'unlocated explanations stay out of source lines');
  const longMessage = await codex.explainDiagnostics({ ...report,source:'LONG_MESSAGE' });
  assert.equal(longMessage.get(0).explanation,'説明'.repeat(400)+'全文の末尾','AI messages are not truncated at 500 characters');
  const requests = (await fs.readFile(path.join(root,'requests.log'),'utf8')).trim().split('\n').map(JSON.parse);
  const background = requests.find(r => r.method === 'turn/start' && r.params.outputSchema);
  assert.deepEqual(background.params.outputSchema.required,['diagnostics']);
  assert.deepEqual(background.params.outputSchema.properties.diagnostics.items.required,['index','displayLine','explanation']);
  const input = JSON.parse(background.params.input[0].text);
  assert.deepEqual(input.source,[{ line:1,text:'module Solution where' },{ line:2,text:'x = "wrong"' }]);
  const thread = requests.find(r => r.method === 'thread/start' && r.params.developerInstructions.includes('GHCi load errors'));
  assert.equal(thread.params.sandbox,'read-only'); assert.equal(thread.params.ephemeral,true);
  assert.equal(thread.params.config.web_search,'disabled');
  assert.ok(requests.some(r => r.method === 'thread/archive'));
  await assert.rejects(codex.explainDiagnostics({ ...report,source:'DISCONNECT' }),/接続が終了/);
  assert.equal(item.messages.length,2,'background failures also leave chat history untouched');
});
