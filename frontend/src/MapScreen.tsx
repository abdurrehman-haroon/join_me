import type * as GeoJSON from "geojson";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import EventDetails, { type EventSummary } from "./EventDetails";
import EventForm from "./EventForm";
import useDeviceLocation from "./useDeviceLocation";
import TonightStory, { type CameraFrame, type StoryLevel } from "./TonightStory";
import CampusScene, { type CampusSceneHandle, type ScenePin } from "./CampusScene";
import { toScene, type ScenePlace } from "./campusModel";
import useReduceMotion from "./useReduceMotion";
import { uuid } from "expo-modules-core";
import { useActivities, useActivityInteraction } from "./ActivitiesProvider";
import { DiscoveryTracker, type SportFilter } from "./activities";

// West, south, east, north.
type LngLatBounds = [number, number, number, number];
type Area = {
  id: string;
  name: string;
  type: string;
  boundary: GeoJSON.MultiPolygon | null;
  bbox: LngLatBounds | null;
  created_at: string;
  updated_at: string;
};
type PlaceProperties = {
  id: string;
  area_id: string;
  name: string;
  type: string;
  boundary: GeoJSON.MultiPolygon | null;
  created_at: string;
  updated_at: string;
};
type Place = GeoJSON.Feature<GeoJSON.Point, PlaceProperties>;
type Places = GeoJSON.FeatureCollection<GeoJSON.Point, PlaceProperties> & {
  truncated: boolean;
};
type EventList = {
  events: EventSummary[];
  place_counts: Record<string, number>;
  truncated: boolean;
};

const apiURL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8080";
const initialAreaID =
  process.env.EXPO_PUBLIC_INITIAL_AREA_ID ??
  "00000000-0000-4000-8000-000000000001";
const emptyPlaces: Places = {
  type: "FeatureCollection",
  features: [],
  truncated: false,
};
// The home story's camera on the 3D campus, as in v6: a high overview, then each
// ground from closer and steeper, turning a little either way between grounds.
const homeTurn = 0.22;
const overviewView = { distance: 96, tilt: 0.62 };
const groundView = { distance: 30, tilt: 0.98 };
// A ground's own level circles it, one step per game.
const groundTurnPerGame = 0.32;
// Beyond this distance from the campus centre (in scene units, 15 m each) the
// device is treated as off campus and the camera does not follow it.
const offCampusDistance = 120;

export default function MapScreen() {
  const { queue, sessionID } = useActivities();
  const [discovery] = useState(
    () =>
      new DiscoveryTracker(
        sessionID,
        (activity) => queue.record(activity),
        () => uuid.v4(),
      ),
  );
  const [foreground, setForeground] = useState(
    AppState.currentState === "active",
  );
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null);
  const [eventReferrer, setEventReferrer] = useState<string | undefined>(undefined);
  const campusScene = useRef<CampusSceneHandle>(null);
  const deviceLocation = useDeviceLocation();
  const centreOnNextLocation = useRef(false);
  const [area, setArea] = useState<Area | null>(null);
  const [bounds, setBounds] = useState<LngLatBounds | null>(null);
  const [places, setPlaces] = useState<Places>(emptyPlaces);
  const [events, setEvents] = useState<EventList>({
    events: [],
    place_counts: {},
    truncated: false,
  });
  const [eventType, setEventType] = useState<"" | "football" | "cricket">("");
  const [eventID, setEventID] = useState<string | null>(null);
  const [creationPlace, setCreationPlace] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [eventRefresh, setEventRefresh] = useState(0);
  const [createdAtPlace, setCreatedAtPlace] = useState<string | null>(null);
  const [selected, setSelected] = useState<Place | null>(null);
  const [areaError, setAreaError] = useState("");
  const [placesError, setPlacesError] = useState("");
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [retry, setRetry] = useState(0);
  const reduceMotion = useReduceMotion();
  // Campus-wide upcoming events for the feed. Unlike `events`, this does not shrink
  // when the camera zooms into a single ground.
  const [campusEvents, setCampusEvents] = useState<EventSummary[]>([]);
  // The kick-off time of the feed card in focus; the map's light follows it.
  const [feedTime, setFeedTime] = useState<Date | null>(null);
  // The home story's level: the whole campus (null) or one ground.
  const [storyPlace, setStoryPlace] = useState<EventSummary["place"] | null>(null);
  const [entrance, setEntrance] = useState<"in" | "out" | null>(null);
  // Explore mode: turn and zoom the 3D campus freely and tap grounds, instead of the story.
  const [exploring, setExploring] = useState(false);
  const [focusedPlaceID, setFocusedPlaceID] = useState<string | null>(null);
  const [offCampus, setOffCampus] = useState(false);
  // Location problems are only shown after the user asks for their location.
  const [locationAsked, setLocationAsked] = useState(false);
  const placeEvents = events.events.filter(
    (event) => event.place.id === selected?.properties.id,
  );
  const sport: SportFilter = eventType || "all";
  const queryKey = bounds ? `${bounds.join(",")}|${eventType}` : null;
  const discoveryVisible = foreground && !eventID && !creationPlace;
  const placeInteraction = useActivityInteraction({
    enabled: Boolean(selected),
    visible: !eventID && !creationPlace,
    target: { type: "place", id: selected?.properties.id ?? "" },
    source: "map",
    startAction: "place_viewed",
    details: { sport, referrer_interaction_id: discovery.id },
  });

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setForeground(state === "active"),
    );
    return () => subscription.remove();
  }, []);


  useEffect(() => {
    // Only count an impression of the successful query currently shown, never stale/loading/error data.
    if (
      !discoveryVisible ||
      !queryKey ||
      loadedQuery !== queryKey ||
      !exploring ||
      loadingPlaces ||
      areaError ||
      placesError
    )
      return;
    if (selected) {
      if (placeInteraction.current)
        discovery.observePlaceResults(
          placeInteraction.current,
          sport,
          !events.truncated &&
            (events.place_counts[selected.properties.id] ?? 0) === 0,
        );
    } else {
      const emptyKind =
        places.truncated || events.truncated
          ? null
          : places.features.length === 0
            ? "no_places"
            : events.events.length === 0
              ? "no_events"
              : null;
      // Coordinate-based fingerprints are local deduplication only, not activity data.
      const viewKey = bounds?.map((value) => value.toFixed(5)).join(",") ?? "";
      discovery.observeMapResults(viewKey, sport, emptyKind);
    }
  }, [
    discovery,
    discoveryVisible,
    queryKey,
    loadedQuery,
    exploring,
    loadingPlaces,
    areaError,
    placesError,
    selected,
    events,
    places,
    sport,
    bounds,
    placeInteraction,
  ]);

  // The 3D campus is laid out around the centre of the campus bounding box.
  const origin: [number, number] | null = area?.bbox
    ? [(area.bbox[0] + area.bbox[2]) / 2, (area.bbox[1] + area.bbox[3]) / 2]
    : null;

  const coordinates = deviceLocation.position?.coords;
  const you: [number, number] | null = coordinates
    ? [coordinates.longitude, coordinates.latitude]
    : null;

  useEffect(() => {
    if (!you || !origin || !centreOnNextLocation.current) return;
    centreOnNextLocation.current = false;
    const point = toScene(you, origin);
    const away = Math.hypot(point.x, point.z) > offCampusDistance;
    setOffCampus(away);
    if (!away)
      campusScene.current?.moveTo({
        x: point.x,
        z: point.z,
        distance: 40,
        tilt: 0.9,
        turn: homeTurn,
        time: 0,
      });
    // `you` changes identity every render; its coordinates are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordinates?.latitude, coordinates?.longitude, origin?.[0], origin?.[1]]);

  function showMyLocation() {
    setLocationAsked(true);
    setSelected(null);
    setOffCampus(false);
    centreOnNextLocation.current = true;
    deviceLocation.locate();
  }

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    async function loadArea() {
      try {
        const response = await fetch(`${apiURL}/areas/${initialAreaID}`, {
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(`Area request failed (${response.status})`);
        const loadedArea: Area = await response.json();
        if (!loadedArea.bbox) {
          if (active) setAreaError("This area has no mapped grounds yet.");
          return;
        }
        if (active) {
          setAreaError("");
          setArea(loadedArea);
          setBounds(loadedArea.bbox);
        }
      } catch {
        if (active)
          setAreaError(
            "Could not load the campus. Check your connection and try again.",
          );
      } finally {
        clearTimeout(timeout);
      }
    }
    void loadArea();
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [retry]);

  useEffect(() => {
    if (!bounds) return;
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    // Query after the camera settles; cancel superseded requests to avoid stale pins.
    const debounce = setTimeout(async () => {
      setLoadingPlaces(true);
      setEvents({ events: [], place_counts: {}, truncated: false });
      setPlacesError("");
      try {
        const [placesResponse, eventsResponse] = await Promise.all([
          fetch(`${apiURL}/places?bbox=${bounds.join(",")}`, {
            signal: controller.signal,
          }),
          fetch(`${apiURL}/events?bbox=${bounds.join(",")}&type=${eventType}`, {
            signal: controller.signal,
          }),
        ]);
        if (!placesResponse.ok || !eventsResponse.ok)
          throw new Error("Could not load this view");
        const [loadedPlaces, loadedEvents]: [Places, EventList] =
          await Promise.all([placesResponse.json(), eventsResponse.json()]);
        if (active) {
          setPlaces(loadedPlaces);
          setEvents(loadedEvents);
          setLoadedQuery(`${bounds!.join(",")}|${eventType}`);
          setSelected((current) =>
            current
              ? (loadedPlaces.features.find(
                  (place) => place.id === current.id,
                ) ?? null)
              : null,
          );
        }
      } catch {
        if (active)
          setPlacesError("Could not refresh places and events. Try again.");
      } finally {
        clearTimeout(timeout);
        if (active) setLoadingPlaces(false);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(debounce);
      clearTimeout(timeout);
      controller.abort();
    };
  }, [bounds, retry, eventType, eventRefresh]);

  // Feed data loads for the whole campus on open, filter change, after this user
  // creates/joins/cancels (eventRefresh), and when the app returns to the foreground.
  // No live updates: map-wide realtime is separate work in plan.md.
  useEffect(() => {
    if (!area?.bbox || !foreground) return;
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    async function loadCampusEvents() {
      try {
        const response = await fetch(
          `${apiURL}/events?bbox=${area!.bbox!.join(",")}&type=${eventType}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("Could not load upcoming events");
        const loaded: EventList = await response.json();
        if (active) setCampusEvents(loaded.events);
      } catch {
        // Keep the last feed; the map's own error state already offers Try again.
      } finally {
        clearTimeout(timeout);
      }
    }
    void loadCampusEvents();
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [area, eventType, eventRefresh, retry, foreground]);


  // Looks slightly past a ground, towards the camera, so the ground sits above a card
  // or sheet at the bottom of the screen.
  function groundFrame(
    coordinates: [number, number],
    distance: number,
    tilt: number,
    turn: number,
    time: number,
  ): CameraFrame {
    const point = toScene(coordinates, origin!);
    const ahead = distance * 0.12;
    return {
      x: point.x + Math.sin(turn) * ahead,
      z: point.z + Math.cos(turn) * ahead,
      distance,
      tilt,
      turn,
      time,
    };
  }

  // Camera stops for the story at a level: an overview, one per game, then the end card.
  function storyFrames(place: EventSummary["place"] | null): CameraFrame[] {
    if (!origin) return [];
    const now = new Date().getTime();
    const games = place
      ? campusEvents.filter((event) => event.place.id === place.id)
      : campusEvents;
    const lastTime = games.length
      ? new Date(games[games.length - 1].starts_at).getTime()
      : now;
    // The story starts now, or just before the first game if that is on a later day,
    // so the light does not pass through a night before the first card.
    const firstTime = games.length ? new Date(games[0].starts_at).getTime() : now;
    const start =
      new Date(firstTime).toDateString() === new Date(now).toDateString()
        ? now
        : firstTime - 30 * 60000;
    const end = lastTime + 30 * 60000;
    const view = groundFrame;
    // The overview looks between the middle of the campus and its grounds, so the
    // grounds are in view under the title.
    const groundPoints = places.features.map((p) =>
      toScene(p.geometry.coordinates as [number, number], origin),
    );
    const middle = groundPoints.length
      ? {
          x: groundPoints.reduce((sum, p) => sum + p.x, 0) / groundPoints.length / 2,
          z: groundPoints.reduce((sum, p) => sum + p.z, 0) / groundPoints.length / 2,
        }
      : { x: 0, z: 0 };
    if (!place)
      return [
        { ...middle, ...overviewView, turn: homeTurn - 0.15, time: start },
        ...games.map((event, index) =>
          view(
            event.place.coordinates,
            groundView.distance,
            groundView.tilt,
            homeTurn + (index % 2 ? 0.2 : -0.16),
            new Date(event.starts_at).getTime(),
          ),
        ),
        { ...middle, distance: 86, tilt: 0.8, turn: homeTurn + 0.25, time: end },
      ];
    return [
      view(place.coordinates, 40, 0.92, homeTurn - 0.3, start),
      ...games.map((event, index) =>
        view(
          place.coordinates,
          groundView.distance,
          groundView.tilt,
          homeTurn + 0.1 + index * groundTurnPerGame,
          new Date(event.starts_at).getTime(),
        ),
      ),
      view(place.coordinates, 34, 0.9, homeTurn + 0.6, end),
    ];
  }

  function enterLevel(place: EventSummary["place"] | null) {
    setEntrance(place ? "in" : "out");
    setStoryPlace(place);
    setFocusedPlaceID(place?.id ?? null);
    setFeedTime(null);
    const first = storyFrames(place)[0];
    if (first) campusScene.current?.moveTo(first, { slow: true });
  }

  function backToStory() {
    setExploring(false);
    setLocationAsked(false);
    setSelected(null);
    setEntrance(null);
    setFeedTime(null);
    setOffCampus(false);
    const first = storyFrames(storyPlace)[0];
    if (first) campusScene.current?.moveTo(first, { slow: true });
  }

  function startExploring() {
    setExploring(true);
    setFocusedPlaceID(null);
    setFeedTime(null);
  }

  // A tap in explore mode: open the ground's sheet and fly to it, or close the sheet.
  function selectPlace(placeID: string | null) {
    const place = places.features.find((item) => item.properties.id === placeID) ?? null;
    setSelected(place);
    if (place)
      campusScene.current?.moveTo(
        groundFrame(
          place.geometry.coordinates as [number, number],
          groundView.distance,
          groundView.tilt,
          homeTurn,
          0,
        ),
      );
  }

  function recentre() {
    centreOnNextLocation.current = false;
    setSelected(null);
    setOffCampus(false);
    const overview = storyFrames(null)[0];
    if (overview) campusScene.current?.moveTo(overview, { slow: true });
  }

  // Follows the story's scroll position every frame.
  function followStory(frame: CameraFrame) {
    campusScene.current?.moveTo(frame);
    // The light only needs to change every ten minutes of story time.
    const step = Math.round(frame.time / 600000) * 600000;
    if (step !== feedTime?.getTime()) setFeedTime(new Date(step));
  }

  const storyReady = Boolean(
    area?.boundary && origin && loadedQuery !== null && !areaError,
  );
  const showStory = storyReady && !exploring;
  const storyEvents = storyPlace
    ? campusEvents.filter((event) => event.place.id === storyPlace.id)
    : campusEvents;
  const players = storyEvents.reduce((sum, event) => sum + event.participant_count, 0);
  const allTonight = storyEvents.every(
    (event) => new Date(event.starts_at).toDateString() === new Date().toDateString(),
  );
  const campusName = area?.name ?? "LUMS";
  const scenePlaces: ScenePlace[] = places.features.map((place) => ({
    id: place.properties.id,
    name: place.properties.name,
    type: place.properties.type,
    coordinates: place.geometry.coordinates as [number, number],
    boundary: place.properties.boundary ?? null,
  }));
  // One ball per ground with games, labelled with its next game.
  const scenePins: ScenePin[] = [];
  for (const event of campusEvents) {
    if (scenePins.some((pin) => pin.placeID === event.place.id)) continue;
    scenePins.push({
      placeID: event.place.id,
      sport: event.type,
      full: event.is_full,
      headline: event.is_full ? "Full" : `${event.available_spots} left`,
      detail: `${event.type === "cricket" ? "Tape-ball" : "Football"}, ${new Date(
        event.starts_at,
      ).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`,
    });
  }
  const storyFramesNow = storyFrames(storyPlace);
  // Explore shows the campus as it is now; the story shows the time being scrolled through.
  const sceneTime = exploring
    ? new Date()
    : (feedTime ?? new Date(storyFramesNow[0]?.time ?? new Date().getTime()));
  const sceneHour = sceneTime.getHours() + sceneTime.getMinutes() / 60;
  const storyLevel: StoryLevel = {
    path: storyPlace
      ? [
          { label: "Lahore", onPress: null },
          { label: campusName, onPress: () => enterLevel(null) },
          { label: storyPlace.name, onPress: null },
        ]
      : [
          { label: "Lahore", onPress: null },
          { label: campusName, onPress: null },
        ],
    kicker: `${allTonight ? "Tonight" : "Coming up"} ${storyPlace ? "at" : "in"}`,
    heading: allTonight ? "Tonight" : "Coming up",
    word: (storyPlace?.name ?? campusName).toUpperCase(),
    subtitle: storyPlace
      ? `${storyEvents.length} game${storyEvents.length === 1 ? "" : "s"} here. Scroll to circle the ground. Pinch in or tap − to go back to ${campusName}.`
      : storyEvents.length
        ? `${storyEvents.length} game${storyEvents.length === 1 ? "" : "s"} and ${players} player${players === 1 ? "" : "s"}. Scroll to walk the campus, game by game.`
        : `No games yet. Start one and it drops onto the map for everyone at ${campusName}.`,
    events: storyEvents,
    frames: storyFramesNow,
    end: storyPlace
      ? {
          title: "Nothing that fits?",
          body: `Start your own game at ${storyPlace.name}. It shows up here for everyone at ${campusName}.`,
          action: "Start a game here",
          onAction: () => {
            setCreatedAtPlace(null);
            setCreationPlace({ id: storyPlace.id, name: storyPlace.name });
          },
        }
      : {
          title: storyEvents.length ? "That’s everything coming up" : "Be the first",
          body: "No game at your time? Pick a ground on the map and start one.",
          action: "Start a game",
          onAction: startExploring,
        },
    canZoomOut: Boolean(storyPlace),
  };

  const sportFilter = (
    <View style={styles.filters}>
      {(["", "football", "cricket"] as const).map((type) => (
        <Pressable
          key={type}
          accessibilityRole="button"
          accessibilityState={{ selected: eventType === type }}
          onPress={() => {
            if (discovery.selectSport(type || "all")) setEventType(type);
          }}
          style={[styles.filter, eventType === type && styles.activeFilter]}
        >
          <Text
            style={[
              styles.filterText,
              eventType === type && styles.activeFilterText,
            ]}
          >
            {type ? type[0].toUpperCase() + type.slice(1) : "All"}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <View style={styles.root}>
      {/* One scene for both the story and explore mode, so it is never rebuilt. */}
      {storyReady && area?.boundary && origin && storyFramesNow[0] && (
        <CampusScene
          ref={campusScene}
          boundary={area.boundary}
          origin={origin}
          places={scenePlaces}
          pins={scenePins}
          focusPlaceID={exploring ? (selected?.properties.id ?? null) : focusedPlaceID}
          hour={sceneHour}
          initialFrame={storyFramesNow[0]}
          reduceMotion={reduceMotion}
          interactive={exploring}
          onPlacePress={selectPlace}
          you={you}
        />
      )}
      {showStory && (
        <TonightStory
          key={storyPlace?.id ?? "campus"}
          level={storyLevel}
          depth={storyPlace ? 1 : 0}
          levelCount={2}
          reduceMotion={reduceMotion}
          entrance={entrance}
          filter={storyPlace ? null : sportFilter}
          onCameraFrame={followStory}
          onActiveEventChange={(event) =>
            setFocusedPlaceID(event?.place.id ?? storyPlace?.id ?? null)
          }
          onZoomIn={storyPlace ? null : (event) => enterLevel(event.place)}
          onZoomOut={() => enterLevel(null)}
          // Pinching out brings the camera closer; it springs back on release.
          onPinch={(spread) =>
            campusScene.current?.pinchZoom(spread === null ? null : 1 / spread)
          }
          onOpenEvent={(event) => {
            setEventReferrer(discovery.id);
            setEventID(event.id);
          }}
          onExplore={startExploring}
        />
      )}
      {!showStory && (
        <>
          {/* Explore keeps the story's look: breadcrumb and filters on top, round controls on the right. */}
          <View style={styles.exploreTop} pointerEvents="box-none">
            <View style={styles.crumbs}>
              <Text style={styles.crumbMuted}>Lahore</Text>
              <Text style={styles.crumbSeparator}>›</Text>
              <Text style={styles.crumbCurrent}>{campusName}</Text>
              <Text style={styles.crumbSeparator}>·</Text>
              <Text style={styles.crumbMuted}>Explore</Text>
            </View>
            {sportFilter}
          </View>
          <View style={styles.exploreControls}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                deviceLocation.finding ? "Finding your location" : "Show my location"
              }
              accessibilityState={{
                disabled: deviceLocation.finding,
                busy: deviceLocation.finding,
              }}
              disabled={deviceLocation.finding}
              onPress={showMyLocation}
              style={styles.roundButton}
            >
              {deviceLocation.finding ? (
                <ActivityIndicator color="#2678D8" />
              ) : (
                <Text style={styles.roundIcon}>◎</Text>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Show all of ${campusName}`}
              onPress={recentre}
              style={styles.roundButton}
            >
              <Text style={styles.roundIcon}>⌂</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to tonight’s games"
              onPress={backToStory}
              style={[styles.roundButton, styles.tonightButton]}
            >
              <Text style={styles.tonightText}>Tonight</Text>
            </Pressable>
          </View>
        </>
      )}

      {!showStory && locationAsked && deviceLocation.error && (
        <View style={styles.locationStatus} accessibilityLiveRegion="polite">
          <Text style={styles.body}>{deviceLocation.error}</Text>
          <View style={styles.locationActions}>
            {deviceLocation.settingsRequired && (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  void Linking.openSettings().catch(() => {
                    Alert.alert(
                      "Open device settings",
                      "Enable Location Services and allow Campus Pickup to access your location while using the app.",
                    );
                  });
                }}
                style={styles.retry}
              >
                <Text style={styles.buttonText}>Open Settings</Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              onPress={showMyLocation}
              style={styles.retry}
            >
              <Text style={styles.buttonText}>Try location again</Text>
            </Pressable>
          </View>
        </View>
      )}

      {areaError || placesError ? (
        <View style={styles.status}>
          <Text style={styles.body}>{areaError || placesError}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setRetry((value) => value + 1)}
            style={styles.retry}
          >
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      ) : !storyReady || (exploring && loadingPlaces) ? (
        <View style={styles.loading}>
          <ActivityIndicator color="#1D5B3A" />
          <Text style={styles.body}>
            {storyReady ? "Loading places and events…" : "Loading campus…"}
          </Text>
        </View>
      ) : null}

      {showStory ? null : selected ? (
        <View style={styles.sheet}>
          <View style={styles.sheetHeading}>
            <Text style={styles.kicker}>
              {selected.properties.type.toUpperCase()}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close place details"
              onPress={() => setSelected(null)}
            >
              <Text style={styles.buttonText}>Close</Text>
            </Pressable>
          </View>
          <Text style={styles.placeName}>{selected.properties.name}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setCreatedAtPlace(null);
              setCreationPlace({
                id: selected.properties.id,
                name: selected.properties.name,
              });
            }}
            style={styles.createButton}
          >
            <Text style={styles.createText}>+ Create event here</Text>
          </Pressable>
          {createdAtPlace === selected.properties.id && (
            <Text style={styles.body}>
              Event created. You’re on the participant list.
            </Text>
          )}
          <ScrollView style={styles.eventList}>
            {loadingPlaces ? (
              <Text style={styles.body}>Loading upcoming events…</Text>
            ) : placesError ? (
              <Text style={styles.body}>
                Events unavailable. Use Try again above.
              </Text>
            ) : (
              <>
                <Text style={styles.body}>
                  {events.place_counts[selected.properties.id] ?? 0} upcoming
                  events
                </Text>
                {placeEvents.map((event) => (
                  <Pressable
                    key={event.id}
                    accessibilityRole="button"
                    accessibilityLabel={`View ${event.title}`}
                    onPress={() => {
                      setEventReferrer(placeInteraction.current?.id);
                      setEventID(event.id);
                    }}
                    style={styles.eventCard}
                  >
                    <Text style={styles.eventTitle}>{event.title}</Text>
                    <Text style={styles.body}>
                      {new Date(event.starts_at).toLocaleString([], {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </Text>
                    <Text style={styles.source}>
                      {event.type.toUpperCase()} · {event.participant_count}/
                      {event.capacity} going ·{" "}
                      {event.is_full
                        ? "Full"
                        : `${event.available_spots} spots left`}
                    </Text>
                  </Pressable>
                ))}
                {!placeEvents.length && !events.truncated && (
                  <Text style={styles.body}>
                    No upcoming {eventType || ""} events here yet.
                  </Text>
                )}
                {events.truncated && (
                  <Text style={styles.body}>
                    Zoom in to load all events at this place.
                  </Text>
                )}
              </>
            )}
          </ScrollView>
          <Text style={styles.source}>
            Community-mapped ground · OpenStreetMap
          </Text>
        </View>
      ) : storyReady && !loadingPlaces && !placesError && !areaError ? (
        <View style={styles.hint} pointerEvents="none">
          <Text style={styles.hintText}>
            {offCampus
              ? "You’re away from campus, so the view stays on LUMS."
              : places.truncated || events.truncated
                ? "Some places or games could not all be loaded."
                : places.features.length
                ? "Drag to turn · pinch to zoom · tap a ground"
                : "No places mapped on this campus yet."}
          </Text>
        </View>
      ) : null}
      {eventID && (
        <EventDetails
          key={eventID}
          id={eventID}
          apiURL={apiURL}
          referrerInteractionID={eventReferrer}
          onClose={() => setEventID(null)}
          onEventChanged={() => setEventRefresh((value) => value + 1)}
        />
      )}
      {creationPlace && (
        <EventForm
          place={creationPlace}
          apiURL={apiURL}
          onClose={() => {
            setCreationPlace(null);
            setEventRefresh((value) => value + 1);
          }}
          onSaved={() => {
            setCreatedAtPlace(creationPlace.id);
            setCreationPlace(null);
            discovery.resetSport();
            setEventType("");
            setEventRefresh((value) => value + 1);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F4F5F0" },
  createButton: {
    backgroundColor: "#1D5B3A",
    borderRadius: 18,
    padding: 14,
    alignItems: "center",
  },
  createText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
  exploreTop: { position: "absolute", top: 58, left: 16, right: 76, gap: 2 },
  crumbs: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#F4F5F0",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  crumbMuted: { color: "#9AA49D", fontSize: 14, fontWeight: "600" },
  crumbSeparator: { color: "#9AA49D", fontSize: 14 },
  crumbCurrent: { color: "#15201B", fontSize: 14, fontWeight: "700" },
  exploreControls: { position: "absolute", right: 12, top: 118, gap: 8, alignItems: "center" },
  roundButton: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: "#F4F5F0",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
  roundIcon: { fontSize: 22, color: "#15201B", lineHeight: 26 },
  tonightButton: { backgroundColor: "#15201B", height: 52 },
  tonightText: { color: "#F4F5F0", fontSize: 11, fontWeight: "700" },
  kicker: {
    color: "#1D5B3A",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  filters: { flexDirection: "row", gap: 6, marginTop: 12 },
  filter: {
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 18,
    backgroundColor: "#E5E9DF",
  },
  activeFilter: { backgroundColor: "#1D5B3A" },
  filterText: { color: "#1D5B3A", fontWeight: "700", fontSize: 12 },
  activeFilterText: { color: "#FFFFFF" },
  eventList: { maxHeight: 240 },
  eventCard: {
    paddingVertical: 14,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#DEE3D8",
  },
  eventTitle: { fontSize: 18, color: "#15201B", fontWeight: "700" },
  locationStatus: {
    position: "absolute",
    left: 16,
    right: 16,
    top: 440,
    padding: 16,
    borderRadius: 20,
    backgroundColor: "#F4F5F0",
  },
  locationActions: { flexDirection: "row", flexWrap: "wrap", gap: 20 },
  buttonText: { color: "#1D5B3A", fontWeight: "700", fontSize: 14 },
  loading: {
    position: "absolute",
    top: 365,
    alignSelf: "center",
    flexDirection: "row",
    gap: 10,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#F4F5F0",
  },
  status: {
    position: "absolute",
    top: 365,
    left: 16,
    right: 16,
    padding: 18,
    borderRadius: 20,
    backgroundColor: "#F4F5F0",
    gap: 12,
  },
  retry: { alignSelf: "flex-start", paddingVertical: 8 },
  body: { color: "#15201B", fontSize: 14, lineHeight: 21 },
  hint: {
    position: "absolute",
    bottom: 28,
    alignSelf: "center",
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: "rgba(244,245,240,0.92)",
    borderRadius: 999,
  },
  hintText: { color: "#15201B", fontSize: 12, fontWeight: "600" },
  sheet: {
    position: "absolute",
    bottom: 40,
    left: 12,
    right: 12,
    padding: 22,
    borderRadius: 26,
    backgroundColor: "#F4F5F0",
    gap: 10,
  },
  sheetHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  placeName: { fontFamily: "BigShoulders", fontSize: 34, color: "#15201B" },
  source: { fontSize: 11, color: "#6C786E" },
});
