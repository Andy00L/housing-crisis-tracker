"use client";

import { useEffect, useState } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
} from "react-simple-maps";
import { getEntity } from "@/lib/placeholder-data";
import { getEntityColorForDimension } from "@/lib/dimensions";
import {
  NEUTRAL_FILL,
  NEUTRAL_STROKE,
  type SetTooltip,
} from "@/lib/map-utils";
import type { HousingProject, Dimension, DimensionLens } from "@/types";
import ProjectDots from "../ProjectDots";
import { useZoomPan } from "./useZoomPan";
import { MapControls } from "./MapControls";
import type { MapConfig, MapLayer, SandboxView } from "./configs";

interface Props {
  config: MapConfig;
  onSelectEntity: (key: string) => void;
  onDrill?: (view: SandboxView) => void;
  selectedGeoId: string | null;
  setTooltip: SetTooltip;
  dimension?: Dimension;
  lens?: DimensionLens;
  showProjects?: boolean;
  onHoverProject?: (
    project: HousingProject,
    x: number,
    y: number,
    clusterSize: number,
  ) => void;
  onLeaveProject?: () => void;
  onSelectProject?: (project: HousingProject) => void;
}

const LOD_ENTER = 3;
const LOD_EXIT = 2.7;

const BLOB_STYLE = {
  fill: NEUTRAL_FILL,
  stroke: NEUTRAL_FILL,
  strokeWidth: 0,
  outline: "none",
  pointerEvents: "none" as const,
};

export default function ZoomableSvgMap({
  config,
  onSelectEntity,
  onDrill,
  selectedGeoId,
  setTooltip,
  dimension = "overall",
  lens = "zoning",
  showProjects = false,
  onHoverProject,
  onLeaveProject,
  onSelectProject,
}: Props) {
  const { zoom, center, setZoom, setCenter, containerRef, reset, minZoom, maxZoom } =
    useZoomPan({
      initialCenter: config.initialCenter,
      initialZoom: config.initialZoom,
      clamp: config.clamp,
    });

  const [highDetail, setHighDetail] = useState(false);
  useEffect(() => {
    if (!highDetail && zoom >= LOD_ENTER) setHighDetail(true);
    else if (highDetail && zoom < LOD_EXIT) setHighDetail(false);
  }, [zoom, highDetail]);

  const strokeScale = (base: number, selected = false) =>
    (selected ? 3 * base : base) / zoom;

  // Pixel width of one world copy in the inner (pre-zoom) coordinate
  // system. For a Mercator-family projection, that's 2π × scale.
  const projScale =
    (config.projection as unknown as { scale?: () => number }).scale?.() ?? 150;
  const worldWidth = 2 * Math.PI * projScale;

  const resolvedGeography = (layer: MapLayer) => {
    if (
      highDetail &&
      config.highDetailUrl &&
      config.highDetailTargetUrl === layer.geography
    ) {
      return config.highDetailUrl;
    }
    return layer.geography;
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="relative w-full h-full outline-none focus:ring-1 focus:ring-neutral-300 rounded"
      onMouseMove={(e) =>
        setTooltip((current) =>
          current ? { ...current, x: e.clientX, y: e.clientY } : current,
        )
      }
      onMouseLeave={() => setTooltip(null)}
    >
      <ComposableMap
        width={960}
        height={600}
        projection={config.projection}
        style={{ width: "100%", height: "100%" }}
      >
        <ZoomableGroup
          zoom={zoom}
          center={center}
          minZoom={minZoom}
          maxZoom={maxZoom}
          onMoveEnd={({ coordinates, zoom: z }) => {
            setCenter(coordinates);
            setZoom(z);
          }}
          filterZoomEvent={(e) => {
            const type = (e as unknown as Event).type;
            // We own wheel (custom pan) and dblclick (geography drill).
            return type !== "wheel" && type !== "dblclick";
          }}
        >
          {config.layers.map((layer) => {
            const fade = layer.zoomFadeIn;
            if (fade != null && zoom < fade - 0.5) return null;
            const opacity =
              fade == null
                ? 1
                : zoom >= fade
                  ? 1
                  : Math.max(0, (zoom - (fade - 0.5)) / 0.5);
            // World-wrapping context layers render 3 copies at ±worldWidth
            // so the user can pan through the antimeridian without seeing
            // a void on the other side.
            const offsets = layer.wrapWorld
              ? [-worldWidth, 0, worldWidth]
              : [0];
            return (
              <g
                key={layer.id}
                style={{
                  opacity,
                  transition: "opacity 200ms ease-out",
                }}
              >
                {offsets.map((dx) => (
                  <g key={dx} transform={`translate(${dx} 0)`}>
            <Geographies geography={resolvedGeography(layer)}>
              {({ geographies }) => {
                const filtered = layer.filter
                  ? geographies.filter(layer.filter)
                  : geographies;
                return filtered
                  .slice()
                  .sort((a, b) => {
                    const aSel = layer.getKey(a) === selectedGeoId;
                    const bSel = layer.getKey(b) === selectedGeoId;
                    return aSel === bSel ? 0 : aSel ? 1 : -1;
                  })
                  .map((geo) => {
                    const key = layer.getKey(geo);
                    const label = layer.getLabel(geo);
                    const ent =
                      layer.role === "primary"
                        ? getEntity(key, layer.entityRegion)
                        : null;
                    const isSelected = selectedGeoId === key;
                    const interactive = layer.role === "primary" && ent !== null;

                    if (!interactive) {
                      return (
                        <Geography
                          key={geo.rsmKey}
                          geography={geo}
                          style={{
                            default: BLOB_STYLE,
                            hover: BLOB_STYLE,
                            pressed: BLOB_STYLE,
                          }}
                        />
                      );
                    }

                    const fill = getEntityColorForDimension(
                      ent,
                      dimension,
                      lens,
                    );
                    const stroke = isSelected ? "#FFFFFF" : NEUTRAL_STROKE;
                    const strokeWidth = strokeScale(
                      layer.strokeWidth ?? 1.2,
                      isSelected,
                    );

                    const base = {
                      fill,
                      stroke,
                      strokeWidth,
                      strokeLinejoin: "round" as const,
                      strokeLinecap: "round" as const,
                      outline: "none",
                      cursor: "pointer",
                      transition: "stroke 200ms, filter 200ms",
                      filter: isSelected
                        ? "drop-shadow(0 4px 12px rgba(0,0,0,0.15))"
                        : undefined,
                    };

                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        onMouseEnter={(e) =>
                          setTooltip({
                            x: e.clientX,
                            y: e.clientY,
                            label,
                            geoId: key,
                            region: layer.entityRegion,
                          })
                        }
                        onMouseLeave={() => setTooltip(null)}
                        onClick={() => onSelectEntity(key)}
                        onDoubleClick={() => {
                          const target = layer.onDrillKey?.(key);
                          if (target) onDrill?.(target);
                        }}
                        style={{
                          default: base,
                          hover: {
                            ...base,
                            filter: isSelected
                              ? "drop-shadow(0 4px 12px rgba(0,0,0,0.18)) brightness(0.94)"
                              : "brightness(0.94)",
                          },
                          pressed: base,
                        }}
                      />
                    );
                  });
              }}
            </Geographies>
                  </g>
                ))}
              </g>
            );
          })}

          {showProjects && onHoverProject && onLeaveProject && (
            <ProjectDots
              projects={config.projects}
              projection={
                config.projection as unknown as (
                  c: [number, number],
                ) => [number, number] | null
              }
              onHoverProject={onHoverProject}
              onLeaveProject={onLeaveProject}
              onSelectProject={onSelectProject}
            />
          )}
        </ZoomableGroup>
      </ComposableMap>

      <MapControls
        zoom={zoom}
        onZoomIn={() => setZoom((z) => Math.min(maxZoom, z * 1.4))}
        onZoomOut={() => setZoom((z) => Math.max(minZoom, z / 1.4))}
        onReset={reset}
      />

      {highDetail && (
        <div className="absolute bottom-2 left-2 text-[10px] px-1.5 py-0.5 bg-white/90 border border-neutral-200 rounded text-neutral-600">
          hi-detail
        </div>
      )}
    </div>
  );
}
