import { uuid } from "expo-modules-core";
import {
  Linking,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useActivities } from "./ActivitiesProvider";
import { explore as theme, formatStart } from "./ExploreCards";

export type ShareableEvent = {
  id: string;
  title: string;
  starts_at: string;
  available_spots: number;
  place: { name: string };
};
export type ShareVia = "whatsapp" | "share_sheet";

// The message people send. The joinme:// link opens the event for anyone with
// the app; an https link replaces it at deploy (docs/deploy-checklist.md).
export function shareMessage(event: ShareableEvent) {
  const spots = event.available_spots;
  return `Join me: ${event.title} at ${event.place.name}, ${formatStart(event.starts_at)}. ${spots} ${spots === 1 ? "spot" : "spots"} left. On Join Me: joinme://events/${event.id}`;
}

// Opens WhatsApp with the message ready, or the phone's share sheet. Without
// WhatsApp the share sheet opens instead. Phones do not say whether a message
// was sent, so this records that sharing was opened.
export function useShareEvent() {
  const { queue, sessionID } = useActivities();
  return (
    event: ShareableEvent,
    via: ShareVia,
    source: "celebration" | "event_details",
    referrerInteractionID: string,
  ) => {
    queue.record({
      id: uuid.v4(),
      action: "event_shared",
      session_id: sessionID,
      interaction_id: uuid.v4(),
      interaction_step: 1,
      trackable_type: "event",
      trackable_id: event.id,
      source,
      occurred_at: new Date().toISOString(),
      details: { via, referrer_interaction_id: referrerInteractionID },
    });
    const message = shareMessage(event);
    const sheet = () => Share.share({ message }).catch(() => {});
    if (via === "share_sheet") return void sheet();
    Linking.openURL(
      `whatsapp://send?text=${encodeURIComponent(message)}`,
    ).catch(sheet);
  };
}

// WhatsApp first, then everything else the phone offers.
export function ShareButtons({
  onShare,
  compact = false,
}: {
  onShare: (via: ShareVia) => void;
  compact?: boolean;
}) {
  return (
    <View style={[styles.row, compact && styles.compactRow]}>
      <Pressable
        accessibilityRole="button"
        onPress={() => onShare("whatsapp")}
        style={({ pressed }) => [
          styles.whatsapp,
          compact && styles.compact,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.whatsappText}>
          {compact ? "WhatsApp" : "Share on WhatsApp"}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => onShare("share_sheet")}
        style={({ pressed }) => [
          styles.more,
          compact && styles.compact,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.moreText}>
          {compact ? "More" : "More ways to share"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 10 },
  compactRow: { flexDirection: "row", gap: 8 },
  whatsapp: {
    backgroundColor: "#1F8A4C",
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: "center",
  },
  whatsappText: { fontFamily: theme.bodyBold, fontSize: 16, color: "#FFFFFF" },
  more: {
    borderRadius: 18,
    paddingVertical: 15,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: theme.ink,
  },
  moreText: { fontFamily: theme.bodyBold, fontSize: 15, color: theme.ink },
  compact: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: 14 },
  pressed: { transform: [{ scale: 0.97 }] },
});
