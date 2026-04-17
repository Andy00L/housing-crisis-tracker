"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import type { Region } from "@/types";

// GlobeHero's d3-geo orthographic projection produces SVG path strings that
// depend on viewport size, so the SSR'd path never matches the client path
// and React hydration errors out — taking down scroll listeners on the
// hero subtree as collateral. Loading client-only sidesteps the mismatch.
const GlobeHero = dynamic(() => import("./GlobeHero"), {
  ssr: false,
  loading: () => <div className="absolute inset-0" aria-hidden />,
});

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

type Props = {
  progress: number;
  onRegionClick?: (region: Region) => void;
};

export default function Hero({ progress, onRegionClick }: Props) {
  const headlineOpacity = clamp(1 - progress / 0.2, 0, 1);
  const headlineY = -progress * 40;
  // Scroll hint stays visible through most of the scroll since the map
  // transition itself doesn't begin until ~0.55. Fades out by ~0.6 once
  // the globe is clearly zooming into the map.
  const hintOpacity = clamp(1 - (progress - 0.45) / 0.15, 0, 1);
  // Fill the progress bar up to 100% by the time the map transition starts.
  const hintProgress = Math.min(100, (progress / 0.55) * 100);

  // Page bounce — if the visitor hasn't scrolled after ~2.5s, we smoothly
  // scroll down ~15vh then bounce back to 0. Acts as a physical demo that
  // the page is scrollable. Any real user scroll cancels the bounce.
  useEffect(() => {
    let userScrolled = false;
    let bouncing = false;
    const onScroll = () => {
      if (!bouncing) userScrolled = true;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    const startTimer = window.setTimeout(() => {
      if (userScrolled) return;
      bouncing = true;
      window.scrollTo({
        top: Math.round(window.innerHeight * 0.15),
        behavior: "smooth",
      });
      window.setTimeout(() => {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }, 750);
    }, 2500);
    return () => {
      window.clearTimeout(startTimer);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  const lockProgress = clamp((progress - 0.18) / 0.35, 0, 1);
  const phi = -15 - lockProgress * 25;
  const lockLambda = lockProgress > 0 ? 100 : undefined;

  const zoom = clamp((progress - 0.55) / 0.45, 0, 1);
  const globeScale = 1 + zoom * 1.8;
  const globeOpacity = clamp(1 - (zoom - 0.35) / 0.5, 0, 1);
  const bgOpacity = 1 - zoom;

  const inactive = progress > 0.92;

  return (
    <section
      className="fixed inset-0 z-20 overflow-hidden"
      style={{ pointerEvents: inactive ? "none" : "auto" }}
      aria-hidden={inactive}
    >
      <div
        className="absolute inset-0 bg-bg"
        style={{ opacity: bgOpacity }}
      />

      <div
        className="absolute inset-x-0 top-[24vh] md:top-[18vh] z-0 px-6 text-center pointer-events-none"
        style={{
          opacity: headlineOpacity,
          transform: `translateY(${headlineY}px)`,
          willChange: "transform, opacity",
        }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-4 md:mb-6 w-10 h-10 md:w-14 md:h-14 text-ink" aria-hidden>
          <path strokeLinecap="round" d="M0 0h24v24H0z" fill="none" stroke="none" />
          <path d="M21 12l-9 -9l-9 9h2v7a2 2 0 0 0 2 2h8" />
          <path d="M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 1.857 1.257" />
          <path d="M19 16v3" />
          <path d="M19 22v.01" />
        </svg>
        <h1 className="text-3xl sm:text-5xl md:text-6xl font-semibold tracking-tight text-ink leading-[1.1] md:leading-[1.05]">
          Tracking housing policy
          <br />
          across Canada
        </h1>
      </div>

      <div
        className="absolute inset-x-0 top-[40vh] z-10 flex justify-center"
        style={{
          opacity: globeOpacity,
          transform: `scale(${globeScale})`,
          transformOrigin: "center center",
          willChange: "transform, opacity",
        }}
      >
        <div className="w-[78vh] h-[78vh] aspect-square">
          <GlobeHero
            phi={phi}
            lockLambda={lockLambda}
            onRegionClick={onRegionClick}
          />
        </div>
      </div>

      {/* Scroll prompt — label + animated chevron + progress bar so users
          know there's more below AND how far they have to go. Fades out
          once the map transition is visibly under way. */}
      <div
        className="absolute inset-x-0 bottom-[5.5vh] z-20 flex flex-col items-center gap-2.5 pointer-events-none"
        style={{ opacity: hintOpacity }}
        aria-hidden
      >
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-ink tracking-tight">
            Scroll to reveal the map
          </span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            className="text-ink"
            style={{ animation: "scroll-hint 1.8s ease-in-out infinite" }}
          >
            <path
              d="M3 4.5l3 3 3-3"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="relative w-40 h-[2px] rounded-full bg-ink/10 overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-ink"
            style={{ width: `${hintProgress}%` }}
          />
        </div>
      </div>
    </section>
  );
}
