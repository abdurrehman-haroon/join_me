import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

type SignupInsights = {
  history_complete: boolean;
  unique_players_joined: number;
  unique_players_left: number;
  first_signup_at: string | null;
  first_signup_seconds: number | null;
  first_full_at: string | null;
  first_full_seconds: number | null;
  first_full_reason:
    | "signup"
    | "capacity_reduction"
    | "initial_capacity"
    | null;
};

function signupDelay(seconds: number) {
  if (seconds < 60) return "less than a minute";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

export default function HostSignupInsights({
  eventID,
  apiURL,
  revision,
  participantCount,
  capacity,
}: {
  eventID: string;
  apiURL: string;
  revision: string;
  participantCount: number;
  capacity: number;
}) {
  const [insights, setInsights] = useState<SignupInsights | null>(null);
  const [loadedRevision, setLoadedRevision] = useState<string | null>(null);
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
          `${apiURL}/events/${eventID}/signup-insights`,
          { signal: controller.signal },
        );
        if (active && (response.status === 403 || response.status === 404))
          setInsights(null);
        if (!response.ok)
          throw new Error(
            (await response.text()).trim() || "Could not load signup insights.",
          );
        const summary: SignupInsights = await response.json();
        if (active) {
          setInsights(summary);
          setLoadedRevision(revision);
          setError("");
        }
      } catch (failure) {
        if (active)
          setError(
            failure instanceof Error && failure.name !== "AbortError"
              ? failure.message
              : "Could not load signup insights. Try again.",
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
  }, [eventID, apiURL, revision, retry]);

  function refreshInsights() {
    setLoading(true);
    setError("");
    setRetry((value) => value + 1);
  }

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Signup insights</Text>
      <Text style={styles.muted}>Only visible to the host</Text>
      <Text style={styles.label}>
        {participantCount} of {capacity} spots filled ·{" "}
        {Math.max(0, capacity - participantCount)} remaining
      </Text>
      <Text style={styles.muted}>Capacity includes your spot as host.</Text>
      {loading && !insights && <ActivityIndicator color="#1D5B3A" />}
      {insights && !error && (loading || loadedRevision !== revision) && (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          Updating signup insights…
        </Text>
      )}
      {insights && (
        <>
          <Text style={styles.label}>
            {insights.unique_players_joined}{" "}
            {insights.unique_players_joined === 1
              ? "player has"
              : "players have"}{" "}
            signed up
          </Text>
          <Text style={styles.body}>
            {insights.unique_players_left}{" "}
            {insights.unique_players_left === 1 ? "player has" : "players have"}{" "}
            left at least once.
          </Text>
          <Text style={styles.muted}>
            Player counts exclude you. Rejoining counts once; someone who
            rejoins still counts as having left.
          </Text>
          <Text style={styles.label}>
            First {insights.history_complete ? "" : "known "}signup
          </Text>
          {insights.first_signup_at !== null &&
          insights.first_signup_seconds !== null ? (
            <>
              <Text style={styles.body}>
                {signupDelay(insights.first_signup_seconds)} after creation
              </Text>
              <Text style={styles.muted}>
                {new Date(insights.first_signup_at).toLocaleString()}
              </Text>
            </>
          ) : (
            <Text style={styles.body}>
              {insights.history_complete
                ? "No players have signed up yet."
                : "No signup recorded."}
            </Text>
          )}
          <Text style={styles.label}>First recorded capacity milestone</Text>
          {insights.first_full_at !== null &&
          insights.first_full_seconds !== null ? (
            <>
              <Text style={styles.body}>
                {insights.first_full_reason === "initial_capacity"
                  ? "Full when created — your spot filled the initial capacity."
                  : `Reached capacity ${signupDelay(insights.first_full_seconds)} after creation${insights.first_full_reason === "capacity_reduction" ? " by reducing capacity." : " through signups."}`}
              </Text>
              <Text style={styles.muted}>
                {new Date(insights.first_full_at).toLocaleString()}
              </Text>
            </>
          ) : (
            <Text style={styles.body}>No capacity milestone recorded.</Text>
          )}
          {!insights.history_complete && (
            <Text style={styles.muted}>
              This event predates complete tracking. Earlier signups, leaves and
              capacity milestones may be missing.
            </Text>
          )}
        </>
      )}
      {!!error && (
        <>
          <Text accessibilityRole="alert" style={styles.error}>
            {insights
              ? `Could not update. Showing the last loaded insights. ${error}`
              : error}
          </Text>
          <Pressable
            accessibilityRole="button"
            style={styles.refresh}
            onPress={refreshInsights}
          >
            <Text style={styles.action}>Retry signup insights</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#E5E9DF", borderRadius: 20, padding: 20, gap: 12 },
  heading: { fontFamily: "BigShoulders", fontSize: 30, color: "#15201B" },
  label: { color: "#15201B", fontSize: 16, fontWeight: "700" },
  body: { color: "#15201B", fontSize: 16, lineHeight: 23 },
  muted: { color: "#6C786E", fontSize: 14, lineHeight: 21 },
  action: { color: "#1D5B3A", fontSize: 16, fontWeight: "700" },
  refresh: { paddingVertical: 12 },
  error: { color: "#B51E2C", fontSize: 14, lineHeight: 21 },
});
