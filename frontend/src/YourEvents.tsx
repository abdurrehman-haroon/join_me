import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import EventDetails, { type EventSummary } from "./EventDetails";

const apiURL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8080";
type EventPage = { events: EventSummary[]; next_offset: number | null };

function EventSection({
  section,
  onSelect,
}: {
  section: "upcoming" | "past";
  onSelect: (id: string) => void;
}) {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    async function load() {
      try {
        const response = await fetch(
          `${apiURL}/me/events?section=${section}&offset=${offset}`,
          { signal: controller.signal },
        );
        if (!response.ok)
          throw new Error(
            (await response.text()).trim() || "Could not load your events.",
          );
        const page: EventPage = await response.json();
        if (active) {
          setEvents((current) =>
            offset === 0
              ? page.events
              : [
                  ...current,
                  ...page.events.filter(
                    (event) =>
                      !current.some((existing) => existing.id === event.id),
                  ),
                ],
          );
          setNextOffset(page.next_offset);
        }
      } catch (failure) {
        if (active)
          setError(
            failure instanceof Error
              ? failure.message
              : "Could not load your events.",
          );
      } finally {
        clearTimeout(timeout);
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [section, offset, retry]);
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>
        {section === "upcoming" ? "Upcoming" : "Past"}
      </Text>
      {section === "past" && (
        <Text style={styles.muted}>
          Cancelled, completed and events whose start time has passed.
        </Text>
      )}
      {events.map((event) => (
        <Pressable
          accessibilityRole="button"
          key={event.id}
          onPress={() => onSelect(event.id)}
          style={styles.card}
        >
          <Text style={styles.kicker}>
            {event.type.toUpperCase()} · {event.status.name.toUpperCase()}
          </Text>
          <Text style={styles.title}>{event.title}</Text>
          <Text style={styles.body}>{event.place.name}</Text>
          <Text style={styles.body}>
            {new Date(event.starts_at).toLocaleString([], {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </Text>
          <Text style={styles.muted}>
            Hosted by {event.host.display_name} · {event.participant_count}/
            {event.capacity} participants
          </Text>
        </Pressable>
      ))}
      {loading && <ActivityIndicator color="#1D5B3A" />}
      {!!error && (
        <View style={{ gap: 12 }}>
          <Text accessibilityRole="alert" style={styles.body}>
            {error}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setLoading(true);
              setError("");
              setRetry((value) => value + 1);
            }}
          >
            <Text style={styles.action}>Try again</Text>
          </Pressable>
        </View>
      )}
      {!loading && !error && events.length === 0 && (
        <Text style={styles.muted}>
          No {section} events. Events you host or join appear here.
        </Text>
      )}
      {!loading && !error && nextOffset !== null && (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setLoading(true);
            setError("");
            setOffset(nextOffset);
          }}
        >
          <Text style={styles.action}>Load more</Text>
        </Pressable>
      )}
    </View>
  );
}

export default function YourEvents() {
  const [eventID, setEventID] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setRefresh((value) => value + 1);
    });
    return () => subscription.remove();
  }, []);
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.pageTitle}>Your events</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setRefresh((value) => value + 1)}
            style={{ padding: 12 }}
          >
            <Text style={styles.action}>Refresh</Text>
          </Pressable>
        </View>
        <Text style={styles.muted}>
          Using the demo user · events you host or have joined
        </Text>
        <EventSection
          key={`upcoming-${refresh}`}
          section="upcoming"
          onSelect={setEventID}
        />
        <EventSection
          key={`past-${refresh}`}
          section="past"
          onSelect={setEventID}
        />
      </ScrollView>
      {eventID && (
        <EventDetails
          key={eventID}
          id={eventID}
          apiURL={apiURL}
          closeLabel="Back to events"
          source="your_events"
          onClose={() => {
            setEventID(null);
            setRefresh((value) => value + 1);
          }}
          onEventChanged={() => setRefresh((value) => value + 1)}
        />
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F5F5EF" },
  content: {
    paddingHorizontal: 24,
    paddingTop: 64,
    paddingBottom: 120,
    gap: 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pageTitle: { fontFamily: "BigShoulders", fontSize: 48, color: "#17251D" },
  heading: { fontSize: 24, fontWeight: "700", color: "#17251D" },
  section: { gap: 16, marginTop: 12 },
  card: { borderRadius: 20, backgroundColor: "#E6EADF", padding: 20, gap: 10 },
  title: { fontFamily: "BigShoulders", fontSize: 32, color: "#17251D" },
  kicker: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    color: "#1D5B3A",
  },
  body: { fontSize: 16, color: "#17251D" },
  muted: { fontSize: 14, color: "#68776C", lineHeight: 21 },
  action: { color: "#1D5B3A", fontSize: 16, fontWeight: "700" },
});
