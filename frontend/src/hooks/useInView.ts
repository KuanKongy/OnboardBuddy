import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Tracks whether an element has entered the viewport.
 *
 * `once` (the default) latches on first intersection, which is the
 * scroll-reveal case; `once: false` keeps reporting both directions, for
 * things that pause while offscreen. jsdom has no IntersectionObserver; there
 * everything counts as in view, so unit tests never render hidden content.
 */
export function useInView<T extends HTMLElement>(options?: {
  once?: boolean;
  threshold?: number;
  rootMargin?: string;
}): { ref: RefObject<T | null>; inView: boolean } {
  const { once = true, threshold = 0.15, rootMargin = "0px 0px -10% 0px" } = options ?? {};
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView(true);
          if (once) observer.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { threshold, rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [once, threshold, rootMargin]);

  return { ref, inView };
}
