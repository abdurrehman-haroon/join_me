import { useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import type { EventSummary } from "./EventDetails";

// The Lahore prototype's palette and type (design/lahore-skin/style.css).
export const explore = {
  paper: "#FAF5E7",
  cream: "#FFF8E8",
  ink: "#203E30",
  muted: "#798268",
  line: "#D2D9B8",
  red: "#E3342F",
  sage: "#E5E8D8",
  display: "BarlowCondensed_800ExtraBold",
  displayBold: "BarlowCondensed_700Bold",
  body: "DMSans_400Regular",
  bodyMedium: "DMSans_500Medium",
  bodyBold: "DMSans_700Bold",
};

export function formatStart(startsAt: string) {
  return new Date(startsAt).toLocaleString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((word) => word[0].toUpperCase())
    .join("");
}

// The city hero's box is outlined in red; a district's is quieter, as in the prototype.
export function HeroCard({
  tone,
  kicker,
  title,
  intro,
  portalKicker,
  portalStat,
  portalNote,
  actionLabel,
  actionArrow,
  onAction,
}: {
  tone: "city" | "district";
  kicker: string;
  title: string;
  intro: string;
  portalKicker: string;
  portalStat: string;
  portalNote: string;
  actionLabel: string;
  actionArrow: string;
  onAction: () => void;
}) {
  return (
    <View style={styles.hero}>
      <Text style={styles.heroKicker}>{kicker}</Text>
      <Text style={styles.heroExplore}>Explore</Text>
      <Text
        style={styles.heroTitle}
        numberOfLines={3}
        adjustsFontSizeToFit
        minimumFontScale={0.5}
      >
        {title.toUpperCase()}
        <Text style={styles.red}>.</Text>
      </Text>
      <Text style={styles.heroIntro}>{intro}</Text>
      <View
        style={[
          styles.portal,
          tone === "city" ? styles.cityPortal : styles.districtPortal,
        ]}
      >
        <View style={styles.portalText}>
          <Text
            style={[
              styles.portalKicker,
              tone === "district" && styles.quietKicker,
            ]}
          >
            {portalKicker}
          </Text>
          <Text style={styles.portalStat}>{portalStat}</Text>
          <Text style={styles.portalNote} numberOfLines={1}>
            {portalNote}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={styles.portalAction}
        >
          <Text style={styles.primaryText}>{actionLabel}</Text>
          <Text style={styles.primaryText}>{actionArrow}</Text>
        </Pressable>
      </View>
    </View>
  );
}

// Kept short so the map above shows the district. Opening it is a left swipe or
// the level button at the top; the rail shows the position.
export function DistrictCard({
  name,
  firstUp,
  count,
  placeCount,
}: {
  name: string;
  firstUp: { place: string; title: string; startsAt: string } | null;
  count: number;
  placeCount: number;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{name}</Text>
      <View style={styles.preview}>
        <Text style={[styles.portalKicker, styles.quietKicker]}>FIRST UP</Text>
        {firstUp ? (
          <>
            <Text style={styles.previewPlace}>{firstUp.place}</Text>
            <Text style={styles.portalNote}>
              {firstUp.title} · {formatStart(firstUp.startsAt)}
            </Text>
          </>
        ) : (
          <Text style={styles.portalNote}>
            Nothing coming up yet · {placeCount}{" "}
            {placeCount === 1 ? "place" : "places"} to explore
          </Text>
        )}
      </View>
      <View style={styles.statRow}>
        <Text style={styles.bigNumber}>{count}</Text>
        <View>
          <Text style={styles.statTitle}>
            {count === 1 ? "thing happening" : "things happening"}
          </Text>
          <Text style={styles.portalNote}>
            Across {placeCount} {placeCount === 1 ? "place" : "places"} this
            week
          </Text>
        </View>
      </View>
    </View>
  );
}

// One place: a header and a carousel of full-width event cards. The selected
// event is reported when the carousel settles, and the scroll position while it
// moves, so the map can glide between the grounds of neighbouring events.
export function PlaceCard({
  name,
  count,
  events,
  selectedIndex,
  reduceMotion,
  onSelectEvent,
  onScrollEvents,
  onViewEvent,
  onStartSomething,
  onTouchCarousel,
}: {
  name: string;
  count: number;
  events: EventSummary[];
  selectedIndex: number;
  reduceMotion: boolean;
  onSelectEvent: (index: number) => void;
  onScrollEvents: (progress: number) => void;
  onViewEvent: (event: EventSummary) => void;
  onStartSomething: (() => void) | null;
  onTouchCarousel: () => void;
}) {
  const carousel = useRef<FlatList<EventSummary>>(null);
  // Only a scroll someone started moves the map. A carousel that has just
  // appeared reports its starting position too, which would cut short the
  // camera's ease into a new level.
  const scrolling = useRef(false);
  const [carouselWidth, setCarouselWidth] = useState(0);
  const eventWidth = Math.max(0, carouselWidth - 32);
  const eventStride = eventWidth + 10;

  function showEvent(index: number) {
    const next = Math.max(0, Math.min(events.length - 1, index));
    scrolling.current = !reduceMotion;
    carousel.current?.scrollToOffset({
      offset: next * eventStride,
      animated: !reduceMotion,
    });
    // An animated scroll reports its end through onMomentumScrollEnd; selecting
    // now would move the map ahead of the carousel.
    if (reduceMotion) onSelectEvent(next);
  }

  return (
    <View style={[styles.card, styles.placeCard]}>
      <View style={styles.placeHeading}>
        <Text style={styles.placeName} numberOfLines={1}>
          {name}
        </Text>
        {/* The action sits in the heading so the card leaves the map in view. */}
        {onStartSomething && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start something here"
            onPress={onStartSomething}
          >
            <Text style={styles.link}>+ Start something</Text>
          </Pressable>
        )}
      </View>
      {events.length ? (
        <View
          style={styles.carouselStrip}
          onLayout={(event) => setCarouselWidth(event.nativeEvent.layout.width)}
          onTouchStart={onTouchCarousel}
        >
          {eventWidth > 0 && (
            <FlatList
              ref={carousel}
              horizontal
              data={events}
              keyExtractor={(event) => event.id}
              showsHorizontalScrollIndicator={false}
              snapToInterval={eventStride}
              // Remounted cards reopen on the event the map is already showing.
              initialScrollIndex={selectedIndex}
              getItemLayout={(_, index) => ({
                length: eventStride,
                offset: eventStride * index,
                index,
              })}
              decelerationRate="fast"
              contentContainerStyle={styles.carouselContent}
              scrollEventThrottle={16}
              onScrollBeginDrag={() => {
                scrolling.current = true;
              }}
              onScroll={(event) => {
                if (scrolling.current)
                  onScrollEvents(event.nativeEvent.contentOffset.x / eventStride);
              }}
              onMomentumScrollEnd={(event) => {
                scrolling.current = false;
                onSelectEvent(
                  Math.round(event.nativeEvent.contentOffset.x / eventStride),
                );
              }}
              renderItem={({ item }) => (
                <EventCard
                  event={item}
                  style={{ width: eventWidth }}
                  onView={() => onViewEvent(item)}
                />
              )}
            />
          )}
        </View>
      ) : (
        <Text style={styles.empty}>Nothing coming up — start something.</Text>
      )}
      <View style={styles.carouselFooter}>
        {events.length > 1 ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous event"
              hitSlop={8}
              disabled={selectedIndex === 0}
              onPress={() => showEvent(selectedIndex - 1)}
              style={[styles.arrow, selectedIndex === 0 && styles.disabled]}
            >
              <Text style={styles.arrowText}>←</Text>
            </Pressable>
            <View style={styles.dots}>
              {events.slice(0, 8).map((event, index) => (
                <View
                  key={event.id}
                  style={[styles.dot, index === selectedIndex && styles.dotOn]}
                />
              ))}
            </View>
            <Text style={styles.portalNote}>
              Event {selectedIndex + 1} of {count}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next event"
              hitSlop={8}
              disabled={selectedIndex >= events.length - 1}
              onPress={() => showEvent(selectedIndex + 1)}
              style={[
                styles.arrow,
                selectedIndex >= events.length - 1 && styles.disabled,
              ]}
            >
              <Text style={styles.arrowText}>→</Text>
            </Pressable>
          </>
        ) : (
          <Text style={styles.portalNote}>
            {count === 1 ? "1 event coming up" : `${count} events coming up`}
          </Text>
        )}
      </View>
    </View>
  );
}

function EventCard({
  event,
  style,
  onView,
}: {
  event: EventSummary;
  style: ViewStyle;
  onView: () => void;
}) {
  const others = Math.max(0, event.participant_count - 1);
  return (
    <View style={[styles.eventCard, style]}>
      <View style={styles.cardTop}>
        <Text style={[styles.tag, styles.eventType]} numberOfLines={1}>
          ● {event.type}
        </Text>
        <Text style={styles.ordinal}>{formatStart(event.starts_at)}</Text>
      </View>
      <Text style={styles.eventTitle} numberOfLines={2}>
        {event.title}
      </Text>
      <Text style={styles.portalNote} numberOfLines={1}>
        ⌖ {event.spot ? `${event.spot.name} · ` : ""}
        {event.place.name}
      </Text>
      <View style={styles.statRow}>
        <Text style={styles.bigNumber}>
          {event.is_full ? "0" : event.available_spots}
        </Text>
        <View style={styles.statText}>
          <Text style={styles.statTitle}>
            {event.is_full
              ? "full"
              : event.available_spots === 1
                ? "spot left"
                : "spots left"}
          </Text>
          <Text style={styles.portalNote} numberOfLines={1}>
            Hosted by {event.host.display_name}
          </Text>
        </View>
        <View style={styles.avatars}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {initials(event.host.display_name)}
            </Text>
          </View>
          {others > 0 && (
            <View style={[styles.avatar, styles.avatarMore]}>
              <Text style={styles.avatarText}>+{others}</Text>
            </View>
          )}
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${event.title}`}
        onPress={onView}
        style={[styles.primary, styles.primaryBlock]}
      >
        <Text style={styles.primaryText}>View event</Text>
        <Text style={styles.primaryText}>↗</Text>
      </Pressable>
    </View>
  );
}

export function EndCard({
  parentName,
  onBeginning,
  onParent,
}: {
  parentName: string | null;
  onBeginning: () => void;
  onParent: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.portalKicker}>A LITTLE FURTHER?</Text>
      <Text style={styles.cardTitle}>That’s this chapter.</Text>
      <Text style={styles.caption}>
        Scroll back to find your place, or pull out to explore the next part of
        Lahore.
      </Text>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to the beginning"
          onPress={onBeginning}
          style={styles.primary}
        >
          <Text style={[styles.primaryText, styles.label]} numberOfLines={1}>
            Back to the beginning
          </Text>
          <Text style={styles.primaryText}>↑</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onParent}
          style={styles.secondary}
        >
          <Text style={styles.secondaryText} numberOfLines={1}>
            {parentName ? `Back to ${parentName}` : "Lahore"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  red: { color: explore.red },
  hero: { gap: 6, paddingBottom: 8 },
  heroKicker: {
    fontFamily: explore.bodyBold,
    fontSize: 11,
    letterSpacing: 2.5,
    color: explore.ink,
  },
  heroExplore: {
    fontFamily: explore.bodyMedium,
    fontSize: 14,
    color: explore.ink,
  },
  heroTitle: {
    fontFamily: explore.display,
    fontSize: 104,
    lineHeight: 96,
    color: explore.ink,
  },
  heroIntro: {
    fontFamily: explore.body,
    fontSize: 15,
    lineHeight: 22,
    color: explore.muted,
  },
  portal: {
    marginTop: 10,
    borderRadius: 18,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    shadowOffset: { width: 0, height: 14 },
  },
  cityPortal: {
    backgroundColor: "#FFFAF0",
    borderWidth: 2,
    borderColor: explore.red,
    shadowColor: "#92352A",
    shadowOpacity: 0.14,
    shadowRadius: 21,
  },
  districtPortal: {
    backgroundColor: "#FFF9EAE8",
    borderWidth: 1,
    borderColor: "#D8DEC5",
    shadowColor: "#294A25",
    shadowOpacity: 0.12,
    shadowRadius: 19,
  },
  portalText: { flex: 1, gap: 3 },
  portalKicker: {
    fontFamily: explore.bodyBold,
    fontSize: 10,
    letterSpacing: 1.6,
    color: explore.red,
  },
  quietKicker: { color: "#6A7C60" },
  portalStat: {
    fontFamily: explore.displayBold,
    fontSize: 22,
    lineHeight: 24,
    color: explore.ink,
  },
  portalNote: { fontFamily: explore.body, fontSize: 12, color: explore.muted },
  portalAction: {
    minWidth: 132,
    minHeight: 52,
    backgroundColor: explore.red,
    borderRadius: 13,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  card: {
    backgroundColor: explore.paper,
    borderRadius: 26,
    padding: 18,
    gap: 10,
    shadowColor: "#314A34",
    shadowOpacity: 0.13,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
  },
  placeCard: {
    paddingHorizontal: 0,
    paddingTop: 14,
    paddingBottom: 14,
    gap: 0,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  tag: {
    flexShrink: 1,
    fontFamily: explore.bodyMedium,
    fontSize: 12,
    color: explore.muted,
  },
  eventType: { textTransform: "capitalize" },
  ordinal: {
    fontFamily: explore.bodyMedium,
    fontSize: 12,
    color: explore.muted,
  },
  cardTitle: {
    fontFamily: explore.display,
    fontSize: 38,
    lineHeight: 38,
    color: explore.ink,
  },
  preview: {
    backgroundColor: explore.cream,
    borderColor: explore.line,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 2,
  },
  previewPlace: {
    fontFamily: explore.displayBold,
    fontSize: 20,
    color: explore.ink,
  },
  statRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  statText: { flex: 1 },
  bigNumber: {
    fontFamily: explore.display,
    fontSize: 52,
    lineHeight: 52,
    color: explore.red,
  },
  statTitle: {
    fontFamily: explore.displayBold,
    fontSize: 22,
    color: explore.ink,
  },
  caption: {
    fontFamily: explore.body,
    fontSize: 13,
    lineHeight: 18,
    color: explore.muted,
  },
  actions: { flexDirection: "row", gap: 10 },
  // Label on the left and its arrow on the right, as in the prototype.
  primary: {
    flex: 1,
    backgroundColor: explore.red,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  label: { flexShrink: 1 },
  // A full-width button in a column must not grow like the row buttons do.
  primaryBlock: { flex: 0 },
  primaryText: {
    fontFamily: explore.bodyBold,
    fontSize: 15,
    color: "#FFFFFF",
  },
  secondary: {
    backgroundColor: explore.sage,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 16,
    maxWidth: 150,
  },
  secondaryText: {
    fontFamily: explore.bodyBold,
    fontSize: 15,
    color: explore.ink,
  },
  placeHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 13,
    borderBottomWidth: 1,
    borderBottomColor: "#DDE3D6",
    gap: 10,
  },
  placeName: {
    flexShrink: 1,
    fontFamily: explore.bodyBold,
    fontSize: 15,
    color: explore.ink,
  },
  link: { fontFamily: explore.bodyBold, fontSize: 13, color: explore.ink },
  // Events sit flush on a sage strip, with the next one peeking in on the right.
  carouselStrip: { backgroundColor: "#E7ECDF" },
  carouselContent: { paddingRight: 32, gap: 10 },
  eventCard: {
    backgroundColor: "#F4F5F0",
    borderRadius: 12,
    borderRightWidth: 1,
    borderRightColor: "#D5DDCE",
    padding: 16,
    gap: 8,
  },
  eventTitle: {
    fontFamily: explore.display,
    fontSize: 28,
    lineHeight: 29,
    color: explore.ink,
  },
  avatars: { flexDirection: "row" },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#305C40",
    borderWidth: 2,
    borderColor: explore.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarMore: { marginLeft: -8, backgroundColor: "#9A7655" },
  avatarText: { fontFamily: explore.bodyBold, fontSize: 11, color: "#FFFFFF" },
  carouselFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 10,
  },
  arrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#E4E9DC",
    alignItems: "center",
    justifyContent: "center",
  },
  arrowText: { fontSize: 15, color: "#40583B" },
  disabled: { opacity: 0.3 },
  dots: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#C9D2C1" },
  dotOn: { width: 17, borderRadius: 4, backgroundColor: explore.red },
  empty: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    fontFamily: explore.body,
    fontSize: 14,
    color: explore.ink,
  },
});
