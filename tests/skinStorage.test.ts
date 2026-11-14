import { beforeEach, expect, test, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { SkinStorageService } from '../src/services/skin/skinStorage';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn() } }));
const metadata = Array.from({ length: 100 }, (_, i) => ({ id: `skin-${i}`, uploadedAt: '2026-01-01', variant: 'slim', url: 'https://example.test/skin.png' }));
beforeEach(() => {
  vi.mocked(invoke).mockReset();
  localStorage.clear();
  localStorage.setItem('valthorne_user_skins_metadata', JSON.stringify(metadata));
  localStorage.setItem('valthorne_active_skin', 'skin-42');
  vi.mocked(invoke).mockImplementation(async command => command === 'list_skin_files' ? metadata.map(s => s.id) : [1, 2, 3]);
});
test('reads a library once and reuses its selected skin', async () => {
  const skins = await SkinStorageService.getStoredSkins();
  expect(await SkinStorageService.getActiveSkin(skins)).toBe(skins[42]);
  expect(invoke).toHaveBeenCalledTimes(101);
  expect(skins.map(s => s.id)).toEqual(metadata.map(s => s.id));
  expect(Array.from(new Uint8Array(skins[42].fileData!))).toEqual([1, 2, 3]);
});
test('loads only the active PNG when no library has been supplied', async () => {
  expect((await SkinStorageService.getActiveSkin())?.id).toBe('skin-42');
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(invoke).toHaveBeenLastCalledWith('load_skin_file', { skinId: 'skin-42' });
});
test('does not perform IO for absent or stale active IDs', async () => {
  localStorage.removeItem('valthorne_active_skin');
  expect(await SkinStorageService.getActiveSkin()).toBeNull();
  localStorage.setItem('valthorne_active_skin', 'missing');
  expect(await SkinStorageService.getActiveSkin()).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
});
test('bounds simultaneous file reads and preserves library order', async () => {
  let active = 0, peak = 0;
  vi.mocked(invoke).mockImplementation(async command => {
    if (command === 'list_skin_files') return metadata.map(s => s.id);
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    return [7];
  });
  const skins = await SkinStorageService.getStoredSkins();
  expect(peak).toBe(8);
  expect(skins.map(s => s.id)).toEqual(metadata.map(s => s.id));
});
test('retains metadata when one PNG is absent or unreadable', async () => {
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === 'list_skin_files') return ['skin-0', 'skin-1'];
    if ((args as { skinId: string }).skinId === 'skin-0') throw new Error('unreadable');
    return [9];
  });
  const skins = await SkinStorageService.getStoredSkins();
  expect(skins).toHaveLength(100);
  expect(skins[0].fileData).toBeUndefined();
  expect(skins[2].fileData).toBeUndefined();
  expect(skins[0].url).toBe(metadata[0].url);
  expect(new Uint8Array(skins[1].fileData!)[0]).toBe(9);
});
