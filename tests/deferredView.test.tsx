import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
vi.mock('react-i18next', () => ({useTranslation: () => ({t:(key:string)=>key})}));
import { deferredView } from '../src/components/DeferredView';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
test('does not load an unmounted view and retries a rejected import', async () => {
  const error = vi.spyOn(console,'error').mockImplementation(()=>{});
  const load = vi.fn().mockRejectedValueOnce(new Error('chunk')).mockResolvedValue({default:({name}:{name:string})=><span>{name}</span>});
  const View = deferredView<{name:string}>(load); expect(load).not.toHaveBeenCalled();
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async()=>root.render(<View name="loaded"/>)); expect(container.textContent).toContain('viewLoadFailed');
    await act(async()=>container.querySelector('button')!.click()); expect(container.textContent).toBe('loaded'); expect(load).toHaveBeenCalledTimes(2);
  } finally { await act(async()=>root.unmount()); error.mockRestore(); }
});

test('shows an accessible skeleton without visible loading text while the import is pending', async () => {
  for (const layout of ['settings','instance','skins'] as const) {
    let resolve!: (value: {default: () => React.ReactNode}) => void;
    const View = deferredView(() => new Promise<{default: () => React.ReactNode}>(done => {resolve=done;}),layout);
    const container=document.createElement('div'), root=createRoot(container);
    try {
      await act(async()=>root.render(<View/>));
      const status=container.querySelector('[role="status"]')!;
      expect(status.getAttribute('data-view-skeleton')).toBe(layout);
      expect(status.getAttribute('aria-label')).toBe('loading');
      expect(status.textContent).toBe('');
      await act(async()=>resolve({default:()=> <span>ready</span>}));
      expect(container.querySelector('[role="status"]')).toBeNull(); expect(container.textContent).toBe('ready');
    } finally {await act(async()=>root.unmount());}
  }
});

test('reuses the loaded view without committing another fallback after navigation', async () => {
  const load=vi.fn().mockResolvedValue({default:()=> <span>ready</span>}); const View=deferredView(load);
  const container=document.createElement('div'), root=createRoot(container);
  const commits:boolean[]=[];
  const {Profiler}=await import('react');
  const screen=()=> <Profiler id="view" onRender={()=>commits.push(!!container.querySelector('[role="status"]'))}><View/></Profiler>;
  try {
    await act(async()=>root.render(screen())); expect(container.textContent).toBe('ready');
    await act(async()=>root.render(null)); commits.length=0;
    await act(async()=>root.render(screen()));
    expect(load).toHaveBeenCalledTimes(1); expect(commits.length).toBeGreaterThan(0); expect(commits).not.toContain(true);
  } finally {await act(async()=>root.unmount());}
});
