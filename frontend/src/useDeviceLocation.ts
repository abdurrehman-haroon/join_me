import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

// Own the foreground subscription here so leaving the map always stops GPS.
export default function useDeviceLocation() {
  const [position, setPosition] = useState<Location.LocationObject | null>(
    null,
  );
  const [finding, setFinding] = useState(false);
  const [error, setError] = useState("");
  const [settingsRequired, setSettingsRequired] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [appState, setAppState] = useState(AppState.currentState);
  const requestPermission = useRef(false);

  useEffect(() => {
    let previousState = AppState.currentState;
    const listener = AppState.addEventListener("change", (state) => {
      if (state === previousState) return;
      previousState = state;
      setAppState(state);
      setPosition(null);
      setFinding(false);
    });
    return () => listener.remove();
  }, []);

  useEffect(() => {
    if (appState !== "active") return;
    let active = true;
    let subscription: Location.LocationSubscription | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    function fail(message: string, needsSettings = false) {
      if (!active) return;
      setPosition(null);
      setFinding(false);
      setError(message);
      setSettingsRequired(needsSettings);
      active = false;
      clearTimeout(timeout);
      subscription?.remove();
    }

    async function startLocation() {
      try {
        let permission = await Location.getForegroundPermissionsAsync();
        if (!active) return;
        if (permission.granted || attempt > 0) {
          const servicesEnabled = await Location.hasServicesEnabledAsync();
          if (!active) return;
          if (!servicesEnabled) {
            fail(
              "Location Services are off. Turn them on in your device settings, then try again.",
              true,
            );
            return;
          }
        }
        if (
          !permission.granted &&
          requestPermission.current &&
          permission.canAskAgain
        ) {
          requestPermission.current = false;
          permission = await Location.requestForegroundPermissionsAsync();
        }
        if (!active) return;
        requestPermission.current = false;
        if (!permission.granted) {
          if (attempt > 0)
            fail(
              "Allow location access to see yourself on the map.",
              !permission.canAskAgain,
            );
          return;
        }
        setFinding(true);
        setError("");
        setSettingsRequired(false);
        timeout = setTimeout(() => {
          fail(
            "Could not find your location. Move somewhere with a clearer signal and try again.",
          );
        }, 20000);
        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            distanceInterval: 5,
            timeInterval: 3000,
          },
          (location) => {
            if (!active) return;
            const { latitude, longitude, accuracy } = location.coords;
            if (
              !Number.isFinite(latitude) ||
              Math.abs(latitude) > 90 ||
              !Number.isFinite(longitude) ||
              Math.abs(longitude) > 180 ||
              !Number.isFinite(location.timestamp) ||
              Date.now() - location.timestamp > 60000 ||
              (accuracy !== null &&
                (!Number.isFinite(accuracy) || accuracy < 0))
            )
              return;
            clearTimeout(timeout);
            setPosition(location);
            setFinding(false);
            setError("");
          },
          () =>
            fail(
              "Location became unavailable. Check location access and try again.",
            ),
        );
        // Permission prompts and native startup can finish after backgrounding/unmount.
        if (!active) subscription.remove();
      } catch {
        fail(
          "Could not access your location. Check your device settings and try again.",
        );
      }
    }
    void startLocation();
    return () => {
      active = false;
      clearTimeout(timeout);
      subscription?.remove();
    };
  }, [appState, attempt]);

  function locate() {
    requestPermission.current = true;
    setError("");
    setPosition(null);
    setSettingsRequired(false);
    setFinding(true);
    setAttempt((value) => value + 1);
  }

  return { position, finding, error, settingsRequired, locate };
}
