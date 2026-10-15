import { useFonts } from "expo-font";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { RealtimeProvider } from "./RealtimeProvider";
import MapScreen from "./MapScreen";
import ProfileScreen from "./ProfileScreen";
import YourEvents from "./YourEvents";

type Tab = "map" | "events" | "you";

export default function NativeApp() {
  const [loaded, fontError] = useFonts({
    BigShoulders: require("../assets/BigShouldersDisplayBlack.ttf"),
  });
  const [tab, setTab] = useState<Tab>("map");
  if (!loaded && !fontError)
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#1D5B3A" />
      </View>
    );
  return (
    <RealtimeProvider>
      <View style={styles.root}>
        {tab === "map" && <MapScreen />}
        {tab === "events" && <YourEvents />}
        {tab === "you" && <ProfileScreen />}
        <View style={styles.tabBar} accessibilityRole="tablist">
          {(
            [
              ["map", "◇", "Map"],
              ["events", "▣", "Your events"],
              ["you", "♙", "You"],
            ] as const
          ).map(([key, icon, label]) => (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === key }}
              onPress={() => setTab(key)}
              style={styles.tabButton}
            >
              <Text style={[styles.tabIcon, tab === key && styles.activeTab]}>
                {icon}
              </Text>
              <Text style={[styles.tabLabel, tab === key && styles.activeTab]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </RealtimeProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F4F5F0" },
  loading: {
    flex: 1,
    backgroundColor: "#F4F5F0",
    alignItems: "center",
    justifyContent: "center",
  },
  tabBar: {
    backgroundColor: "#F4F5F0",
    height: 91,
    paddingTop: 11,
    paddingBottom: 20,
    flexDirection: "row",
    borderTopWidth: 1,
    borderColor: "#DFE2DA",
  },
  tabButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  tabIcon: { fontSize: 28, color: "#91A098" },
  tabLabel: { fontSize: 11, fontWeight: "700", color: "#91A098" },
  activeTab: { color: "#F3192C" },
});
