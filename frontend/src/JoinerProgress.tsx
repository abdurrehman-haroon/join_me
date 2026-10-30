import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

export type ParticipationProgress = {
  event_goal_target: number | null;
  event_goal_period: "weekly" | "monthly" | null;
  goal_progress: number;
  goal_starts_at: string | null;
  goal_ends_at: string | null;
  eligible_joined: number;
  football_joined: number;
  cricket_joined: number;
  padel_joined: number;
  month_starts_at: string;
  month_ends_at: string;
  month_joined: number;
  previous_month_joined: number;
  month_sports: number;
  month_grounds: number;
  month_hosted: number;
};

export default function JoinerProgress({
  progress,
  apiURL,
  onSaved,
}: {
  progress: ParticipationProgress;
  apiURL: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState("");
  const [period, setPeriod] = useState<"weekly" | "monthly">("weekly");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const saveController = useRef<AbortController | null>(null);
  useEffect(() => () => saveController.current?.abort(), []);

  async function saveGoal(turnOff = false) {
    const goalTarget = Number(target.trim());
    if (
      !turnOff &&
      (!/^[1-9]\d*$/.test(target.trim()) ||
        !Number.isSafeInteger(goalTarget) ||
        goalTarget > 2147483647)
    ) {
      setError("Enter a whole number from 1 to 2,147,483,647.");
      return;
    }
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError("");
    const controller = new AbortController();
    saveController.current = controller;
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${apiURL}/me/event-goal`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_goal_target: turnOff ? null : goalTarget,
          event_goal_period: turnOff ? null : period,
        }),
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error(
          (await response.text()).trim() || "Could not save your goal.",
        );
      setEditing(false);
      onSaved();
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not save your goal.",
        );
      else
        setError(
          "Could not confirm saving. Your choices are kept; retry the same action.",
        );
    } finally {
      clearTimeout(timeout);
      saveController.current = null;
      pending.current = false;
      setSaving(false);
    }
  }

  const milestones = [
    ...(progress.eligible_joined >= 1 ? ["First event joined"] : []),
    ...[5, 10, 25]
      .filter((count) => progress.eligible_joined >= count)
      .map((count) => `${count} events joined`),
    ...(progress.football_joined > 0 ? ["First football signup"] : []),
    ...(progress.cricket_joined > 0 ? ["First cricket signup"] : []),
    ...(progress.padel_joined > 0 ? ["First padel signup"] : []),
  ];
  const nextMilestone = [1, 5, 10, 25].find(
    (count) => progress.eligible_joined < count,
  );
  const monthName = new Date(progress.month_starts_at).toLocaleDateString([], {
    month: "long",
    year: "numeric",
  });

  return (
    <View style={styles.section}>
      <View style={styles.card}>
        <Text style={styles.heading}>Your event goal</Text>
        {progress.event_goal_target !== null ? (
          <>
            <Text style={styles.number}>
              {progress.goal_progress} of {progress.event_goal_target}
            </Text>
            <Text style={styles.label}>
              Events this{" "}
              {progress.event_goal_period === "weekly" ? "week" : "month"}
            </Text>
            {progress.goal_starts_at && progress.goal_ends_at && (
              <Text style={styles.muted}>
                {new Date(progress.goal_starts_at).toLocaleDateString([], {
                  month: "short",
                  day: "numeric",
                })}{" "}
                –{" "}
                {new Date(
                  new Date(progress.goal_ends_at).getTime() - 1,
                ).toLocaleDateString([], {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </Text>
            )}
            {progress.goal_progress >= progress.event_goal_target && (
              <Text accessibilityLiveRegion="polite" style={styles.action}>
                Goal reached!
              </Text>
            )}
          </>
        ) : (
          <Text style={styles.muted}>
            Choose a weekly or monthly signup goal that suits you.
          </Text>
        )}
        <Text style={styles.muted}>
          Counts events scheduled in this period where you remain signed up.
          Your hosted events and cancelled events are excluded. Weeks start
          Monday.
        </Text>
        {!editing ? (
          <Pressable
            accessibilityRole="button"
            style={styles.button}
            onPress={() => {
              setTarget(String(progress.event_goal_target ?? 2));
              setPeriod(progress.event_goal_period ?? "weekly");
              setError("");
              setEditing(true);
            }}
          >
            <Text style={styles.buttonText}>
              {progress.event_goal_target === null
                ? "Set event goal"
                : "Change event goal"}
            </Text>
          </Pressable>
        ) : (
          <View style={styles.section}>
            <View style={styles.row}>
              {(["weekly", "monthly"] as const).map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: period === value }}
                  disabled={saving}
                  onPress={() => setPeriod(value)}
                  style={[styles.choice, period === value && styles.selected]}
                >
                  <Text
                    style={period === value ? styles.buttonText : styles.action}
                  >
                    {value === "weekly" ? "Weekly" : "Monthly"}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>
              Target events per {period === "weekly" ? "week" : "month"}
            </Text>
            <View style={styles.row}>
              {(period === "weekly" ? [1, 2, 3] : [4, 8, 12]).map((count) => (
                <Pressable
                  key={count}
                  accessibilityRole="button"
                  accessibilityLabel={`Set target to ${count}`}
                  accessibilityState={{ selected: target === String(count) }}
                  disabled={saving}
                  onPress={() => setTarget(String(count))}
                  style={[
                    styles.choice,
                    target === String(count) && styles.selected,
                  ]}
                >
                  <Text
                    style={
                      target === String(count)
                        ? styles.buttonText
                        : styles.action
                    }
                  >
                    {count}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              accessibilityLabel="Event goal target"
              value={target}
              onChangeText={setTarget}
              editable={!saving}
              keyboardType="number-pad"
              maxLength={10}
              style={styles.input}
            />
            <Text style={styles.muted}>
              Changes apply to the current and following periods. Leaving or
              cancellation can reduce progress.
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              style={[styles.button, saving && styles.disabled]}
              onPress={() => void saveGoal()}
            >
              {saving ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.buttonText}>Save event goal</Text>
              )}
            </Pressable>
            {progress.event_goal_target !== null && (
              <Pressable
                accessibilityRole="button"
                disabled={saving}
                style={styles.control}
                onPress={() => void saveGoal(true)}
              >
                <Text style={styles.action}>Turn goal off</Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              style={styles.control}
              onPress={() => {
                setEditing(false);
                setError("");
              }}
            >
              <Text style={styles.action}>Cancel</Text>
            </Pressable>
            {!!error && (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            )}
          </View>
        )}
      </View>
      <View style={styles.card}>
        <Text style={styles.heading}>Your milestones</Text>
        <Text style={styles.muted}>
          Based on retained, non-cancelled signups, including upcoming events.
          Leaving or cancellation can remove a milestone.
        </Text>
        {milestones.length === 0 ? (
          <Text style={styles.label}>
            Your first signup starts your milestones.
          </Text>
        ) : (
          milestones.map((milestone) => (
            <Text key={milestone} style={styles.badge}>
              {milestone}
            </Text>
          ))
        )}
        {nextMilestone !== undefined && (
          <Text style={styles.action}>
            Next milestone: {progress.eligible_joined} of {nextMilestone} events
            joined
          </Text>
        )}
      </View>
      <View style={styles.card}>
        <Text style={styles.heading}>{monthName} recap</Text>
        <Text style={styles.number}>{progress.month_joined} joined</Text>
        <Text style={styles.label}>
          {progress.month_sports}{" "}
          {progress.month_sports === 1 ? "sport" : "sports"} ·{" "}
          {progress.month_grounds}{" "}
          {progress.month_grounds === 1 ? "ground" : "grounds"}
        </Text>
        <Text style={styles.muted}>
          Last month: {progress.previous_month_joined} joined
        </Text>
        <Text style={styles.label}>
          Hosted separately: {progress.month_hosted}
        </Text>
        <Text style={styles.muted}>
          By scheduled event date in your local month, including upcoming
          events. Joined counts exclude your hosted events, cancelled events and
          events you left. Hosting excludes cancelled events. Signups do not
          confirm attendance.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 16 },
  card: { backgroundColor: "#E5E9DF", borderRadius: 20, padding: 20, gap: 12 },
  heading: { fontFamily: "BigShoulders", fontSize: 30, color: "#15201B" },
  number: { fontFamily: "BigShoulders", fontSize: 42, color: "#15201B" },
  label: { fontSize: 16, fontWeight: "700", color: "#15201B" },
  muted: { fontSize: 14, lineHeight: 21, color: "#6C786E" },
  action: { fontSize: 16, fontWeight: "700", color: "#1D5B3A" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  choice: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: "#F4F5F0",
    minWidth: 44,
    alignItems: "center",
  },
  selected: { backgroundColor: "#1D5B3A" },
  button: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: "#1D5B3A",
    alignItems: "center",
  },
  buttonText: { color: "white", fontSize: 16, fontWeight: "700" },
  input: {
    backgroundColor: "white",
    padding: 16,
    borderRadius: 14,
    color: "#15201B",
    fontSize: 18,
  },
  badge: {
    color: "#1D5B3A",
    fontSize: 16,
    fontWeight: "700",
    backgroundColor: "#F4F5F0",
    borderRadius: 12,
    padding: 14,
    overflow: "hidden",
  },
  control: { paddingVertical: 12 },
  disabled: { opacity: 0.5 },
  error: { color: "#B51E2C", fontSize: 14, lineHeight: 21 },
});
