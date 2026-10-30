import * as Haptics from "expo-haptics";
import { SymbolView } from "expo-symbols";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  type FlatList,
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { EventSummary } from "./EventDetails";
import { sportNames, type Sport } from "./activities";
import { colors, displayFont, fadeDuration, margin, type } from "./theme";
import { Icon, PressableScale } from "./ui";

// One camera position over the 3D map, as an orbit around a point (scene units).
export type CameraFrame = {
  x: number;
  z: number;
  distance: number;
  // Angle from straight down, in radians.
  tilt: number;
  // Angle around the point, in radians.
  turn: number;
};

export type FeedPlace = {
  id: string;
  name: string;
  // The sport a new game here starts with.
  sport: Sport;
};

// One page of the feed: an area's overview first, then one place per page, then an end.
export type FeedPage =
  | { kind: "overview"; key: string; kicker: string; title: string; subtitle: string; frame: CameraFrame }
  | {
      kind: "place";
      key: string;
      place: FeedPlace;
      kicker: string;
      games: EventSummary[];
      canGoInside: boolean;
      frame: CameraFrame;
    }
  | { kind: "end"; key: string; title: string; body: string; frame: CameraFrame };

type Props = {
  pages: FeedPage[];
  initialIndex: number;
  // The top bar's segmented control shows these; a sideways swipe on the feed moves
  // between them too.
  tabs: { key: string; label: string }[];
  activeTab: string;
  reduceMotion: boolean;
  onTabChange: (key: string) => void;
  // Called while swiping, and with `arriving` when the feed first shows a page.
  onCameraFrame: (frame: CameraFrame, arriving: boolean) => void;
  onPageChange: (index: number) => void;
  onGoInside: (place: FeedPlace) => void;
  // Back out to the feed this one is inside, or null at the widest feed.
  onBack: (() => void) | null;
  onOpenEvent: (event: EventSummary) => void;
  onStartGame: (place: FeedPlace) => void;
  onOpenMap: () => void;
};

// A sideways swipe at least this long, and mostly sideways, switches tabs.
const tabSwipe = 70;
// Pinching apart past the first ratio goes inside a place; together past the second goes back.
const pinchInside = 1.35;
const pinchBack = 0.72;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function lerp(from: number, to: number, t: number) {
  return from + (to - from) * t;
}

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function touchSpread(event: GestureResponderEvent) {
  const [a, b] = event.nativeEvent.touches;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

function gameLine(event: EventSummary) {
  const startsAt = new Date(event.starts_at);
  const when = `${startsAt.toLocaleDateString([], { weekday: "short" })} ${startsAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  const spots = event.is_full ? "Full" : event.available_spots === 1 ? "Last spot" : `${event.available_spots} spots left`;
  return { when, spots, urgent: event.is_full || event.available_spots === 1 };
}

// The home feed: one place per page, like a video feed. Each vertical swipe moves to the
// next place and the 3D map glides there with the finger; pinching goes inside a place or
// back out. The top bar (TopBar.tsx) floats above it.
export default function PlaceFeed({
  pages,
  initialIndex,
  tabs,
  activeTab,
  reduceMotion,
  onTabChange,
  onCameraFrame,
  onPageChange,
  onGoInside,
  onBack,
  onOpenEvent,
  onStartGame,
  onOpenMap,
}: Props) {
  const [pageHeight, setPageHeight] = useState(0);
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const list = useRef<FlatList<FeedPage>>(null);
  // The page the feed last came to rest on, for the haptic tick when it rests on a new one.
  const restingIndex = useRef(initialIndex);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const pinchStart = useRef<number | null>(null);
  // The scroll position, on the native side, so cards can dim as they leave without
  // waiting for JavaScript.
  const [scrollY] = useState(() => new Animated.Value(0));
  // The pages fade in when a feed opens (a new tab or level), instead of popping in.
  const [appear] = useState(() => new Animated.Value(0));

  // Once the page size is known, the camera flies to the first page shown.
  useEffect(() => {
    if (!pageHeight) return;
    scrollY.setValue(initialIndex * pageHeight);
    Animated.timing(appear, {
      toValue: 1,
      duration: fadeDuration,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
    const first = pages[initialIndex];
    if (first) onCameraFrame(first.frame, true);
    onPageChange(initialIndex);
    // Only on arrival; later pages are followed while scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageHeight > 0]);

  // Follows the swipe: between two pages the camera holds briefly, then travels, rising
  // over long hops so it arcs above the map instead of skimming across it.
  function followScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (!pageHeight || pages.length === 0) return;
    const position = clamp(event.nativeEvent.contentOffset.y / pageHeight, 0, pages.length - 1);
    const index = Math.min(Math.floor(position), pages.length - 2);
    const nearest = Math.round(position);
    if (nearest !== activeIndex) {
      setActiveIndex(nearest);
      onPageChange(nearest);
    }
    if (index < 0) return;
    const from = pages[index].frame;
    const to = pages[index + 1].frame;
    const t = position - index;
    if (reduceMotion) {
      onCameraFrame(t < 0.5 ? from : to, false);
      return;
    }
    const travel = easeInOut(clamp((t - 0.1) / 0.8, 0, 1));
    const span = Math.hypot(to.x - from.x, to.z - from.z);
    const lift = Math.sin(Math.PI * travel) * Math.max(Math.min(from.distance, to.distance) * 0.2, span * 0.5);
    onCameraFrame(
      {
        x: lerp(from.x, to.x, travel),
        z: lerp(from.z, to.z, travel),
        distance: lerp(from.distance, to.distance, travel) + lift,
        tilt: lerp(from.tilt, to.tilt, travel),
        turn: lerp(from.turn, to.turn, travel),
      },
      false,
    );
  }

  // A light tick each time the feed comes to rest on a new place, like a picker's detent.
  function onRest(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (!pageHeight) return;
    const index = Math.round(event.nativeEvent.contentOffset.y / pageHeight);
    if (index === restingIndex.current) return;
    restingIndex.current = index;
    void Haptics.selectionAsync();
  }

  function onTouchStart(event: GestureResponderEvent) {
    const touch = event.nativeEvent.touches[0];
    touchStart.current = touch && event.nativeEvent.touches.length === 1 ? { x: touch.pageX, y: touch.pageY } : null;
  }

  // Two fingers: pinch apart to go inside the place in view, together to go back out.
  function onTouchMove(event: GestureResponderEvent) {
    if (event.nativeEvent.touches.length !== 2) {
      pinchStart.current = null;
      return;
    }
    touchStart.current = null;
    const spread = touchSpread(event);
    if (pinchStart.current === null) {
      pinchStart.current = spread;
      return;
    }
    const ratio = spread / pinchStart.current;
    const page = pages[activeIndex];
    if (ratio > pinchInside && page?.kind === "place" && page.canGoInside) {
      pinchStart.current = null;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onGoInside(page.place);
    } else if (ratio < pinchBack && onBack) {
      pinchStart.current = null;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onBack();
    }
  }

  // One finger moving mostly sideways switches to the next or previous tab.
  function onTouchEnd(event: GestureResponderEvent) {
    pinchStart.current = null;
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || tabs.length < 2) return;
    const dx = event.nativeEvent.pageX - start.x;
    const dy = event.nativeEvent.pageY - start.y;
    if (Math.abs(dx) < tabSwipe || Math.abs(dx) < Math.abs(dy) * 2) return;
    const current = tabs.findIndex((tab) => tab.key === activeTab);
    const next = tabs[current + (dx < 0 ? 1 : -1)];
    if (!next) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onTabChange(next.key);
  }

  const placeCount = pages.filter((page) => page.kind === "place").length;

  function renderPage({ item, index }: { item: FeedPage; index: number }) {
    // As a page scrolls away, its card dims and shrinks a little, and the next one grows
    // into place, so the swipe has depth. Reduce Motion keeps only the dimming.
    const range = [(index - 1) * pageHeight, index * pageHeight, (index + 1) * pageHeight];
    const cardMotion = {
      opacity: scrollY.interpolate({ inputRange: range, outputRange: [0.4, 1, 0.4], extrapolate: "clamp" }),
      transform: [
        {
          scale: reduceMotion
            ? 1
            : scrollY.interpolate({ inputRange: range, outputRange: [0.94, 1, 0.94], extrapolate: "clamp" }),
        },
      ],
    };
    return (
      <View style={[styles.page, { height: pageHeight }]}>
        {item.kind === "overview" && (
          <Animated.View style={[styles.card, cardMotion]}>
            <Text style={styles.kicker}>{item.kicker}</Text>
            <Text style={styles.overviewTitle} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.2}>
              {item.title}
            </Text>
            <Text style={styles.subtitle}>{item.subtitle}</Text>
            <View style={styles.hint}>
              <SymbolView
                name="chevron.up"
                size={15}
                tintColor={colors.secondary}
                weight="semibold"
                animationSpec={reduceMotion ? undefined : { effect: { type: "bounce" }, repeatCount: 2 }}
                fallback={<Text style={styles.hintText}>↑</Text>}
              />
              <Text style={styles.hintText}>Swipe up for the first place</Text>
            </View>
          </Animated.View>
        )}
        {item.kind === "place" && (
          <Animated.View style={[styles.card, cardMotion]}>
            <View style={styles.kickerRow}>
              <Text style={[styles.kicker, styles.kickerText]} numberOfLines={1}>
                {item.kicker}
              </Text>
              <Text style={styles.position}>
                {pages.slice(0, index + 1).filter((page) => page.kind === "place").length} of {placeCount}
              </Text>
            </View>
            <Text style={styles.placeTitle} numberOfLines={2} adjustsFontSizeToFit maxFontSizeMultiplier={1.2}>
              {item.place.name.toUpperCase()}
            </Text>
            {item.games.length === 0 ? (
              <Text style={styles.subtitle}>
                {item.canGoInside ? "No games yet." : "No games yet. Start the first one."}
              </Text>
            ) : (
              <View style={styles.games}>
                {item.games.slice(0, 2).map((game, gameIndex) => {
                  const line = gameLine(game);
                  return (
                    <PressableScale
                      key={game.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${game.title}, ${sportNames[game.type]}, ${line.when}, ${line.spots}`}
                      accessibilityHint="Opens the game"
                      onPress={() => onOpenEvent(game)}
                      style={[styles.game, gameIndex > 0 && styles.gameDivider]}
                    >
                      <View style={styles.gameText}>
                        <Text style={styles.gameTitle} numberOfLines={1}>
                          {game.title}
                        </Text>
                        <Text style={styles.gameDetail} numberOfLines={1}>
                          {sportNames[game.type]} · {line.when} ·{" "}
                          <Text style={line.urgent ? styles.urgent : undefined}>{line.spots}</Text>
                        </Text>
                      </View>
                      <Icon name="chevron.right" fallback="›" size={14} color={colors.secondary} />
                    </PressableScale>
                  );
                })}
                {item.games.length > 2 && (
                  <Text style={styles.more}>
                    {item.games.length - 2} more {item.games.length - 2 === 1 ? "game" : "games"} coming up
                  </Text>
                )}
              </View>
            )}
            {item.canGoInside ? (
              // The campus is not one place to play at: its games are at its grounds.
              <PressableScale
                accessibilityRole="button"
                haptic
                onPress={() => onGoInside(item.place)}
                style={[styles.button, styles.buttonProminent]}
              >
                <Icon name="arrow.down.right.and.arrow.up.left" fallback="↘" size={16} color={colors.surface} />
                <Text style={styles.buttonProminentText}>See the Grounds</Text>
              </PressableScale>
            ) : (
              // Start is the one prominent button when there is nothing to join; when there
              // are games, joining one is the likelier choice, so Start steps back.
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`Start a game at ${item.place.name}`}
                haptic
                onPress={() => onStartGame(item.place)}
                style={[styles.button, item.games.length === 0 ? styles.buttonProminent : styles.buttonTinted]}
              >
                <Icon name="plus" fallback="+" size={16} color={item.games.length === 0 ? colors.surface : colors.tint} />
                <Text style={item.games.length === 0 ? styles.buttonProminentText : styles.buttonTintedText}>
                  Start a Game
                </Text>
              </PressableScale>
            )}
          </Animated.View>
        )}
        {item.kind === "end" && (
          <Animated.View style={[styles.card, cardMotion]}>
            <Text style={styles.placeTitle} maxFontSizeMultiplier={1.2}>
              {item.title}
            </Text>
            <Text style={styles.subtitle}>{item.body}</Text>
            <PressableScale
              accessibilityRole="button"
              onPress={() => list.current?.scrollToOffset({ offset: 0, animated: !reduceMotion })}
              style={[styles.button, styles.buttonProminent]}
            >
              <Icon name="arrow.up.to.line" fallback="↑" size={16} color={colors.surface} />
              <Text style={styles.buttonProminentText}>Back to the Start</Text>
            </PressableScale>
            <PressableScale accessibilityRole="button" onPress={onOpenMap} style={[styles.button, styles.buttonTinted]}>
              <Icon name="map" fallback="◇" size={16} color={colors.tint} />
              <Text style={styles.buttonTintedText}>Open the Map</Text>
            </PressableScale>
          </Animated.View>
        )}
      </View>
    );
  }

  return (
    <View
      style={StyleSheet.absoluteFill}
      onLayout={(event) => setPageHeight(event.nativeEvent.layout.height)}
      pointerEvents="box-none"
    >
      {pageHeight > 0 && (
        <Animated.FlatList
          ref={list}
          style={{ opacity: appear }}
          data={pages}
          keyExtractor={(page) => page.key}
          renderItem={renderPage}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, index) => ({ length: pageHeight, offset: pageHeight * index, index })}
          // One place per swipe, however hard the flick, with iOS's own paging physics.
          pagingEnabled
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
            useNativeDriver: true,
            listener: followScroll,
          })}
          onMomentumScrollEnd={onRest}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={() => {
            touchStart.current = null;
            pinchStart.current = null;
          }}
          windowSize={5}
          accessibilityLabel="Places. Swipe up or down to move between them."
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { justifyContent: "flex-end", paddingHorizontal: margin - 4, paddingBottom: 12 },
  // Content stays on a solid card (never glass), with a soft shadow to lift it off the map.
  card: {
    backgroundColor: colors.surface,
    borderRadius: 28,
    borderCurve: "continuous",
    padding: 20,
    gap: 8,
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  kickerRow: { flexDirection: "row", alignItems: "baseline", gap: 12 },
  kickerText: { flex: 1 },
  kicker: {
    ...type.footnote,
    fontWeight: "600",
    letterSpacing: 0.6,
    color: colors.tint,
    textTransform: "uppercase",
  },
  position: { ...type.footnote, color: colors.secondary, fontVariant: ["tabular-nums"] },
  overviewTitle: { fontFamily: displayFont, fontSize: 96, lineHeight: 96, color: colors.ink },
  placeTitle: { fontFamily: displayFont, fontSize: 44, lineHeight: 46, color: colors.ink },
  subtitle: { ...type.callout, color: colors.secondary },
  hint: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  hintText: { ...type.footnote, fontWeight: "600", color: colors.secondary },
  // A game's rows sit on one surface, split by hairlines, like an iOS inset list.
  games: { backgroundColor: colors.chalk, borderRadius: 16, borderCurve: "continuous", marginTop: 4 },
  game: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 60,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  gameDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  gameText: { flex: 1, gap: 2 },
  gameTitle: { ...type.headline, color: colors.ink },
  gameDetail: { ...type.subheadline, color: colors.secondary },
  urgent: { color: colors.signal, fontWeight: "600" },
  more: {
    ...type.footnote,
    color: colors.secondary,
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  button: {
    minHeight: 50,
    borderRadius: 25,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 20,
    marginTop: 6,
  },
  buttonProminent: { backgroundColor: colors.tint },
  buttonProminentText: { ...type.headline, color: colors.surface },
  buttonTinted: { backgroundColor: colors.tintSoft },
  buttonTintedText: { ...type.headline, color: colors.tint },
});
