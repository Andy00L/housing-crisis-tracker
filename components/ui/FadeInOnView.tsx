"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * Fades + translates its children in when they scroll into view. Cheapest
 * possible implementation: a single IntersectionObserver, a single CSS
 * transition on opacity + transform (GPU-composited, no layout/paint),
 * `once: true` — the observer disconnects after firing so there's zero
 * ongoing cost. `prefers-reduced-motion: reduce` short-circuits to the
 * final state on mount.
 *
 * Apply at CARD granularity, not row granularity. Long tables are
 * deliberately NOT wrapped — staggering hundreds of rows feels janky and
 * delays the reveal of content the user is trying to read.
 */
interface FadeInOnViewProps {
  children: ReactNode;
  /** Milliseconds to offset the start — useful for stagger across siblings. */
  delay?: number;
  /** Override the default wrapper element if `<div>` breaks semantics. */
  as?: "div" | "section" | "article" | "li" | "tr";
  className?: string;
  style?: CSSProperties;
}

export default function FadeInOnView({
  children,
  delay = 0,
  as: Tag = "div",
  className,
  style,
}: FadeInOnViewProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true);
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const transition = `opacity 320ms cubic-bezier(0.32,0.72,0,1) ${delay}ms, transform 320ms cubic-bezier(0.32,0.72,0,1) ${delay}ms`;
  const mergedStyle: CSSProperties = {
    opacity: shown ? 1 : 0,
    transform: shown ? "translateY(0)" : "translateY(8px)",
    transition,
    willChange: shown ? undefined : "opacity, transform",
    ...style,
  };

  const Component = Tag as "div";
  return (
    <Component
      ref={ref as React.RefObject<HTMLDivElement>}
      className={className}
      style={mergedStyle}
    >
      {children}
    </Component>
  );
}
