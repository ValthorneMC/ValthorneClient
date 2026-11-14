// Ported from Modrinth (packages/ui/src/composables/skin-rendering/use-skin-preview-scene.ts)
// Vue's useGLTF()/useTexture() (Tres/cientos) are replaced with the plain Three.js
// GLTFLoader/TextureLoader wrapped in loadModel()/acquireTexture() from skin-rendering.ts,
// since this project does not use a Vue-only Three.js reconciler.

import { useEffect, useRef, useState } from 'react';
import { MeshStandardMaterial, Box3, Vector3 } from 'three';
import type { Mesh, Object3D, Material, AnimationClip, Texture } from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

import {
  applyCapeTexture,
  applyTexture,
  createTransparentTexture,
  loadModel as loadGltfModel,
  acquireTexture,
} from '@/lib/skin-rendering/skin-rendering';
import type { SkinPreviewTuple } from '@/lib/skin-rendering/types';

const SKIN_LAYER_DEPTH_BIAS = -1;

function configureSkinPreviewMesh(mesh: Mesh) {
  const isSkinLayer = mesh.name.endsWith('_Layer');
  mesh.renderOrder = 0;

  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  materials.forEach((material) => {
    if (!(material instanceof MeshStandardMaterial) || material.name === 'cape') return;

    material.transparent = isSkinLayer;
    material.alphaTest = 0.1;
    material.depthTest = true;
    material.depthWrite = true;
    material.polygonOffset = isSkinLayer;
    material.polygonOffsetFactor = isSkinLayer ? SKIN_LAYER_DEPTH_BIAS : 0;
    material.polygonOffsetUnits = isSkinLayer ? SKIN_LAYER_DEPTH_BIAS : 0;
    material.needsUpdate = true;
  });
}

function cloneSceneForRenderer(source: Object3D) {
  const cloned = cloneSkeleton(source);

  cloned.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || !mesh.material) return;

    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((material) => material.clone())
      : mesh.material.clone();

    configureSkinPreviewMesh(mesh);
  });

  return cloned;
}

function disposeSceneMaterials(root: Object3D | null) {
  if (!root) return;

  const materials = new Set<Material>();

  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || !mesh.material) return;

    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    meshMaterials.forEach((material) => materials.add(material));
  });

  materials.forEach((material) => material.dispose());
}

function getVisibleMeshBox(root: Object3D): Box3 | null {
  root.updateWorldMatrix(true, true);

  const result = new Box3();
  const meshBox = new Box3();
  let found = false;

  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || !mesh.geometry || mesh.visible === false) return;

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.length && materials.every((material) => material.visible === false)) return;

    if (!mesh.geometry.boundingBox) {
      mesh.geometry.computeBoundingBox();
    }

    if (!mesh.geometry.boundingBox) return;

    meshBox.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
    result.union(meshBox);
    found = true;
  });

  return found && !result.isEmpty() ? result.clone() : null;
}

export function useSkinPreviewScene({
  selectedModelSrc,
  textureSrc,
  capeSrc,
  initializeAnimations,
  cleanupAnimationState,
}: {
  selectedModelSrc: string;
  textureSrc: string;
  capeSrc: string | undefined;
  initializeAnimations: (loadedScene: Object3D, clips: AnimationClip[]) => void;
  cleanupAnimationState: (root: Object3D | null) => void;
}) {
  const [scene, setScene] = useState<Object3D | null>(null);
  const sceneRef = useRef<Object3D | null>(null);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [isTextureLoaded, setIsTextureLoaded] = useState(false);
  const [modelCenter, setModelCenter] = useState<SkinPreviewTuple>([0, 1, 0]);
  const [modelSize, setModelSize] = useState<SkinPreviewTuple>([1, 2, 1]);

  const textureRef = useRef<Texture | null>(null);
  const capeTextureRef = useRef<Texture | null>(null);
  const transparentTextureRef = useRef<Texture | null>(null);
  const callbacks = useRef({ initializeAnimations, cleanupAnimationState });
  callbacks.current = { initializeAnimations, cleanupAnimationState };

  useEffect(() => {
    let cancelled = false;
    const transparent = createTransparentTexture();
    transparentTextureRef.current = transparent;
    setIsModelLoaded(false);
    void loadGltfModel(selectedModelSrc).then(gltf => {
      if (cancelled) return;
      const cloned = cloneSceneForRenderer(gltf.scene);
      sceneRef.current = cloned;
      applyTexture(cloned, textureRef.current ?? transparent);
      applyCapeTexture(cloned, capeTextureRef.current, transparent);
      if (gltf.animations?.length) callbacks.current.initializeAnimations(cloned, gltf.animations);
      const box = getVisibleMeshBox(cloned);
      const center = box?.getCenter(new Vector3()) ?? new Vector3(0, 1, 0);
      const size = box?.getSize(new Vector3()) ?? new Vector3(1, 2, 1);
      setModelCenter([center.x, center.y, center.z]);
      setModelSize([Math.max(size.x, 0.001), Math.max(size.y, 0.001), Math.max(size.z, 0.001)]);
      setScene(cloned);
      setIsModelLoaded(true);
    }).catch(error => {
      if (!cancelled) console.error('Failed to load model:', error);
    });
    return () => {
      cancelled = true;
      const current = sceneRef.current;
      callbacks.current.cleanupAnimationState(current);
      disposeSceneMaterials(current);
      sceneRef.current = null;
      setScene(null);
      setIsModelLoaded(false);
      transparent.dispose();
      transparentTextureRef.current = null;
    };
  }, [selectedModelSrc]);

  useEffect(() => {
    let cancelled = false;
    const lease = textureSrc ? acquireTexture(textureSrc) : null;
    setIsTextureLoaded(false);
    void (lease?.texture ?? Promise.resolve(null)).then(texture => {
      if (cancelled) return;
      textureRef.current = texture;
      if (sceneRef.current && texture) applyTexture(sceneRef.current, texture);
      setIsTextureLoaded(true);
    }).catch(error => {
      if (!cancelled) console.error('Failed to load texture:', error);
    });
    return () => {
      cancelled = true;
      textureRef.current = null;
      if (sceneRef.current && transparentTextureRef.current) {
        applyTexture(sceneRef.current, transparentTextureRef.current);
      }
      lease?.release();
    };
  }, [textureSrc]);

  useEffect(() => {
    let cancelled = false;
    const lease = capeSrc ? acquireTexture(capeSrc) : null;
    void (lease?.texture ?? Promise.resolve(null)).then(texture => {
      if (cancelled) return;
      capeTextureRef.current = texture;
      if (sceneRef.current) applyCapeTexture(sceneRef.current, texture, transparentTextureRef.current ?? undefined);
    }).catch(error => {
      if (!cancelled) console.error('Failed to load cape:', error);
    });
    return () => {
      cancelled = true;
      capeTextureRef.current = null;
      if (sceneRef.current) applyCapeTexture(sceneRef.current, null, transparentTextureRef.current ?? undefined);
      lease?.release();
    };
  }, [capeSrc]);

  return { isModelLoaded, isTextureLoaded, modelCenter, modelSize, scene };
}
