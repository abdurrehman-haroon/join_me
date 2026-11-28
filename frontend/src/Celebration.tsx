import { uuid } from "expo-modules-core";
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useActivities } from "./ActivitiesProvider";
import { explore as theme, formatStart } from "./ExploreCards";
import { ShareButtons, useShareEvent, type ShareableEvent } from "./share";

// What the celebration shows, and what landing on the map needs.
export type CreatedEvent = ShareableEvent & {
  capacity: number;
  participant_count: number;
  place: { name: string; slug: string; district: { slug: string } };
};
export type CelebrationClose =
  "whatsapp" | "share_sheet" | "map" | "timed_out" | "dismissed";

const showFor = 5000;
// The burst: red dots flying out from behind the headline.
const burst = Array.from({ length: 10 }, (_, index) => {
  const angle = (index / 10) * Math.PI * 2;
  return {
    x: Math.cos(angle) * (90 + (index % 3) * 26),
    y: Math.sin(angle) * (70 + (index % 2) * 30),
    size: 8 + (index % 3) * 4,
  };
});

// Straight after posting: "It's on.", the plan, ways to share it, and the map.
// It closes on its own after five seconds; any tap closes it sooner.
export default function Celebration({
  apiURL,
  eventID,
  referrerInteractionID,
  onClose,
}: {
  apiURL: string;
  eventID: string;
  // The creation's interaction, which these rows point back to.
  referrerInteractionID: string;
  onClose: (how: CelebrationClose, event: CreatedEvent | null) => void;
}) {
  const { queue, sessionID } = useActivities();
  const shareEvent = useShareEvent();
  const [event, setEvent] = useState<CreatedEvent | null>(null);
  const [shownAt] = useState(() => Date.now());
  const closed = useRef(false);
  const [countdown] = useState(() => new Animated.Value(1));
  const [pop] = useState(() => new Animated.Value(0));

  function close(how: CelebrationClose, loaded = event) {
    if (closed.current) return;
    closed.current = true;
    queue.record({
      id: uuid.v4(),
      action: "celebration_closed",
      session_id: sessionID,
      interaction_id: uuid.v4(),
      interaction_step: 1,
      trackable_type: "event",
      trackable_id: eventID,
      source: "celebration",
      occurred_at: new Date().toISOString(),
      details: {
        how,
        shown_ms: Math.min(3600000, Date.now() - shownAt),
        referrer_interaction_id: referrerInteractionID,
      },
    });
    onClose(how, loaded);
  }
  // The latest close for the timer, which is set up once.
  const closeLater = useRef(close);
  useEffect(() => {
    closeLater.current = close;
  });

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiURL}/events/${eventID}`, { signal: controller.signal })
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error()),
      )
      .then(setEvent)
      .catch(() => {});
    return () => controller.abort();
  }, [apiURL, eventID]);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (!reduce)
        Animated.spring(pop, {
          toValue: 1,
          friction: 6,
          useNativeDriver: true,
        }).start();
      else pop.setValue(1);
    });
    Animated.timing(countdown, {
      toValue: 0,
      duration: showFor,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
    const timer = setTimeout(() => closeLater.current("timed_out"), showFor);
    return () => {
      clearTimeout(timer);
    };
  }, [countdown, pop]);

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => close("dismissed")}
    >
      {/* A tap anywhere outside the buttons goes to the map. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="See it on the map"
        onPress={() => close("map")}
        style={styles.root}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => close("dismissed")}
          hitSlop={12}
          style={styles.closeButton}
        >
          <Text style={styles.closeText}>×</Text>
        </Pressable>
        <View style={styles.headline}>
          {burst.map((dot, index) => (
            <Animated.View
              key={index}
              style={[
                styles.dot,
                {
                  width: dot.size,
                  height: dot.size,
                  borderRadius: dot.size / 2,
                  opacity: pop.interpolate({
                    inputRange: [0, 0.6, 1],
                    outputRange: [0, 1, 0.9],
                  }),
                  transform: [
                    { translateX: Animated.multiply(pop, dot.x) },
                    { translateY: Animated.multiply(pop, dot.y) },
                  ],
                },
              ]}
            />
          ))}
          <Animated.Text
            style={[
              styles.title,
              {
                transform: [
                  {
                    scale: pop.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.85, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            It&apos;s on<Text style={styles.titleDot}>.</Text>
          </Animated.Text>
        </View>
        {event && (
          <View style={styles.card}>
            <Text style={styles.kicker}>YOUR PLAN</Text>
            <Text style={styles.eventTitle} numberOfLines={2}>
              {event.title}
            </Text>
            <Text style={styles.body}>
              {event.place.name} · {formatStart(event.starts_at)}
            </Text>
            <Text style={styles.count}>
              {event.participant_count} of {event.capacity} · you&apos;re in
            </Text>
          </View>
        )}
        <View style={styles.actions}>
          {event && (
            <ShareButtons
              onShare={(via) => {
                shareEvent(event, via, "celebration", referrerInteractionID);
                close(via);
              }}
            />
          )}
          <Pressable
            accessibilityRole="button"
            onPress={() => close("map")}
            style={styles.map}
          >
            <Text style={styles.mapText}>See it on the map</Text>
          </Pressable>
        </View>
        <View style={styles.track}>
          <Animated.View
            style={[
              styles.bar,
              {
                width: countdown.interpolate({
                  inputRange: [0, 1],
                  outputRange: ["0%", "100%"],
                }),
              },
            ]}
          />
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.paper,
    paddingHorizontal: 24,
    paddingTop: 70,
    paddingBottom: 40,
    justifyContent: "center",
    gap: 28,
  },
  closeButton: {
    position: "absolute",
    top: 52,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.sage,
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: {
    fontFamily: theme.bodyBold,
    fontSize: 24,
    lineHeight: 28,
    color: theme.ink,
  },
  headline: { alignItems: "center", justifyContent: "center", height: 170 },
  dot: { position: "absolute", backgroundColor: theme.red },
  title: {
    fontFamily: theme.display,
    fontSize: 88,
    lineHeight: 92,
    color: theme.ink,
  },
  titleDot: { color: theme.red },
  card: {
    backgroundColor: theme.cream,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.line,
    padding: 20,
    gap: 6,
  },
  kicker: {
    fontFamily: theme.bodyBold,
    fontSize: 10,
    letterSpacing: 1.4,
    color: theme.red,
  },
  eventTitle: {
    fontFamily: theme.display,
    fontSize: 34,
    lineHeight: 36,
    color: theme.ink,
  },
  body: { fontFamily: theme.body, fontSize: 15, color: theme.ink },
  count: { fontFamily: theme.bodyBold, fontSize: 14, color: theme.red },
  actions: { gap: 10 },
  map: { alignItems: "center", paddingVertical: 14 },
  mapText: { fontFamily: theme.bodyBold, fontSize: 15, color: theme.ink },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.sage,
    overflow: "hidden",
  },
  bar: { height: 4, backgroundColor: theme.red },
});
