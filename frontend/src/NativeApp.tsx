import {
  BarlowCondensed_700Bold,
  BarlowCondensed_800ExtraBold,
} from "@expo-google-fonts/barlow-condensed";
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_700Bold,
} from "@expo-google-fonts/dm-sans";
import { useFonts } from "expo-font";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import EventDetails from "./EventDetails";
import { ActivitiesProvider } from "./ActivitiesProvider";
import { RealtimeProvider } from "./RealtimeProvider";
import ExploreScreen from "./ExploreScreen";
import { explore as theme } from "./ExploreCards";
import YouScreen from "./YouScreen";

type Tab = "explore" | "you";

export default function NativeApp() {
  const [loaded, fontError] = useFonts({
    BigShoulders: require("../assets/BigShouldersDisplayBlack.ttf"),
    // The Lahore prototype's type, used by the Explore tab.
    BarlowCondensed_700Bold,
    BarlowCondensed_800ExtraBold,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
  });
  const [tab, setTab] = useState<Tab>("explore");
  // An event opened from a shared joinme://events/{id} link.
  const [linkedEventID, setLinkedEventID] = useState<string | null>(null);
  useEffect(() => {
    const open = (url: string | null) => {
      const id = url?.match(/^joinme:\/\/events\/([0-9a-f-]{36})\/?$/i)?.[1];
      if (id) setLinkedEventID(id.toLowerCase());
    };
    void Linking.getInitialURL().then(open);
    const subscription = Linking.addEventListener("url", ({ url }) =>
      open(url),
    );
    return () => subscription.remove();
  }, []);
  // The ＋ is an action, not a tab: Explore opens the create form over itself.
  const explore = useRef<{ startCreating: () => void }>(null);
  const [exploreOpenedByCreate, setExploreOpenedByCreate] = useState(false);
  if (!loaded && !fontError)
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={theme.red} />
      </View>
    );
  return (
    <GestureHandlerRootView style={styles.root}>
      <ActivitiesProvider>
        <RealtimeProvider>
          <View style={styles.root}>
            {tab === "explore" && (
              <ExploreScreen
                ref={explore}
                openedByCreate={exploreOpenedByCreate}
              />
            )}
            {tab === "you" && <YouScreen />}
            <View style={styles.tabBar} accessibilityRole="tablist">
              <TabButton
                label="Explore"
                selected={tab === "explore"}
                onPress={() => {
                  setExploreOpenedByCreate(false);
                  setTab("explore");
                }}
                icon={(color) => <PinIcon color={color} />}
              />
              <View style={styles.tabButton}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Create an event"
                  onPress={() => {
                    if (tab === "explore") {
                      explore.current?.startCreating();
                    } else {
                      setExploreOpenedByCreate(true);
                      setTab("explore");
                    }
                  }}
                  style={({ pressed }) => [
                    styles.createButton,
                    pressed && styles.createButtonPressed,
                  ]}
                >
                  {/* Drawn rather than a "+" glyph, which sits off-centre in most fonts. */}
                  <View style={styles.plusBar} />
                  <View style={[styles.plusBar, styles.plusBarDown]} />
                </Pressable>
              </View>
              <TabButton
                label="You"
                selected={tab === "you"}
                onPress={() => setTab("you")}
                icon={(color) => <PersonIcon color={color} />}
              />
            </View>
            {linkedEventID && (
              <LinkedEvent
                key={linkedEventID}
                id={linkedEventID}
                onClose={() => setLinkedEventID(null)}
              />
            )}
          </View>
        </RealtimeProvider>
      </ActivitiesProvider>
    </GestureHandlerRootView>
  );
}

const apiURL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8080";

// A shared plan: its details when it is still coming up, otherwise a short note.
function LinkedEvent({ id, onClose }: { id: string; onClose: () => void }) {
  const [state, setState] = useState<"checking" | "open" | "gone">("checking");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiURL}/events/${id}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((event: { starts_at: string; status: { slug: string } } | null) =>
        setState(
          event &&
            event.status.slug === "scheduled" &&
            new Date(event.starts_at).getTime() > Date.now()
            ? "open"
            : "gone",
        ),
      )
      .catch(() => {
        if (!controller.signal.aborted) setState("gone");
      });
    return () => controller.abort();
  }, [id]);
  if (state === "checking") return null;
  if (state === "open")
    return (
      <EventDetails
        id={id}
        apiURL={apiURL}
        closeLabel="Close"
        // Link opens count as Explore views until views get a source of their own.
        source="explore"
        onClose={onClose}
        onEventChanged={() => {}}
      />
    );
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.linkScrim} onPress={onClose}>
        <View style={styles.linkCard}>
          <Text style={styles.linkTitle}>
            This plan isn&apos;t available anymore
          </Text>
          <Text style={styles.linkBody}>
            It was cancelled, has already happened, or was removed.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={styles.linkButton}
          >
            <Text style={styles.linkButtonText}>OK</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

function TabButton({
  label,
  selected,
  onPress,
  icon,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  icon: (color: string) => ReactNode;
}) {
  const color = selected ? theme.red : theme.muted;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.tabButton}
    >
      <View style={styles.iconBox}>{icon(color)}</View>
      <Text style={[styles.tabLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

// A map pin, like the markers on Explore: a teardrop with a hole.
function PinIcon({ color }: { color: string }) {
  return (
    <View style={[styles.pin, { borderColor: color }]}>
      <View style={[styles.pinHole, { borderColor: color }]} />
    </View>
  );
}

// A head and shoulders.
function PersonIcon({ color }: { color: string }) {
  return (
    <View style={styles.person}>
      <View style={[styles.personHead, { borderColor: color }]} />
      <View style={[styles.personBody, { borderColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.paper },
  loading: {
    flex: 1,
    backgroundColor: theme.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  tabBar: {
    backgroundColor: theme.paper,
    height: 88,
    paddingTop: 10,
    paddingBottom: 22,
    flexDirection: "row",
    borderTopWidth: 1,
    borderColor: theme.line,
  },
  tabButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  iconBox: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  tabLabel: { fontFamily: theme.bodyBold, fontSize: 11, letterSpacing: 0.2 },
  pin: {
    width: 18,
    height: 18,
    marginTop: -4,
    borderWidth: 2.2,
    borderRadius: 9,
    borderBottomRightRadius: 0,
    transform: [{ rotate: "45deg" }],
    alignItems: "center",
    justifyContent: "center",
  },
  pinHole: { width: 6, height: 6, borderRadius: 3, borderWidth: 2 },
  person: { alignItems: "center", gap: 2 },
  personHead: { width: 10, height: 10, borderRadius: 5, borderWidth: 2.2 },
  personBody: {
    width: 20,
    height: 10,
    borderWidth: 2.2,
    borderBottomWidth: 0,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  // Raised above the bar so creating stands out from the tabs.
  createButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    marginTop: -30,
    backgroundColor: theme.red,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: theme.paper,
    shadowColor: "#5B2A17",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  },
  createButtonPressed: { transform: [{ scale: 0.94 }] },
  plusBar: {
    position: "absolute",
    width: 22,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: theme.cream,
  },
  plusBarDown: { transform: [{ rotate: "90deg" }] },
  linkScrim: {
    flex: 1,
    backgroundColor: "rgba(32, 62, 48, 0.45)",
    justifyContent: "center",
    padding: 28,
  },
  linkCard: {
    backgroundColor: theme.paper,
    borderRadius: 22,
    padding: 22,
    gap: 10,
  },
  linkTitle: {
    fontFamily: theme.display,
    fontSize: 28,
    lineHeight: 30,
    color: theme.ink,
  },
  linkBody: { fontFamily: theme.body, fontSize: 14, color: theme.muted },
  linkButton: {
    marginTop: 8,
    alignSelf: "flex-start",
    backgroundColor: theme.red,
    borderRadius: 14,
    paddingHorizontal: 22,
    paddingVertical: 10,
  },
  linkButtonText: {
    fontFamily: theme.bodyBold,
    fontSize: 15,
    color: theme.cream,
  },
});
