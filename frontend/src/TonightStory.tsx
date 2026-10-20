import { useEffect, useRef, useState } from "react";
import {
  Animated,
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { EventSummary } from "./EventDetails";

// One camera position in the story, as an orbit around a point on the 3D campus.
// The camera moves between these as the user scrolls.
export type CameraFrame = {
  // The point looked at, in scene units.
  x: number;
  z: number;
  distance: number;
  // Angle from straight down, in radians.
  tilt: number;
  // Angle around the point, in radians.
  turn: number;
  // The time of day shown by the map's light at this point in the story.
  time: number;
};

export type StoryLevel = {
  // Breadcrumb from the widest level to this one, e.g. Lahore › LUMS › Football Field.
  path: { label: string; onPress: (() => void) | null }[];
  kicker: string;
  // Shown small in the top bar once the big word has lifted away.
  heading: string;
  word: string;
  subtitle: string;
  events: EventSummary[];
  // frames[0] is the overview above the hero, then one per event, then the end card.
  frames: CameraFrame[];
  // Shown at the bottom of the story, after the last game.
  end: { title: string; body: string; action: string; onAction: () => void };
  canZoomOut: boolean;
};

type Props = {
  level: StoryLevel;
  // Top-to-bottom depth of the zoom rail; the current level is filled.
  depth: number;
  levelCount: number;
  reduceMotion: boolean;
  // Which way the user just moved between levels, for the dive or pull-back entrance.
  entrance: "in" | "out" | null;
  // Sport filter, only shown at the campus level.
  filter: React.ReactNode;
  onCameraFrame: (frame: CameraFrame) => void;
  onActiveEventChange: (event: EventSummary | null) => void;
  // Called with the game in focus when the user pinches out or taps +.
  onZoomIn: ((event: EventSummary) => void) | null;
  onZoomOut: () => void;
  // Live pinch on the story: the spread so far (above 1 is pinching out), or null when released.
  onPinch: (spread: number | null) => void;
  onOpenEvent: (event: EventSummary) => void;
  onExplore: () => void;
};

const filterHeight = 56;
const maxTitleSize = 220;
const zoomCooldown = 900;
// Keeps the big title clear of the zoom rail on the right.
const zoomRailSpace = 64;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function lerp(from: number, to: number, t: number) {
  return from + (to - from) * t;
}

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

// Turns wrap at a full circle; always turn the short way round.
function lerpTurn(from: number, to: number, t: number) {
  const full = Math.PI * 2;
  const turn = ((((to - from) % full) + full * 1.5) % full) - full / 2;
  return from + turn * t;
}

function touchDistance(event: GestureResponderEvent) {
  const [a, b] = event.nativeEvent.touches;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

// The home screen: tonight's games as a vertical story over the 3D map. Scrolling
// moves the camera from ground to ground and later in the evening; pinching or the
// zoom rail moves between levels (campus and a single ground).
export default function TonightStory({
  level,
  depth,
  levelCount,
  reduceMotion,
  entrance,
  filter,
  onCameraFrame,
  onActiveEventChange,
  onZoomIn,
  onZoomOut,
  onPinch,
  onOpenEvent,
  onExplore,
}: Props) {
  const [height, setHeight] = useState(0);
  const [width, setWidth] = useState(0);
  const [titleWidthAt100, setTitleWidthAt100] = useState(0);
  // Updated by the native driver while scrolling, without re-rendering.
  const [scrollY] = useState(() => new Animated.Value(0));
  const [clock, setClock] = useState(() => level.frames[0]?.time ?? Date.now());
  const [activeIndex, setActiveIndex] = useState(-1);
  // The camera frame the scroll position is closest to.
  const [nearestFrame, setNearestFrame] = useState(0);
  const pinchStart = useRef<number | null>(null);
  const lastZoom = useRef(0);
  const [arrival] = useState(() => new Animated.Value(entrance && !reduceMotion ? 0 : 1));

  useEffect(() => {
    Animated.timing(arrival, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();
  }, [arrival]);

  const showFilter = filter !== null;
  const heroHeight = Math.round(height * 0.66);
  const chapterHeight = Math.round(height * 0.58);
  // Where on screen a card sits when its ground is the one in view.
  const focusY = height * 0.68;
  const storyTop = heroHeight + (showFilter ? filterHeight : 0);
  const cardCentres = [...level.events.map((_, index) => index), level.events.length].map(
    (index) => storyTop + index * chapterHeight + chapterHeight / 2,
  );
  // Scroll offsets at which each camera frame is reached exactly.
  const anchors = [0];
  for (const centre of cardCentres)
    anchors.push(Math.max(anchors[anchors.length - 1] + 1, centre - focusY));
  const titleSize = titleWidthAt100
    ? Math.min(maxTitleSize, (100 * (width - 16 - zoomRailSpace)) / titleWidthAt100)
    : 0;
  const titleLift = heroHeight * 0.7;
  const letters = level.word.split("");

  function frameAt(offset: number): { frame: CameraFrame; nearest: number } {
    const frames = level.frames;
    let segment = 0;
    while (segment < anchors.length - 2 && offset >= anchors[segment + 1]) segment++;
    const t = clamp(
      (offset - anchors[segment]) / (anchors[segment + 1] - anchors[segment]),
      0,
      1,
    );
    // Hold still near each card, then travel; a small lift between two grounds.
    const travel = easeInOut(clamp((t - 0.12) / 0.76, 0, 1));
    const from = frames[segment];
    const to = frames[segment + 1];
    const betweenGrounds = segment > 0 && segment < frames.length - 2;
    const lift = betweenGrounds
      ? Math.sin(Math.PI * travel) * Math.min(from.distance, to.distance) * 0.2
      : 0;
    const nearest = t < 0.5 ? segment : segment + 1;
    if (reduceMotion) return { frame: frames[nearest], nearest };
    return {
      nearest,
      frame: {
        x: lerp(from.x, to.x, travel),
        z: lerp(from.z, to.z, travel),
        distance: lerp(from.distance, to.distance, travel) + lift,
        tilt: lerp(from.tilt, to.tilt, travel),
        turn: lerpTurn(from.turn, to.turn, travel),
        time: lerp(from.time, to.time, t),
      },
    };
  }

  function followScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (!height || level.frames.length < 2) return;
    const offset = event.nativeEvent.contentOffset.y;
    const { frame, nearest } = frameAt(offset);
    // With Reduce Motion the camera cuts between frames instead of travelling.
    if (!reduceMotion || nearest !== nearestFrame) onCameraFrame(frame);
    if (nearest !== nearestFrame) setNearestFrame(nearest);
    // The clock moves in five-minute steps so the screen is not re-rendered every frame.
    const step = Math.round(frame.time / 300000) * 300000;
    if (step !== clock) setClock(step);
    const close = Math.abs(offset - anchors[nearest]) < height * 0.32;
    const index = close && nearest > 0 && nearest <= level.events.length ? nearest - 1 : -1;
    if (index !== activeIndex) {
      setActiveIndex(index);
      onActiveEventChange(index >= 0 ? level.events[index] : null);
    }
  }

  const focusedEvent = level.events[activeIndex >= 0 ? activeIndex : 0] ?? null;
  function zoomStep(direction: 1 | -1) {
    const now = Date.now();
    if (now - lastZoom.current < zoomCooldown) return;
    lastZoom.current = now;
    if (direction > 0 && onZoomIn && focusedEvent) onZoomIn(focusedEvent);
    if (direction < 0 && level.canZoomOut) onZoomOut();
  }

  function endPinch() {
    if (pinchStart.current === null) return;
    pinchStart.current = null;
    onPinch(null);
  }

  // The camera follows the fingers while pinching; past a threshold it changes level.
  function onTouchMove(event: GestureResponderEvent) {
    if (event.nativeEvent.touches.length !== 2) {
      endPinch();
      return;
    }
    const distance = touchDistance(event);
    if (pinchStart.current === null) {
      pinchStart.current = distance;
      return;
    }
    const ratio = distance / pinchStart.current;
    onPinch(ratio);
    if (ratio > 1.35 || ratio < 0.72) {
      endPinch();
      zoomStep(ratio > 1 ? 1 : -1);
    }
  }

  // Cards lie back below the focus line and stand up as they reach it, then fade out above.
  function cardMotion(centre: number) {
    const reached = centre - focusY;
    const at = (distance: number) => reached - distance * height;
    const opacity = scrollY.interpolate({
      inputRange: [at(0.66), at(0.16), at(-0.28), at(-0.55)],
      outputRange: [0.28, 1, 1, 0],
      extrapolate: "clamp",
    });
    if (reduceMotion) return { opacity };
    return {
      opacity,
      transform: [
        { perspective: 900 },
        {
          translateY: scrollY.interpolate({
            inputRange: [at(1), at(0)],
            outputRange: [36, 0],
            extrapolate: "clamp",
          }),
        },
        {
          rotateX: scrollY.interpolate({
            inputRange: [at(0.5), at(0), at(-0.46)],
            outputRange: ["40deg", "0deg", "-12deg"],
            extrapolate: "clamp",
          }),
        },
        {
          scale: scrollY.interpolate({
            inputRange: [at(0.6), at(0), at(-0.6)],
            outputRange: [0.88, 1, 0.88],
            extrapolate: "clamp",
          }),
        },
      ],
    };
  }

  const clockLabel = new Date(clock).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        {
          // Diving in, the new level grows into place; pulling back, it settles down from larger.
          opacity: arrival,
          transform: [
            {
              scale: arrival.interpolate({
                inputRange: [0, 1],
                outputRange: [entrance === "out" ? 1.08 : 0.9, 1],
              }),
            },
          ],
        },
      ]}
      onLayout={(event) => {
        setHeight(event.nativeEvent.layout.height);
        setWidth(event.nativeEvent.layout.width);
      }}
    >
      {/* Measures the title once at 100pt so it can be scaled to fill the width. */}
      <View
        style={styles.measure}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Text
          style={[styles.title, { fontSize: 100, lineHeight: 100 }]}
          onLayout={(event) => setTitleWidthAt100(event.nativeEvent.layout.width)}
        >
          {level.word}
        </Text>
      </View>
      {height > 0 && titleSize > 0 && (
        <Animated.ScrollView
          showsVerticalScrollIndicator={false}
          // Settle on each game, so its ground is framed above its card.
          snapToOffsets={anchors}
          snapToEnd={false}
          decelerationRate="fast"
          scrollEventThrottle={16}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: scrollY } } }],
            { useNativeDriver: true, listener: followScroll },
          )}
          onTouchMove={onTouchMove}
          onTouchEnd={endPinch}
          onTouchCancel={endPinch}
          accessibilityLabel="Tonight's games. Scroll to move through the map."
        >
          <View style={[styles.hero, { height: heroHeight }]}>
            <Animated.View
              style={{
                opacity: scrollY.interpolate({
                  inputRange: [0, titleLift / 1.3],
                  outputRange: [1, 0],
                  extrapolate: "clamp",
                }),
              }}
            >
              <Animated.Text
                style={[
                  styles.kicker,
                  !reduceMotion && {
                    transform: [
                      {
                        translateY: scrollY.interpolate({
                          inputRange: [0, titleLift],
                          outputRange: [0, -30],
                          extrapolate: "clamp",
                        }),
                      },
                    ],
                  },
                ]}
              >
                {level.kicker}
              </Animated.Text>
              <View
                style={styles.titleRow}
                accessible
                accessibilityRole="header"
                accessibilityLabel={`${level.kicker} ${level.word}`}
              >
                {letters.map((letter, index) => (
                  <Animated.Text
                    key={`${letter}${index}`}
                    style={[
                      styles.title,
                      { fontSize: titleSize, lineHeight: titleSize },
                      !reduceMotion && {
                        transform: [
                          {
                            translateY: scrollY.interpolate({
                              inputRange: [0, titleLift],
                              outputRange: [0, -(26 + index * 22)],
                              extrapolate: "clamp",
                            }),
                          },
                          {
                            rotate: scrollY.interpolate({
                              inputRange: [0, titleLift],
                              outputRange: [
                                "0deg",
                                `${(index - (letters.length - 1) / 2) * 3}deg`,
                              ],
                              extrapolate: "clamp",
                            }),
                          },
                        ],
                      },
                    ]}
                  >
                    {letter === " " ? " " : letter}
                  </Animated.Text>
                ))}
              </View>
              <Text style={styles.subtitle}>{level.subtitle}</Text>
              <Text style={styles.hint}>↓ Scroll</Text>
            </Animated.View>
          </View>
          {showFilter && <View style={styles.filter}>{filter}</View>}
          {level.events.map((event, index) => {
            const startsAt = new Date(event.starts_at);
            const spotsLabel = event.is_full
              ? "Game is full"
              : event.available_spots === 1
                ? "Last spot"
                : "spots left";
            return (
              <View key={event.id} style={[styles.chapter, { height: chapterHeight }]}>
                <Animated.View style={[styles.card, cardMotion(cardCentres[index])]}>
                  <View style={styles.cardTop}>
                    <Text style={styles.sport}>
                      {event.type === "cricket" ? "Tape-ball" : "Football"} · {event.title}
                    </Text>
                    <Text style={styles.time}>
                      {startsAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    </Text>
                  </View>
                  <Text style={styles.ground} numberOfLines={1}>
                    {event.place.name}
                  </Text>
                  <View style={styles.cardMiddle}>
                    <Text style={[styles.spots, event.is_full && styles.spotsFull]}>
                      {event.is_full ? "Full" : event.available_spots}
                    </Text>
                    <View style={styles.spotsText}>
                      <Text style={styles.spotsLabel}>{spotsLabel}</Text>
                      <Text style={styles.going}>
                        {event.participant_count} of {event.capacity} in ·{" "}
                        {startsAt.toLocaleDateString([], { weekday: "short" })}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.actions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${event.title} at ${event.place.name}`}
                      onPress={() => onOpenEvent(event)}
                      style={[styles.button, styles.primary]}
                    >
                      <Text style={styles.primaryText}>
                        {event.is_full ? "See game" : "Join game"}
                      </Text>
                    </Pressable>
                    {onZoomIn && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Zoom in to ${event.place.name}`}
                        onPress={() => onZoomIn(event)}
                        style={[styles.button, styles.ghost]}
                      >
                        <Text style={styles.ghostText}>Zoom in</Text>
                      </Pressable>
                    )}
                  </View>
                </Animated.View>
              </View>
            );
          })}
          <View style={[styles.chapter, { height: chapterHeight }]}>
            <Animated.View
              style={[styles.card, cardMotion(cardCentres[level.events.length])]}
            >
              <Text style={styles.ground}>{level.end.title}</Text>
              <Text style={styles.body}>{level.end.body}</Text>
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={level.end.onAction}
                  style={[styles.button, styles.primary]}
                >
                  <Text style={styles.primaryText}>{level.end.action}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={onExplore}
                  style={[styles.button, styles.ghost]}
                >
                  <Text style={styles.ghostText}>Explore the map</Text>
                </Pressable>
              </View>
            </Animated.View>
          </View>
          <View style={{ height: Math.round(height * 0.36) }} />
        </Animated.ScrollView>
      )}

      {/* Top bar: breadcrumb, and a compact title once the big one has lifted away. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.topFade,
          {
            opacity: scrollY.interpolate({
              inputRange: [0, 140],
              outputRange: [0, 1],
              extrapolate: "clamp",
            }),
          },
        ]}
      />
      <View style={styles.topBar} pointerEvents="box-none">
        <View style={styles.crumbs} accessibilityRole="toolbar" accessibilityLabel="Where you are">
          {level.path.map((part, index) => {
            const current = index === level.path.length - 1;
            return (
              <View key={part.label} style={styles.crumb}>
                {index > 0 && <Text style={styles.crumbSeparator}>›</Text>}
                {current || !part.onPress ? (
                  <Text
                    style={current ? styles.crumbCurrent : styles.crumbMuted}
                    accessibilityRole={current ? "text" : undefined}
                  >
                    {part.label}
                  </Text>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Zoom out to ${part.label}`}
                    onPress={part.onPress}
                    hitSlop={8}
                  >
                    <Text style={styles.crumbLink}>{part.label}</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
        {height > 0 && (
          <Animated.View
            style={[
              styles.compactTitle,
              {
                opacity: scrollY.interpolate({
                  inputRange: [titleLift * 0.55, titleLift * 0.9],
                  outputRange: [0, 1],
                  extrapolate: "clamp",
                }),
              },
            ]}
            pointerEvents="none"
          >
            <Text style={styles.compactWord}>{level.heading}</Text>
            <Text style={styles.compactClock}>{clockLabel}</Text>
          </Animated.View>
        )}
      </View>

      <View style={styles.zoomRail} accessibilityRole="toolbar" accessibilityLabel="Zoom level">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            onZoomIn && focusedEvent ? `Zoom in to ${focusedEvent.place.name}` : "Nothing closer here"
          }
          accessibilityState={{ disabled: !onZoomIn || !focusedEvent }}
          disabled={!onZoomIn || !focusedEvent}
          onPress={() => zoomStep(1)}
          style={[styles.zoomButton, (!onZoomIn || !focusedEvent) && styles.disabled]}
        >
          <Text style={styles.zoomText}>+</Text>
        </Pressable>
        {Array.from({ length: levelCount }, (_, index) => (
          <View key={index} style={[styles.dot, index === depth && styles.dotOn]} />
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={level.canZoomOut ? "Zoom out" : "Already at the widest view"}
          accessibilityState={{ disabled: !level.canZoomOut }}
          disabled={!level.canZoomOut}
          onPress={() => zoomStep(-1)}
          style={[styles.zoomButton, !level.canZoomOut && styles.disabled]}
        >
          <Text style={styles.zoomText}>−</Text>
        </Pressable>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Explore the map"
        onPress={onExplore}
        style={styles.explore}
      >
        <Text style={styles.exploreIcon}>⬡</Text>
        <Text style={styles.exploreText}>Map</Text>
      </Pressable>
    </Animated.View>
  );
}

const ink = "#15201B";
const chalk = "#F4F5F0";
const muted = "#6C786E";
const turf = "#1D5B3A";
const tape = "#E3342F";

const styles = StyleSheet.create({
  // Wide enough that the title never wraps while being measured.
  measure: { position: "absolute", opacity: 0, left: -10000, width: 4000, flexDirection: "row" },
  hero: { justifyContent: "flex-start", paddingTop: 104, paddingHorizontal: 16 },
  kicker: { fontSize: 17, fontWeight: "700", color: ink },
  titleRow: { flexDirection: "row", marginTop: 4, marginBottom: 6 },
  title: { fontFamily: "BigShoulders", color: ink },
  subtitle: {
    fontSize: 15,
    fontWeight: "600",
    color: ink,
    lineHeight: 21,
    maxWidth: 320,
    textShadowColor: "rgba(244,245,240,0.95)",
    textShadowRadius: 10,
  },
  hint: { marginTop: 14, fontSize: 13, fontWeight: "700", color: "rgba(21,32,27,0.7)" },
  filter: { height: filterHeight, justifyContent: "center", paddingHorizontal: 16 },
  chapter: { justifyContent: "center", paddingHorizontal: 16 },
  card: {
    backgroundColor: chalk,
    borderRadius: 24,
    padding: 18,
    gap: 6,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  sport: { flexShrink: 1, fontSize: 13, fontWeight: "700", color: turf },
  time: { fontSize: 13, fontWeight: "700", color: ink },
  ground: { fontFamily: "BigShoulders", fontSize: 34, lineHeight: 38, color: ink },
  cardMiddle: { flexDirection: "row", alignItems: "flex-end", gap: 10 },
  spots: { fontFamily: "BigShoulders", fontSize: 64, lineHeight: 64, color: tape },
  spotsFull: { color: muted, fontSize: 44, lineHeight: 50 },
  spotsText: { paddingBottom: 8, flexShrink: 1 },
  spotsLabel: { fontFamily: "BigShoulders", fontSize: 22, color: ink },
  going: { fontSize: 13, color: muted },
  body: { fontSize: 15, lineHeight: 21, color: ink },
  actions: { flexDirection: "row", gap: 10, marginTop: 6 },
  button: { borderRadius: 16, paddingVertical: 12, paddingHorizontal: 18 },
  primary: { backgroundColor: turf },
  primaryText: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 },
  ghost: { backgroundColor: "#E5E9DF" },
  ghostText: { color: turf, fontWeight: "700", fontSize: 15 },
  topFade: { position: "absolute", top: 0, left: 0, right: 0, height: 108, backgroundColor: chalk },
  topBar: {
    position: "absolute",
    top: 58,
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  crumbs: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: chalk,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  crumb: { flexDirection: "row", alignItems: "center" },
  crumbSeparator: { color: "#9AA49D", marginHorizontal: 5, fontSize: 14 },
  crumbMuted: { color: "#9AA49D", fontSize: 14, fontWeight: "600" },
  crumbLink: { color: muted, fontSize: 14, fontWeight: "600", textDecorationLine: "underline" },
  crumbCurrent: { color: ink, fontSize: 14, fontWeight: "700" },
  compactTitle: { alignItems: "flex-end" },
  compactWord: { fontSize: 16, fontWeight: "700", color: ink },
  compactClock: { fontSize: 12, color: muted },
  zoomRail: {
    position: "absolute",
    right: 12,
    top: 118,
    alignItems: "center",
    gap: 6,
    backgroundColor: chalk,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 5,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
  zoomButton: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: "#E5E9DF",
    alignItems: "center",
    justifyContent: "center",
  },
  zoomText: { fontSize: 22, fontWeight: "600", color: ink, lineHeight: 26 },
  disabled: { opacity: 0.35 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#C3CBC2" },
  dotOn: { height: 14, backgroundColor: tape },
  explore: {
    position: "absolute",
    right: 12,
    top: 262,
    width: 46,
    backgroundColor: ink,
    borderRadius: 16,
    paddingVertical: 8,
    alignItems: "center",
  },
  exploreIcon: { color: chalk, fontSize: 18, lineHeight: 20 },
  exploreText: { color: chalk, fontWeight: "700", fontSize: 11 },
});
