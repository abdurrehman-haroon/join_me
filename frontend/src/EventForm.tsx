import { uuid } from "expo-modules-core";
import { useActivityInteraction } from "./ActivitiesProvider";
import { explore as theme } from "./ExploreCards";
import PlacePicker, {
  forgetPickerPlaces,
  kindName,
  type PickerStart,
} from "./PlacePicker";
import type { PinnedPlace } from "./PinSheet";
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
  entry,
  pickerStart = null,
  onClose,
  onSaved,
}: {
  // The place the form opened at; none when the ＋ opened it with nothing picked.
  place?: { id: string; name: string; coordinates?: [number, number] };
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
  // Where a new event's form was opened from, recorded when it starts.
  entry?: "create_tab" | "place_card";
  // Where the place picker's map opens (a district in view, say).
  pickerStart?: PickerStart;
  onClose: () => void;
  // A new event reports its ID and the creation interaction, for what follows posting.
  onSaved: (created?: { id: string; interactionID: string }) => void;
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
  const [chosen, setChosen] = useState<{
    id: string;
    name: string;
    detail?: string;
    coordinates?: [number, number];
    // A pinned place, created together with the event.
    newPlace?: PinnedPlace;
  } | null>(place ?? null);
  // With nothing picked, the picker opens straight over the form.
  const [picking, setPicking] = useState(false);
  // The interaction's first target stays fixed; later rows follow the pick.
  const [startTarget] = useState(() =>
    place ? { type: "place" as const, id: place.id } : null,
  );
  const interaction = useActivityInteraction({
    enabled: !event && shown,
    // The picker is part of creating, so its time counts as active.
    visible: shown,
    target: startTarget,
    source: "event_form",
    startAction: "event_creation_started",
    details: entry ? { entry } : {},
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
    if (!chosen) {
      setError("Pick a place first.");
      setPicking(true);
      return;
    }
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
        ...(chosen.newPlace
          ? {
              new_place: {
                name: chosen.newPlace.name,
                ...(chosen.newPlace.kindText
                  ? { kind_text: chosen.newPlace.kindText }
                  : { kind: chosen.newPlace.kind }),
                coordinates: chosen.newPlace.coordinates,
                private: chosen.newPlace.private,
              },
            }
          : { place_id: chosen.id }),
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
                  ...(!event && { place_id: chosen.id, type }),
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
      const created: { id?: string } | null = event
        ? null
        : await response.json().catch(() => null);
      const interactionID = interaction.current?.id;
      interaction.current?.close("completed");
      // The new place joins the picker's list next time it opens.
      if (chosen?.newPlace) forgetPickerPlaces();
      onSaved(
        created?.id && interactionID
          ? { id: created.id, interactionID }
          : undefined,
      );
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
      onShow={() => {
        setShown(true);
        if (!event && !chosen) setPicking(true);
      }}
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
          <Text style={styles.kicker}>{event ? "EDIT PLAN" : "NEW PLAN"}</Text>
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              chosen ? `Where: ${chosen.name}. Change place` : "Pick a place"
            }
            disabled={!!event || submitting || uncertainCreation}
            onPress={() => setPicking(true)}
            style={({ pressed }) => [
              styles.place,
              !chosen && styles.placeEmpty,
              pressed && styles.placePressed,
            ]}
          >
            <View style={[styles.placeDot, !chosen && styles.placeDotEmpty]} />
            <View style={styles.placeText}>
              <Text style={styles.placeKicker}>WHERE</Text>
              <Text
                style={[styles.placeName, !chosen && styles.placeNameEmpty]}
                numberOfLines={2}
              >
                {chosen?.name ?? "Pick a place"}
              </Text>
              {!!chosen?.detail && (
                <Text style={styles.muted}>{chosen.detail}</Text>
              )}
            </View>
            {!event && (
              <Text style={styles.change}>{chosen ? "Change" : "›"}</Text>
            )}
          </Pressable>
          <Text style={styles.label}>WHAT</Text>
          <TextInput
            accessibilityLabel="Event title"
            placeholder="Evening football"
            placeholderTextColor={theme.muted}
            value={title}
            onChangeText={setTitle}
            editable={!submitting && !uncertainCreation}
            style={styles.input}
          />
          <Text style={styles.label}>KIND</Text>
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
          {!event && place && chosen?.id === place.id && spots.length > 0 && (
            <>
              <Text style={styles.label}>
                WHERE AT {place.name.toUpperCase()}
              </Text>
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
          <Text style={styles.label}>DATE · YYYY-MM-DD</Text>
          <TextInput
            accessibilityLabel="Event date YYYY-MM-DD"
            value={date}
            onChangeText={setDate}
            editable={!submitting && !uncertainCreation}
            autoCorrect={false}
            autoCapitalize="none"
            style={styles.input}
          />
          <Text style={styles.label}>START TIME · HH:MM, 24-HOUR</Text>
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
          <Text style={styles.label}>HOW MANY PEOPLE · INCLUDING YOU</Text>
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
              <ActivityIndicator color={theme.cream} />
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
      {picking && (
        <PlacePicker
          apiURL={apiURL}
          // Changing the place reopens the map where the picked one is.
          start={
            chosen?.coordinates
              ? { center: chosen.coordinates, zoom: 15 }
              : pickerStart
          }
          onPick={(
            picked,
            districtName,
            via,
            position,
            resultCount,
            query,
            locationOn,
          ) => {
            // The pick and everything after it point at the picked place.
            const target = { type: "place" as const, id: picked.id };
            interaction.current?.setTarget(target);
            interaction.current?.record("place_search_selected", {
              via,
              position,
              result_count: resultCount,
              query,
              location_on: locationOn,
            });
            setChosen({
              id: picked.id,
              name: picked.name,
              detail: `${kindName(picked.type)} · ${districtName}`,
              coordinates: picked.coordinates,
            });
            setSpotID("");
            setError("");
            setPicking(false);
          }}
          onPinned={(pinned, district, tracking) => {
            // The place does not exist until the event is created, so the pin
            // and the rows after it have no target.
            interaction.current?.setTarget(null);
            interaction.current?.record(
              "place_pinned",
              { ...tracking, district: district.slug },
              undefined,
              null,
            );
            setChosen({
              id: "",
              name: pinned.name,
              detail: `${pinned.kindText ?? kindName(pinned.kind ?? "")} · ${district.name} · ${pinned.private ? "Private" : "New place"}`,
              coordinates: pinned.coordinates,
              newPlace: pinned,
            });
            setSpotID("");
            setError("");
            setPicking(false);
          }}
          onLocationAnswered={(answer) =>
            interaction.current?.record(
              "location_permission_answered",
              { answer },
              undefined,
              null,
            )
          }
          onBack={(resultCount, query, locationOn) => {
            interaction.current?.record(
              "place_search_abandoned",
              {
                query,
                result_count: resultCount,
                location_on: locationOn,
                reason: "back",
              },
              undefined,
              null,
            );
            setPicking(false);
          }}
        />
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.paper, paddingTop: 24 },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
  },
  kicker: {
    fontFamily: theme.bodyBold,
    color: theme.red,
    fontSize: 11,
    letterSpacing: 1.6,
  },
  close: { padding: 14, marginRight: -14 },
  action: { fontFamily: theme.bodyBold, color: theme.ink, fontSize: 14 },
  content: { padding: 24, paddingTop: 8, paddingBottom: 60, gap: 10 },
  title: {
    fontFamily: theme.display,
    fontSize: 52,
    lineHeight: 52,
    letterSpacing: -0.5,
    color: theme.ink,
  },
  body: {
    fontFamily: theme.body,
    color: theme.ink,
    fontSize: 16,
    lineHeight: 24,
  },
  muted: { fontFamily: theme.body, color: theme.muted, fontSize: 13 },
  // The place, as a card like the ones floating over the Explore map.
  place: {
    // Android keeps a dashed border unless solid is set explicitly.
    borderStyle: "solid",
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginTop: 6,
    padding: 16,
    borderRadius: 18,
    backgroundColor: theme.cream,
    borderWidth: 1,
    borderColor: theme.line,
  },
  placeEmpty: { borderStyle: "dashed", borderColor: theme.red },
  placePressed: { opacity: 0.75 },
  placeDotEmpty: { backgroundColor: theme.line, borderColor: theme.sage },
  placeNameEmpty: { color: theme.red },
  change: { fontFamily: theme.bodyBold, fontSize: 13, color: theme.red },
  placeDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: theme.red,
    borderWidth: 3,
    borderColor: "#F6C9B9",
  },
  placeText: { flex: 1, gap: 2 },
  placeKicker: {
    fontFamily: theme.bodyBold,
    color: theme.muted,
    fontSize: 10,
    letterSpacing: 1.4,
  },
  placeName: {
    fontFamily: theme.displayBold,
    color: theme.ink,
    fontSize: 24,
    lineHeight: 26,
  },
  label: {
    fontFamily: theme.bodyBold,
    color: theme.muted,
    fontSize: 11,
    letterSpacing: 1.4,
    marginTop: 14,
  },
  input: {
    fontFamily: theme.bodyMedium,
    backgroundColor: theme.cream,
    color: theme.ink,
    paddingHorizontal: 16,
    paddingVertical: 15,
    borderRadius: 14,
    fontSize: 16,
    borderWidth: 1,
    borderColor: theme.line,
  },
  types: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  type: {
    backgroundColor: theme.sage,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.line,
  },
  selectedType: { backgroundColor: theme.ink, borderColor: theme.ink },
  white: { color: theme.cream },
  error: {
    fontFamily: theme.body,
    color: "#B51E2C",
    fontSize: 14,
    lineHeight: 21,
  },
  submit: {
    backgroundColor: theme.red,
    paddingVertical: 18,
    borderRadius: 18,
    alignItems: "center",
    marginTop: 18,
    shadowColor: "#5B2A17",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  submitText: { fontFamily: theme.bodyBold, color: theme.cream, fontSize: 16 },
  disabled: { opacity: 0.6 },
});
