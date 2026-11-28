import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { explore as theme } from "./ExploreCards";
import ProfileScreen from "./ProfileScreen";
import YourEvents from "./YourEvents";

// The You tab holds what used to be two tabs, so the ＋ can sit in the middle of
// a three-slot bar: your events first, your profile and activity beside them.
export default function YouScreen() {
  const [section, setSection] = useState<"events" | "profile">("events");
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>You</Text>
        <View style={styles.switch} accessibilityRole="tablist">
          {(
            [
              ["events", "Your events"],
              ["profile", "Profile"],
            ] as const
          ).map(([key, label]) => (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: section === key }}
              onPress={() => setSection(key)}
              style={[styles.option, section === key && styles.selected]}
            >
              <Text
                style={[
                  styles.optionText,
                  section === key && styles.selectedText,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={styles.body}>
        {section === "events" ? (
          <YourEvents embedded />
        ) : (
          <ProfileScreen embedded />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.paper },
  header: { paddingHorizontal: 24, paddingTop: 60, gap: 14 },
  title: {
    fontFamily: theme.display,
    fontSize: 46,
    lineHeight: 48,
    color: theme.ink,
  },
  switch: {
    flexDirection: "row",
    backgroundColor: theme.sage,
    borderRadius: 22,
    padding: 4,
  },
  option: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 18,
    alignItems: "center",
  },
  selected: { backgroundColor: theme.ink },
  optionText: { fontFamily: theme.bodyBold, fontSize: 14, color: theme.muted },
  selectedText: { color: theme.cream },
  body: { flex: 1 },
});
