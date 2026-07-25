// Ported (simplified) from Modrinth (packages/ui/src/composables/skin-rendering/use-skin-preview-fit.ts)
// Nametag/subtitle layout helpers were dropped since this project's skin preview does not render
// player nametags or subtitle slots - camera/model fitting (the part that matters for rendering
// the model correctly) is preserved 1:1.

import { useCallback, useEffect, useState } from 'react';
import * as THREE from 'three';

import type {
  SkinPreviewFitLock,
  SkinPreviewFitPadding,
  SkinPreviewFraming,
  SkinPreviewTuple,
} from '@/lib/skin-rendering/types';

const FRAMING_PRESETS: Record<
  SkinPreviewFraming,
  { fov: number; zoom: number; padding: SkinPreviewFitPadding }
> = {
  page: {
    fov: 35,
    zoom: 0.96,
    padding: { top: 0.2, right: 0.14, bottom: 0.3, left: 0.14 },
  },
  modal: {
    fov: 35,
    zoom: 1,
    padding: { top: 0.1, right: 0.1, bottom: 0.18, left: 0.1 },
  },
};

function cloneModelTuple(tuple: SkinPreviewTuple): SkinPreviewTuple {
  return [tuple[0], tuple[1], tuple[2]];
}

export interface CameraConfig {
  fov: number;
  position: SkinPreviewTuple;
  target: SkinPreviewTuple;
}

export function useSkinPreviewFit({
  containerElement,
  fit,
  lockFit = true,
  framing = 'page',
  fitZoom = 1,
  fitPadding,
  scale,
  fov,
  modelRotationRef,
  modelCenter,
  modelSize,
  isModelLoaded,
}: {
  containerElement: HTMLElement | null;
  fit?: boolean;
  lockFit?: boolean;
  framing?: SkinPreviewFraming;
  fitZoom?: number;
  fitPadding?: Partial<SkinPreviewFitPadding>;
  scale?: number;
  fov?: number;
  modelRotationRef: React.RefObject<number>;
  modelCenter: SkinPreviewTuple;
  modelSize: SkinPreviewTuple;
  isModelLoaded: boolean;
}) {
  const [containerSize, setContainerSize] = useState({ width: 1, height: 1 });
  const [fitLock, setFitLock] = useState<SkinPreviewFitLock | null>(null);

  const fitEnabled = fit !== undefined ? fit : scale === undefined && fov === undefined;
  const lockFitEnabled = framing === 'page' || lockFit;
  const legacyScale = scale ?? 1;
  const legacyFov = fov ?? 40;

  const hasUsableFitSize = containerSize.width > 1 && containerSize.height > 1;
  const hasResolvedFit = !fitEnabled || (lockFitEnabled ? fitLock !== null : hasUsableFitSize);

  const fitContainerSize = lockFitEnabled ? (fitLock?.containerSize ?? containerSize) : containerSize;
  const fitModelCenter = lockFitEnabled ? (fitLock?.modelCenter ?? modelCenter) : modelCenter;
  const fitModelSize = lockFitEnabled ? (fitLock?.modelSize ?? modelSize) : modelSize;

  const preset = FRAMING_PRESETS[framing];
  const resolvedFitPadding: SkinPreviewFitPadding = {
    top: preset.padding.top,
    right: preset.padding.right,
    bottom: preset.padding.bottom,
    left: preset.padding.left,
    ...(fitPadding ?? {}),
  };
  const fitResolvedPadding = lockFitEnabled ? (fitLock?.padding ?? resolvedFitPadding) : resolvedFitPadding;

  const modelOffset: SkinPreviewTuple = fitEnabled
    ? [-fitModelCenter[0], -fitModelCenter[1], -fitModelCenter[2]]
    : [0, 0, 0];

  const modelGroupPosition: SkinPreviewTuple = fitEnabled
    ? [0, 0, 0]
    : [0, -0.05 * legacyScale, 1.95];

  const modelGroupScale: SkinPreviewTuple = fitEnabled
    ? [1, 1, 1]
    : (() => {
        const resolvedScale = 0.8 * legacyScale;
        return [resolvedScale, resolvedScale, resolvedScale];
      })();

  function computeFittedCamera(): CameraConfig {
    const width = Math.max(fitContainerSize.width, 1);
    const height = Math.max(fitContainerSize.height, 1);
    const aspect = width / height;
    const padding = fitResolvedPadding;

    const usableWidth = Math.max(width * (1 - padding.left - padding.right), 1);
    const usableHeight = Math.max(height * (1 - padding.top - padding.bottom), 1);

    const [sizeX, sizeY, sizeZ] = fitModelSize;
    const halfWidth = Math.sqrt((sizeX / 2) ** 2 + (sizeZ / 2) ** 2);
    const halfHeight = sizeY / 2;

    const resolvedFov = fov ?? preset.fov;
    const verticalFov = THREE.MathUtils.degToRad(resolvedFov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);

    const paddedHalfWidth = halfWidth * (width / usableWidth);
    const paddedHalfHeight = halfHeight * (height / usableHeight);
    const zoom = Math.max(fitZoom * preset.zoom, 0.01);

    const distance =
      Math.max(
        paddedHalfHeight / Math.tan(verticalFov / 2),
        paddedHalfWidth / Math.tan(horizontalFov / 2),
      ) / zoom;

    const visibleHalfHeight = distance * Math.tan(verticalFov / 2);
    const targetY = -(padding.bottom - padding.top) * visibleHalfHeight;

    return {
      fov: resolvedFov,
      position: [0, targetY, -distance],
      target: [0, targetY, 0],
    };
  }

  const cameraConfig: CameraConfig = fitEnabled
    ? computeFittedCamera()
    : {
        fov: legacyFov,
        position: [0, 1.5, -3.25],
        target: modelCenter,
      };

  const spotlightY = fitEnabled ? -fitModelSize[1] / 2 - 0.02 : -0.1 * legacyScale;
  const spotlightPosition: SkinPreviewTuple = [0, spotlightY, fitEnabled ? 0 : 2];
  const spotlightScale: SkinPreviewTuple = fitEnabled
    ? (() => {
        const [sizeX, , sizeZ] = fitModelSize;
        const radius = Math.max(sizeX, sizeZ, 1) * 0.8;
        return [radius, radius, radius];
      })()
    : (() => {
        const resolvedScale = 0.75 * legacyScale;
        return [resolvedScale, resolvedScale, resolvedScale];
      })();

  const lockFitState = useCallback(() => {
    setFitLock((current) => {
      if (!fitEnabled || !lockFitEnabled || current || !isModelLoaded) return current;

      const { width, height } = containerSize;
      if (width <= 1 || height <= 1) return current;

      return {
        containerSize: { width, height },
        modelCenter: cloneModelTuple(modelCenter),
        modelSize: cloneModelTuple(modelSize),
        padding: { ...resolvedFitPadding },
        rotation: modelRotationRef.current ?? 0,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitEnabled, lockFitEnabled, isModelLoaded, containerSize, modelCenter, modelSize]);

  const resetFitLockForLayoutChange = useCallback(() => {
    if (!fitEnabled || !lockFitEnabled) return;
    setFitLock(null);
    // lockFitState will re-lock on next render pass via effect below since isModelLoaded is true
  }, [fitEnabled, lockFitEnabled]);

  useEffect(() => {
    const el = containerElement;
    if (!el) return;

    const resizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const nextContainerSize = {
        width: Math.max(width, 1),
        height: Math.max(height, 1),
      };

      setContainerSize((prev) => {
        const changed = prev.width !== nextContainerSize.width || prev.height !== nextContainerSize.height;
        if (changed) {
          resetFitLockForLayoutChange();
        }
        return changed ? nextContainerSize : prev;
      });
    });

    resizeObserver.observe(el);

    return () => {
      resizeObserver.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerElement]);

  useEffect(() => {
    if (isModelLoaded) {
      lockFitState();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isModelLoaded, lockFitState]);

  useEffect(() => {
    setFitLock(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockFitEnabled, fitEnabled]);

  return {
    cameraConfig,
    fitEnabled,
    hasResolvedFit,
    modelGroupPosition,
    modelGroupScale,
    modelOffset,
    spotlightPosition,
    spotlightScale,
  };
}
