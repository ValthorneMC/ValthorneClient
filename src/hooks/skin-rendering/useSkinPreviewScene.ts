// Ported from Modrinth (packages/ui/src/composables/skin-rendering/use-skin-preview-scene.ts)
// Vue's useGLTF()/useTexture() (Tres/cientos) are replaced with the plain Three.js
// GLTFLoader/TextureLoader wrapped in loadModel()/loadTexture() from skin-rendering.ts,
// since this project does not use a Vue-only Three.js reconciler.

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

import {
  applyCapeTexture,
  applyTexture,
  createTransparentTexture,
  loadModel as loadGltfModel,
  loadTexture as loadSkinTexture,
} from '@/lib/skin-rendering/skin-rendering';
import type { SkinPreviewTuple } from '@/lib/skin-rendering/types';

const SKIN_LAYER_DEPTH_BIAS = -1;

function configureSkinPreviewMesh(mesh: THREE.Mesh) {
  const isSkinLayer = mesh.name.endsWith('_Layer');
  mesh.renderOrder = 0;

  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  materials.forEach((material) => {
    if (!(material instanceof THREE.MeshStandardMaterial) || material.name === 'cape') return;

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

function cloneSceneForRenderer(source: THREE.Object3D) {
  const cloned = cloneSkeleton(source);

  cloned.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;

    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((material) => material.clone())
      : mesh.material.clone();

    configureSkinPreviewMesh(mesh);
  });

  return cloned;
}

function disposeSceneMaterials(root: THREE.Object3D | null) {
  if (!root) return;

  const materials = new Set<THREE.Material>();

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;

    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    meshMaterials.forEach((material) => materials.add(material));
  });

  materials.forEach((material) => material.dispose());
}

function getVisibleMeshBox(root: THREE.Object3D): THREE.Box3 | null {
  root.updateWorldMatrix(true, true);

  const result = new THREE.Box3();
  const meshBox = new THREE.Box3();
  let found = false;

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
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
  initializeAnimations: (loadedScene: THREE.Object3D, clips: THREE.AnimationClip[]) => void;
  cleanupAnimationState: (root: THREE.Object3D | null) => void;
}) {
  const [scene, setScene] = useState<THREE.Object3D | null>(null);
  const sceneRef = useRef<THREE.Object3D | null>(null);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [isTextureLoaded, setIsTextureLoaded] = useState(false);
  const [modelCenter, setModelCenter] = useState<SkinPreviewTuple>([0, 1, 0]);
  const [modelSize, setModelSize] = useState<SkinPreviewTuple>([1, 2, 1]);

  const loadedModelSrcRef = useRef<string | undefined>(undefined);
  const loadedTextureSrcRef = useRef<string | undefined>(undefined);
  const loadedCapeSrcRef = useRef<string | undefined>(undefined);
  const lastCapeSrcRef = useRef<string | undefined>(undefined);
  const textureRef = useRef<THREE.Texture | null>(null);
  const capeTextureRef = useRef<THREE.Texture | null>(null);
  const transparentTextureRef = useRef<THREE.Texture | null>(null);

  const modelLoadVersionRef = useRef(0);
  const textureLoadVersionRef = useRef(0);
  const capeLoadVersionRef = useRef(0);
  const isUnmountedRef = useRef(false);

  const initializeAnimationsRef = useRef(initializeAnimations);
  initializeAnimationsRef.current = initializeAnimations;
  const cleanupAnimationStateRef = useRef(cleanupAnimationState);
  cleanupAnimationStateRef.current = cleanupAnimationState;

  if (!transparentTextureRef.current && typeof document !== 'undefined') {
    transparentTextureRef.current = createTransparentTexture();
  }

  const updateModelInfo = useCallback(() => {
    const box = sceneRef.current ? getVisibleMeshBox(sceneRef.current) : null;

    if (!box) {
      setModelCenter([0, 1, 0]);
      setModelSize([1, 2, 1]);
      return;
    }

    const center = new THREE.Vector3();
    const size = new THREE.Vector3();

    box.getCenter(center);
    box.getSize(size);

    setModelCenter([center.x, center.y, center.z]);
    setModelSize([Math.max(size.x, 0.001), Math.max(size.y, 0.001), Math.max(size.z, 0.001)]);
  }, []);

  const applyTextureToLoadedModel = useCallback(() => {
    if (
      !sceneRef.current ||
      !textureRef.current ||
      loadedModelSrcRef.current !== selectedModelSrc ||
      loadedTextureSrcRef.current !== textureSrc
    ) {
      return;
    }

    applyTexture(sceneRef.current, textureRef.current);
  }, [selectedModelSrc, textureSrc]);

  const applyCapeTextureToLoadedModel = useCallback(() => {
    if (!sceneRef.current || loadedModelSrcRef.current !== selectedModelSrc) return;

    applyCapeTexture(
      sceneRef.current,
      loadedCapeSrcRef.current === capeSrc ? capeTextureRef.current : null,
      transparentTextureRef.current ?? undefined,
    );
  }, [selectedModelSrc, capeSrc]);

  const loadAndApplyTexture = useCallback(async (src: string): Promise<THREE.Texture | null> => {
    if (!src) return null;

    try {
      return await loadSkinTexture(src);
    } catch (error) {
      console.error('Failed to load texture:', error);
      return null;
    }
  }, []);

  const loadModel = useCallback(
    async (src: string) => {
      const loadVersion = ++modelLoadVersionRef.current;

      try {
        setIsModelLoaded(false);
        const gltf = await loadGltfModel(src);
        const clonedScene = cloneSceneForRenderer(gltf.scene);
        if (isUnmountedRef.current || loadVersion !== modelLoadVersionRef.current) {
          disposeSceneMaterials(clonedScene);
          return;
        }

        const previousScene = sceneRef.current;
        cleanupAnimationStateRef.current(previousScene);
        disposeSceneMaterials(previousScene);
        sceneRef.current = clonedScene;
        setScene(clonedScene);
        loadedModelSrcRef.current = src;

        applyTextureToLoadedModel();
        applyCapeTextureToLoadedModel();

        if (gltf.animations && gltf.animations.length > 0) {
          initializeAnimationsRef.current(clonedScene, gltf.animations);
        }

        updateModelInfo();
        setIsModelLoaded(true);
      } catch (error) {
        console.error('Failed to load model:', error);
        if (!isUnmountedRef.current && loadVersion === modelLoadVersionRef.current) {
          setIsModelLoaded(false);
        }
      }
    },
    [applyCapeTextureToLoadedModel, applyTextureToLoadedModel, updateModelInfo],
  );

  const loadAndApplyCapeTexture = useCallback(
    async (src: string | undefined) => {
      if (src === lastCapeSrcRef.current) return;

      const loadVersion = ++capeLoadVersionRef.current;
      lastCapeSrcRef.current = src;

      let loadedCapeTexture: THREE.Texture | null = null;
      if (src) {
        loadedCapeTexture = await loadAndApplyTexture(src);
      }
      if (isUnmountedRef.current || loadVersion !== capeLoadVersionRef.current) return;

      capeTextureRef.current = loadedCapeTexture;
      loadedCapeSrcRef.current = src;
      applyCapeTextureToLoadedModel();
    },
    [applyCapeTextureToLoadedModel, loadAndApplyTexture],
  );

  // Initial mount: load texture, model, cape (mirrors Vue's onBeforeMount).
  useEffect(() => {
    isUnmountedRef.current = false;

    (async () => {
      try {
        setIsTextureLoaded(false);
        textureRef.current = await loadAndApplyTexture(textureSrc);
        loadedTextureSrcRef.current = textureSrc;
        setIsTextureLoaded(true);

        await loadModel(selectedModelSrc);

        if (capeSrc) {
          await loadAndApplyCapeTexture(capeSrc);
        }
      } catch (error) {
        console.error('Failed to initialize skin preview:', error);
      }
    })();

    return () => {
      isUnmountedRef.current = true;
      modelLoadVersionRef.current++;
      textureLoadVersionRef.current++;
      capeLoadVersionRef.current++;

      cleanupAnimationStateRef.current(sceneRef.current);
      disposeSceneMaterials(sceneRef.current);
      sceneRef.current = null;
      setScene(null);
      transparentTextureRef.current?.dispose();
      transparentTextureRef.current = null;
    };
    // Mount/unmount only - model/texture/cape src changes are handled by the watch-equivalent
    // effects below, matching the Vue composable's separate watch() handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // watch(selectedModelSrc)
  const isFirstModelRunRef = useRef(true);
  useEffect(() => {
    if (isFirstModelRunRef.current) {
      isFirstModelRunRef.current = false;
      return;
    }
    loadModel(selectedModelSrc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModelSrc]);

  // watch(textureSrc)
  const isFirstTextureRunRef = useRef(true);
  useEffect(() => {
    if (isFirstTextureRunRef.current) {
      isFirstTextureRunRef.current = false;
      return;
    }

    const loadVersion = ++textureLoadVersionRef.current;

    (async () => {
      setIsTextureLoaded(false);
      const loadedTexture = await loadAndApplyTexture(textureSrc);
      if (isUnmountedRef.current || loadVersion !== textureLoadVersionRef.current) return;

      textureRef.current = loadedTexture;
      loadedTextureSrcRef.current = textureSrc;
      applyTextureToLoadedModel();
      setIsTextureLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textureSrc]);

  // watch(capeSrc)
  const isFirstCapeRunRef = useRef(true);
  useEffect(() => {
    if (isFirstCapeRunRef.current) {
      isFirstCapeRunRef.current = false;
      return;
    }
    loadAndApplyCapeTexture(capeSrc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capeSrc]);

  return {
    isModelLoaded,
    isTextureLoaded,
    modelCenter,
    modelSize,
    scene,
  };
}
