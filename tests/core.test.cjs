const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../electron/store.cjs');
const { Ghci } = require('../electron/ghci.cjs');
const { Codex } = require('../electron/codex.cjs');
const { Workspace, migrateLegacy } = require('../electron/workspace.cjs');
async function temporary(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(),'kata-test-')); t.after(() => fs.rm(root,{ recursive:true,force:true })); return root; }

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

test('real GHCi loads, evaluates, detects compile/runtime errors, reloads and isolates sessions', { timeout:20000 }, async t => {
  const root = await temporary(t); const store = new Store(root); await store.init();
  const item = await store.create('Solution.hs',example); const events = []; const ghci = new Ghci(e => events.push(e),process.env.KATA_GHCI || 'ghci'); t.after(() => ghci.close());
  const loaded = await ghci.start(item.id,store.file(item.id)); assert.equal(loaded.failed,false);
  assert.equal((await ghci.run(item.id,'solution 10')).output,'23');
  assert.equal((await ghci.run(item.id,':t solution')).output,'solution :: Integer -> Integer');
  const bad = await ghci.run(item.id,'solution "ten"'); assert.equal(bad.failed,true); assert.match(bad.output,/Couldn't match/);
  const exception = await ghci.run(item.id,'head ([] :: [Int])'); assert.equal(exception.failed,true); assert.match(exception.output,/Exception/);
  await store.save(item.id,'module Solution where\nsolution :: Integer -> Integer\nsolution n = n * 2\n');
  assert.equal((await ghci.run(item.id,':reload')).failed,false);
  assert.equal((await ghci.run(item.id,'solution 10')).output,'20');
  const other = await store.create('Other'); await ghci.start(other.id,store.file(other.id));
  assert.equal((await ghci.run(other.id,'solve [1,2,3]')).output,'6');
  assert.equal((await ghci.run(item.id,'solution 5')).output,'10');
  assert.equal((await ghci.run(item.id,'let double x =\n      x * 2')).failed,false);
  assert.equal((await ghci.run(item.id,'double 4')).output,'8');
  await store.save(item.id,'module Solution where\nsolution = missingName\n');
  assert.equal((await ghci.run(item.id,':reload')).failed,true);
  assert.ok(events.some(e => e.type==='ghci-result' && e.result.failed));
});

test('GHCi interrupt recovers from non-terminating expressions', { timeout:10000 }, async t => {
  const root = await temporary(t); const store = new Store(root); await store.init();
  const item = await store.create('Solution.hs',example); const ghci = new Ghci(() => {},process.env.KATA_GHCI || 'ghci'); t.after(() => ghci.close());
  await ghci.start(item.id,store.file(item.id));
  const running = ghci.run(item.id,'sum [1..]');
  setTimeout(() => ghci.interrupt(item.id),250);
  const result = await running; assert.match(result.output,/Interrupted|interrupt|Exception/i);
  assert.equal((await ghci.run(item.id,'1 + 1')).output,'2');
});

test('missing GHCi reports an actionable error', async t => {
  const root = await temporary(t); const store = new Store(root); await store.init();
  const item = await store.create('Solution.hs',example); const ghci = new Ghci(() => {},'/missing/ghci'); t.after(() => ghci.close());
  await assert.rejects(ghci.start(item.id,store.file(item.id)),/GHCiを起動できません/);
});

test('Codex streams per-file ephemeral conversations without writing local metadata', { timeout:10000 }, async t => {
  const root = await temporary(t); const store = new Store(root); await store.init();
  const script = path.join(root,'fake-codex.cjs');
  await fs.writeFile(script,`#!/usr/bin/env node
const rl = require('node:readline').createInterface({ input:process.stdin });
const send = x => process.stdout.write(JSON.stringify(x)+'\\n');
let initialized = false;
rl.on('line', line => { const m = JSON.parse(line); let result = {};
  if (m.method === 'initialize') result = { userAgent:'test' };
  else if (m.method === 'initialized') { initialized = true; return; }
  else if (!initialized) return send({ id:m.id,error:{ message:'Not initialized' } });
  else if (m.method === 'account/read') result = { requiresOpenaiAuth:false,account:null };
  else if (m.method === 'model/list') result = { data:[{ id:'test',model:'test',displayName:'Test',isDefault:true }] };
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
  await codex.ask(item.id,'ヒントをください','solution 10\n23','test');
  await new Promise(r => setTimeout(r,100));
  assert.equal(store.find(item.id).threadId,'thread-test');
  assert.equal(store.find(item.id).messages.at(-1).text,'型を確認しましょう。');
  assert.equal(store.find(item.id).messages.at(-1).pending,false);
  assert.ok(events.some(x => x.type==='ai-message'));
  codex.loaded.clear();
  await codex.ask(item.id,'もう少し詳しく','','test');
  await new Promise(r => setTimeout(r,100));
  assert.equal(store.find(item.id).messages.length,4);
  await store.writes;
  const reopened = new Store(root); await reopened.init();
  assert.deepEqual(reopened.find(item.id).messages,[]);
  assert.equal(reopened.find(item.id).threadId,null);
  assert.equal((await fs.readdir(root)).some(name => name.endsWith('.json')),false);
});
