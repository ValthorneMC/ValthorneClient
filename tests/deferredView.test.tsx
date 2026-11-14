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
