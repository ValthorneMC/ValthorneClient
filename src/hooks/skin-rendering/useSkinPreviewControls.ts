// Ported from Modrinth (packages/ui/src/composables/skin-rendering/use-skin-preview-controls.ts)
// modelRotation is kept in a ref (not state) since it's consumed every animation frame by the
// render loop rather than by React renders - mirrors the Vue version's fine-grained reactivity.

import { useCallback, useRef } from 'react';

export function useSkinPreviewControls({
  initialRotation,
  onClickWithoutDrag,
}: {
  initialRotation?: number;
  onClickWithoutDrag: () => void;
}) {
  const modelRotationRef = useRef((initialRotation ?? 15.75) + Math.PI);
  const isDraggingRef = useRef(false);
  const previousXRef = useRef(0);
  const hasDraggedRef = useRef(false);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    isDraggingRef.current = true;
    previousXRef.current = event.clientX;
    hasDraggedRef.current = false;
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const deltaX = event.clientX - previousXRef.current;
    modelRotationRef.current += deltaX * 0.01;
    previousXRef.current = event.clientX;
    hasDraggedRef.current = true;
  }, []);

  const onPointerUp = useCallback((event: React.PointerEvent) => {
    isDraggingRef.current = false;

    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
  }, []);

  const onCanvasClick = useCallback(() => {
    if (!hasDraggedRef.current) {
      onClickWithoutDrag();
    }

    hasDraggedRef.current = false;
  }, [onClickWithoutDrag]);

  const ignoreControlClick = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
  }, []);

  return {
    ignoreControlClick,
    modelRotationRef,
    onCanvasClick,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
