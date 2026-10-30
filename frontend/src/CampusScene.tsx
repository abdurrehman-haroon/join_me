import type * as GeoJSON from "geojson";
import { GLView, type ExpoWebGLRenderingContext } from "expo-gl";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import {
  ActivityIndicator,
  Animated,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from "react-native";
import * as THREE from "three";
import {
  buildCampus,
  buildDistrict,
  footprintRadius,
  makeBall,
  makeYouMarker,
  toScene,
  type CampusWorld,
  type CourtSpot,
  type District,
  type SceneArea,
  type ScenePlace,
} from "./campusModel";
import type { CameraFrame } from "./PlaceFeed";
import { cameraFlightResponse, cameraFollowResponse } from "./theme";

// A ball floating over a ground, with its label: the next game there.
export type ScenePin = {
  placeID: string;
  sport: string;
  full: boolean;
  headline: string;
  detail: string;
};

// A name on the map without a game: a venue (tappable) or an area such as a DHA phase.
export type SceneLabel = {
  id: string;
  kind: "venue" | "area";
  placeID: string | null;
  coordinates: [number, number];
  text: string;
};

// Each label's box in screen points, relative to the point it marks. The same numbers
// place the label and decide which labels overlap.
const labelBoxes = {
  pin: { left: -52, top: -46, width: 104, height: 44 },
  venue: { left: -48, top: -24, width: 96, height: 20 },
  area: { left: -60, top: -10, width: 120, height: 20 },
};
// When labels overlap, the focused game wins, then other games, venues, and areas.
const labelPriority = { focused: 0, pin: 1, venue: 2, area: 3 };

type LabelSpot = {
  x: number;
  y: number;
  visible: boolean;
  placeID: string | null;
  kind: keyof typeof labelBoxes;
};

export type CampusSceneHandle = {
  // Sets where the camera is heading; it eases there each frame. `slow` is for level changes.
  moveTo: (frame: CameraFrame, options?: { slow?: boolean }) => void;
  // Live pinch feedback: scales the camera distance (below 1 is closer); null releases it.
  pinchZoom: (scale: number | null) => void;
};

type Props = {
  ref?: Ref<CampusSceneHandle>;
  boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  origin: [number, number];
  places: ScenePlace[];
  // The area around the campus (DHA): its phases and where each venue's court goes.
  district: { areas: SceneArea[]; courts: CourtSpot[] } | null;
  pins: ScenePin[];
  labels: SceneLabel[];
  focusPlaceID: string | null;
  hour: number;
  initialFrame: CameraFrame;
  reduceMotion: boolean;
  // Explore mode: drag to turn, pinch to zoom, two fingers to pan, tap a ground.
  interactive: boolean;
  onPlacePress: (placeID: string | null) => void;
  // The device's location, shown as a blue dot when it is known.
  you: [number, number] | null;
};

type Orbit = { x: number; z: number; distance: number; tilt: number; turn: number };

const ballHeight = 2.4;
// Beyond this camera distance, balls grow with it so games stay visible from high up.
const ballGrowthDistance = 90;
// Venue names show only up close and area names only from high up, so a wide view is
// not a pile of names and few labels move each frame.
const venueLabelDistance = 150;
const areaLabelDistance = 130;
const renderScale = 0.5;
const idleFrameInterval = 33;
// How long a `slow` move (a level change) uses the slower flight spring, in milliseconds.
const slowDuration = 1600;
const orbitParts = ["x", "z", "distance", "tilt", "turn"] as const;
// Close enough to look into a padel court.
const minDistance = 10;
// Far enough out to see all of DHA (one unit is 15 metres).
const maxDistance = 1600;
const minTilt = 0.25;
const maxTilt = 1.3;
// A touch that moves less than this, and lifts quickly, is a tap.
const tapSlop = 8;
const tapDuration = 350;

type Gesture = {
  fingers: number;
  x: number;
  y: number;
  spread: number;
  startX: number;
  startY: number;
  startTime: number;
  moved: boolean;
};

function centre(event: GestureResponderEvent) {
  const touches = event.nativeEvent.touches;
  const x = touches.reduce((sum, touch) => sum + touch.pageX, 0) / touches.length;
  const y = touches.reduce((sum, touch) => sum + touch.pageY, 0) / touches.length;
  const spread =
    touches.length > 1
      ? Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY)
      : 0;
  return { fingers: touches.length, x, y, spread };
}

function orbitOf(frame: CameraFrame): Orbit {
  return { x: frame.x, z: frame.z, distance: frame.distance, tilt: frame.tilt, turn: frame.turn };
}

// Moves one part of the camera `seconds` along a critically damped spring towards `goal`.
// This is the spring's exact solution, not a step-by-step estimate, so it stays smooth
// however long a frame takes (the iOS Simulator only draws a few frames a second).
// `omega` sets the speed: 2π divided by the spring's response in seconds.
function springStep(position: number, velocity: number, goal: number, omega: number, seconds: number) {
  const offset = position - goal;
  const slope = velocity + omega * offset;
  const decay = Math.exp(-omega * seconds);
  return {
    position: goal + (offset + slope * seconds) * decay,
    velocity: (velocity - omega * slope * seconds) * decay,
  };
}

// The v6 campus as a real-time 3D scene. The story drives the camera through moveTo;
// the hour sets the sky, floodlights and windows.
export default function CampusScene({
  ref,
  boundary,
  origin,
  places,
  district,
  pins,
  labels,
  focusPlaceID,
  hour,
  initialFrame,
  reduceMotion,
  interactive,
  onPlacePress,
  you,
}: Props) {
  // The GL view is created once the screen size is known.
  const [layoutSize, setLayoutSize] = useState({ width: 0, height: 0 });
  // Set once the GL context and scene exist, so the balls can be added.
  const [sceneReady, setSceneReady] = useState(false);
  // Shaders compile on the first frame, which can take a while; a cover shows until then.
  const [drawn, setDrawn] = useState(false);
  const world = useRef<CampusWorld | null>(null);
  const districtLayer = useRef<District | null>(null);
  const camera = useRef<THREE.PerspectiveCamera | null>(null);
  const balls = useRef(new Map<string, THREE.Mesh>());
  const orbit = useRef<Orbit>(orbitOf(initialFrame));
  const goal = useRef<Orbit>(orbitOf(initialFrame));
  // How fast each part of the camera is moving, so a new goal mid-flight keeps the speed.
  const speed = useRef<Orbit>({ x: 0, z: 0, distance: 0, tilt: 0, turn: 0 });
  const slowUntil = useRef(0);
  const pinchScale = useRef(1);
  const gesture = useRef<Gesture | null>(null);
  const youMarker = useRef<THREE.Group | null>(null);
  // Where each label was last drawn, in screen points, so labels can be tapped too.
  // Pins are keyed by place ID, other labels by their own ID.
  const labelSpots = useRef(new Map<string, LabelSpot>());
  const labelGround = useRef(new Map<string, { x: number; z: number }>());
  const frameRequest = useRef<number | null>(null);
  // Label positions follow the balls on screen, updated every frame without re-rendering.
  const [labelPositions] = useState(() => new Map<string, Animated.ValueXY>());
  const [labelOpacities] = useState(() => new Map<string, Animated.Value>());
  // Values for props, read by the render loop.
  const latest = useRef({ pins, labels, district, focusPlaceID, hour, reduceMotion, size: layoutSize });
  useEffect(() => {
    latest.current = { pins, labels, district, focusPlaceID, hour, reduceMotion, size: layoutSize };
  });

  useImperativeHandle(ref, () => ({
    moveTo(frame, options) {
      goal.current = orbitOf(frame);
      // Dragging can wind the camera round many times; take the short way back.
      const full = Math.PI * 2;
      orbit.current.turn +=
        Math.round((goal.current.turn - orbit.current.turn) / full) * full;
      slowUntil.current = options?.slow ? Date.now() + slowDuration : 0;
      if (latest.current.reduceMotion) orbit.current = { ...goal.current };
    },
    pinchZoom(scale) {
      pinchScale.current = scale ?? 1;
    },
  }));

  for (const key of [...pins.map((pin) => pin.placeID), ...labels.map((label) => label.id)]) {
    if (!labelPositions.has(key)) {
      labelPositions.set(key, new Animated.ValueXY({ x: -500, y: -500 }));
      labelOpacities.set(key, new Animated.Value(0));
    }
  }

  useEffect(() => {
    world.current?.setHour(hour);
    districtLayer.current?.setHour(hour);
  }, [hour]);

  // Adds the district once its areas and courts are known, and the courts' footprints so
  // games there get a ball. Rebuilt only when the areas or court positions change.
  const districtKey = district
    ? `${district.areas.map((area) => area.id).join()}|${district.courts
        .map((court) => `${court.placeID}@${court.x.toFixed(2)},${court.z.toFixed(2)}`)
        .join()}`
    : "";
  useEffect(() => {
    const built = world.current;
    if (!built) return;
    if (districtLayer.current) {
      built.scene.remove(districtLayer.current.group);
      for (const placeID of districtLayer.current.footprints.keys()) built.footprints.delete(placeID);
      districtLayer.current = null;
    }
    const current = latest.current.district;
    if (!current) return;
    const layer = buildDistrict(current.areas, current.courts, origin);
    layer.setHour(latest.current.hour);
    built.scene.add(layer.group);
    for (const [placeID, footprint] of layer.footprints) built.footprints.set(placeID, footprint);
    districtLayer.current = layer;
    // The origin array is recreated on every parent render; its values are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [districtKey, origin[0], origin[1], sceneReady]);

  // Rebuilds the balls when the games change (not on every parent render). The district
  // key is included because venue balls need the venues' footprints.
  const pinsKey = pins.map((pin) => `${pin.placeID}:${pin.sport}:${pin.full}`).join("|");
  useEffect(() => {
    const scene = world.current?.scene;
    if (!scene) return;
    for (const ball of balls.current.values()) scene.remove(ball);
    balls.current.clear();
    labelSpots.current.clear();
    for (const pin of latest.current.pins) {
      const footprint = world.current!.footprints.get(pin.placeID);
      if (!footprint) continue;
      const ball = makeBall(pin.sport, pin.full);
      ball.position.set(footprint.x, ballHeight, footprint.z);
      ball.userData.phase = balls.current.size * 1.7;
      scene.add(ball);
      balls.current.set(pin.placeID, ball);
    }
  }, [pinsKey, districtKey, sceneReady]);

  useEffect(() => {
    const scene = world.current?.scene;
    if (!scene) return;
    if (!you) {
      if (youMarker.current) scene.remove(youMarker.current);
      youMarker.current = null;
      return;
    }
    if (!youMarker.current) {
      youMarker.current = makeYouMarker();
      scene.add(youMarker.current);
    }
    const point = toScene(you, origin);
    youMarker.current.position.x = point.x;
    youMarker.current.position.z = point.z;
  }, [you, origin, sceneReady]);

  // Finds the place under a tap: a label, a ball, or the ground or court itself.
  function placeAt(x: number, y: number): string | null {
    for (const spot of labelSpots.current.values()) {
      const box = labelBoxes[spot.kind];
      if (
        spot.visible &&
        spot.placeID &&
        x > spot.x + box.left &&
        x < spot.x + box.left + box.width &&
        y > spot.y + box.top &&
        y < spot.y + box.top + box.height
      )
        return spot.placeID;
    }
    const view = camera.current;
    const built = world.current;
    const { width, height } = latest.current.size;
    if (!view || !built || !width) return null;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2((x / width) * 2 - 1, -(y / height) * 2 + 1), view);
    // Buildings are included so a tap on a building does not select a ground behind it.
    const hit = raycaster.intersectObjects(
      [
        ...balls.current.values(),
        ...built.grounds,
        ...(districtLayer.current?.courts.pickable ?? []),
        ...built.buildings,
      ],
      false,
    )[0];
    const courts = districtLayer.current?.courts;
    if (hit && hit.instanceId !== undefined && courts?.pickable.includes(hit.object as THREE.InstancedMesh))
      return courts.placeIDs[hit.instanceId];
    if (!hit || built.buildings.includes(hit.object as THREE.Mesh)) return null;
    const ball = [...balls.current.entries()].find(([, mesh]) => mesh === hit.object);
    return ball ? ball[0] : (hit.object.userData.placeID as string);
  }

  function onGestureStart(event: GestureResponderEvent) {
    const start = centre(event);
    gesture.current = {
      ...start,
      startX: start.x,
      startY: start.y,
      startTime: Date.now(),
      moved: false,
    };
  }

  function onGestureMove(event: GestureResponderEvent) {
    const previous = gesture.current;
    if (!previous) return;
    const now = centre(event);
    // A finger was added or lifted: restart from here so nothing jumps.
    if (now.fingers !== previous.fingers) {
      gesture.current = { ...previous, ...now, moved: true };
      return;
    }
    const dx = now.x - previous.x;
    const dy = now.y - previous.y;
    if (Math.hypot(now.x - previous.startX, now.y - previous.startY) > tapSlop)
      previous.moved = true;
    const next = goal.current;
    if (now.fingers === 1) {
      next.turn -= dx * 0.006;
      next.tilt = Math.min(maxTilt, Math.max(minTilt, next.tilt + dy * 0.004));
    } else {
      if (previous.spread > 0 && now.spread > 0)
        next.distance = Math.min(
          maxDistance,
          Math.max(minDistance, (next.distance * previous.spread) / now.spread),
        );
      // Move the point looked at with the fingers, across the ground.
      const step = next.distance * 0.0018;
      const right = { x: Math.cos(next.turn), z: -Math.sin(next.turn) };
      const back = { x: Math.sin(next.turn), z: Math.cos(next.turn) };
      next.x -= right.x * dx * step + back.x * dy * step;
      next.z -= right.z * dx * step + back.z * dy * step;
    }
    slowUntil.current = 0;
    if (latest.current.reduceMotion) orbit.current = { ...next };
    gesture.current = { ...previous, ...now };
  }

  function onGestureEnd(event: GestureResponderEvent) {
    const finished = gesture.current;
    gesture.current = null;
    if (!finished || finished.moved || Date.now() - finished.startTime > tapDuration) return;
    // Page coordinates: the scene fills the screen from its top-left corner, and
    // locationX/Y would be relative to whichever label was touched.
    onPlacePress(placeAt(event.nativeEvent.pageX, event.nativeEvent.pageY));
  }

  useEffect(
    () => () => {
      if (frameRequest.current !== null) cancelAnimationFrame(frameRequest.current);
    },
    [],
  );

  function onContextCreate(gl: ExpoWebGLRenderingContext) {
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    // three.js expects a canvas; expo-gl only provides the context.
    const canvas = {
      width,
      height,
      style: {},
      addEventListener: () => {},
      removeEventListener: () => {},
      clientWidth: width,
      clientHeight: height,
      getContext: () => gl,
    } as unknown as HTMLCanvasElement;
    // expo-gl's WebGL 2 context class inherits from its WebGL 1 class, so three.js's
    // "WebGL 1 is not supported" instanceof check rejects it. Hide the WebGL 1 global
    // only while the renderer is created.
    const globals = globalThis as { WebGLRenderingContext?: unknown };
    const webGL1 = globals.WebGLRenderingContext;
    globals.WebGLRenderingContext = undefined;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        context: gl as unknown as WebGL2RenderingContext,
        antialias: false,
      });
    } finally {
      globals.WebGLRenderingContext = webGL1;
    }
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);

    const built = buildCampus(boundary, origin, places);
    world.current = built;
    built.setHour(latest.current.hour);
    // expo-gl's depth buffer is low precision; a near plane this far out keeps flat
    // layers from flickering at overview distance.
    const view = new THREE.PerspectiveCamera(42, width / height, 4, 600);
    camera.current = view;
    setSceneReady(true);

    const target = new THREE.Vector3();
    const projected = new THREE.Vector3();
    let firstFrameDone = false;
    let lastDrawn = 0;
    let lastFrame = Date.now();
    let lastReach = 1;
    const render = () => {
      frameRequest.current = requestAnimationFrame(render);
      const now = Date.now();
      const current = orbit.current;
      const next = goal.current;
      // While the camera is still, only the balls and selection ring move, so the
      // scene is drawn at most 30 times a second.
      const heading: Orbit = { ...next, distance: next.distance * pinchScale.current };
      const moving = speed.current;
      const settled =
        Math.abs(heading.x - current.x) + Math.abs(heading.z - current.z) < 0.01 &&
        Math.abs(heading.distance - current.distance) < 0.01 &&
        Math.abs(heading.tilt - current.tilt) + Math.abs(heading.turn - current.turn) < 0.001 &&
        orbitParts.every((part) => Math.abs(moving[part]) < 0.01);
      if (settled && firstFrameDone && now - lastDrawn < idleFrameInterval) return;
      lastDrawn = now;
      const seconds = Math.min(250, now - lastFrame) / 1000;
      lastFrame = now;
      // The camera follows its goal on a spring with no bounce: quick while a finger or
      // the feed drives it, slower for a flight to another level. With Reduce Motion it
      // goes straight there.
      const response = now < slowUntil.current ? cameraFlightResponse : cameraFollowResponse;
      const omega = (2 * Math.PI) / response;
      for (const part of orbitParts) {
        if (latest.current.reduceMotion) {
          current[part] = heading[part];
          moving[part] = 0;
          continue;
        }
        const step = springStep(current[part], moving[part], heading[part], omega, seconds);
        current[part] = step.position;
        moving[part] = step.velocity;
      }
      const sinTilt = Math.sin(current.tilt);
      view.position.set(
        current.x + current.distance * sinTilt * Math.sin(current.turn),
        current.distance * Math.cos(current.tilt),
        current.z + current.distance * sinTilt * Math.cos(current.turn),
      );
      view.lookAt(target.set(current.x, 0, current.z));
      // Far views (all of DHA) push the clipping planes and the fog out with the camera,
      // keeping the same depth precision and haze as the campus views.
      const reach = Math.max(1, current.distance / 100);
      if (Math.abs(reach - lastReach) > 0.02) {
        lastReach = reach;
        view.near = 4 * reach;
        view.far = 600 * reach;
        view.updateProjectionMatrix();
        const fog = built.scene.fog as THREE.Fog;
        fog.near = 80 * reach;
        fog.far = 220 * reach;
      }

      const { focusPlaceID: focus, reduceMotion: still, size: screen, labels: names } = latest.current;
      const focused = focus ? built.footprints.get(focus) : undefined;
      const material = built.selection.material as THREE.MeshBasicMaterial;
      if (focused) {
        built.selection.position.x = focused.x;
        built.selection.position.z = focused.z;
        built.selection.scale.setScalar(footprintRadius(focused) + 0.6);
        material.opacity = still ? 0.9 : 0.65 + Math.sin(now / 300) * 0.25;
      } else material.opacity = 0;

      // Where every label would sit on screen: game labels above their balls, venue and
      // area names at their points on the ground.
      const candidates: { key: string; spot: LabelSpot; priority: number }[] = [];
      const onScreen = (point: THREE.Vector3) => {
        point.project(view);
        return {
          x: ((point.x + 1) / 2) * screen.width,
          y: ((1 - point.y) / 2) * screen.height,
          visible: point.z < 1 && Math.abs(point.x) < 1.2 && Math.abs(point.y) < 1.2,
        };
      };
      const growth = Math.max(1, current.distance / ballGrowthDistance);
      for (const [placeID, ball] of balls.current) {
        ball.scale.setScalar(growth);
        ball.position.y = ballHeight * growth;
        if (!still) {
          ball.position.y += Math.sin(now / 600 + ball.userData.phase) * 0.15 * growth;
          ball.rotation.y += 0.012;
        }
        const point = onScreen(projected.set(ball.position.x, ball.position.y + 1.1, ball.position.z));
        candidates.push({
          key: placeID,
          spot: { ...point, placeID, kind: "pin" },
          priority: placeID === focus ? labelPriority.focused : labelPriority.pin,
        });
      }
      for (const label of names) {
        const shown =
          label.kind === "venue"
            ? current.distance < venueLabelDistance
            : current.distance > areaLabelDistance;
        if (!shown) {
          const last = labelSpots.current.get(label.id);
          candidates.push({
            key: label.id,
            spot: { x: last?.x ?? -500, y: last?.y ?? -500, visible: false, placeID: label.placeID, kind: label.kind },
            priority: labelPriority[label.kind],
          });
          continue;
        }
        // A venue's name sits on its court, which may be nudged from its exact point; an
        // area's name stays where it is, so it is converted to scene units once.
        let ground = (label.placeID && built.footprints.get(label.placeID)) || labelGround.current.get(label.id);
        if (!ground) {
          ground = toScene(label.coordinates, origin);
          labelGround.current.set(label.id, ground);
        }
        const point = onScreen(projected.set(ground.x, label.kind === "venue" ? 1.2 : 0, ground.z));
        candidates.push({
          key: label.id,
          spot: { ...point, placeID: label.placeID, kind: label.kind },
          priority: labelPriority[label.kind],
        });
      }
      // Hide any label that would overlap a more important one, so a dense cluster of
      // venues (DHA Phase 5) shows a few readable names instead of a pile.
      candidates.sort((a, b) => a.priority - b.priority);
      const shown: { left: number; top: number; right: number; bottom: number }[] = [];
      const spots = new Map<string, LabelSpot>();
      for (const { key, spot } of candidates) {
        const box = labelBoxes[spot.kind];
        const left = spot.x + box.left;
        const top = spot.y + box.top;
        const right = left + box.width;
        const bottom = top + box.height;
        if (spot.visible) {
          const overlaps = shown.some(
            (other) => left < other.right && right > other.left && top < other.bottom && bottom > other.top,
          );
          if (overlaps) spot.visible = false;
          else shown.push({ left, top, right, bottom });
        }
        spots.set(key, spot);
        // Only update labels that moved or appeared, so a still screen sends no native updates.
        const last = labelSpots.current.get(key);
        if (
          !last ||
          last.visible !== spot.visible ||
          Math.abs(last.x - spot.x) + Math.abs(last.y - spot.y) > 0.5
        ) {
          labelPositions.get(key)?.setValue({ x: spot.x, y: spot.y });
          labelOpacities.get(key)?.setValue(spot.visible ? 1 : 0);
        } else spots.set(key, last);
      }
      labelSpots.current = spots;

      renderer.render(built.scene, view);
      gl.endFrameEXP();
      // Waits for the GL thread to finish this frame before the next is queued, so frames
      // never pile up on a slow GPU (the iOS Simulator draws in software).
      gl.getError();
      if (!firstFrameDone) {
        firstFrameDone = true;
        setDrawn(true);
      }
    };
    render();
  }

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents={interactive ? "auto" : "none"}
      onStartShouldSetResponder={() => interactive}
      onMoveShouldSetResponder={() => interactive}
      onResponderTerminationRequest={() => false}
      onResponderGrant={onGestureStart}
      onResponderMove={onGestureMove}
      onResponderRelease={onGestureEnd}
      onResponderTerminate={() => (gesture.current = null)}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setLayoutSize({ width, height });
      }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {layoutSize.width > 0 && (
        // Rendered below screen resolution and scaled up: the flat, illustrated style
        // stays sharp enough, and phones draw a quarter of the pixels.
        <GLView
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: layoutSize.width * renderScale,
            height: layoutSize.height * renderScale,
            transformOrigin: "top left",
            transform: [{ scale: 1 / renderScale }],
          }}
          onContextCreate={onContextCreate}
          msaaSamples={0}
        />
      )}
      {pins.map((pin) => (
        <Animated.View
          key={pin.placeID}
          style={[
            styles.label,
            pin.placeID === focusPlaceID && styles.labelFocused,
            {
              opacity: labelOpacities.get(pin.placeID),
              transform: [
                ...(labelPositions.get(pin.placeID)?.getTranslateTransform() ?? []),
                // Centred, sitting just above the ball.
                { translateX: labelBoxes.pin.left },
                { translateY: labelBoxes.pin.top },
              ],
            },
          ]}
        >
          <Text style={[styles.headline, pin.full && styles.full]}>{pin.headline}</Text>
          <Text style={styles.detail} numberOfLines={1}>
            {pin.detail}
          </Text>
        </Animated.View>
      ))}
      {labels.map((label) => (
        <Animated.View
          key={label.id}
          style={[
            label.kind === "venue" ? styles.venueLabel : styles.areaLabel,
            {
              opacity: labelOpacities.get(label.id),
              transform: [
                ...(labelPositions.get(label.id)?.getTranslateTransform() ?? []),
                { translateX: labelBoxes[label.kind].left },
                { translateY: labelBoxes[label.kind].top },
              ],
            },
          ]}
        >
          <Text
            style={label.kind === "venue" ? styles.venueText : styles.areaText}
            numberOfLines={1}
          >
            {label.text}
          </Text>
        </Animated.View>
      ))}
      <Text style={styles.attribution}>Map data © OpenStreetMap contributors</Text>
      {!drawn && (
        <View style={styles.cover}>
          <ActivityIndicator color="#1D5B3A" />
          <Text style={styles.coverText}>Building the campus…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    position: "absolute",
    left: 0,
    top: 0,
    width: labelBoxes.pin.width,
    alignItems: "center",
    backgroundColor: "#F4F5F0",
    borderRadius: 12,
    paddingVertical: 3,
    paddingHorizontal: 4,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  labelFocused: { backgroundColor: "#FFFFFF", borderWidth: 2, borderColor: "#E3342F" },
  // A venue's name: a small chalk tag, like a game label without a game.
  venueLabel: {
    position: "absolute",
    left: 0,
    top: 0,
    width: labelBoxes.venue.width,
    height: labelBoxes.venue.height,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,245,240,0.92)",
    borderRadius: 10,
    paddingHorizontal: 4,
  },
  venueText: { fontSize: 10, fontWeight: "700", color: "#2F6DB5" },
  // An area's name (a DHA phase), printed on the land like a map label.
  areaLabel: {
    position: "absolute",
    left: 0,
    top: 0,
    width: labelBoxes.area.width,
    height: labelBoxes.area.height,
    alignItems: "center",
    justifyContent: "center",
  },
  areaText: {
    fontFamily: "BigShoulders",
    fontSize: 15,
    letterSpacing: 1,
    color: "rgba(21,32,27,0.62)",
    textShadowColor: "rgba(244,245,240,0.9)",
    textShadowRadius: 6,
  },
  headline: { fontFamily: "BigShoulders", fontSize: 16, lineHeight: 18, color: "#E3342F" },
  full: { color: "#5B6960" },
  detail: { fontSize: 9, fontWeight: "600", color: "#15201B" },
  cover: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#F4F5F0",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 260,
    gap: 8,
  },
  coverText: { fontSize: 13, fontWeight: "600", color: "#6C786E" },
  attribution: { position: "absolute", right: 8, bottom: 6, fontSize: 9, color: "rgba(21,32,27,0.6)" },
});
