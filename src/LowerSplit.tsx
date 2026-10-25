import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { SidebarResizer } from './SidebarResizer';

function initialRatio() {
  try {
    const saved = JSON.parse(localStorage.getItem('kata-lower-split') || 'null');
    if (typeof saved === 'number' && Number.isFinite(saved) && saved >= 0 && saved <= 1) return saved;
  } catch { /* Use equal widths. */ }
  return 0.5;
}

export function LowerSplit({ ghci,assistant }:{ ghci:ReactNode; assistant:ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [ratio,setRatio] = useState(initialRatio);
  const [width,setWidth] = useState(600);
  useLayoutEffect(() => {
    const element = host.current; if (!element) return;
    const update = () => setWidth(element.clientWidth);
    update(); const observer = new ResizeObserver(update); observer.observe(element);
    return () => observer.disconnect();
  },[]);
  useEffect(() => {
    const timer = setTimeout(() => { try { localStorage.setItem('kata-lower-split',JSON.stringify(ratio)); } catch {} },200);
    return () => clearTimeout(timer);
  },[ratio]);
  const available = Math.max(1,width-5);
  const minimum = Math.min(220,available/2);
  const left = Math.max(minimum,Math.min(available-minimum,available*ratio));
  return <div ref={host} className="lower-panel" style={{ gridTemplateColumns:`${left}px 5px minmax(0,1fr)` }}>
    {ghci}
    <SidebarResizer side="left" controls="ghci-panel assistant-panel" label="GHCiとAIアシスタントの幅を調整" className="lower-resizer"
      width={left} min={minimum} max={available-minimum} onResize={value => setRatio(value/available)}/>
    {assistant}
  </div>;
}
