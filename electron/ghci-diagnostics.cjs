const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { hasDiagnostic } = require('./ghci.cjs');

function parseDiagnostics(output, file, source) {
  const lines = source.split('\n').length;
  const headers = [...output.matchAll(/^(.+?):(?:(\d+):(\d+)(?:-\d+)?|\((\d+),(\d+)\)-\(\d+,\d+\)):\s*(error|warning)(?:\s*\[[^\]]+\])*:/gm)];
  return headers.flatMap((match,index) => {
    const line = Number(match[2] || match[4]), column = Number(match[3] || match[5]);
    if (path.resolve(path.dirname(file),match[1]) !== path.resolve(file) || line < 1 || line > lines) return [];
    return [{ line,column,severity:match[6],message:output.slice(match.index + match[0].length,headers[index+1]?.index ?? output.length).trim().slice(0,8000) }];
  });
}

class GhciDiagnostics {
  constructor(store, ghci) { this.store = store; this.ghci = ghci; this.reports = new Map(); this.sources = new Map(); }
  report(id,source,output) {
    const diagnostics = parseDiagnostics(output,this.store.file(id),source);
    const success = !hasDiagnostic(output);
    if (!success && !diagnostics.some(d => d.severity === 'error')) {
      // Interactive exceptions and dependency errors cannot be assigned to a source line.
      diagnostics.push({ line:0,column:0,severity:'error',message:output.slice(-20000) });
    }
    const report = { token:randomUUID(),fileName:this.store.find(id).fileName,source,output,success,diagnostics };
    this.reports.set(id,report); return report;
  }
  async load(id,cols,rows) {
    const snapshot = await this.store.open(id);
    this.sources.set(id,snapshot.code);
    const output = await this.ghci.load(id,this.store.file(id),cols,rows);
    if ((await this.store.open(id)).code !== snapshot.code) throw new Error('読み込み中にコードが変更されました。もう一度読み込んでください。');
    return this.report(id,snapshot.code,output);
  }
  async latest(id) {
    const snapshot = await this.store.open(id), diagnostic = this.ghci.sessions.get(id)?.lastDiagnostic;
    if (!diagnostic) throw new Error('解析するGHCiのエラーがありません。');
    if (this.sources.has(id) && this.sources.get(id) !== snapshot.code) throw new Error('コードが変更されています。GHCiで再読み込みしてください。');
    return this.report(id,snapshot.code,diagnostic.output);
  }
  async explain(id,token,codex,model,effort) {
    const report = this.reports.get(id);
    if (!report || report.token !== token || (await this.store.open(id)).code !== report.source) throw new Error('コードが更新されています。GHCiで再読み込みしてください。');
    if (report.success || !report.diagnostics.some(d => d.severity === 'error')) return report;
    const explanations = await codex.explainDiagnostics(report,model,effort);
    return { ...report,diagnostics:report.diagnostics.map((d,index) => ({ ...d,...(explanations.get(index) ? explanations.get(index) : {}) })) };
  }
  close() { this.reports.clear(); this.sources.clear(); }
}
module.exports = { GhciDiagnostics,parseDiagnostics };
