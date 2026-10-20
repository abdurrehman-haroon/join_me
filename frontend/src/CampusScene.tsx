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
  footprintRadius,
  makeBall,
  makeYouMarker,
  toScene,
  type CampusWorld,
  type ScenePlace,
} from "./campusModel";
import type { CameraFrame } from "./TonightStory";

// A ball floating over a ground, with its label: the next game there.
export type ScenePin = {
  placeID: string;
  sport: string;
  full: boolean;
  headline: string;
  detail: string;
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
  pins: ScenePin[];
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
const renderScale = 0.5;
const idleFrameInterval = 33;
// How quickly the camera catches up with where it is heading, in milliseconds. Easing
// by elapsed time (not per frame) keeps the camera with the scroll even when a slow
// GPU, like the iOS Simulator's, only manages a few frames a second.
const normalCatchUp = 90;
const slowCatchUp = 420;
const slowDuration = 1600;
const minDistance = 20;
const maxDistance = 140;
const minTilt = 0.25;
const maxTilt = 1.3;
// A touch that moves less than this, and lifts quickly, is a tap.
const tapSlop = 8;
const tapDuration = 350;
// Half the size of a label, for tapping labels as well as balls.
const labelHalfWidth = 52;
const labelHeight = 44;

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

// The v6 campus as a real-time 3D scene. The story drives the camera through moveTo;
// the hour sets the sky, floodlights and windows.
export default function CampusScene({
  ref,
  boundary,
  origin,
  places,
  pins,
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
  const camera = useRef<THREE.PerspectiveCamera | null>(null);
  const balls = useRef(new Map<string, THREE.Mesh>());
  const orbit = useRef<Orbit>(orbitOf(initialFrame));
  const goal = useRef<Orbit>(orbitOf(initialFrame));
  const slowUntil = useRef(0);
  const pinchScale = useRef(1);
  const gesture = useRef<Gesture | null>(null);
  const youMarker = useRef<THREE.Group | null>(null);
  // Where each label was last drawn, in screen points, so labels can be tapped too.
  const labelSpots = useRef(new Map<string, { x: number; y: number; visible: boolean }>());
  const frameRequest = useRef<number | null>(null);
  // Label positions follow the balls on screen, updated every frame without re-rendering.
  const [labelPositions] = useState(() => new Map<string, Animated.ValueXY>());
  const [labelOpacities] = useState(() => new Map<string, Animated.Value>());
  // Values for props, read by the render loop.
  const latest = useRef({ pins, focusPlaceID, hour, reduceMotion, size: layoutSize });
  useEffect(() => {
    latest.current = { pins, focusPlaceID, hour, reduceMotion, size: layoutSize };
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

  for (const pin of pins) {
    if (!labelPositions.has(pin.placeID)) {
      labelPositions.set(pin.placeID, new Animated.ValueXY({ x: -500, y: -500 }));
      labelOpacities.set(pin.placeID, new Animated.Value(0));
    }
  }

  useEffect(() => {
    world.current?.setHour(hour);
  }, [hour]);

  // Rebuilds the balls when the games change (not on every parent render).
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
  }, [pinsKey, sceneReady]);

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

  // Finds the ground under a tap: a label, a ball, or the ground itself.
  function placeAt(x: number, y: number): string | null {
    for (const [placeID, spot] of labelSpots.current)
      if (
        spot.visible &&
        Math.abs(x - spot.x) < labelHalfWidth &&
        y > spot.y - labelHeight &&
        y < spot.y
      )
        return placeID;
    const view = camera.current;
    const built = world.current;
    const { width, height } = latest.current.size;
    if (!view || !built || !width) return null;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2((x / width) * 2 - 1, -(y / height) * 2 + 1), view);
    // Buildings are included so a tap on a building does not select a ground behind it.
    const hit = raycaster.intersectObjects(
      [...balls.current.values(), ...built.grounds, ...built.buildings],
      false,
    )[0];
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
    const render = () => {
      frameRequest.current = requestAnimationFrame(render);
      const now = Date.now();
      const current = orbit.current;
      const next = goal.current;
      // While the camera is still, only the balls and selection ring move, so the
      // scene is drawn at most 30 times a second.
      const targetDistance = next.distance * pinchScale.current;
      const settled =
        Math.abs(next.x - current.x) + Math.abs(next.z - current.z) < 0.01 &&
        Math.abs(targetDistance - current.distance) < 0.01 &&
        Math.abs(next.tilt - current.tilt) + Math.abs(next.turn - current.turn) < 0.001;
      if (settled && firstFrameDone && now - lastDrawn < idleFrameInterval) return;
      lastDrawn = now;
      const elapsed = Math.min(250, now - lastFrame);
      lastFrame = now;
      const catchUp = now < slowUntil.current ? slowCatchUp : normalCatchUp;
      const ease = latest.current.reduceMotion ? 1 : 1 - Math.exp(-elapsed / catchUp);
      current.x += (next.x - current.x) * ease;
      current.z += (next.z - current.z) * ease;
      current.distance += (targetDistance - current.distance) * ease;
      current.tilt += (next.tilt - current.tilt) * ease;
      current.turn += (next.turn - current.turn) * ease;
      const sinTilt = Math.sin(current.tilt);
      view.position.set(
        current.x + current.distance * sinTilt * Math.sin(current.turn),
        current.distance * Math.cos(current.tilt),
        current.z + current.distance * sinTilt * Math.cos(current.turn),
      );
      view.lookAt(target.set(current.x, 0, current.z));

      const { focusPlaceID: focus, reduceMotion: still, size: screen } = latest.current;
      const focused = focus ? built.footprints.get(focus) : undefined;
      const material = built.selection.material as THREE.MeshBasicMaterial;
      if (focused) {
        built.selection.position.x = focused.x;
        built.selection.position.z = focused.z;
        built.selection.scale.setScalar(footprintRadius(focused) + 0.6);
        material.opacity = still ? 0.9 : 0.65 + Math.sin(now / 300) * 0.25;
      } else material.opacity = 0;

      for (const [placeID, ball] of balls.current) {
        if (!still) {
          ball.position.y = ballHeight + Math.sin(now / 600 + ball.userData.phase) * 0.15;
          ball.rotation.y += 0.012;
        }
        projected.set(ball.position.x, ball.position.y + 1.1, ball.position.z).project(view);
        const visible = projected.z < 1 && Math.abs(projected.x) < 1.2 && Math.abs(projected.y) < 1.2;
        const spot = {
          x: ((projected.x + 1) / 2) * screen.width,
          y: ((1 - projected.y) / 2) * screen.height,
          visible,
        };
        // Only update labels that moved, so a still screen sends no native updates.
        const last = labelSpots.current.get(placeID);
        if (
          !last ||
          last.visible !== visible ||
          Math.abs(last.x - spot.x) + Math.abs(last.y - spot.y) > 0.5
        ) {
          labelSpots.current.set(placeID, spot);
          labelPositions.get(placeID)?.setValue({ x: spot.x, y: spot.y });
          labelOpacities.get(placeID)?.setValue(visible ? 1 : 0);
        }
      }

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
                { translateX: -52 },
                { translateY: -46 },
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
      <Text style={styles.attribution}>Buildings © OpenStreetMap contributors</Text>
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
    width: 104,
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
