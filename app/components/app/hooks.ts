import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/** False during SSR and hydration, true after; for clock- or locale-dependent output. */
export function useMounted(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/**
 * Animates a number to each new value. With `linear` and a duration close to
 * the poll interval, a live counter keeps ticking between polls instead of
 * jumping, while only ever moving towards the latest real value.
 */
export function useTweened(value: number, durationMs = 600, linear = false): number {
  const [shown, setShown] = useState(value);
  const current = useRef(value);
  useEffect(() => {
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : durationMs;
    const origin = current.current;
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = duration === 0 ? 1 : Math.min(1, (t - start) / duration);
      const eased = linear ? k : 1 - Math.pow(1 - k, 3);
      const v = Math.round(origin + (value - origin) * eased);
      current.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs, linear]);
  return shown;
}
