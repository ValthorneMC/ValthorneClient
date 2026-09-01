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
const textureCache: Map<string, Texture> = new Map();
const texturePromiseCache: Map<string, Promise<Texture>> = new Map();

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

export async function loadTexture(
  textureUrl: string,
  config: SkinRendererConfig = {},
): Promise<Texture> {
  const cacheKey = `${textureUrl}_${JSON.stringify(config)}`;

  if (textureCache.has(cacheKey)) {
    return textureCache.get(cacheKey)!;
  }

  if (texturePromiseCache.has(cacheKey)) {
    return texturePromiseCache.get(cacheKey)!;
  }

  const textureLoader = new TextureLoader();
  const promise = new Promise<Texture>((resolve, reject) => {
    textureLoader.load(
      textureUrl,
      (texture) => {
        texture.colorSpace = config.textureColorSpace ?? SRGBColorSpace;
        texture.flipY = config.textureFlipY ?? false;
        texture.magFilter = config.textureMagFilter ?? NearestFilter;
        texture.minFilter = config.textureMinFilter ?? NearestFilter;

        textureCache.set(cacheKey, texture);
        resolve(texture);
      },
      undefined,
      reject,
    );
  }).finally(() => {
    texturePromiseCache.delete(cacheKey);
  });

  texturePromiseCache.set(cacheKey, promise);
  return promise;
}

/** Disposes and evicts every cached texture loaded from `textureUrl`, regardless of config. */
export function releaseTexture(textureUrl: string): void {
  for (const key of textureCache.keys()) {
    if (key.startsWith(`${textureUrl}_`)) {
      textureCache.get(key)?.dispose();
      textureCache.delete(key);
    }
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

