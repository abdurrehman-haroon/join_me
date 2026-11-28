import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { explore as theme } from "./ExploreCards";
import { formatDistance, type LngLat } from "./location";

// The kinds people can pick; anything else is typed and stored as written.
export const approvedKinds: [string, string][] = [
  ["cafe", "Café"],
  ["restaurant", "Restaurant"],
  ["park", "Park"],
  ["sports_club", "Sports"],
  ["stadium", "Stadium"],
  ["campus", "Campus"],
  ["culture", "Culture"],
  ["heritage", "Heritage"],
  ["mall", "Mall"],
  ["hotel", "Hotel"],
  ["community", "Community"],
  ["exhibition", "Exhibition"],
];
const typedKind = "typed";
const maxNames = 20;

export type PinVia = "cant_find" | "pin_button" | "long_press";
export type PinnedPlace = {
  name: string;
  kind?: string;
  kindText?: string;
  coordinates: LngLat;
  private: boolean;
};
// place_pinned's details, apart from the district, which the picker knows.
export type PinTracking = {
  via: PinVia;
  duplicate_suggested: boolean;
  duplicate_ignored: boolean;
  private: boolean;
  kind: "chip" | "typed";
  names: string[];
  rename_count: number;
};
export type Nearby = {
  id: string;
  slug: string;
  name: string;
  type: string;
  kind_text: string | null;
  private: boolean;
  district: { slug: string; name: string };
  coordinates: [number, number];
  distance_m: number;
};

// Naming a pin: its name, a kind (a chip or typed), whether it is private, and
// similar places close by in case it is already on the map.
export default function PinSheet({
  apiURL,
  citySlug,
  coordinates,
  districtName,
  via,
  initialName,
  onUseExisting,
  onDone,
  onCancel,
}: {
  apiURL: string;
  citySlug: string;
  coordinates: LngLat;
  districtName: string;
  via: PinVia;
  initialName: string;
  // A suggested place was picked instead: it, how many were suggested, and the typed name.
  onUseExisting: (place: Nearby, suggested: number, name: string) => void;
  onDone: (place: PinnedPlace, tracking: PinTracking) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [kind, setKind] = useState("");
  const [kindText, setKindText] = useState("");
  const [isPrivate, setPrivate] = useState(false);
  const [nearby, setNearby] = useState<Nearby[]>([]);
  const [checking, setChecking] = useState(false);
  const everSuggested = useRef(false);
  // Every name typed along the way: a name counts once typing pauses for a
  // second or the field is left. Repeats are skipped; the last 20 are kept.
  const names = useRef<string[]>([]);
  const pause = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typed = name.trim();

  function remember(value: string) {
    const next = value.trim();
    if (!next || names.current[names.current.length - 1] === next) return;
    names.current = [...names.current, next.slice(0, 80)].slice(-maxNames);
  }
  useEffect(() => {
    if (initialName.trim()) remember(initialName);
    return () => {
      if (pause.current) clearTimeout(pause.current);
    };
    // Only the name the sheet opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Similar places within 150 m, a moment after typing stops.
  useEffect(() => {
    if (typed.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(
        `${apiURL}/cities/${citySlug}/places/nearby?lng=${coordinates[0]}&lat=${coordinates[1]}&q=${encodeURIComponent(typed)}`,
        { signal: controller.signal },
      )
        .then((response) =>
          response.ok ? response.json() : Promise.reject(new Error()),
        )
        .then((body: { places: Nearby[] }) => {
          setNearby(body.places);
          if (body.places.length) everSuggested.current = true;
          setChecking(false);
        })
        .catch(() => {
          if (!controller.signal.aborted) setChecking(false);
        });
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [apiURL, citySlug, coordinates, typed]);

  function changeName(value: string) {
    setName(value);
    setChecking(value.trim().length >= 2);
    if (value.trim().length < 2) setNearby([]);
    if (pause.current) clearTimeout(pause.current);
    pause.current = setTimeout(() => remember(value), 1000);
  }

  const nameOK = typed.length >= 2 && typed.length <= 80;
  const kindOK =
    kind === typedKind
      ? kindText.trim().length >= 1 && kindText.trim().length <= 40
      : !!kind;
  function done() {
    if (pause.current) clearTimeout(pause.current);
    remember(typed);
    const typedIt = kind === typedKind;
    onDone(
      {
        name: typed,
        ...(typedIt ? { kindText: kindText.trim() } : { kind }),
        coordinates,
        private: isPrivate,
      },
      {
        via,
        duplicate_suggested: everSuggested.current,
        duplicate_ignored: everSuggested.current,
        private: isPrivate,
        kind: typedIt ? "typed" : "chip",
        names: names.current,
        rename_count: names.current.length - 1,
      },
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.kicker}>
        NEW PLACE · {districtName.toUpperCase()}
      </Text>
      <TextInput
        accessibilityLabel="Name this place"
        value={name}
        onChangeText={changeName}
        onBlur={() => remember(name)}
        placeholder="Name this place"
        placeholderTextColor={theme.muted}
        maxLength={80}
        autoFocus={!initialName}
        style={styles.name}
      />
      {checking && <ActivityIndicator color={theme.red} style={styles.spin} />}
      {nearby.length > 0 && (
        <View style={styles.suggestions}>
          <Text style={styles.label}>DID YOU MEAN</Text>
          {nearby.map((place) => (
            <View key={place.id} style={styles.suggestion}>
              <View style={styles.suggestionText}>
                <Text style={styles.suggestionName} numberOfLines={1}>
                  {place.name}
                </Text>
                <Text style={styles.muted}>
                  {formatDistance(place.distance_m)} from your pin
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Use ${place.name}`}
                onPress={() => {
                  remember(typed);
                  onUseExisting(place, nearby.length, typed);
                }}
                style={styles.useThat}
              >
                <Text style={styles.useThatText}>Use this</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
      <Text style={styles.label}>KIND</Text>
      <View style={styles.kinds}>
        {[...approvedKinds, [typedKind, "Something else"]].map(
          ([key, label]) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityState={{ selected: kind === key }}
              onPress={() => setKind(key)}
              style={[styles.kind, kind === key && styles.kindOn]}
            >
              <Text
                style={[styles.kindText, kind === key && styles.kindTextOn]}
              >
                {label}
              </Text>
            </Pressable>
          ),
        )}
      </View>
      {kind === typedKind && (
        <TextInput
          accessibilityLabel="Type the kind of place"
          value={kindText}
          onChangeText={setKindText}
          placeholder="Rooftop, dhaba, home…"
          placeholderTextColor={theme.muted}
          maxLength={40}
          autoFocus
          style={styles.input}
        />
      )}
      <View style={styles.private}>
        <View style={styles.privateText}>
          <Text style={styles.privateTitle}>Private place, like a home</Text>
          <Text style={styles.muted}>
            Only you will find it in search and on this map.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Private place"
          value={isPrivate}
          onValueChange={setPrivate}
          trackColor={{ true: theme.ink, false: theme.line }}
          thumbColor={theme.cream}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={!nameOK || !kindOK}
        onPress={done}
        style={({ pressed }) => [
          styles.use,
          (!nameOK || !kindOK) && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.useText}>Use this place</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={onCancel}
        style={styles.secondary}
      >
        <Text style={styles.action}>Move the pin</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 22, paddingBottom: 30, gap: 10 },
  kicker: {
    fontFamily: theme.bodyBold,
    fontSize: 10,
    letterSpacing: 1.4,
    color: theme.red,
  },
  name: {
    fontFamily: theme.display,
    fontSize: 30,
    color: theme.ink,
    borderBottomWidth: 2,
    borderBottomColor: theme.line,
    paddingVertical: 4,
  },
  spin: { alignSelf: "flex-start" },
  label: {
    fontFamily: theme.bodyBold,
    fontSize: 10,
    letterSpacing: 1.4,
    color: theme.muted,
    marginTop: 6,
  },
  suggestions: { gap: 8 },
  suggestion: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: theme.cream,
    borderWidth: 1,
    borderColor: theme.red,
  },
  suggestionText: { flex: 1, gap: 2 },
  suggestionName: {
    fontFamily: theme.bodyBold,
    fontSize: 15,
    color: theme.ink,
  },
  useThat: {
    backgroundColor: theme.ink,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  useThatText: { fontFamily: theme.bodyBold, fontSize: 13, color: theme.cream },
  muted: { fontFamily: theme.body, fontSize: 12, color: theme.muted },
  kinds: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kind: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: theme.sage,
    borderWidth: 1,
    borderColor: theme.line,
  },
  kindOn: { backgroundColor: theme.ink, borderColor: theme.ink },
  kindText: { fontFamily: theme.bodyBold, fontSize: 13, color: theme.ink },
  kindTextOn: { color: theme.cream },
  input: {
    fontFamily: theme.bodyMedium,
    fontSize: 15,
    color: theme.ink,
    backgroundColor: theme.cream,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  private: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 6,
  },
  privateText: { flex: 1, gap: 2 },
  privateTitle: { fontFamily: theme.bodyBold, fontSize: 14, color: theme.ink },
  use: {
    marginTop: 8,
    backgroundColor: theme.red,
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: "center",
  },
  disabled: { opacity: 0.45 },
  pressed: { transform: [{ scale: 0.98 }] },
  useText: { fontFamily: theme.bodyBold, fontSize: 16, color: theme.cream },
  secondary: { alignItems: "center", paddingVertical: 10 },
  action: { fontFamily: theme.bodyBold, fontSize: 15, color: theme.ink },
});
