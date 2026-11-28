import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import YourActivity from "./YourActivity";

type Profile = {
  id: string;
  display_name: string;
  created_at: string;
  updated_at: string;
};
const apiURL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8080";

export default function ProfileScreen({
  embedded = false,
}: {
  // Inside the You tab, which shows its own title.
  embedded?: boolean;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [retry, setRetry] = useState(0);
  const pending = useRef(false);
  const saveController = useRef<AbortController | null>(null);
  useEffect(() => () => saveController.current?.abort(), []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    async function load() {
      try {
        const response = await fetch(`${apiURL}/me`, {
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(
            (await response.text()).trim() || "Could not load profile.",
          );
        const user: Profile = await response.json();
        if (active) {
          setProfile(user);
          setError("");
        }
      } catch (failure) {
        if (active)
          setError(
            failure instanceof Error && failure.name !== "AbortError"
              ? failure.message
              : "Could not load your profile. Try again.",
          );
      } finally {
        clearTimeout(timeout);
      }
    }
    void load();
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [retry]);

  async function save() {
    const name = draft.trim();
    if (!name || Array.from(name).length > 100 || /[\r\n\0]/.test(name)) {
      setError("Enter a name of 1–100 characters on one line.");
      return;
    }
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError("");
    setSaved(false);
    const controller = new AbortController();
    saveController.current = controller;
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${apiURL}/me`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: name }),
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error(
          (await response.text()).trim() || "Could not save your name.",
        );
      const user: Profile = await response.json();
      setProfile(user);
      setEditing(false);
      setSaved(true);
    } catch (failure) {
      setError(
        failure instanceof Error &&
          failure.name !== "AbortError" &&
          failure.message !== "Network request failed"
          ? failure.message
          : "Could not confirm saving. Your draft is kept; retry Save or cancel to reload your saved name.",
      );
    } finally {
      clearTimeout(timeout);
      saveController.current = null;
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[styles.content, embedded && styles.embedded]}
        keyboardShouldPersistTaps="handled"
      >
        {!embedded && <Text style={styles.title}>You</Text>}
        <Text style={styles.muted}>Using the demo user · no sign-in yet</Text>
        {!profile && !error && <ActivityIndicator color="#E3342F" />}
        {profile && (
          <>
            <View style={styles.card}>
              <Text style={styles.kicker}>YOUR PROFILE</Text>
              <Text style={styles.name}>{profile.display_name}</Text>
              <Text style={styles.muted}>
                This name appears on your events and messages.
              </Text>
            </View>
            {editing ? (
              <View style={styles.form}>
                <Text style={styles.label}>Display name</Text>
                <TextInput
                  placeholderTextColor="#798268"
                  accessibilityLabel="Display name"
                  value={draft}
                  onChangeText={setDraft}
                  editable={!saving}
                  autoCapitalize="words"
                  autoCorrect={false}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={() => void save()}
                  style={styles.input}
                />
                <View style={styles.actions}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={saving || !draft.trim()}
                    onPress={() => void save()}
                    style={[
                      styles.button,
                      (saving || !draft.trim()) && styles.disabled,
                    ]}
                  >
                    {saving ? (
                      <ActivityIndicator color="#FFF8E8" />
                    ) : (
                      <Text style={styles.buttonText}>Save name</Text>
                    )}
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={saving}
                    onPress={() => {
                      setEditing(false);
                      setError("");
                      setRetry((value) => value + 1);
                    }}
                    style={styles.secondary}
                  >
                    <Text style={styles.action}>Cancel</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                style={styles.button}
                onPress={() => {
                  setDraft(profile.display_name);
                  setEditing(true);
                  setSaved(false);
                  setError("");
                }}
              >
                <Text style={styles.buttonText}>Edit name</Text>
              </Pressable>
            )}
          </>
        )}
        {!!error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
        {!!error && !editing && (
          <Pressable
            accessibilityRole="button"
            style={styles.secondary}
            onPress={() => {
              setError("");
              setRetry((value) => value + 1);
            }}
          >
            <Text style={styles.action}>Try again</Text>
          </Pressable>
        )}
        {saved && !editing && (
          <Text accessibilityLiveRegion="polite" style={styles.action}>
            Name saved.
          </Text>
        )}
        {profile && <YourActivity />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#FAF5E7" },
  content: { padding: 24, paddingTop: 64, paddingBottom: 40, gap: 20 },
  embedded: { paddingTop: 16 },
  title: {
    fontFamily: "BarlowCondensed_800ExtraBold",
    fontSize: 48,
    color: "#203E30",
  },
  name: {
    fontFamily: "BarlowCondensed_800ExtraBold",
    fontSize: 44,
    color: "#203E30",
  },
  card: {
    backgroundColor: "#FFF8E8",
    borderRadius: 24,
    padding: 24,
    gap: 12,
    borderWidth: 1,
    borderColor: "#D2D9B8",
  },
  kicker: {
    color: "#E3342F",
    fontSize: 11,
    fontFamily: "DMSans_700Bold",
    letterSpacing: 1.3,
  },
  muted: {
    color: "#798268",
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "DMSans_400Regular",
  },
  form: { gap: 14 },
  label: { color: "#203E30", fontSize: 16, fontFamily: "DMSans_700Bold" },
  input: {
    backgroundColor: "#FFF8E8",
    color: "#203E30",
    fontSize: 18,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#D2D9B8",
    fontFamily: "DMSans_400Regular",
  },
  actions: { flexDirection: "row", alignItems: "center", gap: 16 },
  button: {
    backgroundColor: "#E3342F",
    borderRadius: 18,
    padding: 18,
    alignItems: "center",
    minWidth: 140,
  },
  buttonText: { color: "#FFF8E8", fontSize: 16, fontFamily: "DMSans_700Bold" },
  secondary: { padding: 18 },
  action: { color: "#203E30", fontSize: 16, fontFamily: "DMSans_700Bold" },
  disabled: { opacity: 0.5 },
  error: {
    color: "#B51E2C",
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "DMSans_400Regular",
  },
});
