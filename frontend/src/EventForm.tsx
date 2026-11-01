import { uuid } from "expo-modules-core";
import { useActivityInteraction } from "./ActivitiesProvider";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

export default function EventForm({
  place,
  spots = [],
  event,
  apiURL,
  onClose,
  onSaved,
}: {
  place: { id: string; name: string };
  spots?: { id: string; name: string }[];
  event?: {
    id: string;
    title: string;
    type: "football" | "cricket";
    starts_at: string;
    capacity: number;
    participant_count: number;
  };
  apiURL: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [initialStart] = useState(() => {
    if (event) return new Date(event.starts_at);
    const start = new Date();
    start.setDate(start.getDate() + 1);
    start.setHours(18, 0, 0, 0);
    return start;
  });
  const [title, setTitle] = useState(event?.title ?? "");
  const [type, setType] = useState<"football" | "cricket">(
    event?.type ?? "football",
  );
  const [date, setDate] = useState(
    () =>
      `${initialStart.getFullYear()}-${String(initialStart.getMonth() + 1).padStart(2, "0")}-${String(initialStart.getDate()).padStart(2, "0")}`,
  );
  const [time, setTime] = useState(
    () =>
      `${String(initialStart.getHours()).padStart(2, "0")}:${String(initialStart.getMinutes()).padStart(2, "0")}`,
  );
  const [capacity, setCapacity] = useState(String(event?.capacity ?? 10));
  const [spotID, setSpotID] = useState("");
  const [shown, setShown] = useState(false);
  const interaction = useActivityInteraction({
    enabled: !event && shown,
    visible: shown,
    target: { type: "place", id: place.id },
    source: "event_form",
    startAction: "event_creation_started",
  });
  const attempt = useRef(0);
  const creationRequest = useRef<{
    body: string;
    headers: Record<string, string>;
  } | null>(null);
  const [uncertainCreation, setUncertainCreation] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  async function submit() {
    if (pending.current) return;
    setError("");
    if (
      !uncertainCreation &&
      (!title.trim() || [...title.trim()].length > 200)
    ) {
      setError("Enter a title with 1 to 200 characters.");
      return;
    }
    // Reject calendar rollover (for example February 30) and ambiguous input formats.
    const startsAt = new Date(`${date}T${time}:00`);
    const [year, month, day] = date.split("-").map(Number);
    const [hour, minute] = time.split(":").map(Number);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !/^\d{2}:\d{2}$/.test(time) ||
      Number.isNaN(startsAt.getTime()) ||
      startsAt.getFullYear() !== year ||
      startsAt.getMonth() + 1 !== month ||
      startsAt.getDate() !== day ||
      startsAt.getHours() !== hour ||
      startsAt.getMinutes() !== minute
    ) {
      setError("Enter a valid date as YYYY-MM-DD and time as HH:mm (24-hour).");
      return;
    }
    // Preserve the original seconds when only title/capacity changed.
    const originalMinute = new Date(initialStart);
    originalMinute.setSeconds(0, 0);
    if (event && startsAt.getTime() === originalMinute.getTime()) {
      startsAt.setSeconds(
        initialStart.getSeconds(),
        initialStart.getMilliseconds(),
      );
    }
    if (!uncertainCreation && startsAt.getTime() <= Date.now()) {
      setError("Choose a start time in the future.");
      return;
    }
    const spots = Number(capacity);
    if (
      !/^\d+$/.test(capacity) ||
      !Number.isInteger(spots) ||
      spots < 1 ||
      spots > 2147483647
    ) {
      setError("Capacity must be a positive whole number, including the host.");
      return;
    }
    if (event && spots < event.participant_count) {
      setError(
        `Capacity must be at least ${event.participant_count}, the current participant count.`,
      );
      return;
    }
    let creation = creationRequest.current;
    if (!event && !uncertainCreation) {
      const body = JSON.stringify({
        place_id: place.id,
        ...(spotID && { spot_id: spotID }),
        type,
        title: title.trim(),
        starts_at: startsAt.toISOString(),
        capacity: spots,
      });
      if (!creation || creation.body !== body) {
        interaction.current?.record("event_creation_submitted", {
          attempt_number: ++attempt.current,
        });
        creation = {
          body,
          headers: interaction.current?.headers(uuid.v4()) ?? {},
        };
        creationRequest.current = creation;
      }
    }
    pending.current = true;
    setSubmitting(true);
    const requestController = new AbortController();
    controller.current = requestController;
    const timeout = setTimeout(() => requestController.abort(), 12000);
    try {
      const response = await fetch(
        `${apiURL}/events${event ? `/${event.id}` : ""}`,
        {
          method: event ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            ...(!event && creation ? creation.headers : {}),
          },
          signal: requestController.signal,
          body:
            !event && creation
              ? creation.body
              : JSON.stringify({
                  ...(!event && { place_id: place.id, type }),
                  title: title.trim(),
                  starts_at: startsAt.toISOString(),
                  capacity: spots,
                }),
        },
      );
      if (!response.ok) {
        if (!event) {
          const uncertain = response.status >= 500;
          setUncertainCreation(uncertain);
          if (!uncertain) creationRequest.current = null;
        }
        const message = await response.text();
        setError(message.trim() || "Could not save the event.");
        return;
      }
      interaction.current?.close("completed");
      onSaved();
    } catch {
      if (!event) setUncertainCreation(true);
      setError(
        event
          ? "Could not confirm the changes. Your draft is kept; retry or close to refresh the event."
          : "Could not confirm creation. Retry to confirm the same request, or close and check this place’s events.",
      );
    } finally {
      clearTimeout(timeout);
      controller.current = null;
      pending.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Modal
      visible
      onShow={() => setShown(true)}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        if (!pending.current) onClose();
      }}
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.heading}>
          <Text style={styles.kicker}>
            {event ? "EDIT EVENT" : "NEW EVENT"}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={submitting}
            onPress={onClose}
            style={styles.close}
          >
            <Text style={styles.action}>Cancel</Text>
          </Pressable>
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          <Text style={styles.title}>
            {event ? "Update your plan." : "Make a plan."}
          </Text>
          <Text style={styles.body}>{place.name}</Text>
          <Text style={styles.muted}>
            {event ? "Update the details below." : "Choose the details below."}
          </Text>
          <Text style={styles.label}>Title</Text>
          <TextInput
            accessibilityLabel="Event title"
            placeholder="Evening football"
            placeholderTextColor="#6C786E"
            value={title}
            onChangeText={setTitle}
            editable={!submitting && !uncertainCreation}
            style={styles.input}
          />
          <Text style={styles.label}>Event type</Text>
          {event ? (
            <Text style={styles.body}>
              {type === "football" ? "Football" : "Cricket"} · fixed for this
              event
            </Text>
          ) : (
            <View style={styles.types}>
              {(["football", "cricket"] as const).map((option) => (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  accessibilityState={{ selected: type === option }}
                  disabled={submitting || uncertainCreation}
                  onPress={() => setType(option)}
                  style={[styles.type, type === option && styles.selectedType]}
                >
                  <Text
                    style={[styles.action, type === option && styles.white]}
                  >
                    {option === "football" ? "Football" : "Cricket"}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          {!event && spots.length > 0 && (
            <>
              <Text style={styles.label}>Where at {place.name}</Text>
              <View style={styles.types}>
                {[{ id: "", name: "Anywhere" }, ...spots].map((spot) => (
                  <Pressable
                    key={spot.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: spotID === spot.id }}
                    disabled={submitting || uncertainCreation}
                    onPress={() => setSpotID(spot.id)}
                    style={[
                      styles.type,
                      spotID === spot.id && styles.selectedType,
                    ]}
                  >
                    <Text
                      style={[
                        styles.action,
                        spotID === spot.id && styles.white,
                      ]}
                    >
                      {spot.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
          <Text style={styles.label}>Date · YYYY-MM-DD</Text>
          <TextInput
            accessibilityLabel="Event date YYYY-MM-DD"
            value={date}
            onChangeText={setDate}
            editable={!submitting && !uncertainCreation}
            autoCorrect={false}
            autoCapitalize="none"
            style={styles.input}
          />
          <Text style={styles.label}>Start time · HH:mm (24-hour)</Text>
          <TextInput
            accessibilityLabel="Start time HH:mm"
            value={time}
            onChangeText={setTime}
            editable={!submitting && !uncertainCreation}
            autoCorrect={false}
            autoCapitalize="none"
            style={styles.input}
          />
          <Text style={styles.muted}>Uses your phone’s local time zone.</Text>
          <Text style={styles.label}>Capacity · includes you as host</Text>
          <TextInput
            accessibilityLabel="Capacity including host"
            value={capacity}
            onChangeText={setCapacity}
            editable={!submitting && !uncertainCreation}
            keyboardType="number-pad"
            style={styles.input}
          />
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
          <Pressable
            accessibilityRole="button"
            disabled={submitting}
            onPress={() => void submit()}
            style={[styles.submit, submitting && styles.disabled]}
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.submitText}>
                {event
                  ? "Save changes"
                  : uncertainCreation
                    ? "Confirm creation"
                    : "Create event"}
              </Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F4F5F0", paddingTop: 24 },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 22,
  },
  kicker: {
    color: "#1D5B3A",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.3,
  },
  close: { padding: 14 },
  action: { color: "#1D5B3A", fontWeight: "700", fontSize: 14 },
  content: { padding: 24, paddingBottom: 60, gap: 12 },
  title: { fontFamily: "BigShoulders", fontSize: 46, color: "#15201B" },
  body: { color: "#15201B", fontSize: 16, lineHeight: 24 },
  muted: { color: "#6C786E", fontSize: 13 },
  label: { color: "#15201B", fontSize: 14, fontWeight: "700", marginTop: 12 },
  input: {
    backgroundColor: "#FFFFFF",
    color: "#15201B",
    padding: 16,
    borderRadius: 14,
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#DEE3D8",
  },
  types: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  type: { backgroundColor: "#E5E9DF", padding: 14, borderRadius: 20 },
  selectedType: { backgroundColor: "#1D5B3A" },
  white: { color: "#FFFFFF" },
  error: { color: "#B51E2C", fontSize: 14, lineHeight: 21 },
  submit: {
    backgroundColor: "#1D5B3A",
    padding: 18,
    borderRadius: 20,
    alignItems: "center",
    marginTop: 12,
  },
  submitText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  disabled: { opacity: 0.6 },
});
