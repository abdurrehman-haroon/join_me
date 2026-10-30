import type * as GeoJSON from "geojson";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import campusMap from "../assets/lums-campus.json";
import { buildPadelCourts, type PadelCourts } from "./padelCourt";
import {
  courtTexture,
  cricketTexture,
  houseTextures,
  padelBallTexture,
  pitchTexture,
  tapeBallTexture,
  wallTextures,
} from "./sceneTextures";

// Builds the illustrated 3D campus from the v6 prototype out of real data: the campus
// boundary and grounds from our API, and building footprints and paths extracted from
// OpenStreetMap (assets/lums-campus.json). One scene unit is 15 metres.

export const metresPerUnit = 15;
// Real buildings are exaggerated in height so the campus reads as a model, like v6.
const unitsPerLevel = 0.55;
const defaultLevels = 2;

export type ScenePlace = {
  id: string;
  name: string;
  type: string;
  coordinates: [number, number];
  boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
};

// A ground's footprint in scene units: an oriented rectangle, or a circle for ovals.
export type Footprint =
  | { kind: "rect"; x: number; z: number; length: number; width: number; angle: number }
  | { kind: "circle"; x: number; z: number; radius: number };

export type CampusWorld = {
  scene: THREE.Scene;
  footprints: Map<string, Footprint>;
  // Ground and court meshes, each with `userData.placeID`, for tap hit-testing.
  grounds: THREE.Mesh[];
  // Building meshes, which hide grounds behind them from taps.
  buildings: THREE.Mesh[];
  setHour: (hour: number) => void;
  selection: THREE.Mesh;
};

// Local flat projection around the campus centre: x east, z south, in scene units.
export function toScene(
  [lng, lat]: [number, number],
  origin: [number, number],
): { x: number; z: number } {
  const metresPerDegreeLng = 111320 * Math.cos((origin[1] * Math.PI) / 180);
  return {
    x: ((lng - origin[0]) * metresPerDegreeLng) / metresPerUnit,
    z: (-(lat - origin[1]) * 110540) / metresPerUnit,
  };
}

function outerRing(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): GeoJSON.Position[] {
  return geometry.type === "Polygon" ? geometry.coordinates[0] : geometry.coordinates[0][0];
}

function contains(point: { x: number; z: number }, ring: { x: number; z: number }[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.z > point.z !== b.z > point.z && point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x)
      inside = !inside;
  }
  return inside;
}

// Shape in the XY plane that becomes the scene's XZ ground plane after rotateX(-90°).
function shapeOf(ring: { x: number; z: number }[]) {
  return new THREE.Shape(ring.map((point) => new THREE.Vector2(point.x, -point.z)));
}

// Flat ribbons along a line, one box per segment, for merging into a single mesh.
function ribbonsAlong(line: { x: number; z: number }[], width: number, y: number) {
  const ribbons: THREE.BufferGeometry[] = [];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 0.01) continue;
    const ribbon = new THREE.BoxGeometry(length + width, 0.03, width);
    ribbon.rotateY(-Math.atan2(b.z - a.z, b.x - a.x));
    ribbon.translate((a.x + b.x) / 2, y, (a.z + b.z) / 2);
    ribbons.push(ribbon);
  }
  return ribbons;
}

// Grounds mapped as four corners become rectangles; anything rounder becomes an oval.
export function footprintOf(place: ScenePlace, origin: [number, number]): Footprint {
  const centre = toScene(place.coordinates, origin);
  if (!place.boundary) return { kind: "circle", ...centre, radius: 2 };
  const ring = outerRing(place.boundary).map((p) => toScene([p[0], p[1]], origin));
  const corners = ring.length > 1 && ring[0].x === ring[ring.length - 1].x ? ring.slice(0, -1) : ring;
  let area = 0;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    area += a.x * b.z - b.x * a.z;
  }
  area = Math.abs(area) / 2;
  if (corners.length !== 4) return { kind: "circle", ...centre, radius: Math.sqrt(area / Math.PI) };
  const side1 = Math.hypot(corners[1].x - corners[0].x, corners[1].z - corners[0].z);
  const side2 = Math.hypot(corners[2].x - corners[1].x, corners[2].z - corners[1].z);
  const longFirst = side1 >= side2;
  const [a, b] = longFirst ? [corners[0], corners[1]] : [corners[1], corners[2]];
  return {
    kind: "rect",
    x: corners.reduce((sum, p) => sum + p.x, 0) / 4,
    z: corners.reduce((sum, p) => sum + p.z, 0) / 4,
    length: Math.max(side1, side2),
    width: Math.min(side1, side2),
    angle: Math.atan2(b.z - a.z, b.x - a.x),
  };
}

export function footprintRadius(footprint: Footprint) {
  return footprint.kind === "circle" ? footprint.radius : footprint.length / 2;
}

function courtColour(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes("tennis")) return "#3D6F8E";
  if (lower.includes("basket")) return "#B9643F";
  return "#C9AE78";
}

const smooth = (from: number, to: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};
const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

export function buildCampus(
  boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  origin: [number, number],
  places: ScenePlace[],
): CampusWorld {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#E7A77A");
  scene.fog = new THREE.Fog("#E7A77A", 80, 220);

  // Wide enough for the DHA level, about 120 km across.
  const land = new THREE.Mesh(
    new THREE.PlaneGeometry(8000, 8000),
    // Flat layers are pushed back in depth so the grounds and paths on top never flicker.
    new THREE.MeshLambertMaterial({
      color: "#C7BCA0",
      polygonOffset: true,
      polygonOffsetFactor: 4,
      polygonOffsetUnits: 4,
    }),
  );
  land.rotation.x = -Math.PI / 2;
  scene.add(land);

  const campusRing = outerRing(boundary).map((p) => toScene([p[0], p[1]], origin));
  const campus = new THREE.Mesh(
    new THREE.ShapeGeometry(shapeOf(campusRing)).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({
      color: "#D3CAAE",
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 2,
    }),
  );
  campus.position.y = 0.02;
  scene.add(campus);

  // Paths: flat ribbons along each OpenStreetMap footway, merged into one mesh.
  const ribbons = campusMap.paths.flatMap((path) =>
    ribbonsAlong(
      path.map((p) => toScene([p[0], p[1]], origin)),
      0.32,
      0.06,
    ),
  );
  if (ribbons.length) {
    const paths = new THREE.Mesh(
      mergeGeometries(ribbons),
      new THREE.MeshLambertMaterial({ color: "#E2D8C0" }),
    );
    scene.add(paths);
  }

  // Grounds, each with floodlights whose heads and beams switch on after sunset.
  const footprints = new Map<string, Footprint>();
  const grounds: THREE.Mesh[] = [];
  const side = new THREE.MeshLambertMaterial({ color: "#3A6B45" });
  const floodHeads: THREE.MeshLambertMaterial[] = [];
  const beams: THREE.MeshBasicMaterial[] = [];
  const lightPools: THREE.MeshBasicMaterial[] = [];
  for (const place of places) {
    const footprint = footprintOf(place, origin);
    footprints.set(place.id, footprint);
    const isCourt = place.type === "court";
    const isGround = place.type === "ground";
    if (!isCourt && !isGround) continue;
    let mesh: THREE.Mesh;
    if (footprint.kind === "circle") {
      const top = new THREE.MeshLambertMaterial({ map: cricketTexture() });
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(footprint.radius, footprint.radius, 0.24, 72),
        [side, top, side],
      );
    } else {
      const top = new THREE.MeshLambertMaterial({
        map: isCourt
          ? courtTexture(courtColour(place.name))
          : pitchTexture(footprint.length, footprint.width),
      });
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(footprint.length, 0.24, footprint.width),
        [side, side, top, side, side, side],
      );
      mesh.rotation.y = -footprint.angle;
    }
    mesh.position.set(footprint.x, 0.12, footprint.z);
    mesh.userData.placeID = place.id;
    scene.add(mesh);
    grounds.push(mesh);

    const poleHeight = isCourt ? 2.4 : 3.4;
    const poles =
      footprint.kind === "circle"
        ? [0, 1, 2, 3, 4, 5].map((i) => {
            const a = (i / 6) * Math.PI * 2 + 0.3;
            return [
              footprint.x + Math.cos(a) * (footprint.radius + 0.7),
              footprint.z + Math.sin(a) * (footprint.radius + 0.7),
            ];
          })
        : [
            [-1, -1],
            [1, -1],
            [-1, 1],
            [1, 1],
          ].map(([sx, sz]) => {
            const along = sx * (footprint.length / 2 + 0.5);
            const across = sz * (footprint.width / 2 + 0.5);
            const c = Math.cos(footprint.angle);
            const s = Math.sin(footprint.angle);
            return [footprint.x + along * c - across * s, footprint.z + along * s + across * c];
          });
    for (const [px, pz] of poles) {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.08, poleHeight, 6),
        new THREE.MeshLambertMaterial({ color: "#6E756F" }),
      );
      pole.position.set(px, poleHeight / 2, pz);
      scene.add(pole);
      const headMaterial = new THREE.MeshLambertMaterial({
        color: "#DCDCD0",
        emissive: "#FFE9B0",
        emissiveIntensity: 0,
      });
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.12), headMaterial);
      head.position.set(px, poleHeight + 0.05, pz);
      head.lookAt(footprint.x, 0, footprint.z);
      scene.add(head);
      floodHeads.push(headMaterial);
      const length = Math.hypot(px - footprint.x, pz - footprint.z, poleHeight) * 0.8;
      const cone = new THREE.ConeGeometry(1.9, length, 24, 1, true);
      cone.translate(0, -length / 2, 0);
      cone.rotateX(-Math.PI / 2);
      const beamMaterial = new THREE.MeshBasicMaterial({
        color: "#FFEFC2",
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const beam = new THREE.Mesh(cone, beamMaterial);
      beam.position.set(px, poleHeight, pz);
      beam.lookAt(lerp(px, footprint.x, 0.8), 0, lerp(pz, footprint.z, 0.8));
      scene.add(beam);
      beams.push(beamMaterial);
    }
    // Real point lights make every shader recompile and are slow on phones, so the
    // floodlit pitch is a soft additive pool of light instead.
    const poolMaterial = new THREE.MeshBasicMaterial({
      color: "#FFE7B0",
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(footprintRadius(footprint) + 1, 48).rotateX(-Math.PI / 2),
      poolMaterial,
    );
    pool.position.set(footprint.x, 0.3, footprint.z);
    scene.add(pool);
    lightPools.push(poolMaterial);
  }

  // Buildings from OpenStreetMap footprints; windows light up at night.
  const { wall, lit } = wallTextures();
  // One texture tile is three floors tall and about four units wide.
  wall.repeat.set(1 / 4, 1 / (3 * unitsPerLevel));
  lit.repeat.copy(wall.repeat);
  const wallMaterial = new THREE.MeshLambertMaterial({
    map: wall,
    emissiveMap: lit,
    emissive: "#FFC27A",
    emissiveIntensity: 0,
  });
  const roofMaterial = new THREE.MeshLambertMaterial({ color: "#D8D2C4" });
  const buildingRings: { x: number; z: number }[][] = [];
  const buildings: THREE.Mesh[] = [];
  for (const building of campusMap.buildings) {
    const ring = building.ring.map((p) => toScene([p[0], p[1]], origin));
    buildingRings.push(ring);
    const height = (building.levels ?? defaultLevels) * unitsPerLevel;
    const geometry = new THREE.ExtrudeGeometry(shapeOf(ring), { depth: height, bevelEnabled: false });
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, [roofMaterial, wallMaterial]);
    buildings.push(mesh);
    scene.add(mesh);
  }

  // OpenStreetMap has no trees mapped here, so low-poly trees are scattered, as in v6,
  // on open campus land away from grounds and buildings.
  const trees = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.7, 0),
    new THREE.MeshLambertMaterial({ color: "#2F5A34", flatShading: true }),
    180,
  );
  const xs = campusRing.map((p) => p.x);
  const zs = campusRing.map((p) => p.z);
  const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const dummy = new THREE.Object3D();
  let count = 0;
  const groundFootprints = [...footprints.values()];
  for (let i = 0; i < 4000 && count < 180; i++) {
    const point = { x: lerp(minX, maxX, random()), z: lerp(minZ, maxZ, random()) };
    if (!contains(point, campusRing)) continue;
    if (groundFootprints.some((f) => Math.hypot(point.x - f.x, point.z - f.z) < footprintRadius(f) + 1.3))
      continue;
    if (buildingRings.some((ring) => contains(point, ring))) continue;
    const size = 0.7 + random() * 0.7;
    dummy.position.set(point.x, 0.5 * size + 0.2, point.z);
    dummy.scale.set(size, size * 1.15, size);
    dummy.rotation.y = random() * 6;
    dummy.updateMatrix();
    trees.setMatrixAt(count++, dummy.matrix);
  }
  trees.count = count;
  scene.add(trees);

  // three.js r155+ lights are physically based, so these are brighter than v6's r128 values.
  const hemisphere = new THREE.HemisphereLight("#FFE8CC", "#6B5C44", 2.2);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight("#FFD7B0", 1.2);
  sun.position.set(-36, 27, 21);
  scene.add(sun);
  const moon = new THREE.DirectionalLight("#8FA3D6", 0);
  moon.position.set(30, 45, -15);
  scene.add(moon);

  const selection = new THREE.Mesh(
    new THREE.RingGeometry(1, 1.12, 64).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: "#E3342F", transparent: true, opacity: 0, depthWrite: false }),
  );
  selection.position.y = 0.3;
  scene.add(selection);

  // Lahore light by hour: golden late afternoon, sunset about 17:40, dark by 19:00.
  const day = new THREE.Color("#E7A77A");
  const night = new THREE.Color("#141E36");
  function setHour(hour: number) {
    const dark = smooth(17.3, 19, hour < 6 ? 24 : hour);
    const sky = day.clone().lerp(night, dark);
    scene.background = sky;
    scene.fog!.color.copy(sky);
    sun.intensity = lerp(2.2, 0, dark);
    hemisphere.intensity = lerp(2.2, 0.7, dark);
    hemisphere.color.set(dark > 0.5 ? "#8FA0C8" : "#FFE8CC");
    moon.intensity = lerp(0, 0.9, dark);
    const floods = smooth(17.4, 18.4, hour < 6 ? 24 : hour);
    // Invisible effects are skipped entirely, which saves drawing them in daylight.
    lightPools.forEach((material) => {
      material.opacity = floods * 0.22;
      material.visible = floods > 0.01;
    });
    floodHeads.forEach((material) => (material.emissiveIntensity = floods * 2.2));
    beams.forEach((material) => {
      material.opacity = floods * 0.07;
      material.visible = floods > 0.01;
    });
    wallMaterial.emissiveIntensity = dark * 0.95;
  }

  return { scene, footprints, grounds, buildings, setHour, selection };
}

// An area around the campus drawn at the district level: a DHA phase, or the campus.
export type SceneArea = {
  id: string;
  name: string;
  type: string;
  boundary: GeoJSON.MultiPolygon | null;
};

// Where a padel venue's court is drawn, in scene units.
export type CourtSpot = { placeID: string; x: number; z: number };

// Padel courts are drawn 3.5 times real size so they read on the map, as v6 exaggerates
// buildings: about 80 by 45 metres with the surround. `courtScale` turns the model's
// metres into scene units.
export const courtScale = 3.5 / metresPerUnit;
// Half the court's footprint with its surround (23 by 13 metres), in scene units.
const courtHalfLength = (23 / 2) * courtScale;
const courtHalfWidth = (13 / 2) * courtScale;

// Where each venue's court goes. Venues a few dozen metres apart (the Phase 5 strip)
// would overlap at map size, so overlapping courts are pushed apart along whichever
// axis needs the smaller move, until each has room.
export function layoutCourts(venues: ScenePlace[], origin: [number, number]): CourtSpot[] {
  const spots = venues.map((venue) => ({ placeID: venue.id, ...toScene(venue.coordinates, origin) }));
  const gapX = courtHalfLength * 2 + 0.6;
  const gapZ = courtHalfWidth * 2 + 0.6;
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let i = 0; i < spots.length; i++)
      for (let j = i + 1; j < spots.length; j++) {
        const a = spots[i];
        const b = spots[j];
        const overlapX = gapX - Math.abs(b.x - a.x);
        const overlapZ = gapZ - Math.abs(b.z - a.z);
        if (overlapX <= 0 || overlapZ <= 0) continue;
        moved = true;
        if (overlapX / gapX < overlapZ / gapZ) {
          const push = (overlapX / 2) * (b.x >= a.x ? 1 : -1);
          a.x -= push;
          b.x += push;
        } else {
          const push = (overlapZ / 2) * (b.z >= a.z ? 1 : -1);
          a.z -= push;
          b.z += push;
        }
      }
    if (!moved) break;
  }
  return spots;
}

export type District = {
  group: THREE.Group;
  footprints: Map<string, Footprint>;
  courts: PadelCourts;
  setHour: (hour: number) => void;
};

// The district around the campus (DHA), as an illustrated town: the phases as softly
// tinted land, houses in planned rows with tree-lined main roads, and a padel court at
// every venue. Houses, trees and each part of the courts are instanced, so the whole
// district is a handful of draw calls.
export function buildDistrict(
  areas: SceneArea[],
  courtSpots: CourtSpot[],
  origin: [number, number],
): District {
  const group = new THREE.Group();
  const ringsOf = (area: SceneArea) =>
    area.boundary
      ? area.boundary.coordinates.map((polygon) => polygon[0].map((p) => toScene([p[0], p[1]], origin)))
      : [];
  const phaseRings = areas.filter((area) => area.type !== "campus").flatMap(ringsOf);
  const campusRings = areas.filter((area) => area.type === "campus").flatMap(ringsOf);

  if (phaseRings.length) {
    const land = new THREE.Mesh(
      mergeGeometries(phaseRings.map((ring) => new THREE.ShapeGeometry(shapeOf(ring)).rotateX(-Math.PI / 2))),
      // Between the land (4) and the campus (2), so neither flickers against it.
      new THREE.MeshLambertMaterial({
        color: "#CFC7A9",
        polygonOffset: true,
        polygonOffsetFactor: 3,
        polygonOffsetUnits: 3,
      }),
    );
    land.position.y = 0.01;
    group.add(land);
    group.add(
      new THREE.Mesh(
        mergeGeometries(phaseRings.flatMap((ring) => ribbonsAlong(ring, 1.2, 0.05))),
        new THREE.MeshLambertMaterial({ color: "#B4A784" }),
      ),
    );
  }

  // Houses in planned rows, like DHA's blocks: a regular grid of plots (about 65 by 75
  // metres) in which every sixth row and column is a main road lined with trees. Plots
  // on the campus or under a court stay empty.
  const plotX = 4.4;
  const plotZ = 5;
  let seed = 23;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const houses: { x: number; z: number; width: number; depth: number; height: number }[] = [];
  const trees: { x: number; z: number; size: number }[] = [];
  const usedPlots = new Set<string>();
  for (const ring of phaseRings) {
    const xs = ring.map((p) => p.x);
    const zs = ring.map((p) => p.z);
    for (let column = Math.ceil(Math.min(...xs) / plotX); column * plotX <= Math.max(...xs); column++)
      for (let row = Math.ceil(Math.min(...zs) / plotZ); row * plotZ <= Math.max(...zs); row++) {
        const plot = `${column},${row}`;
        const point = { x: column * plotX, z: row * plotZ };
        if (usedPlots.has(plot) || !contains(point, ring)) continue;
        usedPlots.add(plot);
        if (campusRings.some((campus) => contains(point, campus))) continue;
        const nearCourt = courtSpots.some(
          (spot) =>
            Math.abs(point.x - spot.x) < courtHalfLength + 2.5 &&
            Math.abs(point.z - spot.z) < courtHalfWidth + 2.5,
        );
        if (nearCourt) continue;
        if (column % 6 === 0 || row % 6 === 0) {
          if (random() < 0.6) trees.push({ ...point, size: 0.9 + random() * 0.5 });
          continue;
        }
        houses.push({
          x: point.x + (random() - 0.5) * 0.6,
          z: point.z + (random() - 0.5) * 0.6,
          width: 2 + random() * 0.9,
          depth: 2.4 + random() * 1,
          height: 0.8 + random() * 0.7,
        });
      }
  }

  // Each house is a block of windowed walls under a flat roof slab, as most DHA houses
  // are; a soft tint per house keeps the rows from looking cloned.
  const { wall, lit } = houseTextures();
  const houseMaterial = new THREE.MeshLambertMaterial({
    map: wall,
    emissiveMap: lit,
    emissive: "#FFC27A",
    emissiveIntensity: 0,
  });
  const walls = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    houseMaterial,
    houses.length,
  );
  const roofs = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.08, 1, 1.08).translate(0, 0.5, 0),
    new THREE.MeshLambertMaterial({ color: "#FFFFFF" }),
    houses.length,
  );
  const wallTints = ["#FFFFFF", "#F6EFE2", "#EDE8E0", "#F9F3EA", "#E8E4DC"].map((colour) => new THREE.Color(colour));
  const roofTints = ["#D8D3C9", "#CFC9BD", "#C6C0B4", "#DDD8CF"].map((colour) => new THREE.Color(colour));
  const placement = new THREE.Object3D();
  houses.forEach((house, index) => {
    placement.position.set(house.x, 0, house.z);
    placement.scale.set(house.width, house.height, house.depth);
    placement.updateMatrix();
    walls.setMatrixAt(index, placement.matrix);
    walls.setColorAt(index, wallTints[index % wallTints.length]);
    placement.position.y = house.height;
    placement.scale.y = 0.12;
    placement.updateMatrix();
    roofs.setMatrixAt(index, placement.matrix);
    roofs.setColorAt(index, roofTints[(index * 7) % roofTints.length]);
  });
  group.add(walls, roofs);

  const treeMeshes = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.7, 0),
    new THREE.MeshLambertMaterial({ color: "#3C6B3E", flatShading: true }),
    trees.length,
  );
  trees.forEach((tree, index) => {
    placement.position.set(tree.x, 0.5 * tree.size + 0.2, tree.z);
    placement.scale.set(tree.size, tree.size * 1.15, tree.size);
    placement.updateMatrix();
    treeMeshes.setMatrixAt(index, placement.matrix);
  });
  group.add(treeMeshes);

  const courts = buildPadelCourts(courtSpots, courtScale);
  group.add(courts.group);
  const footprints = new Map<string, Footprint>();
  for (const spot of courtSpots)
    footprints.set(spot.placeID, { kind: "circle", x: spot.x, z: spot.z, radius: courtHalfLength });

  // The same Lahore evening as the campus: windows warm up and the floodlights come on.
  function setHour(hour: number) {
    const dark = smooth(17.3, 19, hour < 6 ? 24 : hour);
    houseMaterial.emissiveIntensity = dark * 0.9;
    courts.setFloodlights(smooth(17.4, 18.4, hour < 6 ? 24 : hour));
  }

  return { group, footprints, courts, setHour };
}

// A floating ball over a ground with games: a football, a red tape ball for cricket, or a
// yellow padel ball.
export function makeBall(sport: string, full: boolean): THREE.Mesh {
  let ball: THREE.Mesh;
  if (sport === "padel") {
    ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.7, 32, 24),
      new THREE.MeshLambertMaterial({
        map: padelBallTexture(),
        color: full ? "#8E8A86" : "#FFFFFF",
        emissive: "#4A4A18",
      }),
    );
  } else if (sport === "cricket") {
    ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.75, 32, 24),
      new THREE.MeshLambertMaterial({
        map: tapeBallTexture(),
        color: full ? "#8E8A86" : "#FFFFFF",
        // Slightly self-lit so the ball still reads at night, as in v6.
        emissive: "#5A2A28",
      }),
    );
  } else {
    const geometry = new THREE.IcosahedronGeometry(0.85, 1);
    ball = new THREE.Mesh(
      geometry,
      new THREE.MeshLambertMaterial({
        color: full ? "#BFC3BD" : "#F7F7F2",
        emissive: "#5C5C58",
        flatShading: true,
      }),
    );
    ball.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 1), new THREE.LineBasicMaterial({ color: "#1B1F1C" })));
  }
  return ball;
}

// "You are here": a blue dot with a white rim, like the system location dot.
export function makeYouMarker(): THREE.Group {
  const marker = new THREE.Group();
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.75, 0.75, 0.12, 32),
    new THREE.MeshBasicMaterial({ color: "#FFFFFF" }),
  );
  const dot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.55, 0.14, 32),
    new THREE.MeshBasicMaterial({ color: "#2678D8" }),
  );
  marker.add(rim, dot);
  marker.position.y = 0.35;
  return marker;
}

