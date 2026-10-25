import { useEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { indentWithTab } from '@codemirror/commands';
import { StreamLanguage, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { haskell } from '@codemirror/legacy-modes/mode/haskell';
import { tags } from '@lezer/highlight';
import { vim, Vim, getCM } from '@replit/codemirror-vim';
import { editorTypography, type FontSettings } from './fonts';

const theme = EditorView.theme({
  '&': { height:'100%', backgroundColor:'#ffffff', color:'#293329' },
  '.cm-scroller': { overflow:'auto' },
  '.cm-content': { padding:'22px 0', caretColor:'#4b6e36' },
  '.cm-line': { padding:'0 24px 0 16px' },
  '.cm-gutters': { backgroundColor:'#ffffff', color:'#667165', border:'none', minWidth:'58px' },
  '.cm-gutterElement': { padding:'0 10px 0 16px' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor:'#f5f8f1' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor:'#dbe9cf !important' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor:'#4b6e36' },
  '.cm-fat-cursor': { backgroundColor:'#4b6e36 !important', color:'#ffffff !important' },
  '.cm-panels': { backgroundColor:'#f7f8f5', color:'#293329', borderColor:'#dfe5dc' },
  '.cm-search input, .cm-search button': { color:'#293329', background:'#ffffff', border:'1px solid #c7d2bf' },
  '&.cm-focused': { outline:'none' },
  '.cm-tooltip': { backgroundColor:'#ffffff', color:'#293329', border:'1px solid #c7d2bf' },
  '.cm-matchingBracket': { backgroundColor:'#e5efdb', outline:'1px solid #a5bd90' },
  '.cm-selectionMatch': { backgroundColor:'#edf4e6' },
  '.cm-searchMatch': { backgroundColor:'#fff0cc', outline:'1px solid #dbc17e' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor:'#f6df9a' },
}, { dark:false });
export const highlight = HighlightStyle.define([
  { tag:tags.keyword, color:'#7750a3' }, { tag:tags.comment, color:'#60705a', fontStyle:'italic' },
  { tag:tags.string, color:'#3c6c36' }, { tag:tags.number, color:'#9a5b1d' },
  { tag:[tags.typeName,tags.className], color:'#88621b' }, { tag:tags.operator, color:'#365f9a' },
  { tag:tags.variableName, color:'#293329' }, { tag:tags.bool, color:'#9a5b1d' }
]);
type Props = { id:string; code:string; vimEnabled:boolean; fontSettings:FontSettings; onChange:(code:string)=>void; onSave:()=>void; onRun:()=>void; onMode:(mode:string)=>void; onCursor:(line:number, col:number)=>void };
export function Editor(props:Props) {
  const host = useRef<HTMLDivElement>(null); const view = useRef<EditorView|null>(null); const current = useRef(props); current.current = props;
  const applyingExternal = useRef(false);
  const typography = useRef(new Compartment());
  useEffect(() => {
    if (!host.current) return;
    Vim.defineEx('write', 'w', () => current.current.onSave());
    const editor = new EditorView({ parent:host.current, state:EditorState.create({ doc:current.current.code, extensions:[
      ...(props.vimEnabled ? [vim()] : []), basicSetup, keymap.of([
        { key:'Mod-s', run:() => { current.current.onSave(); return true; } },
        { key:'Mod-Enter', run:() => { current.current.onRun(); return true; } }, indentWithTab
      ]), StreamLanguage.define(haskell), syntaxHighlighting(highlight), theme, typography.current.of(editorTypography(current.current.fontSettings)),
      EditorState.tabSize.of(2),
      EditorView.updateListener.of(update => {
        if (update.docChanged && !applyingExternal.current) current.current.onChange(update.state.doc.toString());
        if (update.selectionSet || update.docChanged) {
          const pos = update.state.selection.main.head; const line = update.state.doc.lineAt(pos);
          current.current.onCursor(line.number, pos - line.from + 1);
        }
      })
    ] }) });
    view.current = editor;
    const cm = getCM(editor);
    const modeChange = (event:{ mode:string; subMode?:string }) => current.current.onMode((event.subMode || event.mode).toUpperCase());
    cm?.on('vim-mode-change', modeChange);
    current.current.onMode(props.vimEnabled ? 'NORMAL' : 'EDIT');
    return () => { editor.destroy(); view.current = null; };
  }, [props.id, props.vimEnabled]);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch({ effects:typography.current.reconfigure(editorTypography(props.fontSettings)) });
    let disposed = false;
    document.fonts.ready.then(() => { if (!disposed) editor.requestMeasure(); });
    return () => { disposed = true; };
  },[props.fontSettings,props.id,props.vimEnabled]);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== props.code) {
      applyingExternal.current = true;
      try { editor.dispatch({ changes:{ from:0, to:editor.state.doc.length, insert:props.code } }); }
      finally { applyingExternal.current = false; }
    }
  }, [props.code]);
  return <div ref={host} className="editor-mount" aria-label="Haskellコードエディタ"/>;
}
