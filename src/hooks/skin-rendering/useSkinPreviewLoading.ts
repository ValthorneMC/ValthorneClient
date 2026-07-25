// Ported from Modrinth (packages/ui/src/composables/skin-rendering/use-skin-preview-loading.ts)
// Vue watch()/onUnmounted() -> React useEffect()/useState()/useRef().

import { useEffect, useRef, useState } from 'react';

const LOADING_INDICATOR_DELAY_MS = 200;
const LOADING_INDICATOR_MIN_MS = 250;

export function useSkinPreviewLoading(isReady: boolean) {
  const [showLoading, setShowLoading] = useState(false);
  const delayTimerRef = useRef<number | null>(null);
  const minTimerRef = useRef<number | null>(null);
  const shownAtRef = useRef(0);
  const showLoadingRef = useRef(showLoading);
  showLoadingRef.current = showLoading;

  useEffect(() => {
    function clearDelayTimer() {
      if (delayTimerRef.current !== null) {
        clearTimeout(delayTimerRef.current);
        delayTimerRef.current = null;
      }
    }

    function clearMinTimer() {
      if (minTimerRef.current !== null) {
        clearTimeout(minTimerRef.current);
        minTimerRef.current = null;
      }
    }

    function hideAfterMinimum() {
      const visibleFor = Date.now() - shownAtRef.current;
      const remaining = LOADING_INDICATOR_MIN_MS - visibleFor;

      if (remaining <= 0) {
        setShowLoading(false);
        return;
      }

      minTimerRef.current = window.setTimeout(() => {
        setShowLoading(false);
        minTimerRef.current = null;
      }, remaining);
    }

    clearDelayTimer();

    if (isReady) {
      if (showLoadingRef.current) {
        clearMinTimer();
        hideAfterMinimum();
      }
      return;
    }

    clearMinTimer();

    if (showLoadingRef.current) {
      return;
    }

    delayTimerRef.current = window.setTimeout(() => {
      delayTimerRef.current = null;
      if (isReady) return;
      setShowLoading(true);
      shownAtRef.current = Date.now();
    }, LOADING_INDICATOR_DELAY_MS);

    return () => {
      clearDelayTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);

  useEffect(() => {
    return () => {
      if (delayTimerRef.current !== null) clearTimeout(delayTimerRef.current);
      if (minTimerRef.current !== null) clearTimeout(minTimerRef.current);
    };
  }, []);

  const isPreviewVisible = isReady && !showLoading;

  return { isPreviewVisible, showLoading };
}
