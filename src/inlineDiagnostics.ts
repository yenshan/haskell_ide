import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import type { InlineDiagnostic } from './types';

export const setInlineDiagnostics = StateEffect.define<InlineDiagnostic[]>();

class ErrorExplanation extends WidgetType {
  constructor(readonly diagnostics:InlineDiagnostic[]) { super(); }
  eq(other:ErrorExplanation) { return JSON.stringify(this.diagnostics) === JSON.stringify(other.diagnostics); }
  toDOM() {
    const anchor = document.createElement('span');
    anchor.className = 'cm-inline-diagnostic-anchor';
    const note = document.createElement('span');
    note.className = 'cm-inline-diagnostic';
    note.setAttribute('role','note'); note.tabIndex = 0;
    note.textContent = this.diagnostics.map(d => `${d.explanation ? 'AI' : 'GHCi'}: ${d.explanation || d.message.split('\n').find(line => line.trim() && !/^\[GHC-[^\]]+\]$/.test(line.trim()))?.trim() || d.message}`).join('\n');
    note.title = this.diagnostics.map(d => `${d.explanation || ''}\nGHCi (${d.line}:${d.column}): ${d.message}`).join('\n\n');
    note.setAttribute('aria-label',note.title);
    anchor.append(note);
    return anchor;
  }
  ignoreEvent() { return true; }
}

export const inlineDiagnostics = StateField.define<DecorationSet>({
  create:() => Decoration.none,
  update(value,transaction) {
    // Keep explanations attached while editing, including when their text is replaced.
    if (transaction.docChanged) {
      const mapped = [];
      for (let cursor = value.iter(); cursor.value; cursor.next()) {
        const position = transaction.changes.mapPos(cursor.from,1);
        mapped.push(cursor.value.range(transaction.state.doc.lineAt(position).to));
      }
      value = Decoration.set(mapped,true);
    }
    for (const effect of transaction.effects) {
      if (!effect.is(setInlineDiagnostics)) continue;
      const grouped = new Map<number,InlineDiagnostic[]>();
      for (const d of effect.value) {
        const line = d.displayLine ?? d.line;
        if (!Number.isInteger(line) || line < 1 || line > transaction.state.doc.lines) continue;
        grouped.set(line,[...(grouped.get(line) || []),d]);
      }
      value = Decoration.set([...grouped].map(([number,diagnostics]) => {
        const line = transaction.state.doc.line(number);
        return Decoration.widget({ widget:new ErrorExplanation(diagnostics),side:1 }).range(line.to);
      }),true);
    }
    return value;
  },
  provide:field => EditorView.decorations.from(field)
});

export const inlineDiagnosticTheme = EditorView.baseTheme({
  '.cm-inline-diagnostic-anchor':{
    position:'relative',display:'inline-block',width:'0',height:'0',marginLeft:'24px',verticalAlign:'top'
  },
  '.cm-inline-diagnostic':{
    position:'absolute',top:'0',left:'0',zIndex:'2',display:'block',width:'min(480px, 45vw)',padding:'1px 8px',
    borderRadius:'4px',backgroundColor:'#fff0eb',color:'#963c2b',fontSize:'11px',
    fontFamily:'-apple-system, BlinkMacSystemFont, sans-serif',lineHeight:'1.7',
    verticalAlign:'top',whiteSpace:'pre-wrap',overflowWrap:'anywhere',overflow:'visible',
    cursor:'help',userSelect:'text'
  },
  '.cm-inline-diagnostic:focus':{ outline:'1px solid #a04432',outlineOffset:'2px' }
});
