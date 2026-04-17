import { geoAlbersUsa, geoMercator, geoPath } from "d3-geo";

// US states map projection.
export const usProjection = geoAlbersUsa().scale(900).translate([480, 300]);

// North America (Canada + US) Mercator projection.
//
// Centered near the US/Canada border so the continental view shows
// both countries with roughly equal weight. The previous center
// (lat 52) was a Canada-only framing that cut Florida and the Gulf
// coast out of the viewport. Translate sits just below the SVG
// midpoint so Mercator's high-latitude stretch over Nunavut still
// fits without pushing the southern US off the bottom edge.
export const naProjection = geoMercator()
  .center([-96, 48])
  .scale(420)
  .translate([480, 320]);

// Canada provinces map projection. Centered on Canadian landmass with
// enough pullback to show all 13 provinces and territories (Nunavut at
// the top, Atlantic provinces on the right, Vancouver Island on the left).
export const caProjection = geoMercator()
  .center([-96, 62])
  .scale(250)
  .translate([480, 330]);

export const caPath = geoPath(caProjection);

// Europe centered, fits the EU + UK + nearby comfortably in 960x600.
export const euProjection = geoMercator()
  .center([15, 52])
  .scale(620)
  .translate([480, 300]);

// Asia + Oceania centered. Pulled south and zoomed out a touch from the
// original framing so Australia, New Zealand, and PNG fit in the viewport
// alongside East/Southeast/South Asia.
export const asiaProjection = geoMercator()
  .center([110, 12])
  .scale(310)
  .translate([480, 320]);

export const usPath = geoPath(usProjection);
export const naPath = geoPath(naProjection);
export const euPath = geoPath(euProjection);
export const asiaPath = geoPath(asiaProjection);
