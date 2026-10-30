import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { padelTurfTexture } from "./sceneTextures";

// One padel court, modelled once in metres and drawn at every venue with instancing, so
// each material is a single draw call however many venues there are. The court follows
// the regulation layout: 20 by 10 metres of turf inside glass back walls 3 m high with
// 1 m of mesh above, side walls of glass near the ends and mesh in the middle, a net
// 0.88 m high, a black steel frame and four floodlight masts.

export type PadelCourts = {
  group: THREE.Group;
  // Tappable meshes: a hit's instanceId indexes `placeIDs`.
  pickable: THREE.InstancedMesh[];
  placeIDs: string[];
  // 0 by day to 1 at night: the floodlights' glow and the light on the turf.
  setFloodlights: (floods: number) => void;
};

// The turf's surface, in metres above the ground: the court stands on a low plinth, so it
// sits cleanly above roads and borders drawn on the ground.
const floor = 0.65;

// A box in metres, from its centre and size.
function box(x: number, y: number, z: number, width: number, height: number, depth: number) {
  return new THREE.BoxGeometry(width, height, depth).translate(x, y, z);
}

// Every combination of +1 and -1 for the two ends (x) and the two sides (z).
const ends = [-1, 1];
const corners = ends.flatMap((sx) => ends.map((sz) => [sx, sz]));

function courtParts() {
  const apron = [box(0, 0.3, 0, 23.4, 0.6, 13.4)];
  const turf = [box(0, floor - 0.025, 0, 20, 0.05, 10)];

  const glass: THREE.BufferGeometry[] = [];
  const mesh: THREE.BufferGeometry[] = [];
  for (const sx of ends) {
    // Back wall: glass, with mesh above it.
    glass.push(box(sx * 10, floor + 1.5, 0, 0.06, 3, 10));
    mesh.push(box(sx * 10, floor + 3.5, 0, 0.04, 1, 10));
  }
  for (const [sx, sz] of corners) {
    // Side walls: 2 m of tall glass at each end, then 2 m of lower glass.
    glass.push(box(sx * 9, floor + 1.5, sz * 5, 2, 3, 0.06));
    mesh.push(box(sx * 9, floor + 3.5, sz * 5, 2, 1, 0.04));
    glass.push(box(sx * 7, floor + 1, sz * 5, 2, 2, 0.06));
    mesh.push(box(sx * 7, floor + 2.5, sz * 5, 2, 1, 0.04));
  }
  for (const sz of ends) mesh.push(box(0, floor + 1.5, sz * 5, 12, 3, 0.04));
  // The net is mesh too, with white tape along the top.
  mesh.push(box(0, floor + 0.44, 0, 0.03, 0.88, 10));
  const tape = [box(0, floor + 0.9, 0, 0.05, 0.06, 10.1)];

  const steel: THREE.BufferGeometry[] = [];
  for (const sx of ends) {
    for (const z of [-5, -3, -1, 1, 3, 5]) steel.push(box(sx * 10, floor + 2, z, 0.1, 4, 0.1));
    steel.push(box(sx * 10, floor + 4, 0, 0.1, 0.1, 10));
    steel.push(box(sx * 10, floor + 3, 0, 0.08, 0.08, 10));
  }
  for (const sz of ends) {
    for (let x = -10; x <= 10; x += 2) {
      const height = Math.abs(x) >= 8 ? 4 : 3;
      steel.push(box(x, floor + height / 2, sz * 5, 0.1, height, 0.1));
    }
    steel.push(box(0, floor + 3, sz * 5, 16, 0.1, 0.1));
    for (const sx of ends) steel.push(box(sx * 9, floor + 4, sz * 5, 2, 0.1, 0.1));
    steel.push(box(0, floor + 0.5, sz * 5.05, 0.09, 1, 0.09));
  }

  // Floodlight masts outside the side walls, each with an arm and an LED head over the court.
  const lamps: THREE.BufferGeometry[] = [];
  for (const [sx, sz] of corners) {
    steel.push(box(sx * 6.5, floor + 3.2, sz * 5.7, 0.14, 6.4, 0.14));
    steel.push(box(sx * 6.5, floor + 6.35, sz * 5.2, 0.1, 0.1, 1.1));
    lamps.push(box(sx * 6.5, floor + 6.25, sz * 4.7, 0.9, 0.16, 0.5));
  }

  const pool = [new THREE.PlaneGeometry(22, 12).rotateX(-Math.PI / 2).translate(0, floor + 0.03, 0)];

  return { apron, turf, glass, mesh, tape, steel, lamps, pool };
}

// Courts at the given points (scene units), all facing the same way. `scale` converts
// the model's metres to scene units, including any exaggeration for the map.
export function buildPadelCourts(
  spots: { placeID: string; x: number; z: number }[],
  scale: number,
): PadelCourts {
  const parts = courtParts();
  const lampMaterial = new THREE.MeshLambertMaterial({
    color: "#F4F1E4",
    emissive: "#FFF4D2",
    emissiveIntensity: 0,
  });
  const poolMaterial = new THREE.MeshBasicMaterial({
    color: "#DDEBFF",
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  // Under floodlights the turf and its lines glow, so lit courts stand out from high up.
  const turfTexture = padelTurfTexture();
  const turfMaterial = new THREE.MeshLambertMaterial({
    map: turfTexture,
    emissiveMap: turfTexture,
    emissive: "#FFFFFF",
    emissiveIntensity: 0,
  });
  const materials: Record<keyof typeof parts, THREE.Material> = {
    apron: new THREE.MeshLambertMaterial({ color: "#3B4148" }),
    turf: turfMaterial,
    // Glass and mesh are see-through, so they never write depth and never hide the turf.
    glass: new THREE.MeshLambertMaterial({
      color: "#D8F2FF",
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    mesh: new THREE.MeshLambertMaterial({
      color: "#151A1F",
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    tape: new THREE.MeshLambertMaterial({ color: "#F6F7F8" }),
    steel: new THREE.MeshLambertMaterial({ color: "#1C2025" }),
    lamps: lampMaterial,
    pool: poolMaterial,
  };

  const group = new THREE.Group();
  const placement = new THREE.Object3D();
  const instanced: Partial<Record<keyof typeof parts, THREE.InstancedMesh>> = {};
  for (const name of Object.keys(parts) as (keyof typeof parts)[]) {
    const courts = new THREE.InstancedMesh(mergeGeometries(parts[name]), materials[name], spots.length);
    spots.forEach((spot, index) => {
      placement.position.set(spot.x, 0, spot.z);
      placement.scale.setScalar(scale);
      placement.updateMatrix();
      courts.setMatrixAt(index, placement.matrix);
    });
    // The light pool is drawn last, over the turf.
    if (name === "pool") courts.renderOrder = 1;
    group.add(courts);
    instanced[name] = courts;
  }

  return {
    group,
    pickable: [instanced.apron!, instanced.turf!],
    placeIDs: spots.map((spot) => spot.placeID),
    setFloodlights(floods) {
      lampMaterial.emissiveIntensity = floods * 2.4;
      turfMaterial.emissiveIntensity = floods * 0.6;
      poolMaterial.opacity = floods * 0.3;
      poolMaterial.visible = floods > 0.01;
    },
  };
}
