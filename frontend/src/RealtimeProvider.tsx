import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import { RealtimeClient, type LiveListener, type TargetType } from "./realtime";

const RealtimeContext = createContext<RealtimeClient | null>(null);
const apiURL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8080";

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new RealtimeClient(apiURL));
  useEffect(() => {
    client.setActive(AppState.currentState === "active");
    const subscription = AppState.addEventListener("change", (state) =>
      client.setActive(state === "active"),
    );
    return () => {
      subscription.remove();
      client.setActive(false);
    };
  }, [client]);
  return (
    <RealtimeContext.Provider value={client}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtimeTarget(
  type: TargetType,
  id: string | null,
  listener: LiveListener,
) {
  const client = useContext(RealtimeContext);
  if (!client) throw new Error("RealtimeProvider is missing");
  const callbacks = useRef(listener);
  useEffect(() => {
    callbacks.current = listener;
  });
  useEffect(() => {
    if (!id) return;
    return client.subscribe(type, id, {
      ready: () => callbacks.current.ready(),
      update: (frame) => callbacks.current.update(frame),
      error: (code) => callbacks.current.error(code),
    });
  }, [client, type, id]);
  const status = useSyncExternalStore(
    client.watchStatus,
    client.getStatus,
    client.getStatus,
  );
  const remember = useCallback(
    (sequence: string) => {
      if (id) client.remember(type, id, sequence);
    },
    [client, type, id],
  );
  return { status, remember };
}

export function liveStatusText(
  status: ReturnType<RealtimeClient["getStatus"]>,
): string {
  switch (status) {
    case "live":
      return "Live updates connected";
    case "fallback":
      return "Live updates using an alternate connection";
    case "offline":
      return "Updates paused";
    case "connecting":
      return "Connecting live updates…";
    case "reconnecting":
      return "Reconnecting live updates…";
  }
}
