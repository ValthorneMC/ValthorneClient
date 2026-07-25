// Ported from Modrinth (packages/ui/src/composables/skin-rendering/use-skin-preview-animation.ts)
// All per-frame values (click impulse, damage flash) live in refs and are updated imperatively
// via update(delta) from the render loop, instead of Vue's reactive refs driving re-renders.

import { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';

import type { SkinPreviewAnimationConfig } from '@/lib/skin-rendering/types';

type AnimationFinishedListener = (
  event: THREE.AnimationMixerEventMap['finished'] & {
    readonly type: 'finished';
    readonly target: THREE.AnimationMixer;
  },
) => void;

export const INTERACT_ANIMATION_NAME = 'interact';

const INTERACT_VISIBLE_DURATION_SECONDS = 0.5;
const CLICK_IMPULSE_MAX_ENERGY = 5;
const CLICK_IMPULSE_ENERGY_PER_CLICK = 1;
const DAMAGE_FLASH_MIN_CLICKS_PER_SECOND = 2;
const CLICK_IMPULSE_DECAY_PER_SECOND =
  DAMAGE_FLASH_MIN_CLICKS_PER_SECOND * CLICK_IMPULSE_ENERGY_PER_CLICK;
const CLICK_IMPULSE_BASE_SPEED = 18;
const CLICK_IMPULSE_SPEED_BOOST = 7;
const CLICK_IMPULSE_OFFSET_X = 0.035;
const CLICK_IMPULSE_ROTATION_Z = 0.055;
const CLICK_IMPULSE_SCALE_X = 0.018;
const CLICK_IMPULSE_SCALE_Y = 0.025;
const DAMAGE_FLASH_DURATION_SECONDS = 0.2;
const DAMAGE_FLASH_REPEAT_DELAY_SECONDS = 0.5;
const DAMAGE_FLASH_MAX_INTENSITY = 0.7;

export interface SkinPreviewAnimationImpulse {
  clickImpulseOffsetX: number;
  clickImpulseRotationZ: number;
  clickImpulseScaleX: number;
  clickImpulseScaleY: number;
  damageFlashIntensity: number;
}

export function useSkinPreviewAnimation(animationConfig: SkinPreviewAnimationConfig | undefined) {
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<Record<string, THREE.AnimationAction>>({});
  const clockRef = useRef(new THREE.Clock());
  const currentAnimationRef = useRef<string>('');
  const randomAnimationTimerRef = useRef<number | null>(null);
  const lastRandomAnimationRef = useRef<string>('');
  const animationFinishedListenersRef = useRef<AnimationFinishedListener[]>([]);

  const impulseRef = useRef<SkinPreviewAnimationImpulse>({
    clickImpulseOffsetX: 0,
    clickImpulseRotationZ: 0,
    clickImpulseScaleX: 1,
    clickImpulseScaleY: 1,
    damageFlashIntensity: 0,
  });
  const clickImpulseEnergyRef = useRef(0);
  const clickImpulsePhaseRef = useRef(0);
  const damageFlashRemainingRef = useRef(0);
  const damageFlashCooldownRef = useRef(0);

  const animationConfigRef = useRef(animationConfig);
  animationConfigRef.current = animationConfig;

  const baseAnimation = () => animationConfigRef.current?.baseAnimation ?? '';
  const randomAnimations = () => animationConfigRef.current?.randomAnimations ?? [];
  const transitionDuration = () => animationConfigRef.current?.transitionDuration || 0.3;

  const addAnimationFinishedListener = useCallback((listener: AnimationFinishedListener) => {
    mixerRef.current?.addEventListener('finished', listener);
    animationFinishedListenersRef.current.push(listener);
  }, []);

  const removeAnimationFinishedListener = useCallback(
    (listener: AnimationFinishedListener, targetMixer = mixerRef.current) => {
      targetMixer?.removeEventListener('finished', listener);
      const index = animationFinishedListenersRef.current.indexOf(listener);
      if (index !== -1) {
        animationFinishedListenersRef.current.splice(index, 1);
      }
    },
    [],
  );

  const clearAnimationFinishedListeners = useCallback((targetMixer = mixerRef.current) => {
    animationFinishedListenersRef.current.forEach((listener) => {
      targetMixer?.removeEventListener('finished', listener);
    });
    animationFinishedListenersRef.current.length = 0;
  }, []);

  const clearRandomAnimationTimer = useCallback(() => {
    if (randomAnimationTimerRef.current) {
      clearTimeout(randomAnimationTimerRef.current);
      randomAnimationTimerRef.current = null;
    }
  }, []);

  const playAnimation = useCallback(
    (name: string, immediate = false): boolean => {
      const mixer = mixerRef.current;
      const actions = actionsRef.current;
      if (!mixer || !actions[name]) {
        return false;
      }

      const action = actions[name];

      if (
        currentAnimationRef.current === name &&
        action.isRunning() &&
        name !== baseAnimation()
      ) {
        return false;
      }

      Object.entries(actions).forEach(([actionName, actionInstance]) => {
        if (actionName !== name && actionInstance.isRunning()) {
          actionInstance.fadeOut(transitionDuration());
        }
      });

      action.reset();

      if (name === baseAnimation()) {
        action.setLoop(THREE.LoopRepeat, Infinity);
      } else {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;

        const onFinished: AnimationFinishedListener = (event) => {
          if (event.action === action) {
            removeAnimationFinishedListener(onFinished);
            if (currentAnimationRef.current === name && baseAnimation()) {
              action.fadeOut(transitionDuration());
              const baseAction = actions[baseAnimation()];
              if (baseAction) {
                baseAction.reset();
                baseAction.fadeIn(transitionDuration());
                baseAction.play();
                currentAnimationRef.current = baseAnimation();
              }
            }
          }
        };

        addAnimationFinishedListener(onFinished);
      }

      if (immediate) {
        action.setEffectiveWeight(1);
      } else {
        action.fadeIn(transitionDuration());
      }
      action.play();

      if (immediate) {
        mixer.update(0);
      }

      currentAnimationRef.current = name;
      return true;
    },
    [addAnimationFinishedListener, removeAnimationFinishedListener],
  );

  const playRandomAnimation = useCallback(
    (name: string) => {
      const mixer = mixerRef.current;
      const actions = actionsRef.current;
      if (!mixer || !actions[name]) return;

      const action = actions[name];

      if (currentAnimationRef.current === name && action.isRunning()) return;

      const baseAction = baseAnimation() ? actions[baseAnimation()] : undefined;
      if (baseAction?.isRunning()) {
        baseAction.fadeOut(transitionDuration());
      }

      action.reset();
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.setEffectiveTimeScale(1);
      action.fadeIn(transitionDuration());
      action.play();

      currentAnimationRef.current = name;

      const onFinished: AnimationFinishedListener = (event) => {
        if (event.action === action) {
          removeAnimationFinishedListener(onFinished);
          if (currentAnimationRef.current === name && baseAnimation()) {
            action.fadeOut(transitionDuration());
            const nextBaseAction = actions[baseAnimation()];
            if (nextBaseAction) {
              nextBaseAction.reset();
              nextBaseAction.setEffectiveTimeScale(1);
              nextBaseAction.fadeIn(transitionDuration());
              nextBaseAction.play();
              currentAnimationRef.current = baseAnimation();

              setupRandomAnimationLoop();
            }
          }
        }
      };

      addAnimationFinishedListener(onFinished);
    },
    [addAnimationFinishedListener, removeAnimationFinishedListener],
  );

  const setupRandomAnimationLoop = useCallback(() => {
    const interval = animationConfigRef.current?.randomAnimationInterval || 10000;

    function scheduleNextAnimation() {
      if (randomAnimationTimerRef.current) {
        clearTimeout(randomAnimationTimerRef.current);
      }

      randomAnimationTimerRef.current = window.setTimeout(() => {
        const randoms = randomAnimations();
        if (randoms.length > 0 && currentAnimationRef.current === baseAnimation()) {
          const availableAnimations = randoms.filter(
            (anim) => anim !== lastRandomAnimationRef.current,
          );
          const animationsToChooseFrom = availableAnimations.length > 0 ? availableAnimations : randoms;

          const randomIndex = Math.floor(Math.random() * animationsToChooseFrom.length);
          const randomAnimationName = animationsToChooseFrom[randomIndex];

          if (actionsRef.current[randomAnimationName]) {
            lastRandomAnimationRef.current = randomAnimationName;
            playRandomAnimation(randomAnimationName);
          }
        } else {
          scheduleNextAnimation();
        }
      }, interval);
    }

    scheduleNextAnimation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playRandomAnimation]);

  const initializeAnimations = useCallback(
    (loadedScene: THREE.Object3D, clips: THREE.AnimationClip[]) => {
      if (!clips || clips.length === 0) {
        return;
      }

      mixerRef.current = new THREE.AnimationMixer(loadedScene);
      clockRef.current.start();
      actionsRef.current = {};

      clips.forEach((clip) => {
        if (clip.name === INTERACT_ANIMATION_NAME) {
          clip.duration = INTERACT_VISIBLE_DURATION_SECONDS;
        }

        const action = mixerRef.current!.clipAction(clip);
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        actionsRef.current[clip.name] = action;
      });

      if (baseAnimation() && actionsRef.current[baseAnimation()]) {
        actionsRef.current[baseAnimation()].setLoop(THREE.LoopRepeat, Infinity);
        playAnimation(baseAnimation(), true);
        setupRandomAnimationLoop();
      } else {
        const firstAnimationName = Object.keys(actionsRef.current)[0];
        if (firstAnimationName) {
          actionsRef.current[firstAnimationName].setLoop(THREE.LoopRepeat, Infinity);
          playAnimation(firstAnimationName, true);
        }
      }
    },
    [playAnimation, setupRandomAnimationLoop],
  );

  const playInteractAnimation = useCallback(() => {
    if (actionsRef.current[INTERACT_ANIMATION_NAME]) {
      playRandomAnimation(INTERACT_ANIMATION_NAME);
    }
  }, [playRandomAnimation]);

  const triggerDamageFlash = useCallback(() => {
    damageFlashRemainingRef.current = DAMAGE_FLASH_DURATION_SECONDS;
    damageFlashCooldownRef.current = DAMAGE_FLASH_DURATION_SECONDS + DAMAGE_FLASH_REPEAT_DELAY_SECONDS;
    impulseRef.current.damageFlashIntensity = DAMAGE_FLASH_MAX_INTENSITY;
  }, []);

  const addClickImpulse = useCallback(() => {
    clickImpulseEnergyRef.current = Math.min(
      CLICK_IMPULSE_MAX_ENERGY,
      clickImpulseEnergyRef.current + CLICK_IMPULSE_ENERGY_PER_CLICK,
    );

    if (
      clickImpulseEnergyRef.current >= CLICK_IMPULSE_MAX_ENERGY &&
      damageFlashCooldownRef.current <= 0
    ) {
      triggerDamageFlash();
    }
  }, [triggerDamageFlash]);

  const playClickInteraction = useCallback(() => {
    addClickImpulse();
    playInteractAnimation();
  }, [addClickImpulse, playInteractAnimation]);

  const cleanupAnimationState = useCallback(
    (root: THREE.Object3D | null) => {
      clearRandomAnimationTimer();

      const currentMixer = mixerRef.current;
      if (currentMixer) {
        clearAnimationFinishedListeners(currentMixer);
        currentMixer.stopAllAction();

        if (root) {
          currentMixer.uncacheRoot(root);
        }
      }

      mixerRef.current = null;
      actionsRef.current = {};
      currentAnimationRef.current = '';
      lastRandomAnimationRef.current = '';
      damageFlashRemainingRef.current = 0;
      damageFlashCooldownRef.current = 0;
      impulseRef.current.damageFlashIntensity = 0;
    },
    [clearAnimationFinishedListeners, clearRandomAnimationTimer],
  );

  const stopAnimations = useCallback(() => {
    mixerRef.current?.stopAllAction();
    currentAnimationRef.current = '';
  }, []);

  const getAvailableAnimations = useCallback((): string[] => {
    return Object.keys(actionsRef.current);
  }, []);

  const getCurrentAnimation = useCallback(() => currentAnimationRef.current, []);

  // Update per-frame impulse/flash values; called every animation frame by the render loop.
  const update = useCallback((delta: number) => {
    if (mixerRef.current) {
      mixerRef.current.update(delta);
    }

    // Click impulse
    const energy = Math.max(
      0,
      clickImpulseEnergyRef.current - CLICK_IMPULSE_DECAY_PER_SECOND * delta,
    );
    clickImpulseEnergyRef.current = energy;

    if (energy <= 0) {
      impulseRef.current.clickImpulseOffsetX = 0;
      impulseRef.current.clickImpulseRotationZ = 0;
      impulseRef.current.clickImpulseScaleX = 1;
      impulseRef.current.clickImpulseScaleY = 1;
    } else {
      const intensity = energy / CLICK_IMPULSE_MAX_ENERGY;
      clickImpulsePhaseRef.current +=
        delta * (CLICK_IMPULSE_BASE_SPEED + energy * CLICK_IMPULSE_SPEED_BOOST);

      const shake = Math.sin(clickImpulsePhaseRef.current) * intensity;
      const squash = Math.abs(Math.sin(clickImpulsePhaseRef.current * 1.7)) * intensity;

      impulseRef.current.clickImpulseOffsetX = shake * CLICK_IMPULSE_OFFSET_X;
      impulseRef.current.clickImpulseRotationZ = shake * CLICK_IMPULSE_ROTATION_Z;
      impulseRef.current.clickImpulseScaleX = 1 + squash * CLICK_IMPULSE_SCALE_X;
      impulseRef.current.clickImpulseScaleY = 1 - squash * CLICK_IMPULSE_SCALE_Y;
    }

    // Damage flash
    damageFlashCooldownRef.current = Math.max(0, damageFlashCooldownRef.current - delta);

    if (damageFlashRemainingRef.current <= 0) {
      impulseRef.current.damageFlashIntensity = 0;
    } else {
      damageFlashRemainingRef.current = Math.max(0, damageFlashRemainingRef.current - delta);
      impulseRef.current.damageFlashIntensity =
        DAMAGE_FLASH_MAX_INTENSITY * (damageFlashRemainingRef.current / DAMAGE_FLASH_DURATION_SECONDS);
    }
  }, []);

  useEffect(() => {
    clearRandomAnimationTimer();

    if (
      mixerRef.current &&
      animationConfig?.baseAnimation &&
      actionsRef.current[animationConfig.baseAnimation]
    ) {
      playAnimation(animationConfig.baseAnimation);
      setupRandomAnimationLoop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animationConfig?.baseAnimation, JSON.stringify(animationConfig?.randomAnimations)]);

  return {
    impulseRef,
    clockRef,
    cleanupAnimationState,
    getAvailableAnimations,
    getCurrentAnimation,
    initializeAnimations,
    playAnimation,
    playClickInteraction,
    stopAnimations,
    update,
  };
}
