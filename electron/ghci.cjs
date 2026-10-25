const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

class Ghci {
  constructor(emit, executable = 'ghci') { this.emit = emit; this.executable = executable; this.sessions = new Map(); }
  start(id, file) {
    const existing = this.sessions.get(id);
    if (existing) { this.sessions.delete(id); this.sessions.set(id,existing); return existing.ready; }
    if (this.sessions.size >= 6) {
      const inactive = [...this.sessions.entries()].find(([,s]) => !s.pending);
      if (inactive) this.stop(inactive[0]);
    }
    const proc = spawn(this.executable, ['-ignore-dot-ghci', '-v0', '-fdiagnostics-color=never'], {
      cwd: path.dirname(file), env: process.env, stdio: ['pipe','pipe','pipe']
    });
    const session = { proc, queue: Promise.resolve(), pending: null, closed: false };
    this.sessions.set(id, session);
    proc.stdout.setEncoding('utf8'); proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', data => this.output(id, session, data, 'stdout'));
    proc.stderr.on('data', data => this.output(id, session, data, 'stderr'));
    proc.stdin.on('error', () => {});
    const end = message => {
      if (session.closed) return; session.closed = true;
      if (session.pending) { clearTimeout(session.pending.timer); session.pending.reject(new Error(message)); session.pending = null; }
      if (this.sessions.get(id) === session) this.sessions.delete(id);
      this.emit({ type:'ghci-exit', id, message });
    };
    proc.on('error', e => end(`GHCiを起動できません。GHCUP / PATHを確認してください。${e.message}`));
    proc.on('exit', (code, signal) => end(`GHCi終了 (${signal || code})`));
    session.ready = this.run(id, `:load ${JSON.stringify(file)}`, true);
    return session.ready;
  }
  output(id, session, data, stream) {
    const pending = session.pending;
    if (!pending) return;
    if (stream === 'stderr') pending.stderr += data;
    else pending.stdout += data;
    if (pending.stdout.includes(pending.marker) && !pending.finishing) {
      pending.finishing = true;
      setTimeout(() => {
        if (session.pending !== pending) return;
        clearTimeout(pending.timer);
        session.pending = null;
        const output = (pending.stdout.replace(pending.marker, '').trimEnd() + '\n' + pending.stderr.trimEnd()).trim();
        const failed = /error:|Exception|Failed,|not in scope|parse error|unknown command|syntax:/i.test(output);
        const result = { command: pending.command, output, failed, at: new Date().toISOString() };
        this.emit({ type:'ghci-result', id, result }); pending.resolve(result);
      }, 35);
    }
  }
  run(id, command, internal = false) {
    const session = this.sessions.get(id);
    if (!session || session.closed) return Promise.reject(new Error('GHCiが停止しています。再起動してください。'));
    if (!internal && /^\s*:(q(?:uit)?|set\s+prompt|script)\b/.test(command)) return Promise.reject(new Error('終了・再起動はGHCiパネルのボタンを使ってください。'));
    const task = session.queue.catch(() => {}).then(() => new Promise((resolve,reject) => {
      if (session.closed) return reject(new Error('GHCiが終了しました'));
      const marker = `__KATA_${randomUUID()}__`;
      const pending = { command, marker, stdout:'', stderr:'', resolve, reject, timer: null };
      session.pending = pending;
      pending.timer = setTimeout(() => {
        if (session.pending !== pending) return;
        this.stop(id);
        reject(new Error('実行が60秒を超えたためGHCiを停止しました。再起動してください。'));
      }, 60_000);
      const input = command.includes('\n') && !command.trimStart().startsWith(':') ? `:{\n${command}\n:}` : command;
      session.proc.stdin.write(`${input}\nputStrLn ${JSON.stringify(marker)}\n`);
    }));
    session.queue = task; return task;
  }
  interrupt(id) { const session = this.sessions.get(id); if (session) session.proc.kill('SIGINT'); }
  stop(id) { const s = this.sessions.get(id); if (s) { s.proc.kill('SIGTERM'); setTimeout(() => { if (!s.closed) s.proc.kill('SIGKILL'); }, 1500).unref(); } }
  close() { for (const id of this.sessions.keys()) this.stop(id); }
}
module.exports = { Ghci };
