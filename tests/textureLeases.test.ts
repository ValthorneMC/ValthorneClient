import { afterEach, expect, test, vi } from 'vitest';
import { Texture, TextureLoader } from 'three';
import { acquireTexture, releaseTexture } from '../src/lib/skin-rendering/skin-rendering';
let sequence = 0;
function loader() {
  const pending: { texture: Texture; complete: () => void; fail: () => void }[] = [];
  vi.spyOn(TextureLoader.prototype, 'load').mockImplementation((_url, onLoad, _progress, onError) => {
    const texture = new Texture();
    vi.spyOn(texture, 'dispose');
    pending.push({ texture, complete: () => onLoad!(texture), fail: () => onError!(new Error('offline')) });
    return texture;
  });
  return pending;
}
afterEach(() => vi.restoreAllMocks());
test('shares in-flight loads and keeps the texture until its final consumer releases it', async () => {
  const pending = loader(), url = `blob:shared-${sequence++}`;
  const a = acquireTexture(url), b = acquireTexture(url);
  expect(pending).toHaveLength(1);
  pending[0].complete();
  expect(await a.texture).toBe(await b.texture);
  a.release(); a.release();
  expect(pending[0].texture.dispose).not.toHaveBeenCalled();
  b.release();
  expect(pending[0].texture.dispose).toHaveBeenCalledTimes(1);
});
test('releases cancelled pending loads without restoring stale cache entries', async () => {
  const pending = loader(), url = `blob:pending-${sequence++}`;
  const old = acquireTexture(url); old.release();
  const next = acquireTexture(url);
  expect(pending).toHaveLength(2);
  pending[0].complete(); await old.texture;
  expect(pending[0].texture.dispose).toHaveBeenCalledTimes(1);
  pending[1].complete(); await next.texture;
  expect(pending[1].texture.dispose).not.toHaveBeenCalled();
  next.release();
});
test('invalidates URLs without destroying resources still used by a preview', async () => {
  const pending = loader(), url = `blob:replaced-${sequence++}`;
  const old = acquireTexture(url);
  releaseTexture(url);
  const replacement = acquireTexture(url);
  pending[0].complete(); pending[1].complete();
  await Promise.all([old.texture, replacement.texture]);
  expect(pending[0].texture.dispose).not.toHaveBeenCalled();
  old.release();
  expect(pending[0].texture.dispose).toHaveBeenCalledTimes(1);
  expect(pending[1].texture.dispose).not.toHaveBeenCalled();
  replacement.release();
});
test('bounds idle remote textures while keeping active consumers valid', async () => {
  const pending = loader(), prefix = `https://example.test/${sequence++}/`;
  const active = acquireTexture(prefix + 'active'); pending[0].complete(); await active.texture;
  for (let n = 0; n < 100; n++) {
    const lease = acquireTexture(prefix + n); pending.at(-1)!.complete(); await lease.texture; lease.release();
  }
  expect(pending.filter(p => vi.mocked(p.texture.dispose).mock.calls.length === 0)).toHaveLength(33);
  expect(pending[0].texture.dispose).not.toHaveBeenCalled();
  const reload = acquireTexture(prefix + '0');
  expect(pending).toHaveLength(102);
  pending.at(-1)!.complete(); await reload.texture; reload.release(); active.release();
  for (let n = 0; n < 100; n++) releaseTexture(prefix + n);
  releaseTexture(prefix + 'active');
});
test('permits retry after a loader failure', async () => {
  const pending = loader(), url = `blob:failed-${sequence++}`;
  const failed = acquireTexture(url);
  const rejection = expect(failed.texture).rejects.toThrow('offline');
  pending[0].fail(); await rejection; failed.release();
  const retry = acquireTexture(url);
  expect(pending).toHaveLength(2);
  pending[1].complete(); await retry.texture; retry.release();
});
