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
      send({ method:'item/agentMessage/delta',params:{ threadId:message.params.threadId,delta:message.params.outputSchema ? JSON.stringify({ diagnostics:[{ index:0,displayLine:JSON.parse(message.params.input[0].text).errors[0].line === 0 ? 0 : 2,explanation:'Int型が必要な場所に文字列があります。数値に直してください。'+String.fromCharCode(10)+'型注釈と実際の値の型を確認し、返す値または宣言した型を合わせてください。'.repeat(16)+'最後まで表示される説明です。' }] }) : '型を確認しましょう。' } });
      send({ method:'turn/completed',params:{ threadId:message.params.threadId,turn:{ id:'test-turn',status:'completed' } } });
    },message.params.outputSchema ? 500 : 100);
  }
  if (message.id !== undefined) send({ id:message.id,result });
});`,{ mode:0o755 });
const root = path.resolve(__dirname,'..');
let finished = false;
const timeout = setTimeout(() => finish(new Error('Electron smoke test timed out')),30000);
function finish(error) {
  if (finished) return; finished = true; clearTimeout(timeout);
  if (error) console.error(error);
  else console.log('Electron smoke passed: renderer, Vim edit, manual saving, real GHCi, file switching, layouts, GHCi load shortcut, inline AI explanations and stale result handling.');
  app.exit(error ? 1 : 0);
}
app.on('browser-window-created', (_,win) => {
  win.webContents.on('console-message', (_, details) => { if (details.level >= 3) console.error('Renderer:',details.message); });
  win.webContents.once('did-finish-load', async () => {
    const evaluate = code => win.webContents.executeJavaScript(code,true).catch(error => { throw new Error(`${error.message}\nEvaluating: ${code}`); });
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
      assert.equal(await evaluate(`window.kata.list().then(list => window.kata.ghciSnapshot(list[0].id))`),null,'opening the initial file does not launch GHCi');
      await evaluate(`document.querySelector('[aria-label="AIサイドバーを閉じる"]').click()`);
      // Native key events go through Vim and CodeMirror; edits stay unsaved until requested.
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
      await pause(1100);
      await evaluate(`window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('beforeunload')); document.querySelector('.cm-content').focus()`);
      await pause(100);
      const unsaved = await evaluate(`window.kata.list().then(async list => window.kata.open(list[0].id))`);
      assert.doesNotMatch(unsaved.code,/smoke edit/,'waiting and focus changes never save edits');
      assert.ok(await evaluate(`Boolean(document.querySelector('.dirty-dot'))`));
      key('S',[process.platform === 'darwin' ? 'meta' : 'control']);
      await until(`!document.querySelector('.dirty-dot')`);
      const problem = await evaluate(`window.kata.list().then(async list => window.kata.open(list[0].id))`);
      assert.match(problem.code,/smoke edit/);
      assert.match(problem.code,/^-- smoke edit$/m);
      const editorText = await evaluate(`document.querySelector('.cm-content').textContent`);
      consultError();
      await pause(100);
      assert.equal(await evaluate(`document.querySelector('.cm-content').textContent`),editorText,'error shortcut without an error leaves the editor unchanged');
      assert.ok(!fs.existsSync(path.join(temporary,'requests.log')) || !fs.readFileSync(path.join(temporary,'requests.log'),'utf8').includes('"method":"turn/start"'));
      await evaluate(`document.querySelector('.cm-content').focus()`);
      key('Enter',[process.platform === 'darwin' ? 'meta' : 'control']);
      await until(`!document.querySelector('.ghci-status-popup') && !document.querySelector('.load-button').disabled && document.querySelector('.run-button').textContent.includes('再読込')`);
      await until(`window.kata.ghciSnapshot(${JSON.stringify(problem.id)}).then(s => s && s.data.includes('ghci>'))`);
      await evaluate(`window.kata.ghciWrite(${JSON.stringify(problem.id)},'solution 10\\r')`);
      await until(`window.kata.ghciSnapshot(${JSON.stringify(problem.id)}).then(s => s && /23[\\r\\n]/.test(s.data))`);
      // Moving the terminal must preserve its instance, PTY state and unfinished input.
      await evaluate(`window.smokeTerminal = document.querySelector('.xterm'); document.querySelector('.xterm-helper-textarea').focus()`);
      await win.webContents.insertText('let layoutValue = 41');
      await evaluate(`document.querySelector('[aria-label="GHCiをエディタの右に移動"]').click()`);
      await until(`document.querySelector('.ghci-at-side #ghci-panel')`);
      assert.ok(await evaluate(`window.smokeTerminal === document.querySelector('.xterm')`),'moving does not recreate xterm');
      assert.ok(await evaluate(`!document.querySelector('.split-handle') && !document.querySelector('[role="tab"]')`));
      assert.ok(await evaluate(`document.querySelector('#ghci-panel').getBoundingClientRect().left > document.querySelector('.editor-panel').getBoundingClientRect().left`));
      const ghciWidth = await evaluate(`document.querySelector('#ghci-panel').getBoundingClientRect().width`);
      await evaluate(`document.querySelector('[aria-label="GHCiの幅を調整"]').focus()`);
      key('Left');
      await until(`document.querySelector('#ghci-panel').getBoundingClientRect().width > ${ghciWidth}`);
      assert.ok(await evaluate(`Math.abs(document.querySelector('.editor-panel').getBoundingClientRect().height - document.querySelector('.main-workspace').getBoundingClientRect().height) < 2`),'side layout gives the editor full height');
      await evaluate(`document.querySelector('.xterm-helper-textarea').focus()`);
      key('Enter');
      await win.webContents.insertText('layoutValue + 1'); key('Enter');
      await until(`window.kata.ghciSnapshot(${JSON.stringify(problem.id)}).then(s => s && /42[\\r\\n]/.test(s.data))`);
      // The assistant overlays the workspace without resizing either split pane.
      const paneWidths = await evaluate(`['.editor-panel','#ghci-panel'].map(selector => document.querySelector(selector).getBoundingClientRect().width)`);
      await evaluate(`document.querySelector('[aria-label="AIサイドバーを開く"]').click()`);
      await until(`!document.querySelector('#ai-sidebar-content').hidden`);
      assert.ok(await evaluate(`(() => { const sidebar=document.querySelector('.assistant-overlay').getBoundingClientRect(); const workspace=document.querySelector('.workspace-area').getBoundingClientRect(); return sidebar.top === workspace.top && sidebar.right === workspace.right && sidebar.bottom === workspace.bottom && getComputedStyle(document.querySelector('.assistant-overlay')).borderRadius === '0px'; })()`),'overlay sidebar attaches to the right edge at full height');
      assert.deepEqual(await evaluate(`['.editor-panel','#ghci-panel'].map(selector => document.querySelector(selector).getBoundingClientRect().width)`),paneWidths);
      assert.ok(await evaluate(`(() => { const overlay=document.querySelector('.assistant-overlay').getBoundingClientRect(); const ghci=document.querySelector('#ghci-panel').getBoundingClientRect(); return overlay.left < ghci.right && overlay.right > ghci.left && !!document.elementFromPoint(overlay.left+20,overlay.top+20)?.closest('#assistant-panel'); })()`),'assistant appears above GHCi');
      await evaluate(`document.querySelector('[aria-label="AIへの質問"]').focus()`);
      key('Escape');
      await until(`document.querySelector('.assistant-overlay').hidden && document.activeElement.closest('.editor-panel')`);
      key('J',['control']); key('L');
      await until(`document.activeElement.closest('#ghci-panel')`);
      key('J',['control']); key('L');
      await until(`document.activeElement.closest('#assistant-panel') && !document.querySelector('.assistant-overlay').hidden`);
      key('J',['control']); key('H');
      await until(`document.activeElement.closest('#ghci-panel') && document.querySelector('.assistant-overlay').hidden`);
      await evaluate(`document.querySelector('.cm-content').focus()`);
      key('J',['control','shift']);
      await until(`document.activeElement.closest('#ghci-panel')`);
      assert.equal(await evaluate(`localStorage.getItem('kata-ghci-layout')`),'side');
      await evaluate(`document.querySelector('[aria-label="GHCiをエディタの下に移動"]').click()`);
      await until(`document.querySelector('.split-workspace #ghci-panel') && document.querySelector('.split-handle')`);
      assert.ok(await evaluate(`window.smokeTerminal === document.querySelector('.xterm')`));
      assert.equal(await evaluate(`localStorage.getItem('kata-ghci-layout')`),'bottom');
      // Direct GHCi errors are analyzed in the background, without chat entries.
      await evaluate(`document.querySelector('[aria-label="GHCiをエディタの右に移動"]').click()`);
      await until(`document.querySelector('.ghci-at-side #ghci-panel')`);
      const chatBeforeError = await evaluate(`document.querySelector('.chat-area').textContent`);
      const editorHeightBeforeError = await evaluate(`document.querySelector('.editor-mount').getBoundingClientRect().height`);
      await evaluate(`window.kata.ghciWrite(${JSON.stringify(problem.id)},'solution "ten"\\r')`);
      await until(`document.querySelector('.ask-error-button') && !document.querySelector('.ask-error-button').disabled && document.querySelector('.ghci-status-popup p')`);
      assert.equal(await evaluate(`document.querySelector('.chat-area').textContent`),chatBeforeError);
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('.ghci-status-popup')).position`),'fixed');
      assert.ok(await evaluate(`!document.querySelector('.editor-panel .ghci-status-popup')`),'status floats outside the editor layout');
      assert.equal(await evaluate(`document.querySelector('.editor-mount').getBoundingClientRect().height`),editorHeightBeforeError,'the popup does not reduce editor height');
      assert.ok(await evaluate(`document.querySelector('.assistant-overlay').hidden`));
      assert.equal(await evaluate(`document.querySelector('.ask-error-button').textContent`),'エラーを解析');
      assert.ok(await evaluate(`!document.querySelector('.cm-inline-diagnostic')`),'interactive errors are not assigned to an invented source line');
      for (const [selector,held] of [['.xterm-helper-textarea',false],['.cm-content',true]]) {
        await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
        consultError(held); consultError(held);
        await until(`document.querySelector('.ask-error-button').disabled`);
        await until(`!document.querySelector('.ask-error-button').disabled`);
      }
      const turns = fs.readFileSync(path.join(temporary,'requests.log'),'utf8').trim().split('\n').map(JSON.parse).filter(message => message.method === 'turn/start');
      assert.equal(turns.length,3,'automatic analysis and each explicit shortcut send once');
      assert.ok(turns.every(turn => turn.params.outputSchema),'all error analysis uses structured output');
      assert.equal(await evaluate(`document.querySelector('.chat-area').textContent`),chatBeforeError,'error shortcuts also leave chat unchanged');
      assert.ok(await evaluate(`document.querySelector('.assistant-overlay').hidden`));
      assert.equal(await evaluate(`document.querySelector('.cm-content').textContent`),editorText,'error shortcut never inserts text');
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
      assert.equal(await evaluate(`window.kata.list().then(list => window.kata.ghciSnapshot(list.find(item => item.fileName === 'Untitled.hs').id))`),null,'creating and opening a second file does not launch GHCi');
      await evaluate(`document.querySelector('[data-problem-id="${problem.id}"]').click()`);
      await until(`document.querySelector('.problem-item[aria-current="page"]')?.dataset.problemId === ${JSON.stringify(problem.id)}`);
      assert.ok(await evaluate(`document.querySelector('.cm-content').textContent.includes('smoke edit')`));
      await until(`document.querySelector('.ghci-at-side #ghci-panel')`);
      await pause(150);
      fs.writeFileSync(path.join(artifacts,'electron-ghci-side.png'),(await win.webContents.capturePage()).toPNG());
      await evaluate(`document.querySelector('[aria-label="AIサイドバーを開く"]').click()`);
      await until(`!document.querySelector('.assistant-overlay').hidden`);
      await pause(150);
      fs.writeFileSync(path.join(artifacts,'electron-ai-overlay.png'),(await win.webContents.capturePage()).toPNG());
      await evaluate(`document.querySelector('[aria-label="AIサイドバーを閉じる"]').click(); document.querySelector('[aria-label="GHCiをエディタの下に移動"]').click()`);
      await until(`document.querySelector('.split-handle')`);
      // Empty assistant and default layout for a clean visual QA image.
      await evaluate(`document.querySelector('[aria-label="AIへの質問"]').value = ''`);
      await pause(100);
      // Explicit GHCi loading and background diagnostics stay out of chat.
      const loadKey = () => key('Enter',[process.platform === 'darwin' ? 'meta' : 'control']);
      await evaluate(`document.querySelector('.cm-content').focus()`);
      const beforeVimLoad = await evaluate(`document.querySelector('.cm-content').textContent`);
      loadKey();
      await until(`!document.querySelector('.ghci-status-popup') && !document.querySelector('.load-button').disabled && document.querySelector('.run-button').textContent.includes('再読込')`);
      assert.equal(await evaluate(`document.querySelector('.cm-content').textContent`),beforeVimLoad,'GHCi load shortcut works in Vim without editing code');
      await evaluate(`document.querySelector('.vim-toggle.on')?.click(); document.querySelector('.cm-content').focus()`);
      const editSource = async source => {
        await evaluate(`document.querySelector('.cm-content').focus()`);
        key('A',[process.platform === 'darwin' ? 'meta' : 'control']);
        await win.webContents.insertText(source);
      };
      const invalidSource = 'module Solution where\nvalue :: Int\nvalue = "bad"\n';
      const validSource = 'module Solution where\nvalue :: Int\nvalue = 42\n';
      const chatBeforeLoad = await evaluate(`document.querySelector('.chat-area').textContent`);
      await editSource(invalidSource); loadKey();
      await until(`document.querySelector('.ghci-status-popup').textContent.includes('AIが解析中') && document.querySelector('.cm-inline-diagnostic')`);
      assert.match(await evaluate(`document.querySelector('.cm-inline-diagnostic').closest('.cm-line').textContent`),/value = "bad"/);
      await editSource(validSource);
      assert.ok(await evaluate(`Boolean(document.querySelector('.cm-inline-diagnostic'))`),'editing keeps the existing diagnostic visible');
      key('S',[process.platform === 'darwin' ? 'meta' : 'control']);
      await until(`!document.querySelector('.cm-inline-diagnostic') && !document.querySelector('.ghci-status-popup')`);
      await until(`!document.querySelector('.load-button').disabled`);
      assert.ok(await evaluate(`!document.querySelector('.cm-inline-diagnostic')`),'late AI results do not restore messages after saving');
      loadKey();
      await until(`!document.querySelector('.ghci-status-popup') && !document.querySelector('.load-button').disabled && document.querySelector('.run-button').textContent.includes('再読込')`);
      assert.ok(await evaluate(`!document.querySelector('.cm-inline-diagnostic')`));
      await editSource(invalidSource); loadKey();
      await until(`document.querySelector('.cm-inline-diagnostic')?.textContent.includes('AI: Int型')`);
      assert.match(await evaluate(`document.querySelector('.cm-inline-diagnostic').closest('.cm-line').textContent`),/value :: Int/,'AI explanation uses displayLine 2 instead of GHCi line 3');
      assert.ok(await evaluate(`document.querySelector('.cm-inline-diagnostic').textContent.endsWith('最後まで表示される説明です。')`),'the entire AI explanation is preserved');
      assert.ok(await evaluate(`(() => { const note=document.querySelector('.cm-inline-diagnostic'); return getComputedStyle(note).whiteSpace === 'pre-wrap' && note.getBoundingClientRect().height > 40 && note.scrollHeight <= note.clientHeight+1 && note.scrollWidth <= note.clientWidth+1; })()`),'long explanations wrap across lines without clipping');
      assert.equal(await evaluate(`document.querySelector('.chat-area').textContent`),chatBeforeLoad,'background analysis leaves chat unchanged');
      assert.ok(await evaluate(`document.querySelector('.assistant-overlay').hidden`),'background analysis does not open the assistant');
      assert.match(await evaluate(`document.querySelector('.cm-inline-diagnostic').title`),/GHCi \(3:/);
      fs.writeFileSync(path.join(artifacts,'electron-status-popup.png'),(await win.webContents.capturePage()).toPNG());
      await evaluate(`document.querySelector('[aria-label="GHCiの通知を閉じる"]').click()`);
      await until(`!document.querySelector('.ghci-status-popup')`);
      assert.ok(await evaluate(`Boolean(document.querySelector('.cm-inline-diagnostic'))`),'dismissing the popup keeps inline explanations');
      fs.writeFileSync(path.join(artifacts,'electron-inline-errors.png'),(await win.webContents.capturePage()).toPNG());
      // Explanations track inserted lines and persist until a successful save.
      await evaluate(`document.querySelector('.cm-content').focus()`);
      key('Home',[process.platform === 'darwin' ? 'meta' : 'control']);
      await win.webContents.insertText('-- inserted above the error'+String.fromCharCode(10));
      assert.ok(await evaluate(`Boolean(document.querySelector('.cm-inline-diagnostic'))`),'line insertion keeps the AI explanation');
      await pause(1100);
      assert.ok(await evaluate(`Boolean(document.querySelector('.cm-inline-diagnostic')) && Boolean(document.querySelector('.dirty-dot'))`),'waiting does not auto-save or clear explanations');
      key('S',[process.platform === 'darwin' ? 'meta' : 'control']);
      await until(`!document.querySelector('.cm-inline-diagnostic')`);
      // Saving an unchanged document also clears explanations.
      loadKey();
      await until(`document.querySelector('.cm-inline-diagnostic')?.textContent.includes('AI: Int型')`);
      key('S',[process.platform === 'darwin' ? 'meta' : 'control']);
      await until(`!document.querySelector('.cm-inline-diagnostic')`);
      loadKey();
      await until(`document.querySelector('.cm-inline-diagnostic')?.textContent.includes('AI: Int型')`);
      await editSource(validSource);
      assert.ok(await evaluate(`Boolean(document.querySelector('.cm-inline-diagnostic'))`),'replacing source keeps the explanation until reload');
      loadKey();
      await until(`!document.querySelector('.ghci-status-popup') && !document.querySelector('.load-button').disabled && document.querySelector('.run-button').textContent.includes('再読込') && !document.querySelector('.load-button').disabled`);
      await editSource(validSource+'-- unsaved discard check'+String.fromCharCode(10));
      await evaluate(`window.originalConfirm=window.confirm; window.confirm=() => false; void 0`);
      win.close();
      await pause(100);
      assert.ok(!win.isDestroyed(),'canceling close preserves the dirty editor');
      await evaluate(`document.querySelector('.problem-item:not([aria-current="page"])').click()`);
      await pause(100);
      assert.equal(await evaluate(`document.querySelector('.problem-item[aria-current="page"]').dataset.problemId`),problem.id,'canceling a switch keeps the current file');
      assert.doesNotMatch((await evaluate(`window.kata.open(${JSON.stringify(problem.id)})`)).code,/unsaved discard check/,'close and canceled switch do not save');
      await evaluate(`window.confirm=() => true; document.querySelector('.problem-item:not([aria-current="page"])').click()`);
      await until(`document.querySelector('.problem-item[aria-current="page"]').dataset.problemId !== ${JSON.stringify(problem.id)}`);
      await evaluate(`window.confirm=window.originalConfirm; document.querySelector('[data-problem-id="${problem.id}"]').click()`);
      await until(`document.querySelector('.problem-item[aria-current="page"]').dataset.problemId === ${JSON.stringify(problem.id)}`);
      assert.doesNotMatch((await evaluate(`window.kata.open(${JSON.stringify(problem.id)})`)).code,/unsaved discard check/,'discarding edits does not write them to disk');
      await evaluate(`window.kata.ghciWrite(${JSON.stringify(problem.id)},':quit\\r')`);
      await until(`window.kata.ghciSnapshot(${JSON.stringify(problem.id)}).then(snapshot => snapshot === null)`);
      await until(`document.querySelector('.run-button').textContent.includes('読込') && !document.querySelector('.run-button').textContent.includes('再読込')`);
      await evaluate(`document.querySelector('.cm-content').focus()`);
      loadKey();
      await until(`!document.querySelector('.ghci-status-popup') && !document.querySelector('.load-button').disabled && document.querySelector('.run-button').textContent.includes('再読込') && document.querySelector('.run-button').textContent.includes('再読込')`);
      // Let native PTY exit handlers finish before Electron tears down Node.
      await evaluate(`(async () => {
        const snapshots = await Promise.all((await window.kata.list()).map(async item => ({ id:item.id,snapshot:await window.kata.ghciSnapshot(item.id) })));
        const pending = new Set(snapshots.filter(item => item.snapshot?.alive).map(item => item.id));
        await new Promise((resolve,reject) => {
          const timer = setTimeout(() => { unsubscribe(); reject(new Error('GHCi shutdown timed out')); },3000);
          const done = () => { if (!pending.size) { clearTimeout(timer); unsubscribe(); resolve(); } };
          const unsubscribe = window.kata.onEvent(event => { if (event.type === 'ghci-exit') { pending.delete(event.id); done(); } });
          for (const id of pending) window.kata.ghciWrite(id,':quit\\r').catch(() => { pending.delete(id); done(); });
          done();
        });
      })()`);
      finish();
    } catch (e) {
      console.error(await evaluate(`document.body.innerText`));
      console.error(await evaluate(`window.kata.list().then(list => Promise.all(list.map(item => window.kata.ghciSnapshot(item.id))))`));
      finish(e);
    }
  });
});
require('../electron/main.cjs');
