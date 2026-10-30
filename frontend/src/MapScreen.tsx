import type * as GeoJSON from "geojson";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Alert,
  Linking,
  StyleSheet,
  Text,
  View,
} from "react-native";
import EventDetails, { type EventSummary } from "./EventDetails";
import EventForm from "./EventForm";
import useDeviceLocation from "./useDeviceLocation";
import PlaceFeed, { type CameraFrame, type FeedPage, type FeedPlace } from "./PlaceFeed";
import TopBar, { TopBarButton } from "./TopBar";
import { colors, margin, type } from "./theme";
import { Glass, PressableScale } from "./ui";
import CampusScene, {
  type CampusSceneHandle,
  type SceneLabel,
  type ScenePin,
} from "./CampusScene";
import { layoutCourts, toScene, type SceneArea, type ScenePlace } from "./campusModel";
import useReduceMotion from "./useReduceMotion";
import { uuid } from "expo";
import { useActivities, useActivityInteraction } from "./ActivitiesProvider";
import { DiscoveryTracker, sportNames } from "./activities";

// West, south, east, north.
type LngLatBounds = [number, number, number, number];
type Area = {
  id: string;
  parent_id: string | null;
  name: string;
  type: string;
  boundary: GeoJSON.MultiPolygon | null;
  bbox: LngLatBounds | null;
  created_at: string;
  updated_at: string;
};
// The areas inside the district (DHA's phases, and the campus), from /areas/{id}/children.
type ChildArea = GeoJSON.Feature<
  GeoJSON.MultiPolygon | null,
  { id: string; parent_id: string; name: string; type: string; bbox: LngLatBounds | null }
>;
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
// Which feed is showing: the district (DHA) and its places, or the places inside the campus.
type FeedLevel = "district" | "campus";
// What the district feed is about.
type FeedTab = "all" | "padel" | "campus";
// A place in a feed, before it becomes a page.
type Stop = {
  place: FeedPlace;
  point: { x: number; z: number };
  kicker: string;
  canGoInside: boolean;
  frame: CameraFrame;
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
// The camera always faces the same way, so the map never spins between places.
const facing = 0.22;
const campusView = { distance: 96, tilt: 0.62 };
const groundView = { distance: 30, tilt: 0.98 };
const districtView = { distance: 240, tilt: 0.95 };
const courtView = { distance: 18, tilt: 0.98 };
// A place counts as viewed once the feed has rested on it this long, so places flown past
// in a quick run of swipes are not recorded as visits.
const viewDelay = 700;
const districtTabs: { key: FeedTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "padel", label: "Padel" },
  { key: "campus", label: "Campus" },
];

// Visits stops in route order: each next stop is the nearest one not yet visited, starting
// from `start`, so every swipe is a short hop.
function routeFrom(start: { x: number; z: number }, stops: Stop[]): Stop[] {
  const left = [...stops];
  const route: Stop[] = [];
  let here = start;
  while (left.length) {
    let nearest = 0;
    for (let i = 1; i < left.length; i++)
      if (
        Math.hypot(left[i].point.x - here.x, left[i].point.z - here.z) <
        Math.hypot(left[nearest].point.x - here.x, left[nearest].point.z - here.z)
      )
        nearest = i;
    const [next] = left.splice(nearest, 1);
    route.push(next);
    here = next.point;
  }
  return route;
}

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
  // The district around the campus (DHA) and its phases, when the campus has a parent area.
  const [district, setDistrict] = useState<Area | null>(null);
  const [districtAreas, setDistrictAreas] = useState<ChildArea[]>([]);
  const [bounds, setBounds] = useState<LngLatBounds | null>(null);
  const [places, setPlaces] = useState<Places>(emptyPlaces);
  // Every upcoming game in the district (or the campus without one), for all feeds.
  const [events, setEvents] = useState<EventList>({
    events: [],
    place_counts: {},
    truncated: false,
  });
  const [eventID, setEventID] = useState<string | null>(null);
  const [creationPlace, setCreationPlace] = useState<FeedPlace | null>(null);
  const [eventRefresh, setEventRefresh] = useState(0);
  const [areaError, setAreaError] = useState("");
  const [placesError, setPlacesError] = useState("");
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [retry, setRetry] = useState(0);
  const reduceMotion = useReduceMotion();
  const [level, setLevel] = useState<FeedLevel>("district");
  const [tab, setTab] = useState<FeedTab>("all");
  // Where a feed opens: a place to land on (or its overview), and a counter so the feed
  // starts afresh even when asked for the same place again.
  const [feedStart, setFeedStart] = useState<{ placeID: string | null; nonce: number }>({
    placeID: null,
    nonce: 0,
  });
  const [activePage, setActivePage] = useState(0);
  const [viewedPlaceID, setViewedPlaceID] = useState<string | null>(null);
  // Map mode: drag, pinch and tap the 3D map freely; tapping a place returns to the feed.
  const [mapMode, setMapMode] = useState(false);
  const [offCampus, setOffCampus] = useState(false);
  // Location problems are only shown after the user asks for their location.
  const [locationAsked, setLocationAsked] = useState(false);
  const queryKey = bounds ? bounds.join(",") : null;
  const discoveryVisible = foreground && !eventID && !creationPlace;
  const placeInteraction = useActivityInteraction({
    enabled: Boolean(viewedPlaceID) && !mapMode,
    visible: !eventID && !creationPlace,
    target: { type: "place", id: viewedPlaceID ?? "" },
    source: "map",
    startAction: "place_viewed",
    details: { sport: "all", referrer_interaction_id: discovery.id },
  });

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setForeground(state === "active"),
    );
    return () => subscription.remove();
  }, []);

  // The 3D map is laid out around the centre of the campus bounding box.
  const origin: [number, number] | null = area?.bbox
    ? [(area.bbox[0] + area.bbox[2]) / 2, (area.bbox[1] + area.bbox[3]) / 2]
    : null;

  // Places on the campus have outlines and are drawn as grounds. The other places in the
  // district are, for now, all padel venues, each drawn as a padel court.
  const campusPlaces = places.features.filter((place) => place.properties.area_id === area?.id);
  const venues = places.features.filter((place) => place.properties.area_id !== area?.id);
  // Where each court is drawn (nudged apart where venues are close), so the camera frames
  // the court the user sees. Worked out again only when the venues change, not on every
  // render, because the layout compares every pair of courts.
  const venueKey = venues.map((venue) => venue.properties.id).join();
  const courtSpots = useMemo(
    () =>
      origin
        ? layoutCourts(
            venues.map((venue) => ({
              id: venue.properties.id,
              name: venue.properties.name,
              type: venue.properties.type,
              coordinates: venue.geometry.coordinates as [number, number],
              boundary: null,
            })),
            origin,
          )
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [venueKey, origin?.[0], origin?.[1]],
  );
  const median = (values: number[]) =>
    values.length ? values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)] : 0;
  // The campus overview looks between the middle of the campus and its grounds; the DHA
  // overview at the middle of the courts (the median, so the far-off courts in Rahbar and
  // EME do not pull it away from the Phase 5 strip).
  const groundPoints = origin
    ? campusPlaces.map((place) => toScene(place.geometry.coordinates as [number, number], origin))
    : [];
  const campusMiddle = groundPoints.length
    ? {
        x: groundPoints.reduce((sum, point) => sum + point.x, 0) / groundPoints.length / 2,
        z: groundPoints.reduce((sum, point) => sum + point.z, 0) / groundPoints.length / 2,
      }
    : { x: 0, z: 0 };
  const districtMiddle = {
    x: median(courtSpots.map((spot) => spot.x)),
    z: median(courtSpots.map((spot) => spot.z)),
  };

  // Looks slightly past a place, towards the camera, so it sits above the card at the
  // bottom of the screen.
  function closeUp(point: { x: number; z: number }, view: { distance: number; tilt: number }): CameraFrame {
    const ahead = view.distance * 0.12;
    return {
      x: point.x + Math.sin(facing) * ahead,
      z: point.z + Math.cos(facing) * ahead,
      distance: view.distance,
      tilt: view.tilt,
      turn: facing,
    };
  }

  const gamesAt = (placeID: string) => events.events.filter((event) => event.place.id === placeID);
  const campusName = area?.name ?? "LUMS";
  const districtName = district?.name ?? "DHA";
  const campusGames = events.events.filter((event) =>
    campusPlaces.some((place) => place.properties.id === event.place.id),
  );
  const phaseName = (areaID: string) =>
    districtAreas.find((child) => child.properties.id === areaID)?.properties.name ?? districtName;

  // The feed's stops: in the district, the campus and every padel court; inside the
  // campus, its grounds. The tab picks which district stops are in the feed.
  const campusStop: Stop = {
    place: { id: area?.id ?? "campus", name: campusName, sport: "football" },
    point: campusMiddle,
    kicker: `Campus · ${campusPlaces.length} grounds`,
    canGoInside: true,
    frame: { ...campusMiddle, ...campusView, turn: facing },
  };
  const courtStops: Stop[] = courtSpots.flatMap((spot) => {
    const venue = venues.find((item) => item.properties.id === spot.placeID);
    if (!venue) return [];
    return [
      {
        place: { id: venue.properties.id, name: venue.properties.name, sport: "padel" },
        point: spot,
        kicker: `Padel · ${phaseName(venue.properties.area_id)}`,
        canGoInside: false,
        frame: closeUp(spot, courtView),
      },
    ];
  });
  const groundStops: Stop[] = campusPlaces.map((place) => {
    const point = toScene(place.geometry.coordinates as [number, number], origin ?? [0, 0]);
    return {
      place: { id: place.properties.id, name: place.properties.name, sport: "football" },
      point,
      kicker: `${campusName} · ${place.properties.type}`,
      canGoInside: false,
      frame: closeUp(point, groundView),
    };
  });
  const showingDistrict = level === "district" && Boolean(district);
  const stops = showingDistrict
    ? routeFrom(
        campusMiddle,
        tab === "padel" ? courtStops : tab === "campus" ? [campusStop] : [campusStop, ...courtStops],
      )
    : routeFrom(campusMiddle, groundStops);
  const feedGames = showingDistrict
    ? tab === "campus"
      ? campusGames
      : tab === "padel"
        ? events.events.filter((event) => event.type === "padel")
        : events.events
    : campusGames;
  const overviewFrame: CameraFrame = showingDistrict
    ? { ...districtMiddle, ...districtView, turn: facing }
    : { ...campusMiddle, ...campusView, turn: facing };
  const feedName = showingDistrict ? districtName : campusName;
  const gamesLabel = `${feedGames.length} game${feedGames.length === 1 ? "" : "s"} coming up`;
  const pages: FeedPage[] = [
    {
      kind: "overview",
      key: "overview",
      kicker: showingDistrict ? "Around" : "Inside",
      title: feedName.toUpperCase(),
      subtitle: showingDistrict
        ? tab === "padel"
          ? `${courtStops.length} padel courts · ${gamesLabel}`
          : tab === "campus"
            ? `${campusName} · ${gamesLabel}`
            : `${campusName} and ${courtStops.length} padel courts · ${gamesLabel}`
        : `${groundStops.length} grounds · ${gamesLabel}`,
      frame: overviewFrame,
    },
    ...stops.map(
      (stop): FeedPage => ({
        kind: "place",
        key: stop.place.id,
        place: stop.place,
        kicker: stop.kicker,
        games:
          stop.place.id === area?.id ? campusGames : gamesAt(stop.place.id),
        canGoInside: stop.canGoInside,
        frame: stop.frame,
      }),
    ),
    {
      kind: "end",
      key: "end",
      title: `That's all ${stops.length} ${stops.length === 1 ? "place" : "places"}`,
      body: `Nothing at your time? Go back to any of them and tap Start. Your game shows up for everyone around ${feedName}.`,
      frame: overviewFrame,
    },
  ];
  const startIndex = Math.max(
    0,
    pages.findIndex((page) => page.kind === "place" && page.place.id === feedStart.placeID),
  );
  const activePlace = pages[activePage]?.kind === "place" ? pages[activePage] : null;
  const focusPlaceID = activePlace?.kind === "place" ? activePlace.place.id : null;

  // A place counts as viewed after the feed rests on it (see viewDelay). The campus's own
  // page is an area, not a map place, so it is not recorded as a place view.
  useEffect(() => {
    const viewed = focusPlaceID === area?.id ? null : focusPlaceID;
    const timer = setTimeout(() => setViewedPlaceID(viewed), viewDelay);
    return () => clearTimeout(timer);
  }, [focusPlaceID, area?.id]);

  // Discovery impressions: in map mode, the map's results; in the feed, whether the place
  // being viewed has no games. Only the successful query currently shown counts.
  useEffect(() => {
    if (!discoveryVisible || !queryKey || loadedQuery !== queryKey || loadingPlaces || areaError || placesError)
      return;
    if (mapMode) {
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
      discovery.observeMapResults(viewKey, "all", emptyKind);
    } else if (viewedPlaceID && placeInteraction.current) {
      discovery.observePlaceResults(
        placeInteraction.current,
        "all",
        !events.truncated && (events.place_counts[viewedPlaceID] ?? 0) === 0,
      );
    }
  }, [
    discovery,
    discoveryVisible,
    queryKey,
    loadedQuery,
    mapMode,
    loadingPlaces,
    areaError,
    placesError,
    viewedPlaceID,
    events,
    places,
    bounds,
    placeInteraction,
  ]);

  const coordinates = deviceLocation.position?.coords;
  const you: [number, number] | null = coordinates
    ? [coordinates.longitude, coordinates.latitude]
    : null;

  useEffect(() => {
    if (!you || !origin || !centreOnNextLocation.current) return;
    centreOnNextLocation.current = false;
    const point = toScene(you, origin);
    // The map covers the district's bounds (or the campus's without a district).
    const box = district?.bbox ?? area?.bbox;
    const away = box
      ? you[0] < box[0] || you[0] > box[2] || you[1] < box[1] || you[1] > box[3]
      : false;
    setOffCampus(away);
    if (!away) campusScene.current?.moveTo(closeUp(point, { distance: 40, tilt: 0.9 }), { slow: true });
    // `you` changes identity every render; its coordinates are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordinates?.latitude, coordinates?.longitude, origin?.[0], origin?.[1]]);

  function showMyLocation() {
    setLocationAsked(true);
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
        // The campus's parent area (DHA) is the district the feed opens on. Its venues
        // belong to its phases, so its bounds are the union of the phases' bounds. The
        // campus still works on its own if this fails; Try again reloads both.
        let loadedDistrict: Area | null = null;
        let loadedChildren: ChildArea[] = [];
        if (loadedArea.parent_id) {
          try {
            const [districtResponse, childrenResponse] = await Promise.all([
              fetch(`${apiURL}/areas/${loadedArea.parent_id}`, { signal: controller.signal }),
              fetch(`${apiURL}/areas/${loadedArea.parent_id}/children`, {
                signal: controller.signal,
              }),
            ]);
            if (districtResponse.ok && childrenResponse.ok) {
              loadedDistrict = await districtResponse.json();
              loadedChildren = (await childrenResponse.json()).features;
            }
          } catch {
            // Leave the district out; the campus loads on its own.
          }
        }
        const childBoxes = loadedChildren.flatMap((child) =>
          child.properties.bbox ? [child.properties.bbox] : [],
        );
        const districtBounds: LngLatBounds | null = childBoxes.length
          ? [
              Math.min(...childBoxes.map((box) => box[0])),
              Math.min(...childBoxes.map((box) => box[1])),
              Math.max(...childBoxes.map((box) => box[2])),
              Math.max(...childBoxes.map((box) => box[3])),
            ]
          : null;
        if (active) {
          setAreaError("");
          setArea(loadedArea);
          setDistrict(
            loadedDistrict && districtBounds ? { ...loadedDistrict, bbox: districtBounds } : null,
          );
          setDistrictAreas(loadedChildren);
          setBounds(districtBounds ?? loadedArea.bbox);
        }
      } catch {
        if (active)
          setAreaError(
            "Could not load the map. Check your connection and try again.",
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

  // Places and every upcoming game for the whole district, in one load. It reloads on
  // open, after this user creates, joins or cancels (eventRefresh), on Try again, and
  // when the app returns to the foreground; the last results stay visible meanwhile.
  // No live updates: map-wide realtime is separate work in plan.md.
  useEffect(() => {
    if (!bounds || !foreground) return;
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    async function loadPlacesAndEvents() {
      setLoadingPlaces(true);
      setPlacesError("");
      try {
        const [placesResponse, eventsResponse] = await Promise.all([
          fetch(`${apiURL}/places?bbox=${bounds!.join(",")}`, {
            signal: controller.signal,
          }),
          fetch(`${apiURL}/events?bbox=${bounds!.join(",")}&type=`, {
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
          setLoadedQuery(bounds!.join(","));
        }
      } catch {
        if (active)
          setPlacesError("Could not refresh places and games. Try again.");
      } finally {
        clearTimeout(timeout);
        if (active) setLoadingPlaces(false);
      }
    }
    void loadPlacesAndEvents();
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [bounds, retry, eventRefresh, foreground]);

  // Opens a feed, landing on a place in it or on its overview.
  function openFeed(nextLevel: FeedLevel, nextTab: FeedTab, placeID: string | null) {
    setLevel(nextLevel);
    setTab(nextTab);
    setFeedStart((current) => ({ placeID, nonce: current.nonce + 1 }));
  }

  // Inside the campus, back returns to the district's feed, landing on the campus.
  const backOutOfCampus =
    level === "campus" && district ? () => openFeed("district", "all", area?.id ?? null) : null;

  // Map mode's back button: return to the feed, at the place it was showing.
  function leaveMapMode() {
    setMapMode(false);
    setLocationAsked(false);
    openFeed(level, tab, focusPlaceID);
  }

  // A tap on the map in map mode: back to the feed, at the place tapped.
  function showPlaceInFeed(placeID: string | null) {
    if (!placeID) return;
    setMapMode(false);
    setLocationAsked(false);
    const onCampus = campusPlaces.some((place) => place.properties.id === placeID);
    if (onCampus || !district) openFeed("campus", "all", placeID);
    else openFeed("district", tab === "campus" ? "all" : tab, placeID);
  }

  const ready = Boolean(area?.boundary && origin && loadedQuery !== null && !areaError);
  const toScenePlace = (place: Place): ScenePlace => ({
    id: place.properties.id,
    name: place.properties.name,
    type: place.properties.type,
    coordinates: place.geometry.coordinates as [number, number],
    boundary: place.properties.boundary ?? null,
  });
  const scenePlaces = campusPlaces.map(toScenePlace);
  const sceneDistrict = district
    ? {
        areas: districtAreas.map(
          (child): SceneArea => ({
            id: child.properties.id,
            name: child.properties.name,
            type: child.properties.type,
            boundary: child.geometry,
          }),
        ),
        courts: courtSpots,
      }
    : null;
  // One ball per place with games, labelled with its next game.
  const scenePins: ScenePin[] = [];
  for (const event of events.events) {
    if (scenePins.some((pin) => pin.placeID === event.place.id)) continue;
    scenePins.push({
      placeID: event.place.id,
      sport: event.type,
      full: event.is_full,
      headline: event.is_full ? "Full" : `${event.available_spots} left`,
      detail: `${event.type === "cricket" ? "Tape-ball" : sportNames[event.type]}, ${new Date(
        event.starts_at,
      ).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`,
    });
  }
  // Names on the map: each venue without a game, and each phase with its number of courts.
  const sceneLabels: SceneLabel[] = [
    ...venues
      .filter((venue) => !scenePins.some((pin) => pin.placeID === venue.properties.id))
      .map(
        (venue): SceneLabel => ({
          id: `venue:${venue.properties.id}`,
          kind: "venue",
          placeID: venue.properties.id,
          coordinates: venue.geometry.coordinates as [number, number],
          text: venue.properties.name,
        }),
      ),
    ...districtAreas.flatMap((child): SceneLabel[] => {
      const box = child.properties.bbox;
      if (!box) return [];
      const courtCount = venues.filter(
        (venue) => venue.properties.area_id === child.properties.id,
      ).length;
      return [
        {
          id: `area:${child.properties.id}`,
          kind: "area",
          placeID: null,
          coordinates: [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2],
          text: courtCount
            ? `${child.properties.name} · ${courtCount} padel`
            : child.properties.name,
        },
      ];
    }),
  ];
  // The map shows the real time of day; it is not changed by swiping.
  const now = new Date();
  const sceneHour = now.getHours() + now.getMinutes() / 60;
  const path = showingDistrict
    ? ["Lahore", districtName]
    : district
      ? ["Lahore", districtName, campusName]
      : ["Lahore", campusName];

  return (
    <View style={styles.root}>
      {/* One scene for the feed and map mode, so it is never rebuilt. */}
      {ready && area?.boundary && origin && (
        <CampusScene
          ref={campusScene}
          boundary={area.boundary}
          origin={origin}
          places={scenePlaces}
          district={sceneDistrict}
          pins={scenePins}
          labels={sceneLabels}
          focusPlaceID={mapMode ? null : focusPlaceID}
          hour={sceneHour}
          initialFrame={pages[startIndex].frame}
          reduceMotion={reduceMotion}
          interactive={mapMode}
          onPlacePress={showPlaceInFeed}
          you={you}
        />
      )}
      {ready && !mapMode && (
        <PlaceFeed
          key={`${level}:${tab}:${feedStart.nonce}`}
          pages={pages}
          initialIndex={startIndex}
          tabs={showingDistrict ? districtTabs : []}
          activeTab={tab}
          reduceMotion={reduceMotion}
          onTabChange={(key) => openFeed("district", key as FeedTab, null)}
          onCameraFrame={(frame, arriving) =>
            campusScene.current?.moveTo(frame, { slow: arriving })
          }
          onPageChange={setActivePage}
          onGoInside={(place) => {
            if (place.id === area?.id) openFeed("campus", "all", null);
          }}
          onBack={backOutOfCampus}
          onOpenEvent={(event) => {
            setEventReferrer(placeInteraction.current?.id ?? discovery.id);
            setEventID(event.id);
          }}
          // The campus is not one place to play at, so Start there means picking a ground.
          onStartGame={(place) =>
            place.id === area?.id ? openFeed("campus", "all", null) : setCreationPlace(place)
          }
          onOpenMap={() => setMapMode(true)}
        />
      )}
      {ready && mapMode && (
        <Glass style={styles.hint}>
          <Text style={styles.hintText}>
            {offCampus
              ? `You’re outside ${feedName}, so the view stays where it is.`
              : "Drag to turn · Pinch to zoom · Tap a court or ground"}
          </Text>
        </Glass>
      )}
      {/* One top bar for the feed and map mode, so it never jumps between them. */}
      {ready && (
        <TopBar
          path={mapMode ? [...path, "Map"] : path}
          onBack={mapMode ? leaveMapMode : backOutOfCampus}
          backLabel={mapMode ? "the feed" : districtName}
          tabs={showingDistrict && !mapMode ? districtTabs : []}
          activeTab={tab}
          onTabChange={(key) => openFeed("district", key as FeedTab, null)}
          trailing={
            mapMode ? (
              <TopBarButton
                symbol="location.fill"
                fallback="◎"
                label={deviceLocation.finding ? "Finding…" : "My Location"}
                accessibilityLabel={deviceLocation.finding ? "Finding your location" : "Show my location"}
                busy={deviceLocation.finding}
                onPress={showMyLocation}
              />
            ) : (
              <TopBarButton
                symbol="map"
                fallback="◇"
                label="Map"
                accessibilityLabel="Open the map"
                onPress={() => setMapMode(true)}
              />
            )
          }
        />
      )}

      {mapMode && locationAsked && deviceLocation.error && (
        <View style={styles.status} accessibilityLiveRegion="polite">
          <Text style={styles.body}>{deviceLocation.error}</Text>
          <View style={styles.statusActions}>
            {deviceLocation.settingsRequired && (
              <PressableScale
                accessibilityRole="button"
                onPress={() => {
                  void Linking.openSettings().catch(() => {
                    Alert.alert(
                      "Open device settings",
                      "Enable Location Services and allow Campus Pickup to access your location while using the app.",
                    );
                  });
                }}
                style={styles.statusButton}
              >
                <Text style={styles.statusButtonText}>Open Settings</Text>
              </PressableScale>
            )}
            <PressableScale accessibilityRole="button" onPress={showMyLocation} style={styles.statusButton}>
              <Text style={styles.statusButtonText}>Try Again</Text>
            </PressableScale>
          </View>
        </View>
      )}

      {areaError || (placesError && !ready) ? (
        <View style={styles.status}>
          <Text style={styles.body}>{areaError || placesError}</Text>
          <PressableScale
            accessibilityRole="button"
            onPress={() => setRetry((value) => value + 1)}
            style={styles.statusButton}
          >
            <Text style={styles.statusButtonText}>Try Again</Text>
          </PressableScale>
        </View>
      ) : !ready ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.tint} />
          <Text style={styles.body}>Loading the map…</Text>
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
          defaultType={creationPlace.sport}
          apiURL={apiURL}
          onClose={() => {
            setCreationPlace(null);
            setEventRefresh((value) => value + 1);
          }}
          onSaved={() => {
            setCreationPlace(null);
            setEventRefresh((value) => value + 1);
          }}
        />
      )}
    </View>
  );
}

// Messages (loading, errors) sit on solid cards: they are content, not floating controls.
const card = {
  backgroundColor: colors.surface,
  borderRadius: 24,
  borderCurve: "continuous" as const,
  shadowColor: "#000",
  shadowOpacity: 0.16,
  shadowRadius: 20,
  shadowOffset: { width: 0, height: 8 },
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.chalk },
  loading: {
    ...card,
    position: "absolute",
    top: "45%",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  status: {
    ...card,
    position: "absolute",
    bottom: 24,
    left: margin - 4,
    right: margin - 4,
    padding: 20,
    gap: 12,
  },
  statusActions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  statusButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 18,
    borderRadius: 22,
    backgroundColor: colors.tintSoft,
  },
  statusButtonText: { ...type.headline, color: colors.tint },
  body: { ...type.body, color: colors.ink },
  hint: {
    position: "absolute",
    bottom: 24,
    alignSelf: "center",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.6)",
  },
  hintText: { ...type.footnote, fontWeight: "600", color: colors.ink },
});
