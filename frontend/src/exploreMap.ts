import type {
  LngLatBounds,
  StyleSpecification,
} from "@maplibre/maplibre-react-native";

export type Coordinates = [number, number];
export type CameraTarget = {
  center: Coordinates;
  zoom: number;
  pitch: number;
  bearing: number;
};

// Mirrors design/lahore-skin/skin.js: the prototype's warm palette applied to
// OpenFreeMap's style before the map loads, with shop and POI labels hidden.
export async function loadSkinnedMapStyle(
  styleURL: string,
  signal: AbortSignal,
): Promise<StyleSpecification> {
  const response = await fetch(styleURL, { signal });
  if (!response.ok)
    throw new Error(`Map style request failed (${response.status})`);
  const style: StyleSpecification = await response.json();
  for (const layer of style.layers) {
    const sourceLayer =
      "source-layer" in layer ? (layer["source-layer"] ?? "") : "";
    const name = `${layer.id} ${sourceLayer}`.toLowerCase();
    if (layer.type === "background") {
      layer.paint = { ...layer.paint, "background-color": "#EEE9D9" };
    } else if (layer.type === "fill-extrusion") {
      layer.paint = {
        ...layer.paint,
        "fill-extrusion-color": "#DDCBAE",
        "fill-extrusion-opacity": 0.96,
      };
    } else if (layer.type === "fill") {
      if (/water/.test(name))
        layer.paint = { ...layer.paint, "fill-color": "#A8C7BE" };
      else if (/park|grass|wood|landcover|landuse/.test(name))
        layer.paint = { ...layer.paint, "fill-color": "#C4CDAE" };
      else if (/building/.test(name))
        layer.paint = { ...layer.paint, "fill-color": "#DFCEB1" };
    } else if (
      layer.type === "line" &&
      /road|transportation/.test(name) &&
      !/rail|tunnel/.test(name)
    ) {
      layer.paint = {
        ...layer.paint,
        "line-color": /casing/.test(name) ? "#D6D5BD" : "#FAF6E9",
      };
    } else if (layer.type === "symbol" && layer.layout?.["text-field"]) {
      layer.paint = {
        ...layer.paint,
        "text-color": "#64715B",
        "text-halo-color": "#F5EFDF",
      };
      if (/poi/.test(name))
        layer.layout = { ...layer.layout, visibility: "none" };
    }
  }
  return style;
}

// Zoom that fits bounds into a viewport, using MapLibre's 512-point tiles and
// Web Mercator latitude spacing.
export function zoomToFit(
  bounds: LngLatBounds,
  width: number,
  height: number,
  maxZoom = 17,
): number {
  const [west, south, east, north] = bounds;
  const mercatorY = (latitude: number) =>
    Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360));
  const longitudeFraction = Math.max((east - west) / 360, 1e-6);
  const latitudeFraction = Math.max(
    (mercatorY(north) - mercatorY(south)) / (2 * Math.PI),
    1e-6,
  );
  const zoom = Math.log2(
    Math.min(
      width / (512 * longitudeFraction),
      height / (512 * latitudeFraction),
    ),
  );
  return Math.min(maxZoom, zoom);
}

export function boundsCentre(bounds: LngLatBounds): Coordinates {
  return [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
}

export function outlineBounds(outline: GeoJSON.MultiPolygon): LngLatBounds {
  const positions = outline.coordinates.flat(2);
  const longitudes = positions.map((position) => position[0]);
  const latitudes = positions.map((position) => position[1]);
  return [
    Math.min(...longitudes),
    Math.min(...latitudes),
    Math.max(...longitudes),
    Math.max(...latitudes),
  ];
}

// The prototype moves the camera with the scroll: a smoothstep blend between the
// card being left and the card being approached.
export function blendCamera(
  from: CameraTarget,
  to: CameraTarget,
  progress: number,
): CameraTarget {
  const amount = progress * progress * (3 - 2 * progress);
  const between = (start: number, end: number) =>
    start + (end - start) * amount;
  return {
    center: [
      between(from.center[0], to.center[0]),
      between(from.center[1], to.center[1]),
    ],
    zoom: between(from.zoom, to.zoom),
    pitch: between(from.pitch, to.pitch),
    bearing: between(from.bearing, to.bearing),
  };
}

// Pitch lines from the prototype: a cricket square and 28 m circle on cricket
// grounds, an inset touchline and halfway line on football grounds.
export function groundMarkings(
  grounds: {
    slug: string;
    coordinates: Coordinates;
    boundary: GeoJSON.MultiPolygon | null;
  }[],
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  const lines: GeoJSON.Position[][] = [];
  for (const ground of grounds) {
    if (!ground.boundary) continue;
    const [longitude, latitude] = ground.coordinates;
    const metresPerLongitude = 111320 * Math.cos((latitude * Math.PI) / 180);
    if (ground.slug.includes("cricket")) {
      const halfLength = 9 / 111320;
      const halfWidth = 1.5 / metresPerLongitude;
      lines.push([
        [longitude - halfWidth, latitude - halfLength],
        [longitude + halfWidth, latitude - halfLength],
        [longitude + halfWidth, latitude + halfLength],
        [longitude - halfWidth, latitude + halfLength],
        [longitude - halfWidth, latitude - halfLength],
      ]);
      lines.push(
        Array.from({ length: 65 }, (_, index) => {
          const angle = (index / 64) * Math.PI * 2;
          return [
            longitude + (Math.cos(angle) * 28) / metresPerLongitude,
            latitude + (Math.sin(angle) * 28) / 111320,
          ];
        }),
      );
    } else if (ground.slug.includes("football")) {
      const ring = ground.boundary.coordinates[0][0];
      const west = Math.min(...ring.map((position) => position[0]));
      const east = Math.max(...ring.map((position) => position[0]));
      const south = Math.min(...ring.map((position) => position[1]));
      const north = Math.max(...ring.map((position) => position[1]));
      const insetX = (east - west) * 0.12;
      const insetY = (north - south) * 0.12;
      lines.push([
        [west + insetX, south + insetY],
        [east - insetX, south + insetY],
        [east - insetX, north - insetY],
        [west + insetX, north - insetY],
        [west + insetX, south + insetY],
      ]);
      lines.push([
        [west + insetX, (south + north) / 2],
        [east - insetX, (south + north) / 2],
      ]);
    }
  }
  return {
    type: "FeatureCollection",
    features: lines.map((coordinates) => ({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates },
    })),
  };
}
