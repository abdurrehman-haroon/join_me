import { uuid } from "expo-modules-core";
import { useActivityInteraction } from "./ActivitiesProvider";
import type { ActivitySource } from "./activities";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { compareSequence, validSequence } from "./realtime";
import { useRealtimeTarget, liveStatusText } from "./RealtimeProvider";
import EventForm from "./EventForm";
import EventChat from "./EventChat";
import HostSignupInsights from "./HostSignupInsights";
import { ShareButtons, useShareEvent } from "./share";

type Person = { id: string; display_name: string };
export type EventSummary = {
  id: string;
  title: string;
  type: "football" | "cricket";
  starts_at: string;
  capacity: number;
  participant_count: number;
  available_spots: number;
  is_full: boolean;
  host: Person;
  place: { id: string; name: string; coordinates: [number, number] };
  spot: { id: string; name: string; coordinates: [number, number] } | null;
  status: { id: string; name: string; slug: string };
  created_at: string;
  updated_at: string;
};
type EventDetail = EventSummary & {
  sequence: string;
  participants: Person[];
  viewer: { id: string | null; is_host: boolean; is_participant: boolean };
};

function forViewer(detail: EventDetail, viewerID: string | null): EventDetail {
  return {
    ...detail,
    viewer: {
      id: viewerID,
      is_host: detail.host.id === viewerID,
      is_participant: detail.participants.some(
        (person) => person.id === viewerID,
      ),
    },
  };
}

export default function EventDetails({
  id,
  apiURL,
  onClose,
  closeLabel,
  source,
  referrerInteractionID,
  onEventChanged,
}: {
  id: string | null;
  apiURL: string;
  onClose: () => void;
  closeLabel: string;
  source: ActivitySource;
  referrerInteractionID?: string;
  onEventChanged: () => void;
}) {
  const shareEvent = useShareEvent();
  const [editing, setEditing] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [actionError, setActionError] = useState("");
  const bufferedDetail = useRef<EventDetail | null>(null);
  const { status: liveStatus, remember } = useRealtimeTarget(
    "event_details",
    id,
    {
      ready: () => setRetry((value) => value + 1),
      update: (frame) => {
        if (frame.type === "resync") {
          setRetry((value) => value + 1);
          return;
        }
        const detail = frame.payload as EventDetail;
        if (detail?.id !== id || !validSequence(frame.sequence)) return;
        const sequence = frame.sequence;
        if (
          bufferedDetail.current?.id !== id ||
          compareSequence(sequence, bufferedDetail.current.sequence) > 0
        )
          bufferedDetail.current = { ...detail, sequence };
        remember(sequence);
        setEvent((current) => {
          if (
            !current ||
            current.id !== id ||
            compareSequence(sequence, current.sequence) <= 0
          )
            return current;
          return forViewer({ ...detail, sequence }, current.viewer.id);
        });
        setError("");
      },
      error: (code) =>
        setError(
          code === "not_found"
            ? "This event is no longer available."
            : "Live updates are unavailable. Reconnecting…",
        ),
    },
  );
  const [shown, setShown] = useState(false);
  const interaction = useActivityInteraction({
    enabled: shown && event?.id === id,
    visible: shown && !editing && !chatOpen,
    target: { type: "event", id: id ?? "" },
    source,
    startAction: "event_viewed",
    details: event
      ? {
          snapshot: {
            participant_count: event.participant_count,
            capacity: event.capacity,
            starts_at: event.starts_at,
            status: event.status.slug,
          },
          ...(referrerInteractionID
            ? { referrer_interaction_id: referrerInteractionID }
            : {}),
          viewer_role: event.viewer.is_host
            ? "host"
            : event.viewer.is_participant
              ? "participant"
              : "visitor",
        }
      : {},
  });
  const joinAttempt = useRef(0);
  const participationRequest = useRef<{ id: string; joining: boolean } | null>(
    null,
  );
  const pending = useRef(false);
  const mutationController = useRef<AbortController | null>(null);
  useEffect(() => () => mutationController.current?.abort(), []);

  async function changeEvent(cancel = false) {
    if (!event || pending.current) return;
    const joining = !event.viewer.is_participant;
    if (
      !cancel &&
      (!participationRequest.current ||
        participationRequest.current.joining !== joining)
    ) {
      participationRequest.current = { id: uuid.v4(), joining };
      if (joining)
        interaction.current?.record(
          "join_attempted",
          { attempt_number: ++joinAttempt.current },
          "event_details",
        );
    }
    pending.current = true;
    setMutating(true);
    setActionError("");
    const controller = new AbortController();
    mutationController.current = controller;
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(
        `${apiURL}/events/${id}/${cancel ? "cancellation" : "participation"}`,
        {
          method: cancel || !event.viewer.is_participant ? "PUT" : "DELETE",
          signal: controller.signal,
          headers:
            !cancel && participationRequest.current
              ? interaction.current?.headers(participationRequest.current.id)
              : undefined,
        },
      );
      if (response.status < 500 && !cancel) participationRequest.current = null;
      if (!response.ok)
        setActionError(
          (await response.text()).trim() || "Could not update this event.",
        );
    } catch {
      setActionError(
        "Could not confirm the change. Refreshing the event before you try again.",
      );
    } finally {
      clearTimeout(timeout);
      mutationController.current = null;
      pending.current = false;
      setMutating(false);
      // Always reconcile with the server, including conflicts and uncertain network results.
      setError("");
      setRetry((value) => value + 1);
      onEventChanged();
    }
  }

  useEffect(() => {
    if (!id) return;
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    async function loadEvent() {
      try {
        const response = await fetch(`${apiURL}/events/${id}`, {
          signal: controller.signal,
        });
        if (response.status === 404) {
          if (active) setError("This event is no longer available.");
          return;
        }
        if (!response.ok) throw new Error("Could not load event");
        const detail: EventDetail = await response.json();
        if (active) {
          if (!validSequence(detail.sequence))
            throw new Error("Invalid event sequence");
          remember(detail.sequence);
          const buffered = bufferedDetail.current;
          const snapshot =
            buffered?.id === id &&
            compareSequence(buffered.sequence, detail.sequence) > 0
              ? forViewer(buffered, detail.viewer.id)
              : detail;
          setEvent((current) =>
            current?.id === snapshot.id &&
            compareSequence(current.sequence, snapshot.sequence) > 0
              ? current
              : snapshot,
          );
          setError("");
        }
      } catch {
        if (active)
          setError(
            "Could not load this event. Check your connection and try again.",
          );
      } finally {
        clearTimeout(timeout);
      }
    }
    void loadEvent();
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [id, apiURL, retry, remember]);

  useEffect(() => {
    if (!event) return;
    const remaining = new Date(event.starts_at).getTime() - Date.now();
    const initial = setTimeout(() => setHasStarted(remaining <= 0), 0);
    const kickoff =
      remaining > 0 && remaining <= 2147483647
        ? setTimeout(() => setHasStarted(true), remaining)
        : undefined;
    return () => {
      clearTimeout(initial);
      clearTimeout(kickoff);
    };
  }, [event]);

  return (
    <Modal
      visible={id !== null}
      onShow={() => setShown(true)}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        if (!pending.current) {
          setChatOpen(false);
          onClose();
        }
      }}
    >
      <View style={styles.root}>
        <View style={styles.heading}>
          <Text style={styles.kicker}>EVENT DETAILS</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setChatOpen(false);
              onClose();
            }}
            disabled={mutating}
            style={styles.button}
          >
            <Text style={styles.action}>{closeLabel}</Text>
          </Pressable>
        </View>
        {id && (
          <Text accessibilityLiveRegion="polite" style={styles.liveStatus}>
            {liveStatusText(liveStatus)}
          </Text>
        )}
        {error && event?.id === id && (
          <Text style={styles.liveStatus}>{error}</Text>
        )}
        {error && event?.id !== id ? (
          <View style={styles.message}>
            <Text style={styles.body}>{error}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setError("");
                setRetry((value) => value + 1);
              }}
              style={styles.button}
            >
              <Text style={styles.action}>Try again</Text>
            </Pressable>
          </View>
        ) : event?.id === id ? (
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.kicker}>
              {event.type.toUpperCase()} · {event.status.name.toUpperCase()}
            </Text>
            <Text style={styles.title}>{event.title}</Text>
            <Text style={styles.body}>{event.place.name}</Text>
            <Text style={styles.body}>
              {new Date(event.starts_at).toLocaleString([], {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
                timeZoneName: "short",
              })}
            </Text>
            <Text style={styles.body}>Hosted by {event.host.display_name}</Text>
            <View style={styles.capacity}>
              <Text style={styles.count}>
                {event.participant_count}/{event.capacity}
              </Text>
              <Text style={styles.body}>
                {event.status.slug !== "scheduled"
                  ? event.status.name
                  : hasStarted
                    ? "Already started"
                    : event.is_full
                      ? "Full"
                      : `${event.available_spots} spots left`}
              </Text>
            </View>
            <Text style={styles.muted}>
              Using the demo user · no sign-in yet
            </Text>
            {!!actionError && (
              <Text accessibilityRole="alert" style={styles.actionError}>
                {actionError}
              </Text>
            )}
            {event.viewer.is_host ? (
              <View style={{ gap: 16 }}>
                <Text style={styles.body}>
                  You’re hosting this event. Hosts stay on the participant list.
                </Text>
                {event.status.slug === "scheduled" && !hasStarted && (
                  <Pressable
                    accessibilityRole="button"
                    disabled={mutating}
                    style={styles.participation}
                    onPress={() => setEditing(true)}
                  >
                    <Text style={styles.participationText}>Edit event</Text>
                  </Pressable>
                )}
                {event.status.slug === "scheduled" && !hasStarted && (
                  <Pressable
                    accessibilityRole="button"
                    disabled={mutating}
                    style={[
                      styles.participation,
                      styles.danger,
                      mutating && styles.disabled,
                    ]}
                    onPress={() =>
                      Alert.alert(
                        "Cancel event?",
                        "This closes joining and keeps the event and participant list in Past. Participants will not receive a notification yet.",
                        [
                          { text: "Keep event", style: "cancel" },
                          {
                            text: "Cancel event",
                            style: "destructive",
                            onPress: () => void changeEvent(true),
                          },
                        ],
                      )
                    }
                  >
                    {mutating ? (
                      <ActivityIndicator color="#E3342F" />
                    ) : (
                      <Text style={styles.dangerText}>Cancel event</Text>
                    )}
                  </Pressable>
                )}
              </View>
            ) : !event.viewer.id ? (
              <Text style={styles.body}>Participation is unavailable.</Text>
            ) : (
              <Pressable
                accessibilityRole="button"
                disabled={
                  mutating ||
                  (!event.viewer.is_participant &&
                    (event.is_full ||
                      hasStarted ||
                      event.status.slug !== "scheduled"))
                }
                onPress={() => void changeEvent()}
                style={[
                  styles.participation,
                  (mutating ||
                    (!event.viewer.is_participant &&
                      (event.is_full ||
                        hasStarted ||
                        event.status.slug !== "scheduled"))) &&
                    styles.disabled,
                ]}
              >
                {mutating ? (
                  <ActivityIndicator color="#FFF8E8" />
                ) : (
                  <Text style={styles.participationText}>
                    {event.viewer.is_participant
                      ? "Leave event"
                      : event.status.slug !== "scheduled" || hasStarted
                        ? "Joining closed"
                        : event.is_full
                          ? "Event full"
                          : "Join event"}
                  </Text>
                )}
              </Pressable>
            )}
            {event.viewer.is_participant && (
              <Pressable
                accessibilityRole="button"
                style={[styles.participation, styles.secondary]}
                onPress={() => setChatOpen(true)}
              >
                <Text style={styles.participationText}>Open event chat</Text>
              </Pressable>
            )}
            {/* Anyone can bring people along to a plan that is still coming up. */}
            {event.status.slug === "scheduled" && !hasStarted && (
              <View style={styles.share}>
                <Text style={styles.shareLabel}>BRING PEOPLE ALONG</Text>
                <ShareButtons
                  onShare={(via) =>
                    interaction.current &&
                    shareEvent(
                      event,
                      via,
                      "event_details",
                      interaction.current.id,
                    )
                  }
                />
              </View>
            )}
            {event.viewer.is_host && (
              <HostSignupInsights
                key={event.id}
                eventID={event.id}
                apiURL={apiURL}
                revision={`${event.sequence}:${retry}`}
                participantCount={event.participant_count}
                capacity={event.capacity}
              />
            )}
            <Text style={styles.kicker}>PARTICIPANTS · INCLUDING HOST</Text>
            {event.participants.length ? (
              event.participants.map((person) => (
                <Text key={person.id} style={styles.person}>
                  {person.display_name}
                  {person.id === event.host.id ? " · Host" : ""}
                </Text>
              ))
            ) : (
              <Text style={styles.body}>No participants yet.</Text>
            )}
          </ScrollView>
        ) : (
          <View style={styles.message}>
            <ActivityIndicator color="#E3342F" />
            <Text style={styles.body}>Loading event…</Text>
          </View>
        )}
        {editing && event?.id === id && event.viewer.is_host && (
          <EventForm
            key={`edit-${event.id}`}
            event={event}
            place={event.place}
            apiURL={apiURL}
            onClose={() => {
              setEditing(false);
              setRetry((value) => value + 1);
              onEventChanged();
            }}
            onSaved={() => {
              setEditing(false);
              setRetry((value) => value + 1);
              onEventChanged();
            }}
          />
        )}
        {event?.id === id && event.viewer.is_participant && (
          <EventChat
            key={`chat-${event.id}`}
            eventID={event.id}
            title={event.title}
            apiURL={apiURL}
            visible={chatOpen}
            eventWritable={event.status.slug === "scheduled"}
            onClose={() => setChatOpen(false)}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#FAF5E7", paddingTop: 24 },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 22,
  },
  kicker: {
    color: "#E3342F",
    fontSize: 11,
    fontFamily: "DMSans_700Bold",
    letterSpacing: 1.3,
  },
  button: { paddingVertical: 14, paddingHorizontal: 6 },
  action: { color: "#203E30", fontFamily: "DMSans_700Bold", fontSize: 14 },
  liveStatus: {
    color: "#798268",
    fontSize: 12,
    paddingHorizontal: 24,
    paddingVertical: 6,
    fontFamily: "DMSans_400Regular",
  },
  content: { padding: 24, paddingBottom: 60, gap: 18 },
  title: {
    fontFamily: "BarlowCondensed_800ExtraBold",
    fontSize: 46,
    color: "#203E30",
  },
  body: {
    color: "#203E30",
    fontSize: 16,
    lineHeight: 24,
    fontFamily: "DMSans_400Regular",
  },
  message: { padding: 28, gap: 18, alignItems: "center" },
  capacity: {
    backgroundColor: "#FFF8E8",
    padding: 22,
    borderRadius: 24,
    gap: 4,
    borderWidth: 1,
    borderColor: "#D2D9B8",
  },
  count: {
    fontFamily: "BarlowCondensed_800ExtraBold",
    fontSize: 56,
    color: "#E3342F",
  },
  person: {
    fontSize: 16,
    color: "#203E30",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#D2D9B8",
    fontFamily: "DMSans_400Regular",
  },
  muted: {
    fontSize: 13,
    color: "#798268",
    marginTop: 12,
    fontFamily: "DMSans_400Regular",
  },
  participation: {
    backgroundColor: "#E3342F",
    padding: 18,
    borderRadius: 20,
    alignItems: "center",
  },
  participationText: {
    color: "#FFF8E8",
    fontSize: 16,
    fontFamily: "DMSans_700Bold",
  },
  secondary: { backgroundColor: "#203E30" },
  // Outlined, so cancelling never looks like the main action.
  danger: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: "#E3342F",
  },
  dangerText: { color: "#E3342F", fontSize: 16, fontFamily: "DMSans_700Bold" },
  share: { gap: 10, marginTop: 6 },
  shareLabel: {
    fontFamily: "DMSans_700Bold",
    fontSize: 11,
    letterSpacing: 1.4,
    color: "#798268",
  },
  disabled: { opacity: 0.5 },
  actionError: {
    color: "#B51E2C",
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "DMSans_400Regular",
  },
});
