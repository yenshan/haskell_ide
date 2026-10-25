import { useEffect, useRef, useState } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { haskell } from '@codemirror/legacy-modes/mode/haskell';
import { Type, X } from 'lucide-react';
import { highlight } from './Editor';
import { defaultFontSettings, editorTypography, fonts, type FontSettings as Settings } from './fonts';

const sample = '-- Haskellで、小さな発見を。\n-- 合字: -> => <- >>= >=> <$> <*> /= ==\nmodule Practice where\n\nsquare :: Int -> Int\nsquare x = x * x\n\nvalues = map square $ filter (>= 3) [1..10]\nexample = negate <$> Just 3 >>= pure';

export function FontSettings({ settings,onChange,onClose }:{ settings:Settings; onChange:(settings:Settings)=>void; onClose:()=>void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const host = useRef<HTMLDivElement>(null); const view = useRef<EditorView|null>(null);
  const typography = useRef(new Compartment()); const initial = useRef(settings);
  const [sizeInput,setSizeInput] = useState(String(settings.size));
  useEffect(() => setSizeInput(String(settings.size)),[settings.size]);
  const selected = fonts.find(font => font.id === settings.font) || fonts[0];
  useEffect(() => {
    dialog.current?.showModal();
    dialog.current?.querySelector('select')?.focus();
    if (!host.current) return;
    const editor = new EditorView({ parent:host.current,state:EditorState.create({ doc:sample,extensions:[
      EditorState.readOnly.of(true),EditorView.editable.of(false),lineNumbers(),
      StreamLanguage.define(haskell),syntaxHighlighting(highlight),
      EditorView.theme({ '&':{ height:'100%',backgroundColor:'#fff',color:'#293329' },'.cm-content':{ padding:'16px 0' },'.cm-line':{ padding:'0 18px 0 12px' },'.cm-gutters':{ backgroundColor:'#f7f8f5',color:'#667165',borderColor:'#dfe5dc' },'&.cm-focused':{ outline:'none' } }),
      typography.current.of(editorTypography(initial.current))
    ] }) });
    view.current = editor;
    return () => { editor.destroy(); view.current = null; };
  },[]);
  useEffect(() => {
    const editor = view.current; if (!editor) return;
    editor.dispatch({ effects:typography.current.reconfigure(editorTypography(settings)) });
    let disposed = false;
    document.fonts.ready.then(() => { if (!disposed) editor.requestMeasure(); });
    return () => { disposed = true; };
  },[settings]);
  return <dialog ref={dialog} className="modal font-settings" aria-labelledby="font-settings-title" onCancel={onClose} onClick={e => {
    if (e.target !== e.currentTarget) return;
    const box = e.currentTarget.getBoundingClientRect();
    if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) onClose();
  }}>
    <button className="modal-close icon-button" aria-label="フォント設定を閉じる" onClick={onClose}><X size={17}/></button>
    <div className="font-settings-heading"><Type size={22}/><h2 id="font-settings-title">エディタのフォント</h2><p>変更はすぐに反映され、次回起動時にも引き継ぎます。</p></div>
    <div className="font-settings-controls">
      <label className="font-family-field">フォント<select autoFocus value={settings.font} onChange={e => onChange({ ...settings,font:e.target.value })}>{fonts.map(font => <option value={font.id} key={font.id}>{font.name}</option>)}</select></label>
      <label>文字サイズ<span className="font-size-control"><input aria-label="文字サイズ" type="number" min={10} max={28} step={1} value={sizeInput} onChange={e => {
        setSizeInput(e.target.value);
        const value = e.target.valueAsNumber;
        if (Number.isInteger(value) && value >= 10 && value <= 28) onChange({ ...settings,size:value });
      }} onBlur={() => {
        const value = sizeInput.trim() ? Number(sizeInput) : settings.size;
        const size = Number.isFinite(value) ? Math.round(Math.max(10,Math.min(28,value))) : settings.size;
        setSizeInput(String(size)); onChange({ ...settings,size });
      }}/><span>px</span></span></label>
      <label>行間<select value={settings.lineHeight} onChange={e => onChange({ ...settings,lineHeight:Number(e.target.value) })}>{[1.2,1.4,1.6,1.85,2,2.2].map(value => <option value={value} key={value}>{value} 倍</option>)}</select></label>
    </div>
    <p className="font-description">{selected.description}</p>
    <label className="font-ligatures"><input type="checkbox" checked={settings.ligatures} onChange={e => onChange({ ...settings,ligatures:e.target.checked })}/><span>合字を使う<small><code>-&gt;</code> や <code>=&gt;</code> などを、つながった記号で表示します。</small></span></label>
    <div className="font-preview-heading"><span>プレビュー</span><span>{selected.name} · {settings.size}px</span></div>
    <div ref={host} className="font-preview" aria-label="Haskellフォントプレビュー"/>
    <div className="modal-actions"><button className="secondary-button" onClick={() => onChange({ ...defaultFontSettings })}>標準に戻す</button><button className="primary-button" onClick={onClose}>完了</button></div>
  </dialog>;
}
