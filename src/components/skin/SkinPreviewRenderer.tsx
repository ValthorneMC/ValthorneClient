// Ported from Modrinth (packages/ui/src/components/skin/SkinPreviewRenderer.vue).
// Modrinth uses @tresjs/core (a Vue reconciler for Three.js) to declaratively describe the
// scene graph and drive a render loop. Since this is a React project (no Vue reconciler
// available), this component owns a plain Three.js WebGLRenderer/Scene/PerspectiveCamera
// directly and drives the render loop itself with requestAnimationFrame - the
// scene/animation/fit/controls *logic* ported into the hooks in `@/hooks/skin-rendering`
// is unchanged, only the "glue" that wires it to the DOM/render loop differs.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Rotate3d } from 'lucide-react';
import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  Group,
  Mesh,
  SRGBColorSpace,
  NoToneMapping,
  AmbientLight,
  DirectionalLight,
  CircleGeometry,
  ShaderMaterial,
  Clock,
} from 'three';
import type { Object3D } from 'three';

import {
  useSkinPreviewAnimation,
  useSkinPreviewControls,
  useSkinPreviewFit,
  useSkinPreviewLoading,
  useSkinPreviewScene,
} from '@/hooks/skin-rendering';
import { ClassicPlayerModel, SlimPlayerModel } from '@/lib/skin-rendering/models';
import { createRadialSpotlightShader, syncDamageFlashShader } from '@/lib/skin-rendering/skin-preview-shader';
import type {
  SkinPreviewAnimationConfig,
  SkinPreviewFitPadding,
  SkinPreviewFraming,
} from '@/lib/skin-rendering/types';

export interface SkinPreviewRendererProps {
  textureSrc: string;
  capeSrc?: string;
  variant?: 'SLIM' | 'CLASSIC' | 'UNKNOWN';
  fit?: boolean;
  lockFit?: boolean;
  framing?: SkinPreviewFraming;
  fitZoom?: number;
  fitPadding?: Partial<SkinPreviewFitPadding>;
  initialRotation?: number;
  animationConfig?: SkinPreviewAnimationConfig;
  className?: string;
  interactive?: boolean;
  /** Floating label with the username, Minecraft nameplate style (like on Modrinth). */
  nametag?: string;
  /** Floating content below the model (e.g. an "Edit skin" button), overlaid on the canvas. */
  subtitle?: React.ReactNode;
  /** Shows the "Drag to rotate" hint overlaid on the canvas. */
  showDragHint?: boolean;
}

const DEFAULT_ANIMATION_CONFIG: SkinPreviewAnimationConfig = {
  baseAnimation: 'idle',
  randomAnimations: ['idle_sub_1', 'idle_sub_2', 'idle_sub_3'],
  randomAnimationInterval: 8000,
  transitionDuration: 0.2,
};

export const SkinPreviewRenderer: React.FC<SkinPreviewRendererProps> = ({
  textureSrc,
  capeSrc,
  variant = 'CLASSIC',
  fit,
  lockFit = true,
  framing = 'page',
  fitZoom = 1,
  fitPadding,
  initialRotation = 15.75,
  animationConfig = DEFAULT_ANIMATION_CONFIG,
  className = '',
  interactive = true,
  nametag,
  subtitle,
  showDragHint = false,
}) => {
  const { t } = useTranslation('skins');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [containerElement, setContainerElement] = useState<HTMLElement | null>(null);

  // Grids can mount dozens of these at once (e.g. the skin library). Defer creating the
  // WebGL context until the preview actually scrolls into view, and keep tracking
  // visibility afterwards so the render loop can pause while scrolled out instead of
  // burning GPU/CPU on off-screen thumbnails.
  const [shouldMount, setShouldMount] = useState(false);
  const isVisibleRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        isVisibleRef.current = entry.isIntersecting;
        if (entry.isIntersecting) setShouldMount(true);
      },
      { rootMargin: '150px' },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const rendererRef = useRef<WebGLRenderer | null>(null);
  const threeSceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  const modelGroupOuterRef = useRef<Group | null>(null);
  const modelGroupInnerRef = useRef<Group | null>(null);
  const spotlightMeshRef = useRef<Mesh | null>(null);
  const currentModelChildRef = useRef<Object3D | null>(null);

  const selectedModelSrc = variant === 'SLIM' ? SlimPlayerModel : ClassicPlayerModel;

  const {
    cleanupAnimationState,
    impulseRef,
    initializeAnimations,
    playClickInteraction,
    update: updateAnimation,
  } = useSkinPreviewAnimation(animationConfig);

  const { modelRotationRef, onCanvasClick, onPointerDown, onPointerMove, onPointerUp } =
    useSkinPreviewControls({
      initialRotation,
      onClickWithoutDrag: () => {
        if (interactive) playClickInteraction();
      },
    });

  const { isModelLoaded, isTextureLoaded, modelCenter, modelSize, scene } = useSkinPreviewScene({
    selectedModelSrc,
    textureSrc,
    capeSrc,
    initializeAnimations,
    cleanupAnimationState,
  });

  const {
    cameraConfig,
    hasResolvedFit,
    modelGroupPosition,
    modelGroupScale,
    modelOffset,
    spotlightPosition,
    spotlightScale,
  } = useSkinPreviewFit({
    containerElement,
    fit,
    lockFit,
    framing,
    fitZoom,
    fitPadding,
    scale: undefined,
    fov: undefined,
    modelRotationRef,
    modelCenter,
    modelSize,
    isModelLoaded,
  });

  const isReady = isModelLoaded && isTextureLoaded && hasResolvedFit;
  const { isPreviewVisible, showLoading } = useSkinPreviewLoading(isReady);

  const radialSpotlightShader = useMemo(() => createRadialSpotlightShader(), []);

  // Set up the Three.js renderer/scene/camera/lights/spotlight once the preview has
  // scrolled into view at least once (see the IntersectionObserver effect above).
  useEffect(() => {
    if (!shouldMount || !canvasRef.current) return;

    const renderer = new WebGLRenderer({
      canvas: canvasRef.current,
      alpha: true,
      antialias: true,
    });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = NoToneMapping;
    renderer.toneMappingExposure = 10.0;
    rendererRef.current = renderer;

    const scene3 = new Scene();
    threeSceneRef.current = scene3;

    const camera = new PerspectiveCamera(35, 1, 0.05, 1000);
    cameraRef.current = camera;

    const ambientLight = new AmbientLight(0xffffff, 2);
    const directionalLight = new DirectionalLight(0xffffff, 1.2);
    directionalLight.position.set(-3, 4, -2);
    scene3.add(ambientLight, directionalLight);

    const outerGroup = new Group();
    const innerGroup = new Group();
    outerGroup.add(innerGroup);
    scene3.add(outerGroup);
    modelGroupOuterRef.current = outerGroup;
    modelGroupInnerRef.current = innerGroup;

    const spotlightGeometry = new CircleGeometry(1, 128);
    const spotlightMaterial = new ShaderMaterial(radialSpotlightShader);
    const spotlightMesh = new Mesh(spotlightGeometry, spotlightMaterial);
    spotlightMesh.rotation.set(-Math.PI / 2, 0, 0);
    scene3.add(spotlightMesh);
    spotlightMeshRef.current = spotlightMesh;

    let disposed = false;
    let rafId = 0;
    const clock = new Clock();

    const renderLoop = () => {
      if (disposed) return;
      rafId = requestAnimationFrame(renderLoop);
      if (!isVisibleRef.current) return;

      const delta = clock.getDelta();
      updateAnimation(delta);

      const impulse = impulseRef.current;

      if (outerGroup && innerGroup) {
        outerGroup.rotation.set(0, modelRotationRef.current, impulse.clickImpulseRotationZ);
      }

      if (rendererRef.current && cameraRef.current) {
        const canvas = rendererRef.current.domElement;
        const width = canvas.clientWidth || 1;
        const height = canvas.clientHeight || 1;
        if (canvas.width !== width || canvas.height !== height) {
          rendererRef.current.setSize(width, height, false);
          cameraRef.current.aspect = width / height;
          cameraRef.current.updateProjectionMatrix();
        }

        syncDamageFlashShader(currentModelChildRef.current, impulse.damageFlashIntensity);

        rendererRef.current.render(scene3, cameraRef.current);
      }
    };

    rafId = requestAnimationFrame(renderLoop);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      spotlightGeometry.dispose();
      spotlightMaterial.dispose();
      renderer.dispose();
      rendererRef.current = null;
      threeSceneRef.current = null;
      cameraRef.current = null;
      modelGroupOuterRef.current = null;
      modelGroupInnerRef.current = null;
      spotlightMeshRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldMount]);

  // Track the model group's position/scale/offset, applying click-impulse offsets each frame
  // via a small ref-driven wrapper effect (position/scale change infrequently; impulse changes
  // every frame, so we store the base values and let the render loop above add the impulse).
  const baseTransformRef = useRef({
    position: modelGroupPosition,
    scale: modelGroupScale,
    offset: modelOffset,
  });
  baseTransformRef.current = { position: modelGroupPosition, scale: modelGroupScale, offset: modelOffset };

  useEffect(() => {
    let rafId = 0;
    const applyTransform = () => {
      rafId = requestAnimationFrame(applyTransform);
      const outer = modelGroupOuterRef.current;
      const inner = modelGroupInnerRef.current;
      if (!outer || !inner) return;

      const { position, scale, offset } = baseTransformRef.current;
      const impulse = impulseRef.current;

      outer.position.set(
        position[0] + impulse.clickImpulseOffsetX,
        position[1],
        position[2],
      );
      outer.scale.set(scale[0] * impulse.clickImpulseScaleX, scale[1] * impulse.clickImpulseScaleY, scale[2]);
      inner.position.set(offset[0], offset[1], offset[2]);
    };
    rafId = requestAnimationFrame(applyTransform);
    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap the loaded skin model into the inner group whenever `scene` changes.
  useEffect(() => {
    const inner = modelGroupInnerRef.current;
    if (!inner) return;

    if (currentModelChildRef.current) {
      inner.remove(currentModelChildRef.current);
      currentModelChildRef.current = null;
    }

    if (scene) {
      inner.add(scene);
      currentModelChildRef.current = scene;
    }
    // Also re-run once the renderer/groups exist (`shouldMount`): the model can finish
    // loading before the lazy-mounted WebGL setup effect has populated `modelGroupInnerRef`.
  }, [scene, shouldMount]);

  // Apply camera fov/position/lookAt whenever the computed fit changes.
  useEffect(() => {
    const camera = cameraRef.current;
    if (!camera) return;

    camera.fov = cameraConfig.fov;
    camera.position.set(...cameraConfig.position);
    camera.lookAt(...cameraConfig.target);
    camera.updateProjectionMatrix();
    // Also re-run once the camera exists (`shouldMount`, see note on the scene-attach effect).
  }, [cameraConfig, shouldMount]);

  // Apply spotlight position/scale whenever fit changes.
  useEffect(() => {
    const mesh = spotlightMeshRef.current;
    if (!mesh) return;

    mesh.position.set(...spotlightPosition);
    mesh.scale.set(...spotlightScale);
    // Also re-run once the spotlight mesh exists (`shouldMount`, see note above).
  }, [spotlightPosition, spotlightScale, shouldMount]);

  // Keep the container element ref for the fit hook's ResizeObserver.
  useEffect(() => {
    setContainerElement(containerRef.current);
  }, []);

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden cursor-grab active:cursor-grabbing ${className}`}
    >
      <canvas
        ref={canvasRef}
        className={`w-full h-full block transition-opacity duration-500 ${
          isPreviewVisible ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ imageRendering: 'pixelated' }}
        onPointerDown={interactive ? onPointerDown : undefined}
        onPointerMove={interactive ? onPointerMove : undefined}
        onPointerUp={interactive ? onPointerUp : undefined}
        onPointerLeave={interactive ? onPointerUp : undefined}
        onClick={interactive ? onCanvasClick : undefined}
      />

      {showLoading && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
        </div>
      )}

      {nametag && (
        <div className="absolute left-1/2 top-[18%] -translate-x-1/2 pointer-events-none z-10">
          <div className="font-minecraft rounded-md px-3 py-1 text-sm text-white/90" style={{ background: 'rgba(0,0,0,0.35)', boxShadow: 'inset -0.5px -0.5px 0 rgba(0,0,0,0.25), inset 0.5px 0.5px 0 rgba(255,255,255,0.05)' }}>
            {nametag}
          </div>
        </div>
      )}

      {showDragHint && (
        <div className="absolute inset-x-0 bottom-[14%] flex items-center justify-center pointer-events-none z-10">
          <span className="flex items-center gap-1.5 text-sm font-medium text-white/70">
            <Rotate3d className="w-4 h-4 shrink-0" />
            {t('dragToRotate')}
          </span>
        </div>
      )}

      {subtitle && (
        <div className="absolute inset-x-0 bottom-[3%] flex items-center justify-center z-10">
          {subtitle}
        </div>
      )}
    </div>
  );
};
