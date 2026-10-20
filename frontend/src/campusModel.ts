import type * as GeoJSON from "geojson";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import campusMap from "../assets/lums-campus.json";
import {
  courtTexture,
  cricketTexture,
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

  const land = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 700),
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
  const ribbons: THREE.BufferGeometry[] = [];
  for (const path of campusMap.paths) {
    const points = path.map((p) => toScene([p[0], p[1]], origin));
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < 0.01) continue;
      const ribbon = new THREE.BoxGeometry(length + 0.3, 0.03, 0.32);
      ribbon.rotateY(-Math.atan2(b.z - a.z, b.x - a.x));
      ribbon.translate((a.x + b.x) / 2, 0.06, (a.z + b.z) / 2);
      ribbons.push(ribbon);
    }
  }
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

// A floating ball over a ground with games: a football, or a red tape ball for cricket.
export function makeBall(sport: string, full: boolean): THREE.Mesh {
  let ball: THREE.Mesh;
  if (sport === "cricket") {
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

