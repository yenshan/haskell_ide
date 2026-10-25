// Run with: npm run test:electron (requires a graphical desktop).
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(),'kata-electron-'));
process.env.KATA_WORKSPACE = path.join(temporary,'workspace');
process.env.KATA_RUNTIME = path.join(temporary,'runtime');
fs.mkdirSync(process.env.KATA_WORKSPACE);
fs.writeFileSync(path.join(process.env.KATA_WORKSPACE,'Solution.hs'),'-- Multiples of 3 or 5\nmodule Solution where\nsolution :: Integer -> Integer\nsolution n = sum [x | x <- [1 .. n-1], x `mod` 3 == 0 || x `mod` 5 == 0]\n');
// Error consultation sends immediately; keep this test independent of real AI services.
process.env.KATA_CODEX = path.join(temporary,'fake-codex.cjs');
fs.writeFileSync(process.env.KATA_CODEX,`#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const rl = require('node:readline').createInterface({ input:process.stdin });
const send = message => process.stdout.write(JSON.stringify(message)+'\\n');
rl.on('line',line => {
  const message = JSON.parse(line); let result = {};
  fs.appendFileSync(path.join(__dirname,'requests.log'),line+'\\n');
  if (message.method === 'account/read') result = { requiresOpenaiAuth:false,account:null };
  if (message.method === 'model/list') result = { data:[] };
  if (message.method === 'config/read') result = { config:{} };
  if (message.method === 'thread/start') result = { thread:{ id:'test-thread' } };
  if (message.method === 'turn/start') {
    result = { turn:{ id:'test-turn' } };
    setTimeout(() => {
      send({ method:'item/agentMessage/delta',params:{ threadId:message.params.threadId,delta:'型を確認しましょう。' } });
      send({ method:'turn/completed',params:{ threadId:message.params.threadId,turn:{ id:'test-turn',status:'completed' } } });
    },100);
  }
  if (message.id !== undefined) send({ id:message.id,result });
});`,{ mode:0o755 });
const root = path.resolve(__dirname,'..');
let finished = false;
const timeout = setTimeout(() => finish(new Error('Electron smoke test timed out')),30000);
function finish(error) {
  if (finished) return; finished = true; clearTimeout(timeout);
  if (error) console.error(error);
  else console.log('Electron smoke passed: renderer, Vim edit, autosave, real GHCi, error context, file creation and switching.');
  app.exit(error ? 1 : 0);
}
app.on('browser-window-created', (_,win) => {
  win.webContents.on('console-message', (_, details) => { if (details.level >= 3) console.error('Renderer:',details.message); });
  win.webContents.once('did-finish-load', async () => {
    const evaluate = code => win.webContents.executeJavaScript(code,true);
    const pause = ms => new Promise(r => setTimeout(r,ms));
    const key = (keyCode,modifiers = []) => {
      win.webContents.sendInputEvent({ type:'keyDown',keyCode,modifiers });
      win.webContents.sendInputEvent({ type:'keyUp',keyCode,modifiers });
    };
    const consultError = (held = false) => { key('J',['control']); key('E',held ? ['control'] : []); };
    async function until(code) { for(let i=0;i<100;i++) { const value = await evaluate(`(async () => Boolean(await (${code})))()`); if(value) return value; await pause(60); } throw new Error('Timed out: '+code); }
    try {
      await until(`document.querySelector('.xterm') && document.querySelector('.cm-content')`);
      assert.match(await evaluate('document.body.innerText'),/Multiples of 3 or 5/);
      // Native key events go through Vim and CodeMirror, then the app autosave.
      await evaluate(`document.querySelector('.cm-content').focus()`);
      win.webContents.sendInputEvent({ type:'keyDown', keyCode:'G', modifiers:['shift'] });
      win.webContents.sendInputEvent({ type:'keyUp', keyCode:'G', modifiers:['shift'] });
      win.webContents.sendInputEvent({ type:'keyDown',keyCode:'O' });
      win.webContents.sendInputEvent({ type:'keyUp',keyCode:'O' });
      await until(`document.querySelector('.mode-indicator').textContent === 'INSERT'`);
      await win.webContents.insertText('-- smoke edit');
      win.webContents.sendInputEvent({ type:'keyDown',keyCode:'Escape' });
      win.webContents.sendInputEvent({ type:'keyUp',keyCode:'Escape' });
      await until(`document.querySelector('.cm-content').textContent.includes('smoke edit')`);
      await until(`!document.querySelector('.dirty-dot')`);
      const problem = await evaluate(`window.kata.list().then(async list => window.kata.open(list[0].id))`);
      assert.match(problem.code,/smoke edit/);
      assert.match(problem.code,/^-- smoke edit$/m);
      const editorText = await evaluate(`document.querySelector('.cm-content').textContent`);
      consultError();
      await pause(100);
      assert.equal(await evaluate(`document.querySelector('.cm-content').textContent`),editorText,'error shortcut without an error leaves the editor unchanged');
      assert.ok(!fs.existsSync(path.join(temporary,'requests.log')) || !fs.readFileSync(path.join(temporary,'requests.log'),'utf8').includes('"method":"turn/start"'));
      await until(`window.kata.ghciStart(${JSON.stringify(problem.id)}).then(s => s.data.includes('ghci>'))`);
      await evaluate(`window.kata.ghciWrite(${JSON.stringify(problem.id)},'solution 10\\r')`);
      await until(`window.kata.ghciStart(${JSON.stringify(problem.id)}).then(s => /23[\\r\\n]/.test(s.data))`);
      await evaluate(`document.querySelector('.run-button').click()`);
      await until(`!document.querySelector('.run-button').disabled`);
      await evaluate(`window.kata.ghciWrite(${JSON.stringify(problem.id)},'solution "ten"\\r')`);
      await until(`document.querySelector('.ask-error-button')`);
      assert.equal(await evaluate(`document.querySelector('.ask-error-button').textContent`),'エラーをAIに相談');
      assert.ok(await evaluate(`!document.querySelector('.ask-output-button')`));
      await evaluate(`document.querySelector('[aria-label="AIサイドバーを閉じる"]').click()`);
      await evaluate(`document.querySelector('.ask-error-button').click(); document.querySelector('.ask-error-button').click()`);
      await until(`document.querySelector('.chat-area').textContent.includes('型を確認しましょう。')`);
      assert.ok(await evaluate(`!document.querySelector('#ai-sidebar-content').hidden`));
      assert.equal(await evaluate(`document.querySelector('[aria-label="AIへの質問"]').value`),'');
      const turns = fs.readFileSync(path.join(temporary,'requests.log'),'utf8').trim().split('\n').map(JSON.parse).filter(message => message.method === 'turn/start');
      assert.equal(turns.length,1,'double clicks send only once');
      assert.match(turns[0].params.input[0].text,/GHCiの実行結果/);
      assert.match(turns[0].params.input[0].text,/Couldn't match type/);
      // Native chords must work before xterm and Vim consume either key.
      for (const [selector,held] of [['.xterm-helper-textarea',false],['.cm-content',true]]) {
        await until(`!document.querySelector('.ask-error-button').disabled`);
        await evaluate(`document.querySelector('[aria-label="AIサイドバーを閉じる"]').click(); document.querySelector(${JSON.stringify(selector)}).focus()`);
        consultError(held);
        consultError(held);
        await until(`!document.querySelector('#ai-sidebar-content').hidden && document.querySelector('.ask-error-button').disabled`);
        await until(`!document.querySelector('.ask-error-button').disabled`);
      }
      const shortcutTurns = fs.readFileSync(path.join(temporary,'requests.log'),'utf8').trim().split('\n').map(JSON.parse).filter(message => message.method === 'turn/start');
      assert.equal(shortcutTurns.length,3,'each shortcut sends once, including with Control held');
      assert.equal(await evaluate(`document.querySelector('.cm-content').textContent`),editorText,'shortcut never inserts text');
      await evaluate(`document.querySelector('.cm-content').focus()`);
      key('J',['control']); key('J');
      await until(`document.activeElement.closest('#ghci-panel')`);
      key('J',['control']); key('K');
      await until(`document.activeElement.closest('.editor-panel')`);
      const artifacts = path.join(root,'artifacts'); fs.mkdirSync(artifacts,{ recursive:true });
      fs.writeFileSync(path.join(artifacts,'electron-smoke.png'),(await win.webContents.capturePage()).toPNG());
      await evaluate(`document.querySelector('.new-button').click()`);
      await until(`document.querySelector('.new-modal input')`);
      // Submit the real creation form using its default filename.
      await evaluate(`document.querySelector('.new-modal').requestSubmit()`);
      await until(`document.querySelector('.problem-item[aria-current="page"]')?.dataset.problemId !== ${JSON.stringify(problem.id)} && document.querySelector('.problem-item[aria-current="page"] .file-name')?.textContent === 'Untitled.hs'`);
      await until(`document.querySelector('.xterm')`);
      await evaluate(`document.querySelector('[data-problem-id="${problem.id}"]').click()`);
      await until(`document.querySelector('.problem-item[aria-current="page"]')?.dataset.problemId === ${JSON.stringify(problem.id)}`);
      assert.ok(await evaluate(`document.querySelector('.cm-content').textContent.includes('smoke edit')`));
      // Empty assistant and default layout for a clean visual QA image.
      await evaluate(`document.querySelector('[aria-label="AIへの質問"]').value = ''`);
      await pause(100);
      finish();
    } catch (e) { finish(e); }
  });
});
require('../electron/main.cjs');
