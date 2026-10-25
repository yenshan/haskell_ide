import { useEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { indentWithTab } from '@codemirror/commands';
import { haskellLanguage } from './haskellLanguage';
import { editorAppearance } from './editorThemes';
import { vim, Vim, getCM } from '@replit/codemirror-vim';
import { editorTypography, type FontSettings } from './fonts';
import { closeCompletion, fileCompletion } from './fileCompletion';

const layout = EditorView.theme({
  '&':{ height:'100%' },'.cm-scroller':{ overflow:'auto' },
  '.cm-content':{ padding:'22px 0' },'.cm-line':{ padding:'0 24px 0 16px' },
  '.cm-gutters':{ minWidth:'58px' },'.cm-gutterElement':{ padding:'0 10px 0 16px' }
});
type Props = { id:string; code:string; vimEnabled:boolean; fontSettings:FontSettings; theme:string; onChange:(code:string)=>void; onSave:()=>void; onRun:()=>void; onMode:(mode:string)=>void; onCursor:(line:number, col:number)=>void };
export function Editor(props:Props) {
  const host = useRef<HTMLDivElement>(null); const view = useRef<EditorView|null>(null); const current = useRef(props); current.current = props;
  const applyingExternal = useRef(false);
  const typography = useRef(new Compartment()); const appearance = useRef(new Compartment());
  useEffect(() => {
    if (!host.current) return;
    Vim.defineEx('write', 'w', () => current.current.onSave());
    const editor = new EditorView({ parent:host.current, state:EditorState.create({ doc:current.current.code, extensions:[
      ...(props.vimEnabled ? [vim()] : []), basicSetup, keymap.of([
        { key:'Mod-s', run:() => { current.current.onSave(); return true; } },
        { key:'Mod-Enter', run:() => { current.current.onRun(); return true; } }, indentWithTab
      ]), haskellLanguage, fileCompletion(), layout, appearance.current.of(editorAppearance(current.current.theme)), typography.current.of(editorTypography(current.current.fontSettings)),
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
    const modeChange = (event:{ mode:string; subMode?:string }) => {
      current.current.onMode((event.subMode || event.mode).toUpperCase());
      if (event.mode !== 'insert') queueMicrotask(() => { if (view.current === editor) closeCompletion(editor); });
    };
    cm?.on('vim-mode-change', modeChange);
    current.current.onMode(props.vimEnabled ? 'NORMAL' : 'EDIT');
    return () => { editor.destroy(); view.current = null; };
  }, [props.id, props.vimEnabled]);
  useEffect(() => {
    view.current?.dispatch({ effects:appearance.current.reconfigure(editorAppearance(props.theme)) });
  },[props.theme,props.id,props.vimEnabled]);
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
