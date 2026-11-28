import * as FileSystem from "expo-file-system/legacy";
import * as Location from "expo-location";

export type LocationAnswer = "while_using" | "only_this_time" | "denied";
export type LngLat = [number, number];

// Phones report a "While using the app" and an "Only this time" grant the same
// way. A "while using" grant lasts, so the phone never asks again; if it has to
// ask again after an earlier grant, that grant was only for that time, and this
// one most likely is too. This note says a grant happened before; it holds no
// location and never leaves the phone.
const grantedBefore = `${FileSystem.documentDirectory}location-granted-before`;

export async function hasLocationPermission() {
  try {
    return (await Location.getForegroundPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

// Shows the phone's prompt when it still can. `answer` is set only when the
// prompt was actually shown and answered.
export async function askForLocation(): Promise<{
  granted: boolean;
  blocked: boolean;
  answer: LocationAnswer | null;
}> {
  try {
    const before = await Location.getForegroundPermissionsAsync();
    if (before.granted) return { granted: true, blocked: false, answer: null };
    // Denied for good: the phone will not show its prompt again.
    if (!before.canAskAgain)
      return { granted: false, blocked: true, answer: null };
    const result = await Location.requestForegroundPermissionsAsync();
    if (!result.granted)
      return { granted: false, blocked: !result.canAskAgain, answer: "denied" };
    const seen = await FileSystem.getInfoAsync(grantedBefore)
      .then((info) => info.exists)
      .catch(() => false);
    FileSystem.writeAsStringAsync(grantedBefore, "1").catch(() => {});
    return {
      granted: true,
      blocked: false,
      answer: seen ? "only_this_time" : "while_using",
    };
  } catch {
    return { granted: false, blocked: false, answer: null };
  }
}

// Where the phone is, for ordering and distances only; it is never sent to be stored.
export async function currentPosition(): Promise<LngLat | null> {
  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: 120000 });
    const fix =
      last ??
      (await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }));
    return [fix.coords.longitude, fix.coords.latitude];
  } catch {
    return null;
  }
}

// Straight-line distance in metres.
export function metresBetween([lng1, lat1]: LngLat, [lng2, lat2]: LngLat) {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) *
      Math.cos(lat2 * rad) *
      Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(a));
}

export function formatDistance(metres: number) {
  return metres < 1000
    ? `${Math.max(10, Math.round(metres / 10) * 10)} m`
    : `${(metres / 1000).toFixed(metres < 10000 ? 1 : 0)} km`;
}
