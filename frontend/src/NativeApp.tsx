import { useFonts } from "expo-font";
import * as Haptics from "expo-haptics";
import type { SFSymbol } from "expo-symbols";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { ActivitiesProvider } from "./ActivitiesProvider";
import { RealtimeProvider } from "./RealtimeProvider";
import MapScreen from "./MapScreen";
import ProfileScreen from "./ProfileScreen";
import YourEvents from "./YourEvents";
import { colors } from "./theme";
import { Icon } from "./ui";

type Tab = "map" | "events" | "you";

// Each tab: its symbol when not selected and when selected (filled, as iOS does), and a
// one-word label.
const tabs: { key: Tab; symbol: SFSymbol; selectedSymbol: SFSymbol; fallback: string; label: string }[] = [
  { key: "map", symbol: "map", selectedSymbol: "map.fill", fallback: "◇", label: "Explore" },
  { key: "events", symbol: "calendar", selectedSymbol: "calendar", fallback: "▣", label: "Events" },
  { key: "you", symbol: "person.crop.circle", selectedSymbol: "person.crop.circle.fill", fallback: "♙", label: "You" },
];

export default function NativeApp() {
  return (
    <SafeAreaProvider>
      <App />
    </SafeAreaProvider>
  );
}

function App() {
  const insets = useSafeAreaInsets();
  const [loaded, fontError] = useFonts({
    BigShoulders: require("../assets/BigShouldersDisplayBlack.ttf"),
  });
  const [tab, setTab] = useState<Tab>("map");
  if (!loaded && !fontError)
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.tint} />
      </View>
    );
  return (
    <ActivitiesProvider>
      <RealtimeProvider>
        <View style={styles.root}>
          {tab === "map" && <MapScreen />}
          {tab === "events" && <YourEvents />}
          {tab === "you" && <ProfileScreen />}
          <View style={[styles.tabBar, { paddingBottom: insets.bottom }]} accessibilityRole="tablist">
            {tabs.map((item) => {
              const selected = tab === item.key;
              return (
                <Pressable
                  key={item.key}
                  accessibilityRole="tab"
                  accessibilityLabel={item.label}
                  accessibilityState={{ selected }}
                  onPress={() => {
                    if (!selected) void Haptics.selectionAsync();
                    setTab(item.key);
                  }}
                  style={styles.tabButton}
                >
                  <Icon
                    name={selected ? item.selectedSymbol : item.symbol}
                    fallback={item.fallback}
                    size={22}
                    color={selected ? colors.tint : colors.secondary}
                  />
                  <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </RealtimeProvider>
    </ActivitiesProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.chalk },
  loading: {
    flex: 1,
    backgroundColor: colors.chalk,
    alignItems: "center",
    justifyContent: "center",
  },
  // Apple's tab bar: 49 points tall above the home indicator, with a hairline on top.
  tabBar: {
    backgroundColor: colors.chalk,
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
  tabButton: {
    flex: 1,
    height: 49,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  tabLabel: { fontSize: 10, lineHeight: 12, fontWeight: "500", color: colors.secondary },
  tabLabelSelected: { color: colors.tint },
});
