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
  red: "#D14A35",
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

export function HeroCard({
  kicker,
  title,
  intro,
  portalKicker,
  portalStat,
  portalNote,
  actionLabel,
  onAction,
}: {
  kicker: string;
  title: string;
  intro: string;
  portalKicker: string;
  portalStat: string;
  portalNote: string;
  actionLabel: string;
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
      <View style={styles.portal}>
        <View style={styles.portalText}>
          <Text style={styles.portalKicker}>{portalKicker}</Text>
          <Text style={styles.portalStat}>{portalStat}</Text>
          <Text style={styles.portalNote} numberOfLines={1}>
            {portalNote}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          style={styles.portalAction}
        >
          <Text style={styles.primaryText}>{actionLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function DistrictCard({
  name,
  position,
  total,
  firstUp,
  count,
  placeCount,
  onOpen,
  onNext,
}: {
  name: string;
  position: number;
  total: number;
  firstUp: { place: string; title: string; startsAt: string } | null;
  count: number;
  placeCount: number;
  onOpen: () => void;
  onNext: (() => void) | null;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.tag}>● Lahore district</Text>
        <Text style={styles.ordinal}>
          {String(position).padStart(2, "0")} / {String(total).padStart(2, "0")}
        </Text>
      </View>
      <Text style={styles.cardTitle}>{name}</Text>
      <View style={styles.preview}>
        <Text style={styles.portalKicker}>FIRST UP</Text>
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
      <Text style={styles.caption}>
        {firstUp
          ? `Start with ${firstUp.place}, or open ${name} to see every place.`
          : `Open ${name} to see every place.`}
      </Text>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={onOpen}
          style={styles.primary}
        >
          <Text style={styles.primaryText} numberOfLines={1}>
            See places in {name} ↗
          </Text>
        </Pressable>
        {onNext && (
          <Pressable
            accessibilityRole="button"
            onPress={onNext}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>Next ↓</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// One place: a header and a carousel of full-width event cards. The selected
// event is reported so the map can highlight where it happens.
export function PlaceCard({
  name,
  count,
  events,
  selectedIndex,
  onSelectEvent,
  onViewEvent,
  onOpenPlace,
  onStartSomething,
  onTouchCarousel,
}: {
  name: string;
  count: number;
  events: EventSummary[];
  selectedIndex: number;
  onSelectEvent: (index: number) => void;
  onViewEvent: (event: EventSummary) => void;
  onOpenPlace: (() => void) | null;
  onStartSomething: (() => void) | null;
  onTouchCarousel: () => void;
}) {
  const carousel = useRef<FlatList<EventSummary>>(null);
  const [carouselWidth, setCarouselWidth] = useState(0);
  const eventWidth = Math.max(0, carouselWidth - 24);

  function showEvent(index: number) {
    const next = Math.max(0, Math.min(events.length - 1, index));
    carousel.current?.scrollToOffset({
      offset: next * (eventWidth + 12),
      animated: true,
    });
    onSelectEvent(next);
  }

  return (
    <View style={[styles.card, styles.placeCard]}>
      <View style={styles.placeHeading}>
        <Text style={styles.placeName} numberOfLines={1}>
          {name}
        </Text>
        {onOpenPlace && (
          <Pressable accessibilityRole="button" onPress={onOpenPlace}>
            <Text style={styles.link}>Open place ↗</Text>
          </Pressable>
        )}
      </View>
      {events.length ? (
        <View
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
              snapToInterval={eventWidth + 12}
              // Remounted cards reopen on the event the map is already showing.
              initialScrollIndex={selectedIndex}
              getItemLayout={(_, index) => ({
                length: eventWidth + 12,
                offset: (eventWidth + 12) * index,
                index,
              })}
              decelerationRate="fast"
              contentContainerStyle={styles.carouselContent}
              onMomentumScrollEnd={(event) =>
                onSelectEvent(
                  Math.round(
                    event.nativeEvent.contentOffset.x / (eventWidth + 12),
                  ),
                )
              }
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
      {onStartSomething && (
        <Pressable
          accessibilityRole="button"
          onPress={onStartSomething}
          style={styles.secondaryWide}
        >
          <Text style={styles.secondaryText}>+ Start something here</Text>
        </Pressable>
      )}
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
        <Text style={styles.primaryText}>View event ↗</Text>
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
          onPress={onBeginning}
          style={styles.primary}
        >
          <Text style={styles.primaryText}>Back to the beginning ↑</Text>
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
    backgroundColor: explore.paper,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "#E7B7A6",
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    shadowColor: "#314A34",
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  portalText: { flex: 1, gap: 3 },
  portalKicker: {
    fontFamily: explore.bodyBold,
    fontSize: 10,
    letterSpacing: 1.6,
    color: explore.red,
  },
  portalStat: {
    fontFamily: explore.displayBold,
    fontSize: 22,
    lineHeight: 24,
    color: explore.ink,
  },
  portalNote: { fontFamily: explore.body, fontSize: 12, color: explore.muted },
  portalAction: {
    backgroundColor: explore.red,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  card: {
    backgroundColor: explore.paper,
    borderRadius: 26,
    padding: 20,
    gap: 12,
    shadowColor: "#314A34",
    shadowOpacity: 0.13,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
  },
  placeCard: { paddingHorizontal: 0, gap: 10 },
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
    fontSize: 46,
    lineHeight: 46,
    color: explore.ink,
  },
  preview: {
    backgroundColor: explore.cream,
    borderColor: explore.line,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 3,
  },
  previewPlace: {
    fontFamily: explore.displayBold,
    fontSize: 22,
    color: explore.ink,
  },
  statRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  statText: { flex: 1 },
  bigNumber: {
    fontFamily: explore.display,
    fontSize: 64,
    lineHeight: 64,
    color: explore.red,
  },
  statTitle: {
    fontFamily: explore.displayBold,
    fontSize: 24,
    color: explore.ink,
  },
  caption: {
    fontFamily: explore.body,
    fontSize: 14,
    lineHeight: 20,
    color: explore.muted,
  },
  actions: { flexDirection: "row", gap: 10 },
  primary: {
    flex: 1,
    backgroundColor: explore.red,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  // A full-width button in a column must not grow like the row buttons do.
  primaryBlock: { flex: 0 },
  primaryText: {
    fontFamily: explore.bodyBold,
    fontSize: 15,
    color: "#FFFFFF",
  },
  secondary: {
    backgroundColor: explore.sage,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 16,
    maxWidth: 150,
  },
  secondaryWide: {
    marginHorizontal: 20,
    backgroundColor: explore.sage,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
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
    gap: 10,
  },
  placeName: {
    flexShrink: 1,
    fontFamily: explore.bodyBold,
    fontSize: 15,
    color: explore.ink,
  },
  link: { fontFamily: explore.bodyBold, fontSize: 13, color: explore.ink },
  carouselContent: { paddingHorizontal: 12, gap: 12 },
  eventCard: {
    backgroundColor: "#F3F2EA",
    borderRadius: 20,
    padding: 18,
    gap: 10,
  },
  eventTitle: {
    fontFamily: explore.display,
    fontSize: 34,
    lineHeight: 34,
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
    gap: 10,
  },
  arrow: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: explore.sage,
    alignItems: "center",
    justifyContent: "center",
  },
  arrowText: { fontSize: 18, color: explore.ink },
  disabled: { opacity: 0.4 },
  dots: { flexDirection: "row", gap: 6, flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: explore.line },
  dotOn: { width: 24, backgroundColor: explore.red },
  empty: {
    paddingHorizontal: 20,
    fontFamily: explore.body,
    fontSize: 14,
    color: explore.ink,
  },
});
