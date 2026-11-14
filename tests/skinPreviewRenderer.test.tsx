import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ renderers: [] as any[], update: vi.fn(), scene: vi.fn() }));
vi.mock('three', async original => {
  const actual = await original<typeof import('three')>();
  return { ...actual, WebGLRenderer: class {
    domElement: HTMLCanvasElement; render = vi.fn(); dispose = vi.fn(); forceContextLoss = vi.fn();
    constructor({ canvas }: { canvas: HTMLCanvasElement }) { this.domElement = canvas; mocks.renderers.push(this); }
    setSize(w: number, h: number) { this.domElement.width = w; this.domElement.height = h; }
  } };
});
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/hooks/skin-rendering', async original => {
  const actual = await original<typeof import('../src/hooks/skin-rendering')>();
  return { ...actual,
    useSkinPreviewScene: mocks.scene,
    useSkinPreviewFit: () => ({ cameraConfig: { fov: 35, position: [0, 1, 3], target: [0, 1, 0] }, hasResolvedFit: true, modelGroupPosition: [0, 0, 0], modelGroupScale: [1, 1, 1], modelOffset: [0, 0, 0], spotlightPosition: [0, 0, 0], spotlightScale: [1, 1, 1] }),
    useSkinPreviewAnimation: () => ({ initializeAnimations: vi.fn(), cleanupAnimationState: vi.fn(), update: mocks.update, playClickInteraction: vi.fn(), impulseRef: { current: { clickImpulseOffsetX: 0, clickImpulseRotationZ: 0, clickImpulseScaleX: 1, clickImpulseScaleY: 1, damageFlashIntensity: 0 } } }),
  };
});
import { SkinPreviewRenderer } from '../src/components/skin/SkinPreviewRenderer';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let observer: IntersectionObserverCallback;
let hidden = false;
let frame = 0;
let pending = new Map<number, FrameRequestCallback>();
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  mocks.renderers.length = 0; mocks.update.mockClear(); pending = new Map(); hidden = false;
  mocks.scene.mockReturnValue({ isModelLoaded: true, isTextureLoaded: true, scene: null, modelCenter: [0, 1, 0], modelSize: [1, 2, 1] });
  vi.stubGlobal('IntersectionObserver', class { constructor(callback: IntersectionObserverCallback) { observer = callback; } observe() {} disconnect() {} });
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { pending.set(++frame, callback); return frame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => pending.delete(id));
  root = createRoot(document.createElement('div'));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
async function visible(value: boolean) { await act(async () => observer([{ isIntersecting: value } as IntersectionObserverEntry], {} as IntersectionObserver)); }
function tick() { const batch = [...pending.values()]; pending.clear(); for (const callback of batch) callback(0); }
test('has no renderer or frames outside the viewport and one loop while visible', async () => {
  await act(async () => root.render(<StrictMode><SkinPreviewRenderer textureSrc="skin" /></StrictMode>));
  expect(mocks.renderers).toHaveLength(0); expect(pending.size).toBe(0);
  expect(mocks.scene.mock.calls.at(-1)![0].enabled).toBe(false);
  await visible(true);
  expect(mocks.renderers).toHaveLength(1); expect(pending.size).toBe(1);
  for (let n = 0; n < 60; n++) tick();
  expect(mocks.renderers[0].render).toHaveBeenCalledTimes(60); expect(mocks.update).toHaveBeenCalledTimes(60);
  expect(pending.size).toBe(1);
  await visible(false);
  expect(pending.size).toBe(0); expect(mocks.renderers[0].dispose).toHaveBeenCalledTimes(1);
  expect(mocks.renderers[0].forceContextLoss).toHaveBeenCalledTimes(1);
  await visible(true);
  expect(mocks.renderers).toHaveLength(2);
  expect(mocks.renderers[1].domElement).not.toBe(mocks.renderers[0].domElement);
  expect(pending.size).toBe(1);
});
test('releases the renderer when the document is hidden and resumes only if intersecting', async () => {
  await act(async () => root.render(<SkinPreviewRenderer textureSrc="skin" />));
  await visible(true); tick();
  await act(async () => { hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
  expect(pending.size).toBe(0); expect(mocks.renderers[0].dispose).toHaveBeenCalledTimes(1);
  await visible(false);
  await act(async () => { hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
  expect(mocks.renderers).toHaveLength(1); expect(pending.size).toBe(0);
  await visible(true); tick();
  expect(mocks.renderers).toHaveLength(2); expect(mocks.renderers[1].render).toHaveBeenCalledTimes(1);
});
