const path = require('node:path');
const { stripVTControlCharacters } = require('node:util');
const pty = require('node-pty');

function diagnosticText(data) {
  return stripVTControlCharacters(data).replace(/\r\n/g,'\n').replace(/\r/g,'\n').trim();
}
function hasDiagnostic(text) {
  return /(?:^|\n)[^\n]*:\d+(?::\d+)?(?:-\d+)?:\s*(?:fatal\s+)?error:|(?:^|\n)\*\*\* Exception:|(?:^|\n)(?:unknown command|unrecognised flag|Failed,)/im.test(text);
}
class Ghci {
  constructor(emit, executable = 'ghci', options = {}) {
    this.emit = emit; this.executable = executable; this.options = options; this.sessions = new Map();
  }
  snapshot(session) { return { data:session.history, seq:session.seq, cols:session.cols, rows:session.rows, alive:!session.closed }; }
  start(id,file,cols=80,rows=24) {
    let session = this.sessions.get(id);
    if (session) {
      this.sessions.delete(id); this.sessions.set(id,session);
      return this.snapshot(session);
    }
    if (this.sessions.size >= 6) this.stop(this.sessions.keys().next().value);
    let proc;
    try {
      proc = pty.spawn(this.executable,[file],{
        name:'xterm-256color',cols,rows,cwd:path.dirname(file),
        env:{ ...process.env,...this.options.env,TERM:'xterm-256color',COLORTERM:'truecolor' }
      });
    } catch (error) { throw new Error(`GHCiターミナルを起動できません: ${error.message}`); }
    session = { id,proc,history:'',seq:0,closed:false,cols,rows,diagnosticBuffer:'' };
    this.sessions.set(id,session);
    proc.onData(data => {
      session.history = (session.history+data).slice(-200_000);
      session.diagnosticBuffer = (session.diagnosticBuffer+data).slice(-20000);
      this.emit({ type:'ghci-data',id,data,seq:++session.seq });
      clearTimeout(session.diagnosticTimer);
      session.diagnosticTimer=setTimeout(() => this.flushDiagnostics(session),250);
    });
    session.ended = new Promise(resolve => proc.onExit(event => {
      session.closed=true; clearTimeout(session.diagnosticTimer); this.flushDiagnostics(session);
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
    this.emit({ type:'ghci-diagnostic',id:session.id,diagnostic:{ output,at:new Date().toISOString() } });
  }
  write(id,data) {
    const session=this.sessions.get(id);
    if (!session || session.closed) throw new Error('GHCiが停止しています。再起動してください。');
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
  async stop(id) {
    const session=this.sessions.get(id); if (!session || session.closed) return;
    try { if (process.platform==='win32') session.proc.kill(); else process.kill(-session.proc.pid,'SIGHUP'); } catch { session.proc.kill(); }
    const force=setTimeout(() => {
      if (!session.closed) { try { if (process.platform==='win32') session.proc.kill(); else process.kill(-session.proc.pid,'SIGKILL'); } catch {} }
    },1500);
    await session.ended; clearTimeout(force);
  }
  async restart(id,file) { await this.stop(id); return this.start(id,file); }
  async close() { await Promise.all([...this.sessions.keys()].map(id => this.stop(id))); }
}
module.exports = { Ghci, diagnosticText, hasDiagnostic };
