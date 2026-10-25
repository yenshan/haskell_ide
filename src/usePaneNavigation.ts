import { useEffect } from 'react';

type Pane = 'editor'|'ghci'|'assistant'|'sidebar';
type Direction = 'h'|'j'|'k'|'l';
const selectors:Record<Pane,string> = { editor:'.editor-panel',ghci:'#ghci-panel',assistant:'#assistant-panel',sidebar:'#file-sidebar' };
const neighbors:Record<Pane,Partial<Record<Direction,Pane>>> = {
  editor:{ h:'sidebar',j:'ghci',l:'assistant' },
  ghci:{ h:'sidebar',k:'editor',l:'assistant' },
  assistant:{ h:'editor' },
  sidebar:{ l:'editor' }
};
function paneAt(element:Element|null):Pane|undefined {
  return (Object.keys(selectors) as Pane[]).find(pane => element?.closest(selectors[pane]));
}
function focusPane(pane:Pane) {
  const root = document.querySelector(selectors[pane]);
  if (pane === 'assistant' && root?.querySelector<HTMLElement>('#ai-sidebar-content')?.hidden) {
    root.querySelector<HTMLButtonElement>('[aria-controls="ai-sidebar-content"]')?.click();
    requestAnimationFrame(() => focusPane(pane));
    return;
  }
  const target = pane === 'editor' ? root?.querySelector('.cm-content') :
    pane === 'ghci' ? root?.querySelector('.xterm-helper-textarea') :
    pane === 'assistant' ? root?.querySelector('[aria-label="AIへの質問"]') :
    root?.querySelector('.problem-item[aria-current="page"]') || root?.querySelector('[aria-label="ファイルを検索"]:not([hidden])') || root?.querySelector('.sidebar-heading button');
  if (target instanceof HTMLElement && target.getClientRects().length) target.focus({ preventScroll:true });
  else if (pane === 'sidebar') root?.querySelector<HTMLButtonElement>('.sidebar-heading button')?.focus();
}

export function usePaneNavigation() {
  useEffect(() => {
    let source:Pane|undefined, timer:ReturnType<typeof setTimeout>|undefined;
    let center:'editor'|'ghci' = 'editor';
    const rememberCenter = () => {
      const pane = paneAt(document.activeElement);
      if (pane === 'editor' || pane === 'ghci') center = pane;
    };
    const consumed = new Set<string>();
    const cancel = () => { source = undefined; clearTimeout(timer); };
    const reset = () => { cancel(); consumed.clear(); };
    const swallow = (event:KeyboardEvent) => { event.preventDefault(); event.stopImmediatePropagation(); };
    const keydown = (event:KeyboardEvent) => {
      if (document.querySelector('dialog[open],.modal-backdrop') || event.isComposing || event.keyCode === 229) { reset(); return; }
      const code = event.code || event.key;
      if (consumed.has(code)) { swallow(event); return; }
      const key = event.key.toLowerCase();
      if (source) {
        const from = source;
        // Modifier keys do not cancel the chord, so Control can stay held down.
        if (['Control','Shift','Alt','Meta'].includes(event.key)) return;
        cancel();
        if (key === 'escape' || (!event.metaKey && !event.altKey && ['h','j','k','l'].includes(key))) {
          swallow(event); consumed.add(code);
          const next = from === 'assistant' && key === 'h' ? center : neighbors[from][key as Direction];
          if (next) focusPane(next);
          return;
        }
      }
      if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && key === 'j') {
        const pane = paneAt(document.activeElement);
        if (!pane) return;
        swallow(event); consumed.add(code);
        if (event.repeat) return;
        source = pane; timer = setTimeout(cancel,2000);
      }
    };
    const keyup = (event:KeyboardEvent) => {
      if (consumed.delete(event.code || event.key)) swallow(event);
    };
    // Capture before CodeMirror/Vim and xterm can turn the chord into editor or PTY input.
    window.addEventListener('keydown',keydown,true); window.addEventListener('keyup',keyup,true);
    window.addEventListener('pointerdown',reset,true); window.addEventListener('blur',reset);
    window.addEventListener('focusin',rememberCenter,true);
    return () => {
      reset(); window.removeEventListener('keydown',keydown,true); window.removeEventListener('keyup',keyup,true);
      window.removeEventListener('pointerdown',reset,true); window.removeEventListener('blur',reset);
      window.removeEventListener('focusin',rememberCenter,true);
    };
  },[]);
}
