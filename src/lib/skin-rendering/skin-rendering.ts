// Ported (near 1:1) from Modrinth (packages/ui/src/utils/webgl/skin-rendering.ts)
// Framework-agnostic Three.js utilities for loading and applying Minecraft skin/cape
// textures onto the classic/slim player GLTF models.

import { TextureLoader, SRGBColorSpace, NearestFilter, FrontSide, DoubleSide, MeshStandardMaterial, CanvasTexture } from 'three';
import type { ColorSpace, MagnificationTextureFilter, MinificationTextureFilter, Texture, Side, Object3D, Mesh, Material } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

interface SkinRendererConfig {
  textureColorSpace?: ColorSpace;
  textureFlipY?: boolean;
  textureMagFilter?: MagnificationTextureFilter;
  textureMinFilter?: MinificationTextureFilter;
}

const modelCache: Map<string, GLTF> = new Map();
const modelPromiseCache: Map<string, Promise<GLTF>> = new Map();
interface TextureEntry {
  url: string;
  promise: Promise<Texture>;
  texture?: Texture;
  references: number;
  invalidated: boolean;
}

export interface TextureLease {
  texture: Promise<Texture>;
  release(): void;
}

const MAX_IDLE_TEXTURES = 32;
const textureCache = new Map<string, TextureEntry>();

function evictTexture(key: string, entry: TextureEntry) {
  if (textureCache.get(key) === entry) textureCache.delete(key);
  entry.invalidated = true;
  if (entry.references === 0 && entry.texture) {
    entry.texture.dispose();
    entry.texture = undefined;
  }
}

function trimTextures() {
  const idle: [string, TextureEntry][] = [];
  for (const [key, entry] of textureCache) {
    if (entry.references !== 0) continue;
    if (!entry.texture || entry.url.startsWith('blob:') || entry.invalidated) evictTexture(key, entry);
    else idle.push([key, entry]);
  }
  for (const [key, entry] of idle.slice(0, Math.max(0, idle.length - MAX_IDLE_TEXTURES))) {
    evictTexture(key, entry);
  }
}

export async function loadModel(modelUrl: string): Promise<GLTF> {
  if (modelCache.has(modelUrl)) {
    return modelCache.get(modelUrl)!;
  }

  if (modelPromiseCache.has(modelUrl)) {
    return modelPromiseCache.get(modelUrl)!;
  }

  const loader = new GLTFLoader();
  const promise = new Promise<GLTF>((resolve, reject) => {
    loader.load(
      modelUrl,
      (gltf) => {
        modelCache.set(modelUrl, gltf);
        resolve(gltf);
      },
      undefined,
      reject,
    );
  }).finally(() => {
    modelPromiseCache.delete(modelUrl);
  });

  modelPromiseCache.set(modelUrl, promise);
  return promise;
}

export function acquireTexture(textureUrl: string, config: SkinRendererConfig = {}): TextureLease {
  const key = `${textureUrl}_${JSON.stringify(config)}`;
  let entry = textureCache.get(key);
  if (entry) {
    entry.references++;
    textureCache.delete(key);
    textureCache.set(key, entry);
  } else {
    const created: TextureEntry = {
      url: textureUrl,
      promise: undefined!,
      references: 1,
      invalidated: false,
    };
    entry = created;
    textureCache.set(key, created);
    created.promise = new Promise<Texture>((resolve, reject) => {
      new TextureLoader().load(textureUrl, texture => {
        texture.colorSpace = config.textureColorSpace ?? SRGBColorSpace;
        texture.flipY = config.textureFlipY ?? false;
        texture.magFilter = config.textureMagFilter ?? NearestFilter;
        texture.minFilter = config.textureMinFilter ?? NearestFilter;
        created.texture = texture;
        if (created.invalidated) evictTexture(key, created);
        trimTextures();
        resolve(texture);
      }, undefined, reject);
    }).catch(error => {
      evictTexture(key, created);
      throw error;
    });
  }
  const owned = entry;
  let released = false;
  return {
    texture: owned.promise,
    release() {
      if (released) return;
      released = true;
      owned.references--;
      if (owned.invalidated) evictTexture(key, owned);
      trimTextures();
    },
  };
}

/** Invalidates a URL without disposing a texture still used by another preview. */
export function releaseTexture(textureUrl: string): void {
  for (const [key, entry] of textureCache) {
    if (entry.url === textureUrl) evictTexture(key, entry);
  }
}

function applyMap(mat: MeshStandardMaterial, texture: Texture | null): boolean {
  const hadMap = mat.map !== null;
  const hasMap = texture !== null;

  if (mat.map !== texture) {
    mat.map = texture;
  }

  return hadMap !== hasMap;
}

function setShaderMaterialProperties(
  mat: MeshStandardMaterial,
  properties: {
    alphaTest: number;
    flatShading: boolean;
    side: Side;
    toneMapped: boolean;
    transparent?: boolean;
  },
): boolean {
  let needsUpdate = false;

  if (mat.alphaTest !== properties.alphaTest) {
    mat.alphaTest = properties.alphaTest;
    needsUpdate = true;
  }

  if (mat.flatShading !== properties.flatShading) {
    mat.flatShading = properties.flatShading;
    needsUpdate = true;
  }

  if (mat.side !== properties.side) {
    mat.side = properties.side;
    needsUpdate = true;
  }

  if (mat.toneMapped !== properties.toneMapped) {
    mat.toneMapped = properties.toneMapped;
    needsUpdate = true;
  }

  if (properties.transparent !== undefined && mat.transparent !== properties.transparent) {
    mat.transparent = properties.transparent;
    needsUpdate = true;
  }

  return needsUpdate;
}

function setCommonMaterialProperties(mat: MeshStandardMaterial): void {
  if (mat.metalness !== 0) {
    mat.metalness = 0;
  }

  if (mat.color.getHex() !== 0xffffff) {
    mat.color.set(0xffffff);
  }

  if (mat.roughness !== 1) {
    mat.roughness = 1;
  }

  if (!mat.depthTest) {
    mat.depthTest = true;
  }

  if (!mat.depthWrite) {
    mat.depthWrite = true;
  }
}

export function applyTexture(model: Object3D, texture: Texture): void {
  model.traverse((child) => {
    if ((child as Mesh).isMesh) {
      const mesh = child as Mesh;
      const isSkinLayer = mesh.name.endsWith('_Layer');
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

      materials.forEach((mat: Material) => {
        if (mat instanceof MeshStandardMaterial) {
          if (mat.name !== 'cape') {
            const mapNeedsUpdate = applyMap(mat, texture);
            const propertiesNeedUpdate = setShaderMaterialProperties(mat, {
              alphaTest: 0.1,
              flatShading: true,
              side: FrontSide,
              toneMapped: false,
              transparent: isSkinLayer,
            });

            setCommonMaterialProperties(mat);

            if (mapNeedsUpdate || propertiesNeedUpdate) {
              mat.needsUpdate = true;
            }
          }
        }
      });
    }
  });
}

export function applyCapeTexture(
  model: Object3D,
  texture: Texture | null,
  transparentTexture?: Texture,
): void {
  model.traverse((child) => {
    if ((child as Mesh).isMesh) {
      const mesh = child as Mesh;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

      materials.forEach((mat: Material) => {
        if (mat instanceof MeshStandardMaterial) {
          if (mat.name === 'cape') {
            const nextMap = texture || transparentTexture || null;
            const mapNeedsUpdate = applyMap(mat, nextMap);
            const propertiesNeedUpdate = setShaderMaterialProperties(mat, {
              alphaTest: 0.1,
              flatShading: true,
              side: DoubleSide,
              toneMapped: false,
              transparent: !texture || !!transparentTexture,
            });

            setCommonMaterialProperties(mat);

            if (mapNeedsUpdate || propertiesNeedUpdate) {
              mat.needsUpdate = true;
            }

            mat.visible = !!texture;
          }
        }
      });
    }
  });
}

export function createTransparentTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 1, 1);

  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  texture.colorSpace = SRGBColorSpace;
  texture.flipY = false;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;

  return texture;
}

