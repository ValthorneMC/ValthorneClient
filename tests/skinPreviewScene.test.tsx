import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import { useSkinPreviewScene } from '../src/hooks/skin-rendering/useSkinPreviewScene';
import * as resources from '../src/lib/skin-rendering/skin-rendering';
vi.mock('@/lib/skin-rendering/skin-rendering', () => ({
  loadModel: vi.fn(), acquireTexture: vi.fn(), applyTexture: vi.fn(), applyCapeTexture: vi.fn(), createTransparentTexture: () => new Texture(),
}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => resolve = r); return { promise, resolve }; };
function model() { const scene = new Group(); scene.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial())); return { scene, animations: [{}] }; }
let root: ReturnType<typeof createRoot>;
let state: ReturnType<typeof useSkinPreviewScene>;
const initializeAnimations = vi.fn(), cleanupAnimationState = vi.fn();
function Probe({ texture = 'skin', model: source = 'model', enabled = true }: { texture?: string; model?: string; enabled?: boolean }) {
  state = useSkinPreviewScene({ enabled, textureSrc: texture, selectedModelSrc: source, capeSrc: undefined, initializeAnimations, cleanupAnimationState }); return null;
}
beforeEach(() => { vi.clearAllMocks(); root = createRoot(document.createElement('div')); });
afterEach(async () => { await act(async () => root.unmount()); });
test('ignores late model and texture results after a source change and releases owned materials', async () => {
  const oldModel = deferred<any>(), nextModel = deferred<any>();
  const oldTexture = deferred<Texture>(), nextTexture = deferred<Texture>();
  const releaseOld = vi.fn(), releaseNext = vi.fn();
  vi.mocked(resources.loadModel).mockImplementation(src => src === 'old' ? oldModel.promise : nextModel.promise);
  vi.mocked(resources.acquireTexture).mockImplementation(src => src === 'old' ? { texture: oldTexture.promise, release: releaseOld } : { texture: nextTexture.promise, release: releaseNext });
  await act(async () => root.render(<Probe texture="old" model="old" />));
  await act(async () => root.render(<Probe texture="next" model="next" />));
  const texture = new Texture();
  await act(async () => { nextTexture.resolve(texture); nextModel.resolve(model()); });
  const scene = state!.scene;
  expect(scene).not.toBeNull(); expect(resources.applyTexture).toHaveBeenCalledWith(scene, texture);
  await act(async () => { oldTexture.resolve(new Texture()); oldModel.resolve(model()); });
  expect(state!.scene).toBe(scene); expect(initializeAnimations).toHaveBeenCalledTimes(1);
  const material = ((scene!.children[0] as Mesh).material as MeshStandardMaterial);
  const dispose = vi.spyOn(material, 'dispose');
  await act(async () => root.unmount());
  expect(dispose).toHaveBeenCalledTimes(1); expect(releaseOld).toHaveBeenCalledTimes(1); expect(releaseNext).toHaveBeenCalledTimes(1);
});
test('StrictMode replay does not initialize disposed scenes or retain texture consumers', async () => {
  const pending = deferred<any>(), texture = deferred<Texture>(); const releases: ReturnType<typeof vi.fn>[] = [];
  vi.mocked(resources.loadModel).mockReturnValue(pending.promise);
  vi.mocked(resources.acquireTexture).mockImplementation(() => { const release = vi.fn(); releases.push(release); return { texture: texture.promise, release }; });
  await act(async () => root.render(<StrictMode><Probe /></StrictMode>));
  expect(releases).toHaveLength(2); expect(releases[0]).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve(model()); texture.resolve(new Texture()); });
  expect(initializeAnimations).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
  expect(releases[1]).toHaveBeenCalledTimes(1);
});

test('defers every resource load until enabled and releases consumers when hidden', async () => {
  const pending = deferred<any>(), texture = deferred<Texture>(), release = vi.fn();
  vi.mocked(resources.loadModel).mockReturnValue(pending.promise);
  vi.mocked(resources.acquireTexture).mockReturnValue({ texture: texture.promise, release });
  await act(async () => root.render(<Probe enabled={false} />));
  expect(resources.loadModel).not.toHaveBeenCalled(); expect(resources.acquireTexture).not.toHaveBeenCalled();
  await act(async () => root.render(<Probe enabled />));
  expect(resources.acquireTexture).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<Probe enabled={false} />));
  expect(release).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve(model()); texture.resolve(new Texture()); });
  expect(initializeAnimations).not.toHaveBeenCalled(); expect(state!.scene).toBeNull();
});
