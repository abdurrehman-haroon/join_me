import { useEffect, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import useReduceMotion from "./useReduceMotion";

type Props = {
  availableSpots: number;
  participantCount: number;
  capacity: number;
  // Shown in place of the number when joining is no longer possible for a reason
  // other than being full, e.g. "Cancelled", "Completed" or "Started".
  closedLabel: string | null;
};

// Above this many places the dots become too small to read, so only the text is shown.
const maxCapacityDots = 30;

// The headline of an event: how many places are still open. When the count changes
// (your own join, or a live update from someone else), the old number drops out and
// the new one drops in.
export default function SpotsLeft({
  availableSpots,
  participantCount,
  capacity,
  closedLabel,
}: Props) {
  const reduceMotion = useReduceMotion();
  const [shownSpots, setShownSpots] = useState(availableSpots);
  const [leavingSpots, setLeavingSpots] = useState<number | null>(null);
  const [roll] = useState(() => new Animated.Value(1));

  // Remember the number being replaced so it can animate out.
  if (availableSpots !== shownSpots) {
    setLeavingSpots(reduceMotion ? null : shownSpots);
    setShownSpots(availableSpots);
  }

  useEffect(() => {
    if (leavingSpots === null) return;
    roll.setValue(0);
    Animated.timing(roll, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => setLeavingSpots(null));
  }, [leavingSpots, roll]);

  const isFull = shownSpots <= 0;
  const headline = closedLabel ?? (isFull ? "Full" : String(shownSpots));
  const label = closedLabel
    ? "Joining closed"
    : isFull
      ? "No spots left"
      : shownSpots === 1
        ? "Last spot"
        : "spots left";
  const showNumber = !closedLabel && !isFull;

  return (
    <View
      style={styles.root}
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${showNumber ? `${shownSpots} ${label}` : `${headline}, ${label}`}, ${participantCount} of ${capacity} going`}
    >
      <View style={styles.row}>
        <View style={styles.numberWindow}>
          {leavingSpots !== null && showNumber && (
            <Animated.Text
              style={[
                styles.number,
                styles.leaving,
                {
                  opacity: roll.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
                  transform: [
                    { translateY: roll.interpolate({ inputRange: [0, 1], outputRange: [0, 70] }) },
                  ],
                },
              ]}
            >
              {leavingSpots}
            </Animated.Text>
          )}
          <Animated.Text
            style={[
              showNumber ? styles.number : styles.closed,
              leavingSpots !== null && showNumber
                ? {
                    opacity: roll,
                    transform: [
                      { translateY: roll.interpolate({ inputRange: [0, 1], outputRange: [-70, 0] }) },
                    ],
                  }
                : null,
            ]}
          >
            {headline}
          </Animated.Text>
        </View>
        <View style={styles.labels}>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.going}>
            {participantCount} of {capacity} going
          </Text>
        </View>
      </View>
      {capacity <= maxCapacityDots && (
        <View style={styles.dots} importantForAccessibility="no-hide-descendants">
          {Array.from({ length: capacity }, (_, index) => (
            <View
              key={index}
              style={[styles.dot, index < participantCount ? styles.dotTaken : styles.dotOpen]}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: "#E5E9DF", borderRadius: 24, padding: 20, gap: 14 },
  row: { flexDirection: "row", alignItems: "flex-end", gap: 14 },
  // Clips the rolling numbers so they appear to drop through a window.
  numberWindow: { height: 104, justifyContent: "flex-end", overflow: "hidden" },
  number: {
    fontFamily: "BigShoulders",
    fontSize: 120,
    lineHeight: 112,
    color: "#E3342F",
    fontVariant: ["tabular-nums"],
  },
  leaving: { position: "absolute", left: 0, bottom: 0 },
  closed: {
    fontFamily: "BigShoulders",
    fontSize: 64,
    lineHeight: 70,
    color: "#6C786E",
  },
  labels: { paddingBottom: 10, gap: 2, flexShrink: 1 },
  label: { fontFamily: "BigShoulders", fontSize: 30, lineHeight: 32, color: "#15201B" },
  going: { fontSize: 14, color: "#6C786E" },
  dots: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  dot: { width: 14, height: 14, borderRadius: 7 },
  dotTaken: { backgroundColor: "#1D5B3A" },
  dotOpen: { borderWidth: 2, borderColor: "#E3342F", backgroundColor: "#F4F5F0" },
});
