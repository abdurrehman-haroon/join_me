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
import { useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ActivitiesProvider } from "./ActivitiesProvider";
import { RealtimeProvider } from "./RealtimeProvider";
import ExploreScreen from "./ExploreScreen";
import ProfileScreen from "./ProfileScreen";
import YourEvents from "./YourEvents";

type Tab = "explore" | "events" | "you";

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
  if (!loaded && !fontError)
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#1D5B3A" />
      </View>
    );
  return (
    <GestureHandlerRootView style={styles.root}>
      <ActivitiesProvider>
        <RealtimeProvider>
          <View style={styles.root}>
            {tab === "explore" && <ExploreScreen />}
            {tab === "events" && <YourEvents />}
            {tab === "you" && <ProfileScreen />}
            <View style={styles.tabBar} accessibilityRole="tablist">
              {(
                [
                  ["explore", "◇", "Explore"],
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
                  <Text
                    style={[styles.tabIcon, tab === key && styles.activeTab]}
                  >
                    {icon}
                  </Text>
                  <Text
                    style={[styles.tabLabel, tab === key && styles.activeTab]}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </RealtimeProvider>
      </ActivitiesProvider>
    </GestureHandlerRootView>
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
