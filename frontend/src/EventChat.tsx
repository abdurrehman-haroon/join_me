import { useActivityInteraction } from "./ActivitiesProvider";
import { compareSequence, validSequence } from "./realtime";
import { useRealtimeTarget, liveStatusText } from "./RealtimeProvider";
import { uuid } from "expo";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type Message = {
  event_id: string;
  sequence: string;
  id: string;
  user_id: string;
  body: string;
  display_name: string;
  created_at: string;
  cursor: string;
};
type Page = {
  sequence: string;
  messages: Message[];
  has_more: boolean;
  can_send: boolean;
  viewer_id: string;
};
type PendingMessage = {
  id: string;
  body: string;
  state: "sending" | "failed";
  activityHeaders?: Record<string, string>;
};

function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  const byID = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byID.set(message.id, message);
  return [...byID.values()].sort((left, right) =>
    compareSequence(right.sequence, left.sequence),
  );
}

export default function EventChat({
  eventID,
  title,
  apiURL,
  visible,
  eventWritable,
  onClose,
}: {
  eventID: string;
  title: string;
  apiURL: string;
  visible: boolean;
  eventWritable: boolean;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [hasOlder, setHasOlder] = useState(false);
  const [canSend, setCanSend] = useState(false);
  const [viewer, setViewer] = useState("");
  const [denied, setDenied] = useState(false);
  const [newMessages, setNewMessages] = useState(false);
  const [retry, setRetry] = useState(0);
  const [shown, setShown] = useState(false);
  const [loadedForVisit, setLoadedForVisit] = useState(false);
  const [previousVisibility, setPreviousVisibility] = useState(visible);
  // Retain messages/drafts, but require fresh visibility and authorization per opening.
  if (previousVisibility !== visible) {
    setPreviousVisibility(visible);
    setShown(false);
    setLoadedForVisit(false);
  }

  const interaction = useActivityInteraction({
    enabled: visible && shown && loadedForVisit && !denied,
    visible: visible && shown,
    target: { type: "event", id: eventID },
    source: "event_details",
    startAction: "chat_opened",
  });

  const newest = useRef("");
  const oldest = useRef("");
  const nearBottom = useRef(true);
  const list = useRef<FlatList<Message | PendingMessage>>(null);
  const newestSequence = useRef("0");
  const initialLoaded = useRef(false);
  const refresh = useRef<(() => void) | null>(null);
  const { status: liveStatus, remember } = useRealtimeTarget(
    "event_messages",
    visible ? eventID : null,
    {
      ready: () => refresh.current?.(),
      update: (frame) => {
        if (frame.type !== "update" || !initialLoaded.current) {
          refresh.current?.();
          return;
        }
        const message = frame.payload as Message;
        if (
          message?.event_id !== eventID ||
          !validSequence(message.sequence) ||
          message.sequence !== frame.sequence
        )
          return;
        if (compareSequence(message.sequence, newestSequence.current) <= 0)
          return;
        if (
          BigInt(message.sequence) !==
          BigInt(newestSequence.current) + BigInt(1)
        ) {
          refresh.current?.();
          return;
        }
        newestSequence.current = message.sequence;
        newest.current = message.cursor;
        remember(message.sequence);
        setMessages((current) => mergeMessages(current, [message]));
        setPending((current) =>
          current.filter((pending) => pending.id !== message.id),
        );
        if (!nearBottom.current) setNewMessages(true);
      },
      error: (code) => {
        if (code === "forbidden" || code === "not_found") {
          setMessages([]);
          setCanSend(false);
          setDenied(true);
          setHasOlder(false);
          newest.current = "";
          oldest.current = "";
          newestSequence.current = "0";
          initialLoaded.current = false;
          setError("You no longer have access to this chat.");
        } else
          setError("Live chat is reconnecting. Your messages are retained.");
      },
    },
  );
  const sending = useRef(new Set<string>());
  const loadOlder = useRef<(() => Promise<void>) | null>(null);
  const sendControllers = useRef(new Set<AbortController>());
  useEffect(
    () => () =>
      sendControllers.current.forEach((controller) => controller.abort()),
    [],
  );

  useEffect(() => {
    if (!visible) return;
    let active = true;
    let fetching = false;
    let refreshQueued = false;
    let controller: AbortController | null = null;
    async function load(older = false) {
      if (AppState.currentState !== "active") return;
      if (fetching) {
        if (!older) refreshQueued = true;
        return;
      }
      fetching = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 12000);
      try {
        const cursor = older ? oldest.current : newest.current;
        const query = cursor
          ? `?${older ? "before" : "after"}=${encodeURIComponent(cursor)}`
          : "";
        const response = await fetch(
          `${apiURL}/events/${eventID}/messages${query}`,
          { signal: controller.signal },
        );
        if (!active) return;
        if (response.status === 403 || response.status === 404) {
          setMessages([]);
          setCanSend(false);
          setDenied(true);
          newest.current = "";
          oldest.current = "";
          newestSequence.current = "0";
          initialLoaded.current = false;
          setHasOlder(false);
          setError("You no longer have access to this chat.");
          return;
        }
        if (!response.ok) throw new Error("Could not load messages");
        const page: Page = await response.json();
        if (!active) return;
        setDenied(false);
        setLoadedForVisit(true);
        setCanSend(page.can_send);
        setViewer(page.viewer_id);
        setError("");
        setMessages((current) => mergeMessages(current, page.messages));
        setPending((current) =>
          current.filter(
            (message) =>
              !page.messages.some((saved) => saved.id === message.id),
          ),
        );
        if (older || !cursor) {
          setHasOlder(page.has_more);
          if (page.messages.length) oldest.current = page.messages[0].cursor;
        }
        if (!older && page.messages.length) {
          const latest = page.messages[page.messages.length - 1];
          if (compareSequence(latest.sequence, newestSequence.current) > 0) {
            newest.current = latest.cursor;
            newestSequence.current = latest.sequence;
            remember(latest.sequence);
          }
          if (!nearBottom.current) setNewMessages(true);
        }
        initialLoaded.current = true;
        // Drain every missed page; socket delivery may race this history request.
        if (!older && cursor && page.has_more)
          setTimeout(() => {
            if (active) void load();
          }, 0);
      } catch {
        if (active)
          setError("Could not refresh chat. Check your connection and retry.");
      } finally {
        clearTimeout(timeout);
        fetching = false;
        if (active) {
          setLoading(false);
          if (refreshQueued) {
            refreshQueued = false;
            void load();
          }
        }
      }
    }
    loadOlder.current = () => load(true);
    refresh.current = () => void load();
    if (newestSequence.current !== "0") remember(newestSequence.current);
    void load();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
      else controller?.abort();
    });
    return () => {
      active = false;
      refresh.current = null;
      subscription.remove();
      controller?.abort();
      loadOlder.current = null;
    };
  }, [eventID, apiURL, visible, retry, remember]);

  async function send(message: PendingMessage) {
    if (sending.current.has(message.id) || !canSend || !eventWritable || denied)
      return;
    sending.current.add(message.id);
    setPending((current) => [
      ...current.filter((item) => item.id !== message.id),
      { ...message, state: "sending" },
    ]);
    const controller = new AbortController();
    sendControllers.current.add(controller);
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${apiURL}/events/${eventID}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...message.activityHeaders },
        body: JSON.stringify({ id: message.id, body: message.body }),
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 403) {
          setDenied(true);
          setMessages([]);
          setCanSend(false);
          newest.current = "";
          oldest.current = "";
          setHasOlder(false);
        }
        if (response.status === 409) setRetry((value) => value + 1);
        throw new Error((await response.text()).trim());
      }
      setRetry((value) => value + 1);
    } catch (failure) {
      setPending((current) =>
        current.map((item) =>
          item.id === message.id ? { ...item, state: "failed" } : item,
        ),
      );
      setError(
        failure instanceof Error && failure.message !== "Aborted"
          ? failure.message
          : "Could not confirm sending. Tap Retry on the message.",
      );
    } finally {
      clearTimeout(timeout);
      sendControllers.current.delete(controller);
      sending.current.delete(message.id);
    }
  }

  return (
    <Modal
      visible={visible}
      onShow={() => setShown(true)}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>EVENT CHAT</Text>
            <Text numberOfLines={1} style={styles.title}>
              {title}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={styles.button}
          >
            <Text style={styles.action}>Back</Text>
          </Pressable>
        </View>
        <Text accessibilityLiveRegion="polite" style={styles.notice}>
          {liveStatusText(liveStatus)}
        </Text>
        {!!error && (
          <View style={styles.notice}>
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
            {!denied && (
              <Pressable
                onPress={() => setRetry((value) => value + 1)}
                style={styles.button}
              >
                <Text style={styles.action}>Retry refresh</Text>
              </Pressable>
            )}
          </View>
        )}
        {loading ? (
          <ActivityIndicator style={{ flex: 1 }} color="#1D5B3A" />
        ) : (
          <FlatList<Message | PendingMessage>
            ref={list}
            inverted
            data={[...pending.slice().reverse(), ...messages]}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: 20, flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
            maintainVisibleContentPosition={{
              minIndexForVisible: 0,
              autoscrollToTopThreshold: 80,
            }}
            onScroll={(event) => {
              nearBottom.current = event.nativeEvent.contentOffset.y < 80;
              if (nearBottom.current) setNewMessages(false);
            }}
            scrollEventThrottle={100}
            ListEmptyComponent={
              <Text style={styles.notice}>
                No messages yet. Say hello to your group.
              </Text>
            }
            ListFooterComponent={
              hasOlder ? (
                <Pressable
                  style={styles.button}
                  onPress={() => void loadOlder.current?.()}
                >
                  <Text style={styles.action}>Load older messages</Text>
                </Pressable>
              ) : undefined
            }
            renderItem={({ item }) => {
              const saved = "created_at" in item;
              const own = !saved || item.user_id === viewer;
              return (
                <View style={[styles.bubble, own && styles.own]}>
                  <Text style={styles.meta}>
                    {own ? "You" : item.display_name}
                  </Text>
                  <Text style={styles.body}>{item.body}</Text>
                  {saved ? (
                    <Text style={styles.meta}>
                      {new Date(item.created_at).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </Text>
                  ) : item.state === "sending" ? (
                    <Text style={styles.meta}>Sending…</Text>
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void send(item)}
                    >
                      <Text style={styles.error}>Failed · Retry</Text>
                    </Pressable>
                  )}
                </View>
              );
            }}
          />
        )}
        {(!canSend || !eventWritable) &&
          !loading &&
          (viewer !== "" || denied) && (
            <Text style={styles.notice}>
              {denied
                ? "Join the event to access chat."
                : "This event’s chat is read-only."}
            </Text>
          )}
        {newMessages && (
          <Pressable
            style={styles.button}
            onPress={() => {
              list.current?.scrollToOffset({ offset: 0, animated: true });
              setNewMessages(false);
            }}
          >
            <Text style={styles.action}>New messages ↓</Text>
          </Pressable>
        )}
        {canSend && eventWritable && !denied && (
          <View style={styles.composer}>
            <TextInput
              accessibilityLabel="Message"
              placeholder="Message your group…"
              multiline
              maxLength={2000}
              value={draft}
              onChangeText={setDraft}
              style={styles.input}
            />
            <Pressable
              accessibilityRole="button"
              disabled={!draft.trim()}
              style={styles.button}
              onPress={() => {
                const body = draft.trim();
                if (!body) return;
                setDraft("");
                void send({
                  id: uuid.v4(),
                  body,
                  state: "sending",
                  activityHeaders: interaction.current?.headers(uuid.v4()),
                });
              }}
            >
              <Text style={styles.action}>Send</Text>
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F4F5F0", paddingTop: 24 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 22,
    gap: 16,
  },
  kicker: {
    color: "#1D5B3A",
    fontWeight: "800",
    fontSize: 11,
    letterSpacing: 1.3,
  },
  title: { fontFamily: "BigShoulders", fontSize: 30, color: "#15201B" },
  button: { padding: 14 },
  action: { color: "#1D5B3A", fontWeight: "700" },
  notice: { paddingHorizontal: 22, paddingVertical: 10, color: "#6C786E" },
  error: { color: "#B51E2C" },
  bubble: {
    backgroundColor: "#E5E9DF",
    borderRadius: 18,
    padding: 14,
    marginVertical: 5,
    maxWidth: "85%",
    alignSelf: "flex-start",
    gap: 5,
  },
  own: { backgroundColor: "#D2E7D4", alignSelf: "flex-end" },
  body: { color: "#15201B", fontSize: 16, lineHeight: 22 },
  meta: { color: "#536658", fontSize: 11 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 16,
    paddingBottom: 30,
    borderTopWidth: 1,
    borderColor: "#DEE3D8",
  },
  input: {
    flex: 1,
    backgroundColor: "white",
    borderRadius: 18,
    padding: 14,
    maxHeight: 140,
    color: "#15201B",
    fontSize: 16,
  },
});
