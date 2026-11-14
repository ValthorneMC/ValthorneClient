import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { useSkinObjectUrls } from '../src/hooks/skin-rendering/useSkinObjectUrls';
vi.mock('@/lib/skin-rendering/skin-rendering', () => ({ releaseTexture: vi.fn() }));
import { releaseTexture } from '../src/lib/skin-rendering/skin-rendering';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
test('owns URLs across StrictMode replay and revokes replacements, deletions and late writes', async () => {
  const revoke = vi.fn(); vi.stubGlobal('URL', class extends URL { static revokeObjectURL = revoke; });
  let owned: ReturnType<typeof useSkinObjectUrls>;
  function Probe() { owned = useSkinObjectUrls(); return null; }
  const container = document.createElement('div'); const root = createRoot(container);
  await act(async () => root.render(<StrictMode><Probe /></StrictMode>));
  owned!.current.set('first', 'blob:first');
  owned!.current.set('first', 'blob:replacement');
  owned!.current.set('second', 'blob:second');
  owned!.current.delete('second');
  expect(revoke.mock.calls.flat()).toEqual(['blob:first', 'blob:second']);
  await act(async () => root.unmount());
  expect(revoke.mock.calls.flat()).toEqual(['blob:first', 'blob:second', 'blob:replacement']);
  owned!.current.set('late', 'blob:late');
  expect(owned!.current.size).toBe(0);
  expect(revoke).toHaveBeenLastCalledWith('blob:late');
  expect(releaseTexture).toHaveBeenCalledWith('blob:replacement');
  vi.unstubAllGlobals();
});
