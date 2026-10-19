import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { uuid } from "expo-modules-core";
import {
  ActivityQueue,
  ActivityInteraction,
  type ActivitySource,
  type InteractionTarget,
  type QueueSnapshot,
} from "./activities";

const apiURL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8080";
const ActivitiesContext = createContext<{
  queue: ActivityQueue;
  sessionID: string;
} | null>(null);

// Alternate complete snapshots: if termination interrupts one write, restore the other.
function queueStorage() {
  let generation = 0;
  const base = `${FileSystem.documentDirectory}activities-${encodeURIComponent(apiURL)}`;
  return {
    async load(): Promise<QueueSnapshot> {
      const snapshots = await Promise.all(
        [0, 1].map(async (slot) => {
          try {
            const content = await FileSystem.readAsStringAsync(
              `${base}-${slot}.json`,
            );
            const snapshot = JSON.parse(content);
            if (
              !Number.isSafeInteger(snapshot.generation) ||
              !Array.isArray(snapshot.entries) ||
              !(
                snapshot.actorID === null ||
                typeof snapshot.actorID === "string"
              ) ||
              !snapshot.entries.every(
                (entry: {
                  actorID?: unknown;
                  activity?: { id?: unknown; occurred_at?: unknown };
                }) =>
                  (entry.actorID === null ||
                    typeof entry.actorID === "string") &&
                  typeof entry.activity?.id === "string" &&
                  typeof entry.activity?.occurred_at === "string",
              )
            )
              return null;
            return snapshot as QueueSnapshot & { generation: number };
          } catch {
            return null;
          }
        }),
      );
      const newest = snapshots
        .filter((snapshot) => snapshot !== null)
        .sort((a, b) => b.generation - a.generation)[0];
      generation = newest?.generation ?? 0;
      return newest ?? { actorID: null, entries: [] };
    },
    async save(snapshot: QueueSnapshot) {
      if (!FileSystem.documentDirectory)
        throw new Error("Persistent storage unavailable");
      const next = generation + 1;
      await FileSystem.writeAsStringAsync(
        `${base}-${next % 2}.json`,
        JSON.stringify({ ...snapshot, generation: next }),
      );
      generation = next;
    },
  };
}

export function ActivitiesProvider({ children }: { children: ReactNode }) {
  const [tracking] = useState(() => ({
    queue: new ActivityQueue(apiURL, queueStorage()),
    sessionID: uuid.v4(),
  }));
  useEffect(() => {
    tracking.queue.startSession(tracking.sessionID);
    tracking.queue.setActive(AppState.currentState === "active");
    const subscription = AppState.addEventListener("change", (state) =>
      tracking.queue.setActive(state === "active"),
    );
    return () => {
      subscription.remove();
      tracking.queue.setActive(false);
    };
  }, [tracking]);
  return (
    <ActivitiesContext.Provider value={tracking}>
      {children}
    </ActivitiesContext.Provider>
  );
}

export function useActivities() {
  const tracking = useContext(ActivitiesContext);
  if (!tracking) throw new Error("ActivitiesProvider missing");
  return tracking;
}

// A screen owns one interaction; visibility changes pause it without recreating it.
export function useActivityInteraction({
  enabled,
  visible,
  target,
  source,
  startAction,
  details = {},
}: {
  enabled: boolean;
  visible: boolean;
  target: InteractionTarget;
  source: ActivitySource;
  startAction:
    | "event_creation_started"
    | "event_viewed"
    | "place_viewed"
    | "chat_opened";
  details?: Record<string, unknown>;
}) {
  const { queue, sessionID } = useActivities();
  const interaction = useRef<ActivityInteraction | null>(null);
  const current = useRef({ visible, details });
  useEffect(() => {
    current.current = { visible, details };
  });
  useEffect(() => {
    if (!enabled) return;
    const visit = new ActivityInteraction(
      sessionID,
      { type: target.type, id: target.id },
      source,
      startAction,
      current.current.details,
      (activity) => queue.record(activity),
      () => uuid.v4(),
      () => performance.now(),
      AppState.currentState === "active",
    );
    interaction.current = visit;
    visit.setState(current.current.visible, AppState.currentState === "active");
    const subscription = AppState.addEventListener("change", (state) =>
      visit.setState(current.current.visible, state === "active"),
    );
    return () => {
      subscription.remove();
      visit.close("dismissed");
      if (interaction.current === visit) interaction.current = null;
    };
  }, [enabled, target.type, target.id, source, startAction, queue, sessionID]);
  useEffect(() => {
    interaction.current?.setState(visible, AppState.currentState === "active");
  }, [visible]);
  return interaction;
}
