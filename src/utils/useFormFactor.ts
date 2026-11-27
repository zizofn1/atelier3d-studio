import { useEffect, useState } from 'react';

export type ScreenFormFactor = 'phone' | 'tablet' | 'desktop';
export type InputDensity = 'coarse' | 'fine';

export interface FormFactorState {
  formFactor: ScreenFormFactor;
  density: InputDensity;
  widthPx: number;
  /** Minimum tablet width: 700 px on touchscreens (iPad mini portrait 744 px), 768 px on mouse devices. */
  tabletMinWidthPx: 700 | 768;
}

export const DESKTOP_MIN_WIDTH_PX = 1280;
export const TABLET_TOUCH_MIN_WIDTH_PX = 700;
export const TABLET_MOUSE_MIN_WIDTH_PX = 768;

/**
 * Pure two-axis responsive classifier:
 * - Axis 1 (Layout / ScreenFormFactor):
 *   * desktop: width >= 1280 px
 *   * tablet:  (pointerCoarse ? 700 : 768) <= width < 1280 px
 *   * phone:   width < (pointerCoarse ? 700 : 768) px
 * - Axis 2 (Density / InputDensity):
 *   * coarse when touch pointer is primary -> 44x44 px targets even on iPad Pro 1366 px landscape.
 */
export function resolveFormFactor(widthPx: number, isCoarsePointer: boolean): FormFactorState {
  const tabletMinWidthPx = isCoarsePointer ? TABLET_TOUCH_MIN_WIDTH_PX : TABLET_MOUSE_MIN_WIDTH_PX;
  const formFactor: ScreenFormFactor =
    widthPx >= DESKTOP_MIN_WIDTH_PX
      ? 'desktop'
      : widthPx >= tabletMinWidthPx
        ? 'tablet'
        : 'phone';

  return {
    formFactor,
    density: isCoarsePointer ? 'coarse' : 'fine',
    widthPx,
    tabletMinWidthPx,
  };
}

function readBrowserFormFactor(): FormFactorState {
  if (typeof window === 'undefined') {
    return resolveFormFactor(1440, false);
  }
  const coarse =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : (navigator.maxTouchPoints ?? 0) > 0;
  return resolveFormFactor(window.innerWidth, coarse);
}

export function useFormFactor(): FormFactorState {
  const [state, setState] = useState<FormFactorState>(() => readBrowserFormFactor());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql =
      typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)') : null;

    const update = () => {
      const next = readBrowserFormFactor();
      setState((prev) =>
        prev.formFactor === next.formFactor &&
        prev.density === next.density &&
        prev.widthPx === next.widthPx
          ? prev
          : next
      );
    };

    window.addEventListener('resize', update);
    mql?.addEventListener('change', update);
    return () => {
      window.removeEventListener('resize', update);
      mql?.removeEventListener('change', update);
    };
  }, []);

  return state;
}
