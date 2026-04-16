"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, {
  type GeoJSONSource,
  type Map as MBMap,
  type MapLayerMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { feature } from "topojson-client";
import type {
  Feature,
  FeatureCollection,
  Geometry,
  GeoJsonProperties,
} from "geojson";
import { getEntity } from "@/lib/placeholder-data";
import { getEntityColorForDimension } from "@/lib/dimensions";
import { NEUTRAL_FILL, NEUTRAL_STROKE, type SetTooltip } from "@/lib/map-utils";
import { statusColorForProject } from "@/lib/project-colors";
import type { HousingProject, Dimension, DimensionLens } from "@/types";
import type {
  MapConfig,
  MapLayer,
  SandboxView,
  GeoFeatureLite,
} from "./configs";

interface Props {
  config: MapConfig;
  onSelectEntity: (key: string) => void;
  onDrill?: (view: SandboxView) => void;
  selectedGeoId: string | null;
  setTooltip: SetTooltip;
  dimension?: Dimension;
  lens?: DimensionLens;
  showDataCenters?: boolean;
  onHoverFacility?: (
    dc: HousingProject,
    x: number,
    y: number,
    clusterSize: number,
  ) => void;
  onLeaveFacility?: () => void;
  onSelectFacility?: (dc: HousingProject) => void;
}

// CartoDB Positron raster tiles — free, no API key, no account. Gives us
// the clean flat-light basemap we wanted without Mapbox's credit-card
// requirement.
const BASEMAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · © <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  layers: [{ id: "carto", type: "raster", source: "carto" }],
};

// One fetch per URL, cached for the session.
const topoCache = new Map<string, Promise<unknown>>();
function fetchTopo(url: string): Promise<unknown> {
  let p = topoCache.get(url);
  if (!p) {
    p = fetch(url).then((r) => r.json());
    topoCache.set(url, p);
  }
  return p;
}

function toGeoJSON(
  topo: unknown,
  layer: MapLayer,
  dimension: Dimension,
  lens: DimensionLens,
): FeatureCollection<Geometry, GeoJsonProperties> {
  const t = topo as Parameters<typeof feature>[0];
  const objects = (t as unknown as { objects: Record<string, never> }).objects;
  // us-atlas uses "states" key, world-atlas uses "countries".
  const key = "states" in (objects as unknown as object) ? "states" : "countries";
  const fc = feature(
    t,
    (objects as unknown as Record<string, never>)[key],
  ) as unknown as FeatureCollection<Geometry, GeoJsonProperties>;

  const features: Feature<Geometry, GeoJsonProperties>[] = fc.features
    .filter((f) => (layer.filter ? layer.filter(f as GeoFeatureLite) : true))
    .map((f) => {
      const k = layer.getKey(f as GeoFeatureLite);
      const ent =
        layer.role === "primary" ? getEntity(k, layer.entityRegion) : null;
      const fill = ent ? getEntityColorForDimension(ent, dimension, lens) : NEUTRAL_FILL;
      return {
        ...f,
        id: k,
        properties: {
          ...(f.properties ?? {}),
          geoKey: k,
          geoLabel: layer.getLabel(f as GeoFeatureLite),
          interactive: ent !== null && layer.role === "primary",
          drillable: Boolean(layer.onDrillKey),
          drillTargetKind: layer.onDrillKey?.(k)?.kind,
          role: layer.role,
          fill,
        },
      };
    });

  return { type: "FeatureCollection", features };
}

function facilitiesFC(
  facs: HousingProject[],
): FeatureCollection<Geometry, GeoJsonProperties> {
  return {
    type: "FeatureCollection",
    features: facs
      .filter(
        (f): f is HousingProject & { lat: number; lng: number } =>
          typeof f.lat === "number" && typeof f.lng === "number",
      )
      .map((f) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [f.lng, f.lat] },
        properties: {
          id: f.id,
          status: f.status,
        },
      })),
  };
}

export default function GLMap({
  config,
  onSelectEntity,
  onDrill,
  selectedGeoId,
  setTooltip,
  dimension = "overall",
  lens = "zoning",
  showDataCenters = false,
  onHoverFacility,
  onLeaveFacility,
  onSelectFacility,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MBMap | null>(null);
  const configRef = useRef(config);
  configRef.current = config;
  const [ready, setReady] = useState(false);

  const onSelectRef = useRef(onSelectEntity);
  const onDrillRef = useRef(onDrill);
  const onHoverFacRef = useRef(onHoverFacility);
  const onLeaveFacRef = useRef(onLeaveFacility);
  const onSelectFacRef = useRef(onSelectFacility);
  const setTooltipRef = useRef(setTooltip);
  onSelectRef.current = onSelectEntity;
  onDrillRef.current = onDrill;
  onHoverFacRef.current = onHoverFacility;
  onLeaveFacRef.current = onLeaveFacility;
  onSelectFacRef.current = onSelectFacility;
  setTooltipRef.current = setTooltip;

  // Init map once.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      center: config.initialCenter,
      zoom: mercatorZoomFor(config.initialZoom ?? 1),
      minZoom: 1,
      maxZoom: 11,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      keyboard: true,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );
    mapRef.current = map;

    map.on("load", async () => {
      await rebuildLayers(map, configRef.current, dimension, lens);
      attachInteractions(map, {
        onSelect: (k) => onSelectRef.current(k),
        onDrill: (v) => onDrillRef.current?.(v),
        onHoverFac: (dc, x, y) => onHoverFacRef.current?.(dc, x, y, 1),
        onLeaveFac: () => onLeaveFacRef.current?.(),
        onSelectFac: (dc) => onSelectFacRef.current?.(dc),
        setTooltip: (t) => setTooltipRef.current(t),
        getFacilities: () => configRef.current.facilities,
      });
      setReady(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild layers when config changes (region switch / drill).
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({
      center: config.initialCenter,
      zoom: mercatorZoomFor(config.initialZoom ?? 1),
      duration: 400,
    });
    rebuildLayers(map, config, dimension, lens);
  }, [config, ready, dimension, lens]);

  // Data center visibility.
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    if (!map) return;
    const vis = showDataCenters ? "visible" : "none";
    for (const id of ["dc-clusters", "dc-cluster-core", "dc-points"]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis);
    }
  }, [showDataCenters, ready]);

  // Reflect external selection.
  const lastSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    if (!map) return;
    // All polygon sources are named after their layer id — iterate config.
    for (const layer of configRef.current.layers) {
      const src = layer.id + "-src";
      if (!map.getSource(src)) continue;
      if (
        lastSelectedRef.current &&
        lastSelectedRef.current !== selectedGeoId
      ) {
        map.setFeatureState(
          { source: src, id: lastSelectedRef.current },
          { selected: false },
        );
      }
      if (selectedGeoId) {
        map.setFeatureState(
          { source: src, id: selectedGeoId },
          { selected: true },
        );
      }
    }
    lastSelectedRef.current = selectedGeoId;
  }, [selectedGeoId, ready]);

  return <div ref={containerRef} className="relative w-full h-full" />;
}

// Rough conversion from d3 "zoom factor" to MapLibre zoom level so the
// starting view is visually similar to the SVG panels.
function mercatorZoomFor(zoomFactor: number): number {
  return 3 + Math.log2(Math.max(1, zoomFactor));
}

async function rebuildLayers(
  map: MBMap,
  config: MapConfig,
  dimension: Dimension,
  lens: DimensionLens,
) {
  // Remove old layers/sources managed by us.
  const existingLayers = map.getStyle().layers ?? [];
  for (const l of existingLayers) {
    if (
      l.id.startsWith("poly-") ||
      l.id.startsWith("line-") ||
      l.id === "dc-clusters" ||
      l.id === "dc-cluster-core" ||
      l.id === "dc-points"
    ) {
      if (map.getLayer(l.id)) map.removeLayer(l.id);
    }
  }
  const sources = Object.keys(map.getStyle().sources ?? {});
  for (const s of sources) {
    if (s.endsWith("-src") || s === "dcs") {
      if (map.getSource(s)) map.removeSource(s);
    }
  }

  // Add polygon layers.
  for (const layer of config.layers) {
    const url =
      config.highDetailTargetUrl === layer.geography &&
      config.highDetailUrl &&
      map.getZoom() >= 5
        ? config.highDetailUrl
        : layer.geography;
    const topo = await fetchTopo(url);
    const fc = toGeoJSON(topo, layer, dimension, lens);
    const srcId = layer.id + "-src";
    map.addSource(srcId, { type: "geojson", data: fc, promoteId: "geoKey" });

    map.addLayer({
      id: `poly-${layer.id}`,
      type: "fill",
      source: srcId,
      paint: {
        "fill-color": ["get", "fill"],
        // Semi-transparent so the Mapbox basemap (coastlines, labels)
        // shows through the choropleth. Context layers stay very faint so
        // they don't wash out the basemap's own colors.
        "fill-opacity": [
          "case",
          ["==", ["get", "role"], "context"],
          0.08,
          ["boolean", ["feature-state", "hover"], false],
          0.75,
          0.6,
        ],
      },
    });

    map.addLayer({
      id: `line-${layer.id}`,
      type: "line",
      source: srcId,
      paint: {
        "line-color": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          "#FFFFFF",
          NEUTRAL_STROKE,
        ],
        "line-width": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          2.5,
          (layer.strokeWidth ?? 1) * 0.6,
        ],
      },
    });
  }

  // DC source.
  map.addSource("dcs", {
    type: "geojson",
    data: facilitiesFC(config.facilities),
    cluster: true,
    clusterRadius: 32,
    clusterMaxZoom: 6,
  });
  map.addLayer({
    id: "dc-clusters",
    type: "circle",
    source: "dcs",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": statusColorForProject("operational"),
      "circle-opacity": 0.85,
      "circle-radius": ["step", ["get", "point_count"], 10, 5, 14, 15, 18],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.5,
    },
  });
  map.addLayer({
    id: "dc-cluster-core",
    type: "circle",
    source: "dcs",
    filter: ["has", "point_count"],
    paint: { "circle-color": "#ffffff", "circle-radius": 2 },
  });
  map.addLayer({
    id: "dc-points",
    type: "circle",
    source: "dcs",
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": [
        "match",
        ["get", "status"],
        "operational", statusColorForProject("operational"),
        "under-construction", statusColorForProject("under-construction"),
        "proposed", statusColorForProject("proposed"),
        "#888",
      ],
      "circle-radius": 5,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.2,
      "circle-opacity": 0.95,
    },
  });
}

interface InteractionHandlers {
  onSelect: (key: string) => void;
  onDrill: (view: SandboxView) => void;
  onHoverFac: (dc: HousingProject, x: number, y: number) => void;
  onLeaveFac: () => void;
  onSelectFac: (dc: HousingProject) => void;
  setTooltip: (t: import("@/lib/map-utils").TooltipState | null) => void;
  getFacilities: () => HousingProject[];
}

function attachInteractions(map: MBMap, h: InteractionHandlers) {
  const hoveredRef: { current: { src: string; id: string } | null } = {
    current: null,
  };

  const clearHover = () => {
    if (hoveredRef.current) {
      map.setFeatureState(
        { source: hoveredRef.current.src, id: hoveredRef.current.id },
        { hover: false },
      );
      hoveredRef.current = null;
    }
  };

  // Polygon interactions — attach to every poly-* layer.
  map.on("mousemove", (e) => {
    const features = map.queryRenderedFeatures(e.point).filter((f) =>
      f.layer?.id?.startsWith("poly-"),
    );
    if (!features.length) {
      map.getCanvas().style.cursor = "";
      clearHover();
      h.setTooltip(null);
      return;
    }
    const f = features[0];
    const props = f.properties as {
      interactive?: boolean;
      geoKey?: string;
      geoLabel?: string;
    };
    if (!props.interactive) {
      map.getCanvas().style.cursor = "";
      clearHover();
      return;
    }
    map.getCanvas().style.cursor = "pointer";
    const key = props.geoKey ?? String(f.id);
    const src = f.layer?.source as string;
    if (
      !hoveredRef.current ||
      hoveredRef.current.id !== key ||
      hoveredRef.current.src !== src
    ) {
      clearHover();
      hoveredRef.current = { src, id: key };
      map.setFeatureState({ source: src, id: key }, { hover: true });
    }
    h.setTooltip({
      x: e.originalEvent.clientX,
      y: e.originalEvent.clientY,
      label: props.geoLabel ?? key,
      geoId: key,
    });
  });

  map.on("click", (e) => {
    const features = map.queryRenderedFeatures(e.point).filter((f) =>
      f.layer?.id?.startsWith("poly-"),
    );
    if (!features.length) return;
    const f = features[0];
    const props = f.properties as { interactive?: boolean; geoKey?: string };
    if (!props.interactive) return;
    h.onSelect(props.geoKey ?? String(f.id));
  });

  map.on("dblclick", (e) => {
    const features = map.queryRenderedFeatures(e.point).filter((f) =>
      f.layer?.id?.startsWith("poly-"),
    );
    if (!features.length) return;
    const f = features[0];
    const props = f.properties as {
      drillable?: boolean;
      geoKey?: string;
      drillTargetKind?: "us-states" | "counties";
    };
    if (!props.drillable) return;
    e.preventDefault();
    const key = props.geoKey ?? String(f.id);
    if (props.drillTargetKind === "counties") {
      h.onDrill({ kind: "counties", state: key });
    } else {
      h.onDrill({ kind: "us-states" });
    }
  });

  // DC interactions.
  map.on("mousemove", "dc-points", (e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f) return;
    const id = (f.properties as { id?: string }).id;
    const dc = h.getFacilities().find((x) => x.id === id);
    if (!dc) return;
    map.getCanvas().style.cursor = "pointer";
    h.onHoverFac(dc, e.originalEvent.clientX, e.originalEvent.clientY);
  });
  map.on("mouseleave", "dc-points", () => {
    h.onLeaveFac();
  });
  map.on("click", "dc-points", (e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f) return;
    const id = (f.properties as { id?: string }).id;
    const dc = h.getFacilities().find((x) => x.id === id);
    if (dc) h.onSelectFac(dc);
  });

  map.on("click", "dc-clusters", async (e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f) return;
    const clusterId = (f.properties as { cluster_id: number }).cluster_id;
    const src = map.getSource("dcs") as GeoJSONSource;
    const zoom = await src.getClusterExpansionZoom(clusterId);
    const geom = f.geometry as { coordinates?: [number, number] };
    if (geom.coordinates) map.easeTo({ center: geom.coordinates, zoom });
  });
}
