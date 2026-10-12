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
  event,
  apiURL,
  onClose,
  onSaved,
}: {
  place: { id: string; name: string };
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
  const [type, setType] = useState<"football" | "cricket">(event?.type ?? "football");
  const [date, setDate] = useState(
    () =>
      `${initialStart.getFullYear()}-${String(initialStart.getMonth() + 1).padStart(2, "0")}-${String(initialStart.getDate()).padStart(2, "0")}`,
  );
  const [time, setTime] = useState(
    () => `${String(initialStart.getHours()).padStart(2, "0")}:${String(initialStart.getMinutes()).padStart(2, "0")}`,
  );
  const [capacity, setCapacity] = useState(String(event?.capacity ?? 10));
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  async function submit() {
    if (pending.current) return;
    setError("");
    if (!title.trim() || [...title.trim()].length > 200) {
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
      startsAt.setSeconds(initialStart.getSeconds(), initialStart.getMilliseconds());
    }
    if (startsAt.getTime() <= Date.now()) {
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
      setError(`Capacity must be at least ${event.participant_count}, the current participant count.`);
      return;
    }
    pending.current = true;
    setSubmitting(true);
    const requestController = new AbortController();
    controller.current = requestController;
    const timeout = setTimeout(() => requestController.abort(), 12000);
    try {
      const response = await fetch(`${apiURL}/events${event ? `/${event.id}` : ""}`, {
        method: event ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        signal: requestController.signal,
        body: JSON.stringify({
          ...(!event && { place_id: place.id, type }),
          title: title.trim(),
          starts_at: startsAt.toISOString(),
          capacity: spots,
        }),
      });
      if (!response.ok) {
        const message = await response.text();
        setError(message.trim() || "Could not save the event.");
        return;
      }
      onSaved();
    } catch {
      setError(
        event
          ? "Could not confirm the changes. Your draft is kept; retry or close to refresh the event."
          : "Could not confirm creation. Close and check this place’s events before trying again.",
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
          <Text style={styles.kicker}>{event ? "EDIT EVENT" : "NEW EVENT"}</Text>
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
          <Text style={styles.title}>{event ? "Update your plan." : "Make a plan."}</Text>
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
            editable={!submitting}
            style={styles.input}
          />
          <Text style={styles.label}>Event type</Text>
          {event ? <Text style={styles.body}>{type === "football" ? "Football" : "Cricket"} · fixed for this event</Text> : <View style={styles.types}>
            {(["football", "cricket"] as const).map((option) => (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityState={{ selected: type === option }}
                disabled={submitting}
                onPress={() => setType(option)}
                style={[styles.type, type === option && styles.selectedType]}
              >
                <Text style={[styles.action, type === option && styles.white]}>
                  {option === "football" ? "Football" : "Cricket"}
                </Text>
              </Pressable>
            ))}
          </View>}
          <Text style={styles.label}>Date · YYYY-MM-DD</Text>
          <TextInput
            accessibilityLabel="Event date YYYY-MM-DD"
            value={date}
            onChangeText={setDate}
            editable={!submitting}
            autoCorrect={false}
            autoCapitalize="none"
            style={styles.input}
          />
          <Text style={styles.label}>Start time · HH:mm (24-hour)</Text>
          <TextInput
            accessibilityLabel="Start time HH:mm"
            value={time}
            onChangeText={setTime}
            editable={!submitting}
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
            editable={!submitting}
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
              <Text style={styles.submitText}>{event ? "Save changes" : "Create event"}</Text>
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
  types: { flexDirection: "row", gap: 10 },
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
