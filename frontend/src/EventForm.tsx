import { uuid } from "expo";
import * as Haptics from "expo-haptics";
import { useActivityInteraction } from "./ActivitiesProvider";
import { sportNames, type Sport } from "./activities";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { colors, displayFont, minTouch, type as textStyles } from "./theme";
import { PressableScale, SegmentedControl } from "./ui";

const sports = ["football", "cricket", "padel"] as const;

export default function EventForm({
  place,
  event,
  defaultType = "football",
  apiURL,
  onClose,
  onSaved,
}: {
  place: { id: string; name: string };
  event?: {
    id: string;
    title: string;
    type: Sport;
    starts_at: string;
    capacity: number;
    participant_count: number;
  };
  // The sport a new event starts with, e.g. padel at a padel venue.
  defaultType?: Sport;
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
  const [type, setType] = useState<Sport>(event?.type ?? defaultType);
  const [date, setDate] = useState(
    () =>
      `${initialStart.getFullYear()}-${String(initialStart.getMonth() + 1).padStart(2, "0")}-${String(initialStart.getDate()).padStart(2, "0")}`,
  );
  const [time, setTime] = useState(
    () =>
      `${String(initialStart.getHours()).padStart(2, "0")}:${String(initialStart.getMinutes()).padStart(2, "0")}`,
  );
  // Padel is doubles: four players including the host.
  const [capacity, setCapacity] = useState(
    String(event?.capacity ?? (type === "padel" ? 4 : 10)),
  );
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
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
          <PressableScale
            accessibilityRole="button"
            disabled={submitting}
            onPress={onClose}
            style={styles.close}
          >
            <Text style={styles.action}>Cancel</Text>
          </PressableScale>
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
            placeholder={`Evening ${sportNames[type].toLowerCase()}`}
            placeholderTextColor={colors.secondary}
            value={title}
            onChangeText={setTitle}
            editable={!submitting && !uncertainCreation}
            style={styles.input}
          />
          <Text style={styles.label}>Event type</Text>
          {event ? (
            <Text style={styles.body}>
              {sportNames[type]} · fixed for this event
            </Text>
          ) : (
            <SegmentedControl
              accessibilityLabel="Event type"
              values={sports.map((option) => sportNames[option])}
              selectedIndex={sports.indexOf(type)}
              enabled={!submitting && !uncertainCreation}
              onChange={(change) => {
                const option = sports[change.nativeEvent.selectedSegmentIndex];
                if (option) setType(option);
              }}
              appearance="light"
              fontStyle={{ color: colors.ink, fontSize: 15, fontWeight: "500" }}
              activeFontStyle={{ color: colors.ink, fontSize: 15, fontWeight: "600" }}
              style={styles.types}
            />
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
          <PressableScale
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
                  ? "Save Changes"
                  : uncertainCreation
                    ? "Confirm Creation"
                    : "Create Event"}
              </Text>
            )}
          </PressableScale>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.chalk, paddingTop: 12 },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: 20,
    paddingRight: 8,
  },
  kicker: {
    ...textStyles.footnote,
    fontWeight: "600",
    letterSpacing: 0.6,
    color: colors.tint,
  },
  close: { minHeight: minTouch, justifyContent: "center", paddingHorizontal: 12 },
  action: { ...textStyles.body, fontWeight: "600", color: colors.tint },
  content: { padding: 20, paddingBottom: 60, gap: 8 },
  title: { fontFamily: displayFont, fontSize: 44, lineHeight: 48, color: colors.ink },
  body: { ...textStyles.body, color: colors.ink },
  muted: { ...textStyles.footnote, color: colors.secondary },
  label: {
    ...textStyles.footnote,
    fontWeight: "600",
    color: colors.secondary,
    textTransform: "uppercase",
    marginTop: 16,
    marginLeft: 4,
  },
  input: {
    ...textStyles.body,
    minHeight: 50,
    backgroundColor: colors.surface,
    color: colors.ink,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderCurve: "continuous",
  },
  types: { height: 36 },
  error: { ...textStyles.subheadline, color: colors.signal },
  submit: {
    backgroundColor: colors.tint,
    minHeight: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
  },
  submitText: { ...textStyles.headline, color: colors.surface },
  disabled: { opacity: 0.6 },
});
