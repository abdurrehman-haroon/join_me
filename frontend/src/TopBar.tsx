import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, margin, minTouch, type } from "./theme";
import { Glass, Icon, PressableScale, SegmentedControl } from "./ui";

type Props = {
  // Where you are, from the widest place in, e.g. Lahore › DHA › LUMS.
  path: string[];
  // Goes back one step, or null when there is nowhere to go back to.
  onBack: (() => void) | null;
  // What the back button returns to, for VoiceOver.
  backLabel: string;
  // The button on the right, such as Map or My Location.
  trailing: ReactNode;
  // What the feed is about (All, Padel, Campus); none hides the segmented control.
  tabs: { key: string; label: string }[];
  activeTab: string;
  onTabChange: (key: string) => void;
};

// The controls floating at the top of the map: back, where you are, one action, and the
// segmented control. It stays mounted while the feed below changes, so the segmented
// control's selection slides instead of jumping.
export default function TopBar({ path, onBack, backLabel, trailing, tabs, activeTab, onTabChange }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.top, { top: insets.top + 6 }]} pointerEvents="box-none">
      <View style={styles.row} pointerEvents="box-none">
        <Glass style={styles.crumbs}>
          {onBack && (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Back to ${backLabel}`}
              onPress={onBack}
              style={styles.back}
            >
              <Icon name="chevron.left" fallback="‹" size={17} />
            </PressableScale>
          )}
          <View
            style={[styles.crumbText, !onBack && styles.crumbTextAlone]}
            accessible
            accessibilityLabel={`You are in ${path.join(", ")}`}
          >
            {path.map((label, index) => (
              <Text
                key={label}
                style={index === path.length - 1 ? styles.crumbCurrent : styles.crumbParent}
                numberOfLines={1}
              >
                {index > 0 && <Text style={styles.crumbParent}> › </Text>}
                {label}
              </Text>
            ))}
          </View>
        </Glass>
        {trailing}
      </View>
      {tabs.length > 1 && (
        <Glass style={styles.segments}>
          <SegmentedControl
            values={tabs.map((tab) => tab.label)}
            selectedIndex={tabs.findIndex((tab) => tab.key === activeTab)}
            onChange={(event) => {
              const next = tabs[event.nativeEvent.selectedSegmentIndex];
              if (next) onTabChange(next.key);
            }}
            appearance="light"
            fontStyle={{ color: colors.ink, fontSize: 14, fontWeight: "500" }}
            activeFontStyle={{ color: colors.ink, fontSize: 14, fontWeight: "600" }}
            style={styles.segmentedControl}
          />
        </Glass>
      )}
    </View>
  );
}

// A round glass button for the top bar's right side: a symbol with a short label.
export function TopBarButton({
  symbol,
  fallback,
  label,
  accessibilityLabel,
  busy,
  onPress,
}: {
  symbol: Parameters<typeof Icon>[0]["name"];
  fallback: string;
  label: string;
  accessibilityLabel: string;
  busy?: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onPress={onPress}
    >
      <Glass style={styles.button}>
        <Icon name={symbol} fallback={fallback} size={17} color={busy ? colors.secondary : colors.ink} />
        <Text style={styles.buttonText}>{label}</Text>
      </Glass>
    </PressableScale>
  );
}

// Glass controls get a hairline edge so they hold up over bright and busy parts of the map.
const edge = { borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.6)" };

const styles = StyleSheet.create({
  top: { position: "absolute", left: margin - 4, right: margin - 4, gap: 10 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  crumbs: {
    ...edge,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    minHeight: minTouch,
    borderRadius: minTouch / 2,
  },
  back: { width: minTouch, height: minTouch, alignItems: "center", justifyContent: "center", marginRight: -6 },
  crumbText: { flexShrink: 1, flexDirection: "row", paddingRight: 16 },
  crumbTextAlone: { paddingLeft: 16 },
  crumbParent: { ...type.subheadline, color: colors.secondary },
  crumbCurrent: { ...type.subheadline, fontWeight: "600", color: colors.ink },
  button: {
    ...edge,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: minTouch,
    paddingHorizontal: 16,
    borderRadius: minTouch / 2,
  },
  buttonText: { ...type.subheadline, fontWeight: "600", color: colors.ink },
  segments: { ...edge, borderRadius: 22, padding: 4 },
  segmentedControl: { height: 34 },
});
