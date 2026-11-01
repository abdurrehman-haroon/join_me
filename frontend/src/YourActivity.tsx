import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import EventDetails from "./EventDetails";
import JoinerProgress, { type ParticipationProgress } from "./JoinerProgress";

type HistoryEntry = {
  entry_id: string;
  action:
    | "event_created"
    | "participation_joined"
    | "participation_left"
    | "event_cancelled";
  event_id: string;
  occurred_at: string;
  title: string;
  type: string;
  place_name: string;
  event_status: string;
};
type ActivitySummary = {
  participation: ParticipationProgress;
  joined: number;
  left: number;
  cancelled_joined: number;
  hosted: number;
  cancelled_hosted: number;
  sports: { type: string; joined: number; hosted: number }[];
  grounds: { id: string; name: string; events: number }[];
  history: HistoryEntry[];
  next_offset: number | null;
};
const apiURL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8080";
const actionLabels = {
  event_created: "Hosted",
  participation_joined: "Joined",
  participation_left: "Left",
  event_cancelled: "Cancelled",
};

function formatEventType(eventType: string) {
  return eventType.charAt(0).toUpperCase() + eventType.slice(1);
}

export default function YourActivity() {
  const [period, setPeriod] = useState<"month" | "all">("month");
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [eventID, setEventID] = useState<string | null>(null);

  function reload() {
    setOffset(0);
    setSummary(null);
    setError("");
    setLoading(true);
    setRefresh((value) => value + 1);
  }

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") reload();
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    async function load() {
      try {
        const timezone =
          Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        const response = await fetch(
          `${apiURL}/me/activity?period=${period}&timezone=${encodeURIComponent(timezone)}&offset=${offset}`,
          { signal: controller.signal },
        );
        if (!response.ok)
          throw new Error(
            (await response.text()).trim() || "Could not load your activity.",
          );
        const page: ActivitySummary = await response.json();
        if (active) {
          setSummary((current) => ({
            ...page,
            history:
              offset === 0 || !current
                ? page.history
                : [
                    ...current.history,
                    ...page.history.filter(
                      (entry) =>
                        !current.history.some(
                          (existing) =>
                            existing.entry_id === entry.entry_id &&
                            existing.action === entry.action,
                        ),
                    ),
                  ],
          }));
          setError("");
        }
      } catch (failure) {
        if (active)
          setError(
            failure instanceof Error && failure.name !== "AbortError"
              ? failure.message
              : "Could not load your activity. Try again.",
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
  }, [period, offset, refresh]);

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.heading}>Your activity</Text>
        <Pressable
          accessibilityRole="button"
          onPress={reload}
          style={styles.control}
        >
          <Text style={styles.action}>Refresh activity</Text>
        </Pressable>
      </View>
      {summary && (
        <JoinerProgress
          progress={summary.participation}
          apiURL={apiURL}
          onSaved={reload}
        />
      )}
      <View accessibilityRole="tablist" style={styles.row}>
        {(
          [
            ["month", "This month"],
            ["all", "All time"],
          ] as const
        ).map(([value, label]) => (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: period === value }}
            onPress={() => {
              if (value !== period) {
                setPeriod(value);
                reload();
              }
            }}
            style={[styles.period, period === value && styles.selected]}
          >
            <Text
              style={period === value ? styles.selectedText : styles.action}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.muted}>
        By first signup or creation date
        {period === "month" ? " · your local month" : ""}. Rejoining counts
        once.
      </Text>
      {summary && (
        <>
          <View style={styles.row}>
            <View style={styles.stat}>
              <Text style={styles.number}>{summary.joined}</Text>
              <Text style={styles.label}>Events joined</Text>
              <Text style={styles.muted}>
                {summary.left} left · {summary.cancelled_joined} cancelled
              </Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.number}>{summary.hosted}</Text>
              <Text style={styles.label}>Events hosted</Text>
              <Text style={styles.muted}>
                {summary.cancelled_hosted} cancelled
              </Text>
            </View>
          </View>
          <Text style={styles.muted}>
            Totals include left and cancelled events. Hosting is separate from
            joining. Signups do not confirm attendance.
          </Text>
          <Text style={styles.subheading}>Your sports</Text>
          {summary.sports.length === 0 ? (
            <Text style={styles.muted}>
              Your sports will appear when you join or host an event.
            </Text>
          ) : (
            summary.sports.map((sport) => (
              <View key={sport.type} style={styles.line}>
                <Text style={styles.label}>{formatEventType(sport.type)}</Text>
                <Text style={styles.muted}>
                  {sport.joined} joined · {sport.hosted} hosted
                </Text>
              </View>
            ))
          )}
          <Text style={styles.subheading}>Top grounds</Text>
          <Text style={styles.muted}>
            Where you joined or hosted the most events.
          </Text>
          {summary.grounds.length === 0 ? (
            <Text style={styles.muted}>No grounds yet for this period.</Text>
          ) : (
            summary.grounds.map((ground) => (
              <View key={ground.id} style={styles.line}>
                <Text style={[styles.label, styles.groundName]}>
                  {ground.name}
                </Text>
                <Text style={styles.muted}>
                  {ground.events} {ground.events === 1 ? "event" : "events"}
                </Text>
              </View>
            ))
          )}
          <Text style={styles.subheading}>Activity history</Text>
          <Text style={styles.muted}>
            Actions taken in this period. Earlier unrecorded joins or leaves may
            be missing.
          </Text>
          {summary.history.length === 0 && (
            <Text style={styles.muted}>No activity yet for this period.</Text>
          )}
          {summary.history.map((entry) => (
            <Pressable
              accessibilityRole="button"
              key={`${entry.action}-${entry.entry_id}`}
              onPress={() => setEventID(entry.event_id)}
              style={styles.history}
            >
              <Text style={styles.action}>
                {actionLabels[entry.action]} ·{" "}
                {formatEventType(entry.type)}
              </Text>
              <Text style={styles.label}>{entry.title}</Text>
              <Text style={styles.muted}>
                {entry.place_name}
                {entry.event_status === "cancelled" ? " · Event cancelled" : ""}
              </Text>
              <Text style={styles.muted}>
                {new Date(entry.occurred_at).toLocaleString([], {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </Text>
            </Pressable>
          ))}
          {!loading && !error && summary.next_offset !== null && (
            <Pressable
              accessibilityRole="button"
              style={styles.control}
              onPress={() => {
                setOffset(summary.next_offset!);
                setLoading(true);
              }}
            >
              <Text style={styles.action}>Load more activity</Text>
            </Pressable>
          )}
        </>
      )}
      {loading && <ActivityIndicator color="#1D5B3A" />}
      {!!error && (
        <>
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
          <Pressable
            accessibilityRole="button"
            style={styles.control}
            onPress={() => {
              setError("");
              setLoading(true);
              setRefresh((value) => value + 1);
            }}
          >
            <Text style={styles.action}>Retry activity</Text>
          </Pressable>
        </>
      )}
      {eventID && (
        <EventDetails
          id={eventID}
          apiURL={apiURL}
          source="profile"
          closeLabel="Back to your activity"
          onClose={() => {
            setEventID(null);
            reload();
          }}
          onEventChanged={reload}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 16, marginTop: 16 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
  },
  heading: { fontFamily: "BigShoulders", fontSize: 36, color: "#15201B" },
  subheading: {
    fontSize: 20,
    fontWeight: "700",
    color: "#15201B",
    marginTop: 8,
  },
  row: { flexDirection: "row", gap: 12 },
  period: { borderRadius: 16, padding: 14, backgroundColor: "#E5E9DF" },
  selected: { backgroundColor: "#1D5B3A" },
  selectedText: { color: "white", fontSize: 16, fontWeight: "700" },
  stat: {
    flex: 1,
    backgroundColor: "#E5E9DF",
    padding: 16,
    borderRadius: 20,
    gap: 8,
  },
  number: { fontFamily: "BigShoulders", fontSize: 46, color: "#15201B" },
  label: { fontSize: 16, fontWeight: "700", color: "#15201B" },
  muted: { fontSize: 14, lineHeight: 21, color: "#6C786E" },
  line: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
  },
  groundName: { flex: 1 },
  action: { fontSize: 16, fontWeight: "700", color: "#1D5B3A" },
  history: {
    backgroundColor: "#E5E9DF",
    borderRadius: 20,
    padding: 20,
    gap: 8,
  },
  control: { paddingVertical: 12 },
  error: { fontSize: 14, lineHeight: 21, color: "#B51E2C" },
});
