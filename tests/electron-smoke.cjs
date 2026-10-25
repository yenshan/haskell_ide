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
    async function until(code) { for(let i=0;i<100;i++) { const value = await evaluate(code); if(value) return value; await pause(60); } throw new Error('Timed out: '+code); }
    try {
      await until(`document.querySelector('.xterm') && document.querySelector('.cm-content')`);
      assert.match(await evaluate('document.body.innerText'),/Multiples of 3 or 5/);
      // Native key events go through Vim and CodeMirror, then the app autosave.
      await evaluate(`document.querySelector('.cm-content').focus()`);
      win.webContents.sendInputEvent({ type:'keyDown', keyCode:'G', modifiers:['shift'] });
      win.webContents.sendInputEvent({ type:'keyUp', keyCode:'G', modifiers:['shift'] });
      win.webContents.sendInputEvent({ type:'char', keyCode:'o' });
      for (const character of '-- smoke edit') win.webContents.sendInputEvent({ type:'char', keyCode:character });
      win.webContents.sendInputEvent({ type:'keyDown',keyCode:'Escape' });
      win.webContents.sendInputEvent({ type:'keyUp',keyCode:'Escape' });
      await until(`document.querySelector('.cm-content').textContent.includes('smoke edit')`);
      await until(`!document.querySelector('.dirty-dot')`);
      const problem = await evaluate(`window.kata.list().then(async list => window.kata.open(list[0].id))`);
      assert.match(problem.code,/smoke edit/);
      await until(`window.kata.ghciStart(${JSON.stringify(problem.id)}).then(s => s.data.includes('ghci>'))`);
      await evaluate(`window.kata.ghciWrite(${JSON.stringify(problem.id)},'solution 10\\r')`);
      await until(`window.kata.ghciStart(${JSON.stringify(problem.id)}).then(s => /23[\\r\\n]/.test(s.data))`);
      await evaluate(`document.querySelector('.run-button').click()`);
      await until(`!document.querySelector('.run-button').disabled`);
      await evaluate(`window.kata.ghciWrite(${JSON.stringify(problem.id)},'solution "ten"\\r')`);
      await until(`document.querySelector('.ask-error-button')`);
      await evaluate(`document.querySelector('.ask-error-button').click()`);
      assert.match(await evaluate(`document.querySelector('[aria-label="AIへの質問"]').value`),/エラーの原因/);
      assert.ok(await evaluate(`!!document.querySelector('.attached-error')`));
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
