import { Children, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export function VirtualSkinGrid({ children }: { children: ReactNode }) {
  const grid = useRef<HTMLDivElement>(null);
  const items = Children.toArray(children);
  const [layout, setLayout] = useState({ columns: 2, first: 0, last: 4, height: 180 });
  useEffect(() => {
    const element = grid.current;
    const root = element?.closest<HTMLElement>('[data-skin-scroll]');
    if (!element || !root) return;
    let pending = 0;
    const measure = () => {
      pending = 0;
      const width = element.clientWidth;
      const columns = Math.max(2, Math.min(6, Math.floor(width / 170)));
      const height = Math.max(1, (width - (columns - 1) * 12) / columns * 40 / 31);
      const rows = Math.ceil(items.length / columns);
      const offset = element.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
      const first = Math.min(Math.max(0, rows - 1), Math.max(0, Math.floor((root.scrollTop - offset) / (height + 12)) - 1));
      const last = Math.min(rows, Math.max(first + 1, Math.ceil((root.scrollTop - offset + root.clientHeight) / (height + 12)) + 1));
      setLayout(current => current.columns === columns && current.first === first && current.last === last && current.height === height ? current : { columns, first, last, height });
    };
    const queue = () => { if (!pending) pending = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(queue); observer.observe(element); observer.observe(root);
    root.addEventListener('scroll', queue, {passive:true}); measure();
    return () => { observer.disconnect(); root.removeEventListener('scroll', queue); cancelAnimationFrame(pending); };
  }, [items.length]);
  const rows = Math.ceil(items.length / layout.columns);
  const last = Math.min(rows, layout.last);
  return <div ref={grid} className="grid gap-3" style={{
    gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
    gridAutoRows: `${layout.height}px`,
    paddingTop: layout.first * (layout.height + 12),
    paddingBottom: Math.max(0, rows - last) * (layout.height + 12),
  }}>{items.slice(layout.first * layout.columns, last * layout.columns)}</div>;
}
