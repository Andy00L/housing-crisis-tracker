import { useCallback, useEffect, useRef, useState } from "react";

interface UseZoomPanOpts {
  initialCenter: [number, number];
  initialZoom?: number;
  minZoom?: number;
  maxZoom?: number;
  clamp: [[number, number], [number, number]];
}

export function useZoomPan({
  initialCenter,
  initialZoom = 1,
  minZoom = 1,
  maxZoom = 8,
  clamp,
}: UseZoomPanOpts) {
  const [zoom, setZoom] = useState(initialZoom);
  const [center, setCenter] = useState<[number, number]>(initialCenter);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const clampC = useCallback(
    ([lng, lat]: [number, number]): [number, number] => {
      // Wrap longitude into [-180, 180] so east/west panning loops. Combined
      // with the world-base layer's triple-render in ZoomableSvgMap, this
      // feels like a seamless spin.
      let wrappedLng = ((lng + 180) % 360 + 360) % 360 - 180;
      // Latitude still clamps — no north/south wrap.
      const clampedLat = Math.max(clamp[0][1], Math.min(clamp[1][1], lat));
      return [wrappedLng, clampedLat];
    },
    [clamp],
  );

  const panBy = useCallback(
    (dxDeg: number, dyDeg: number) => {
      setCenter((c) => clampC([c[0] + dxDeg, c[1] - dyDeg]));
    },
    [clampC],
  );

  const reset = useCallback(() => {
    setZoom(initialZoom);
    setCenter(initialCenter);
  }, [initialCenter, initialZoom]);

  // Reset whenever the initial config changes (e.g. region switch).
  useEffect(() => {
    setZoom(initialZoom);
    setCenter(initialCenter);
  }, [initialCenter, initialZoom]);

  // Wheel: ⌘/ctrl = zoom, else pan.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.01);
        setZoom((z) => Math.max(minZoom, Math.min(maxZoom, z * factor)));
      } else {
        const perPx = 0.12 / zoom;
        panBy(-e.deltaX * perPx, -e.deltaY * perPx);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoom, panBy, minZoom, maxZoom]);

  // Arrow-key pan.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const step = 4 / zoom;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        panBy(-step, 0);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        panBy(step, 0);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        panBy(0, step);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        panBy(0, -step);
      } else if (e.key === "+" || e.key === "=") {
        setZoom((z) => Math.min(maxZoom, z * 1.3));
      } else if (e.key === "-" || e.key === "_") {
        setZoom((z) => Math.max(minZoom, z / 1.3));
      } else if (e.key === "0") {
        reset();
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [zoom, panBy, minZoom, maxZoom, reset]);

  return {
    zoom,
    center,
    setZoom,
    setCenter,
    containerRef,
    reset,
    minZoom,
    maxZoom,
  };
}
