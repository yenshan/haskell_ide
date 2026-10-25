const path = require('node:path');
const { stripVTControlCharacters } = require('node:util');
const pty = require('node-pty');
const fs = require('node:fs');
const os = require('node:os');
const { randomUUID } = require('node:crypto');

function diagnosticText(data) {
  return stripVTControlCharacters(data).replace(/\r\n/g,'\n').replace(/\r/g,'\n').trim();
}
function hasDiagnostic(text) {
  return /(?:^|\n)[^\n]*:(?:\d+(?::\d+)?(?:-\d+)?|\(\d+,\d+\)-\(\d+,\d+\)):\s*(?:fatal\s+)?error:|(?:^|\n)\*\*\* Exception:|(?:^|\n)(?:unknown command|unrecognised flag|Failed,)/im.test(text);
}
class Ghci {
  constructor(emit, executable = 'ghci', options = {}) {
    this.emit = emit; this.executable = executable; this.options = options; this.sessions = new Map();
  }
  snapshot(session) { return { data:session.history, seq:session.seq, cols:session.cols, rows:session.rows, alive:!session.closed }; }
  peek(id) { const session = this.sessions.get(id); return session ? this.snapshot(session) : null; }
  start(id,file,cols=80,rows=24) {
    if (this.closed) throw new Error('GHCiワークスペースを終了しています。');
    let session = this.sessions.get(id);
    if (session) {
      this.sessions.delete(id); this.sessions.set(id,session);
      return this.snapshot(session);
    }
    if (this.sessions.size >= 6) this.stop(this.sessions.keys().next().value);
    let proc;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(),'kata-ghci-'));
    // An invisible OSC marker identifies a complete GHCi prompt, even across PTY chunks.
    const markerId = `kata-${randomUUID()}`;
    const marker = `\x1b]777;${markerId}\x07`;
    const script = path.join(directory,'prompt.ghci');
    fs.writeFileSync(script,`:set prompt "\\ESC]777;${markerId}\\BELghci> "\n`,{ mode:0o600 });
    try {
      proc = pty.spawn(this.executable,['-ghci-script',script,file],{
        name:'xterm-256color',cols,rows,cwd:path.dirname(file),
        env:{ ...process.env,...this.options.env,TERM:'xterm-256color',COLORTERM:'truecolor' }
      });
    } catch (error) { fs.rmSync(directory,{ recursive:true,force:true }); throw new Error(`GHCiターミナルを起動できません: ${error.message}`); }
    session = { id,proc,history:'',seq:0,closed:false,cols,rows,diagnosticBuffer:'',marker,promptTail:'',ready:false };
    session.initial = new Promise((resolve,reject) => {
      session.initialResolve = resolve; session.initialReject = reject;
      session.initialTimer = setTimeout(() => reject(new Error('GHCiの読み込みがタイムアウトしました。')),60000);
    });
    session.initial.catch(() => {});
    this.sessions.set(id,session);
    proc.onData(data => {
      session.history = (session.history+data).slice(-200_000);
      session.diagnosticBuffer = (session.diagnosticBuffer+data).slice(-20000);
      this.emit({ type:'ghci-data',id,data,seq:++session.seq });
      if (session.waiting) session.waiting.output = (session.waiting.output + data).slice(-200000);
      const promptData = session.promptTail + data;
      session.promptTail = promptData.slice(-(marker.length-1));
      if (promptData.includes(marker)) {
        this.flushDiagnostics(session);
        if (!session.ready) { session.ready = true; clearTimeout(session.initialTimer); session.initialResolve(session.history); }
        if (session.waiting) {
          const waiting = session.waiting; session.waiting = null; clearTimeout(waiting.timer); waiting.resolve(waiting.output);
        }
      }
      clearTimeout(session.diagnosticTimer);
      session.diagnosticTimer=setTimeout(() => this.flushDiagnostics(session),250);
    });
    session.ended = new Promise(resolve => proc.onExit(event => {
      session.closed=true; clearTimeout(session.diagnosticTimer); clearTimeout(session.initialTimer); this.flushDiagnostics(session);
      session.initialReject(new Error('GHCiが読み込み完了前に終了しました。'));
      if (session.waiting) { clearTimeout(session.waiting.timer); session.waiting.reject(new Error('GHCiが終了しました。')); session.waiting = null; }
      fs.rmSync(directory,{ recursive:true,force:true });
      if (this.sessions.get(id) === session) this.sessions.delete(id);
      this.emit({ type:'ghci-exit',id,message:`GHCi終了 (${event.signal || event.exitCode})` });
      resolve();
    }));
    return this.snapshot(session);
  }
  flushDiagnostics(session) {
    const output=diagnosticText(session.diagnosticBuffer);
    // Preserve a partial burst so a diagnostic split across PTY chunks is found.
    if (!hasDiagnostic(output)) return;
    session.diagnosticBuffer='';
    session.lastDiagnostic = { output,at:new Date().toISOString() };
    this.emit({ type:'ghci-diagnostic',id:session.id,diagnostic:session.lastDiagnostic });
  }
  write(id,data) {
    const session=this.sessions.get(id);
    if (!session || session.closed) throw new Error('GHCiが停止しています。再起動してください。');
    if (session.loading) throw new Error('GHCiでファイルを読み込み中です。');
    session.proc.write(data);
  }
  resize(id,cols,rows) {
    const session=this.sessions.get(id); if (!session || session.closed) return;
    session.cols=cols; session.rows=rows; session.proc.resize(cols,rows);
  }
  async reload(id) {
    this.write(id,'\x03');
    await new Promise(resolve => setTimeout(resolve,100));
    this.write(id,':reload\r');
  }
  command(session,command) {
    return new Promise((resolve,reject) => {
      const waiting = { resolve,reject,output:'',timer:setTimeout(() => {
        if (session.waiting === waiting) session.waiting = null;
        reject(new Error('GHCiの読み込みがタイムアウトしました。'));
      },60000) };
      session.waiting = waiting;
      try { session.proc.write(command); } catch (error) { clearTimeout(waiting.timer); session.waiting = null; reject(error); }
    });
  }
  async load(id,file,cols=80,rows=24) {
    let session = this.sessions.get(id);
    if (session?.loading) throw new Error('GHCiでファイルを読み込み中です。');
    if (!session) {
      this.start(id,file,cols,rows); session = this.sessions.get(id); session.loading = true;
      try { return diagnosticText(await session.initial); }
      finally { session.loading = false; }
    }
    session.loading = true;
    try {
      await session.initial;
      await this.command(session,'\x03');
      session.diagnosticBuffer = ''; session.lastDiagnostic = null;
      return diagnosticText(await this.command(session,':reload\r'));
    } finally { session.loading = false; }
  }
  async stop(id) {
    const session=this.sessions.get(id); if (!session || session.closed) return;
    try { if (process.platform==='win32') session.proc.kill(); else process.kill(-session.proc.pid,'SIGHUP'); } catch { session.proc.kill(); }
    const force=setTimeout(() => {
      if (!session.closed) { try { if (process.platform==='win32') session.proc.kill(); else process.kill(-session.proc.pid,'SIGKILL'); } catch {} }
    },1500);
    await session.ended; clearTimeout(force);
  }
  async restart(id,file) { await this.stop(id); return this.start(id,file); }
  async close() { this.closed = true; await Promise.all([...this.sessions.keys()].map(id => this.stop(id))); }
}
module.exports = { Ghci, diagnosticText, hasDiagnostic };
