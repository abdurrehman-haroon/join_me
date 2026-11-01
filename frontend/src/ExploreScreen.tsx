import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  Marker,
  type CameraRef,
  type LngLatBounds,
  type StyleSpecification,
} from "@maplibre/maplibre-react-native";
import { uuid } from "expo-modules-core";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  AppState,
  type FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useActivities, useActivityInteraction } from "./ActivitiesProvider";
import EventDetails, { type EventSummary } from "./EventDetails";
import EventForm from "./EventForm";
import {
  DistrictCard,
  EndCard,
  HeroCard,
  PlaceCard,
  explore,
  formatStart,
} from "./ExploreCards";
import {
  blendCamera,
  boundsCentre,
  groundMarkings,
  loadSkinnedMapStyle,
  outlineBounds,
  zoomToFit,
  type CameraTarget,
  type Coordinates,
} from "./exploreMap";

type AreaReference = { id: string; name: string; slug: string };
type DistrictSummary = AreaReference & {
  bbox: LngLatBounds | null;
  boundary: GeoJSON.MultiPolygon | null;
  place_count: number;
  upcoming_event_count: number;
  first_up: {
    place: AreaReference;
    event: { id: string; title: string; starts_at: string };
  } | null;
};
type CityFeed = {
  city: AreaReference & { bbox: LngLatBounds | null };
  districts: DistrictSummary[];
};
type PlaceSummary = AreaReference & {
  type: string;
  coordinates: Coordinates;
  upcoming_event_count: number;
  events: EventSummary[];
};
type DistrictFeed = {
  district: AreaReference & {
    city: AreaReference;
    bbox: LngLatBounds | null;
    boundary: GeoJSON.MultiPolygon | null;
  };
  places: PlaceSummary[];
};
type Spot = AreaReference & {
  type: string;
  coordinates: Coordinates;
  boundary: GeoJSON.MultiPolygon | null;
};
type PlaceView = {
  place: AreaReference & {
    type: string;
    coordinates: Coordinates;
    boundary: GeoJSON.MultiPolygon | null;
    district: AreaReference;
    city: AreaReference;
  };
  spots: Spot[];
  truncated: boolean;
  events: EventSummary[];
};
// Cards on a level: the hero introduces it, its children follow, the end card closes it.
type Card =
  | { kind: "hero" }
  | { kind: "district"; district: DistrictSummary }
  | { kind: "place"; place: PlaceSummary }
  | { kind: "end" };

const apiURL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8080";
const citySlug = "lahore";
const mapStyleURL =
  process.env.EXPO_PUBLIC_MAP_STYLE_URL ??
  "https://tiles.openfreemap.org/styles/liberty";
// A horizontal drag shorter than this snaps back instead of changing level.
const levelSwipeDistance = 60;
// Space kept for the footer controls under each card.
const footerHeight = 76;

export default function ExploreScreen() {
  const { queue, sessionID, viewedAreas } = useActivities();
  const camera = useRef<CameraRef>(null);
  const feed = useRef<FlatList<Card>>(null);
  const [districtSlug, setDistrictSlug] = useState<string | null>(null);
  const [placeSlug, setPlaceSlug] = useState<string | null>(null);
  const [cityFeed, setCityFeed] = useState<CityFeed | null>(null);
  const [districtFeeds, setDistrictFeeds] = useState<
    Record<string, DistrictFeed>
  >({});
  const [placeViews, setPlaceViews] = useState<Record<string, PlaceView>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [mapLoaded, setMapLoaded] = useState(false);
  // The skinned style; falls back to the plain style URL if it cannot be prepared.
  const [mapStyle, setMapStyle] = useState<StyleSpecification | string | null>(
    null,
  );
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });
  const [notice, setNotice] = useState("");
  const [eventID, setEventID] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Explore map mode hides the stories and lets the same map pan freely.
  const [exploring, setExploring] = useState(false);
  const [foreground, setForeground] = useState(
    AppState.currentState === "active",
  );
  // Remembers the focused card per level so going back returns to the same place.
  const [savedIndexes, setSavedIndexes] = useState<Record<string, number>>({});
  // Event shown in each place's carousel, by place ID.
  const [selectedEvents, setSelectedEvents] = useState<Record<string, number>>(
    {},
  );
  // True while a touch that started on an event carousel is down; its sideways
  // swipes move between events instead of changing level.
  const [touchOnEventRow, setTouchOnEventRow] = useState(false);
  // On the city feed the district outline fades between districts with the scroll.
  const [outline, setOutline] = useState<{
    index: number | null;
    opacity: number;
  }>({ index: null, opacity: 0 });
  const [swipeOffset] = useState(() => new Animated.Value(0));
  const [scrollY] = useState(() => new Animated.Value(0));

  const pageHeight = mapSize.height;
  const levelPath = placeSlug
    ? `/cities/${citySlug}/districts/${districtSlug}/places/${placeSlug}`
    : districtSlug
      ? `/cities/${citySlug}/districts/${districtSlug}/places`
      : `/cities/${citySlug}/districts`;
  const districtFeed = districtSlug ? districtFeeds[districtSlug] : undefined;
  const placeView =
    districtSlug && placeSlug
      ? placeViews[`${districtSlug}/${placeSlug}`]
      : undefined;
  const levelLoaded = placeSlug
    ? Boolean(placeView)
    : districtSlug
      ? Boolean(districtFeed)
      : Boolean(cityFeed);
  const children: Card[] = placeSlug
    ? []
    : districtSlug
      ? (districtFeed?.places ?? []).map((place) => ({
          kind: "place" as const,
          place,
        }))
      : (cityFeed?.districts ?? []).map((district) => ({
          kind: "district" as const,
          district,
        }));
  const cards: Card[] = placeSlug
    ? []
    : [{ kind: "hero" }, ...children, { kind: "end" }];
  const focusedCard = cards[focusedIndex];

  // Opening moves one level down: from the hero into the first child, otherwise into the focused child.
  const openTarget: { name: string; open: () => void } | null = (() => {
    if (placeSlug || focusedCard?.kind === "end") return null;
    const child = focusedCard?.kind === "hero" ? cards[1] : focusedCard;
    if (child?.kind === "district")
      return {
        name: child.district.name,
        open: () => openLevel(child.district.slug, null),
      };
    if (child?.kind === "place")
      return {
        name: child.place.name,
        open: () => openLevel(districtSlug, child.place.slug),
      };
    return null;
  })();
  const parentName = placeSlug
    ? (placeView?.place.district.name ?? districtFeed?.district.name ?? "Back")
    : districtSlug
      ? (cityFeed?.city.name ?? districtFeed?.district.city.name ?? "Lahore")
      : null;

  const districtAreaID =
    districtFeed?.district.id ?? placeView?.place.district.id;
  const placeVisit = useActivityInteraction({
    enabled: Boolean(
      placeView && districtAreaID && viewedAreas.has(districtAreaID),
    ),
    visible: foreground && !eventID && !creating && !exploring,
    target: { type: "place", id: placeView?.place.id ?? "" },
    source: "explore",
    startAction: "place_viewed",
    details: {
      referrer_interaction_id: districtAreaID
        ? viewedAreas.get(districtAreaID)
        : undefined,
    },
  });

  function openLevel(nextDistrict: string | null, nextPlace: string | null) {
    setSavedIndexes((saved) => ({ ...saved, [levelPath]: focusedIndex }));
    const nextPath = nextPlace
      ? `/cities/${citySlug}/districts/${nextDistrict}/places/${nextPlace}`
      : nextDistrict
        ? `/cities/${citySlug}/districts/${nextDistrict}/places`
        : `/cities/${citySlug}/districts`;
    const nextIndex = savedIndexes[nextPath] ?? 0;
    setFocusedIndex(nextIndex);
    scrollY.setValue(nextIndex * pageHeight);
    // Returning to the city feed on a district card shows its outline straight away.
    setOutline({
      index: !nextDistrict && nextIndex > 0 ? nextIndex : null,
      opacity: !nextDistrict && nextIndex > 0 ? 1 : 0,
    });
    setDistrictSlug(nextDistrict);
    setPlaceSlug(nextPlace);
    setLoadError("");
  }

  function goBack() {
    if (placeSlug) openLevel(districtSlug, null);
    else if (districtSlug) openLevel(null, null);
    else setNotice("Lahore is the only city for now.");
  }

  function scrollToCard(index: number) {
    feed.current?.scrollToOffset({
      offset: Math.max(0, Math.min(cards.length - 1, index)) * pageHeight,
      animated: true,
    });
  }

  // Horizontal drags change level; any clear vertical movement fails this gesture
  // so the feed keeps scrolling. Event carousels disable it to scroll between events.
  const levelSwipe = Gesture.Pan()
    .runOnJS(true)
    .enabled(!touchOnEventRow && !exploring)
    .activeOffsetX([-15, 15])
    .failOffsetY([-15, 15])
    .onUpdate((event) => swipeOffset.setValue(event.translationX * 0.35))
    .onEnd((event) => {
      Animated.spring(swipeOffset, {
        toValue: 0,
        useNativeDriver: true,
      }).start();
      // Right to left opens the focused district or place; left to right goes back.
      if (event.translationX < -levelSwipeDistance) openTarget?.open();
      else if (event.translationX > levelSwipeDistance) goBack();
    });

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setForeground(state === "active"),
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), 2500);
    return () => clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    async function loadLevel() {
      setLoading(true);
      try {
        const response = await fetch(`${apiURL}${levelPath}`, {
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(`Explore request failed (${response.status})`);
        if (placeSlug && districtSlug) {
          const loadedPlace: PlaceView = await response.json();
          if (active)
            setPlaceViews((views) => ({
              ...views,
              [`${districtSlug}/${placeSlug}`]: loadedPlace,
            }));
        } else if (districtSlug) {
          const loadedDistrict: DistrictFeed = await response.json();
          if (active)
            setDistrictFeeds((feeds) => ({
              ...feeds,
              [districtSlug]: loadedDistrict,
            }));
        } else {
          const loadedCity: CityFeed = await response.json();
          if (active) setCityFeed(loadedCity);
        }
        if (active) setLoadError("");
      } catch {
        if (active)
          setLoadError(
            "Couldn’t load this part of Lahore. Check your connection.",
          );
      } finally {
        clearTimeout(timeout);
        if (active) setLoading(false);
      }
    }
    void loadLevel();
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [levelPath, districtSlug, placeSlug, refreshCount]);

  // The city feed shows event pins for the focused district, as the prototype does;
  // its places come from the district feed, fetched once and reused when opened.
  const focusedDistrictSlug =
    !districtSlug && focusedCard?.kind === "district"
      ? focusedCard.district.slug
      : null;
  const focusedDistrictCached = focusedDistrictSlug
    ? Boolean(districtFeeds[focusedDistrictSlug])
    : true;
  useEffect(() => {
    if (!focusedDistrictSlug || focusedDistrictCached) return;
    const controller = new AbortController();
    fetch(
      `${apiURL}/cities/${citySlug}/districts/${focusedDistrictSlug}/places`,
      { signal: controller.signal },
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((loadedDistrict: DistrictFeed | null) => {
        if (loadedDistrict)
          setDistrictFeeds((feeds) => ({
            ...feeds,
            [focusedDistrictSlug]: loadedDistrict,
          }));
      })
      // Pins are a preview; the card stays usable without them.
      .catch(() => {});
    return () => controller.abort();
  }, [focusedDistrictSlug, focusedDistrictCached]);

  // One area_viewed per area per session, once its page has loaded while visible.
  const viewedAreaID = placeSlug
    ? null
    : districtSlug
      ? districtFeed?.district.id
      : cityFeed?.city.id;
  useEffect(() => {
    if (!viewedAreaID || !foreground || viewedAreas.has(viewedAreaID)) return;
    const interactionID = uuid.v4();
    viewedAreas.set(viewedAreaID, interactionID);
    queue.record({
      id: uuid.v4(),
      action: "area_viewed",
      session_id: sessionID,
      interaction_id: interactionID,
      interaction_step: 1,
      trackable_type: "area",
      trackable_id: viewedAreaID,
      source: "explore",
      occurred_at: new Date().toISOString(),
      details: {},
    });
  }, [viewedAreaID, foreground, viewedAreas, queue, sessionID]);

  useEffect(() => {
    const controller = new AbortController();
    loadSkinnedMapStyle(mapStyleURL, controller.signal)
      .then(setMapStyle)
      .catch(() => {
        if (!controller.signal.aborted) setMapStyle(mapStyleURL);
      });
    return () => controller.abort();
  }, []);

  // The event shown in a place's carousel, and where it happens.
  function selectedEvent(placeID: string, events: EventSummary[]) {
    return events[Math.min(selectedEvents[placeID] ?? 0, events.length - 1)];
  }
  const placeEvent = placeView
    ? selectedEvent(placeView.place.id, placeView.events)
    : undefined;

  // Prototype camera: flat over the city, tilted for districts and places, with a
  // slight alternating turn per card. Targets sit in the map area above the cards.
  const cameraPadding = {
    top: 110,
    right: 0,
    bottom: pageHeight * 0.5,
    left: 0,
  };
  const viewWidth = mapSize.width - 60;
  const viewHeight = pageHeight * 0.4 - 40;
  function cameraFor(
    card: Card | undefined,
    index: number,
  ): CameraTarget | null {
    if (card?.kind === "end") return cameraFor(cards[index - 1], index - 1);
    const turn = index % 2 ? 10 : -9;
    if (card?.kind === "district" && card.district.bbox)
      return {
        center: boundsCentre(card.district.bbox),
        zoom: zoomToFit(card.district.bbox, viewWidth, viewHeight, 15),
        pitch: 35,
        bearing: turn,
      };
    if (card?.kind === "place") {
      const event = selectedEvent(card.place.id, card.place.events);
      return {
        center: event?.spot?.coordinates ?? card.place.coordinates,
        zoom: event?.spot ? 16.4 : 15.6,
        pitch: 48,
        bearing: turn,
      };
    }
    const levelBounds = districtSlug
      ? districtFeed?.district.bbox
      : cityFeed?.city.bbox;
    if (!levelBounds) return null;
    return {
      center: boundsCentre(levelBounds),
      zoom: zoomToFit(levelBounds, viewWidth, viewHeight, 15),
      pitch: districtSlug ? 35 : 0,
      bearing: 0,
    };
  }
  const placeBounds = placeView?.place.boundary
    ? outlineBounds(placeView.place.boundary)
    : null;
  // A place page frames the whole place, or closes in on the ground of the event shown.
  const focusedTarget: CameraTarget | null = placeView
    ? placeEvent?.spot
      ? {
          center: placeEvent.spot.coordinates,
          zoom: 17.2,
          pitch: 52,
          bearing: -23,
        }
      : {
          center: placeBounds
            ? boundsCentre(placeBounds)
            : placeView.place.coordinates,
          zoom: placeBounds
            ? zoomToFit(placeBounds, viewWidth, viewHeight, 17.2)
            : 16.5,
          pitch: 52,
          bearing: -23,
        }
    : cameraFor(focusedCard, focusedIndex);
  // A string key keeps the effect from re-running for an identical target.
  const focusedTargetKey = JSON.stringify(focusedTarget);

  useEffect(() => {
    const target: CameraTarget | null = JSON.parse(focusedTargetKey);
    if (!mapLoaded || !target || !pageHeight || exploring) return;
    camera.current?.easeTo({
      ...target,
      padding: { top: 110, right: 0, bottom: pageHeight * 0.5, left: 0 },
      duration: 700,
    });
  }, [mapLoaded, focusedTargetKey, pageHeight, exploring]);

  // While the feed scrolls, the camera moves with it between the two nearest cards,
  // and on the city feed the outline fades out of one district and into the next.
  function followScroll(offsetY: number) {
    if (!mapLoaded || !pageHeight || !cards.length) return;
    const progress = Math.max(0, offsetY / pageHeight);
    const leaving = Math.min(Math.floor(progress), cards.length - 1);
    const approaching = Math.min(leaving + 1, cards.length - 1);
    const fraction = progress - leaving;
    const from = cameraFor(cards[leaving], leaving);
    const to = cameraFor(cards[approaching], approaching);
    if (from && to)
      camera.current?.jumpTo({
        ...blendCamera(from, to, fraction),
        padding: cameraPadding,
      });
    if (districtSlug) return;
    const amount = fraction * fraction * (3 - 2 * fraction);
    const fromKind = cards[leaving]?.kind;
    const toKind = cards[approaching]?.kind;
    let index: number | null = null;
    let opacity = 0;
    if (fromKind === "hero" && toKind === "district") {
      index = approaching;
      opacity = amount;
    } else if (
      fromKind === "district" &&
      toKind === "district" &&
      leaving !== approaching
    ) {
      index = amount < 0.5 ? leaving : approaching;
      opacity = amount < 0.5 ? 1 - amount * 2 : (amount - 0.5) * 2;
    } else if (fromKind === "district") {
      index = leaving;
      opacity = toKind === "end" ? 1 - amount : 1;
    }
    // Rounded to tenths so a scroll causes a handful of renders, not one per frame.
    const rounded = Math.round(opacity * 10) / 10;
    if (index !== outline.index || rounded !== outline.opacity)
      setOutline({ index, opacity: rounded });
  }

  // Prototype markers: one focus pin with a name tag for what the card shows, and
  // red pins counting events at each location inside the focused district or place.
  const focusPin: {
    id: string;
    name: string;
    coordinates: Coordinates;
  } | null = placeView
    ? {
        id: placeEvent?.spot?.id ?? placeView.place.id,
        name: placeEvent?.spot?.name ?? placeView.place.name,
        coordinates:
          placeEvent?.spot?.coordinates ?? placeView.place.coordinates,
      }
    : focusedCard?.kind === "district" && focusedCard.district.bbox
      ? {
          id: focusedCard.district.id,
          name: focusedCard.district.name,
          coordinates: boundsCentre(focusedCard.district.bbox),
        }
      : focusedCard?.kind === "place"
        ? {
            id: focusedCard.place.id,
            name: focusedCard.place.name,
            coordinates:
              selectedEvent(focusedCard.place.id, focusedCard.place.events)
                ?.spot?.coordinates ?? focusedCard.place.coordinates,
          }
        : null;
  const eventPins: { id: string; count: number; coordinates: Coordinates }[] =
    [];
  if (placeView) {
    for (const event of placeView.events) {
      const coordinates =
        event.spot?.coordinates ?? placeView.place.coordinates;
      const id = coordinates.join(",");
      const pin = eventPins.find((existing) => existing.id === id);
      if (pin) pin.count += 1;
      else eventPins.push({ id, count: 1, coordinates });
    }
  } else {
    const pinnedFeed = districtSlug
      ? districtFeed
      : focusedDistrictSlug
        ? districtFeeds[focusedDistrictSlug]
        : undefined;
    for (const place of pinnedFeed?.places ?? [])
      if (place.upcoming_event_count > 0)
        eventPins.push({
          id: place.id,
          count: place.upcoming_event_count,
          coordinates: place.coordinates,
        });
  }

  // The open district's outline, or on the city feed the one the scroll is passing.
  const outlinedCard =
    !districtSlug && outline.index !== null ? cards[outline.index] : undefined;
  const districtBoundary = placeSlug
    ? null
    : districtSlug
      ? districtFeed?.district.boundary
      : outlinedCard?.kind === "district"
        ? outlinedCard.district.boundary
        : null;
  const outlineOpacity = districtSlug ? 1 : outline.opacity;
  const districtOutline: GeoJSON.FeatureCollection<GeoJSON.MultiPolygon> = {
    type: "FeatureCollection",
    features: districtBoundary
      ? [{ type: "Feature", properties: {}, geometry: districtBoundary }]
      : [],
  };
  const placeOutline: GeoJSON.FeatureCollection<GeoJSON.MultiPolygon> = {
    type: "FeatureCollection",
    features: placeView?.place.boundary
      ? [
          {
            type: "Feature",
            properties: {},
            geometry: placeView.place.boundary,
          },
        ]
      : [],
  };
  const markings = groundMarkings(placeView?.spots ?? []);
  const spotOutlines: GeoJSON.FeatureCollection<GeoJSON.MultiPolygon> = {
    type: "FeatureCollection",
    features: (placeView?.spots ?? [])
      .filter((spot) => spot.boundary)
      .map((spot) => ({
        type: "Feature",
        properties: { id: spot.id },
        geometry: spot.boundary!,
      })),
  };

  function districtHero() {
    const places = districtFeed?.places ?? [];
    const count = places.reduce(
      (sum, place) => sum + place.upcoming_event_count,
      0,
    );
    const firstUp = places
      .flatMap((place) =>
        place.events.map((event) => ({ place: place.name, event })),
      )
      .sort((a, b) => a.event.starts_at.localeCompare(b.event.starts_at))[0];
    return (
      <HeroCard
        kicker="LAHORE / DISTRICT"
        title={districtFeed?.district.name ?? ""}
        intro="Scroll to see what’s happening here. One place, one moment at a time."
        portalKicker={`COMING UP IN ${(districtFeed?.district.name ?? "").toUpperCase()}`}
        portalStat={`${places.length} ${places.length === 1 ? "place" : "places"} · ${count} ${count === 1 ? "thing" : "things"} happening`}
        portalNote={
          firstUp
            ? `First up · ${firstUp.place} · ${formatStart(firstUp.event.starts_at)}`
            : "Nothing coming up yet"
        }
        actionLabel="See places ↗"
        onAction={() => places[0] && openLevel(districtSlug, places[0].slug)}
      />
    );
  }

  function cityHero() {
    const districts = cityFeed?.districts ?? [];
    const count = districts.reduce(
      (sum, district) => sum + district.upcoming_event_count,
      0,
    );
    const start = districts.find((district) => district.first_up);
    return (
      <HeroCard
        kicker="ONE CITY. YOUR PEOPLE."
        title={cityFeed?.city.name ?? "Lahore"}
        intro="Explore Lahore, one district and one place at a time."
        portalKicker="COMING UP IN LAHORE"
        portalStat={`${districts.length} districts · ${count} things happening`}
        portalNote={
          start?.first_up
            ? `Start with ${start.name} · ${start.first_up.place.name}`
            : "Scroll to see each district"
        }
        actionLabel="Explore ↓"
        onAction={() => scrollToCard(1)}
      />
    );
  }

  // Cards move like the prototype's: the next card rises, tilts and fades in as it
  // approaches; the hero fades and lifts away. Reduce Motion users get plain scrolling.
  function renderCard({ item: card, index }: { item: Card; index: number }) {
    const atCard = index * pageHeight;
    const motion =
      card.kind === "hero"
        ? {
            opacity: scrollY.interpolate({
              inputRange: [0, pageHeight / 1.7],
              outputRange: [1, 0],
              extrapolate: "clamp",
            }),
            transform: [
              {
                translateY: scrollY.interpolate({
                  inputRange: [0, pageHeight],
                  outputRange: [0, -70],
                  extrapolate: "clamp",
                }),
              },
            ],
          }
        : {
            opacity: scrollY.interpolate({
              inputRange: [
                atCard - pageHeight * 0.75,
                atCard,
                atCard + pageHeight * 0.75,
              ],
              outputRange: [0, 1, 0],
              extrapolate: "clamp",
            }),
            transform: [
              { perspective: 1000 },
              {
                translateY: scrollY.interpolate({
                  inputRange: [atCard - pageHeight, atCard],
                  outputRange: [24, 0],
                  extrapolate: "clamp",
                }),
              },
              {
                rotateX: scrollY.interpolate({
                  inputRange: [
                    atCard - pageHeight,
                    atCard,
                    atCard + pageHeight,
                  ],
                  outputRange: ["22deg", "0deg", "-10deg"],
                  extrapolate: "clamp",
                }),
              },
              {
                scale: scrollY.interpolate({
                  inputRange: [
                    atCard - pageHeight,
                    atCard,
                    atCard + pageHeight,
                  ],
                  outputRange: [0.93, 1, 0.93],
                  extrapolate: "clamp",
                }),
              },
            ],
          };
    let content;
    if (card.kind === "hero") {
      content = districtSlug ? districtHero() : cityHero();
    } else if (card.kind === "district") {
      const { district } = card;
      content = (
        <DistrictCard
          name={district.name}
          position={index}
          total={children.length}
          firstUp={
            district.first_up
              ? {
                  place: district.first_up.place.name,
                  title: district.first_up.event.title,
                  startsAt: district.first_up.event.starts_at,
                }
              : null
          }
          count={district.upcoming_event_count}
          placeCount={district.place_count}
          onOpen={() => openLevel(district.slug, null)}
          onNext={() => scrollToCard(index + 1)}
        />
      );
    } else if (card.kind === "place") {
      const { place } = card;
      content = (
        <PlaceCard
          name={place.name}
          count={place.upcoming_event_count}
          events={place.events}
          selectedIndex={Math.min(
            selectedEvents[place.id] ?? 0,
            Math.max(0, place.events.length - 1),
          )}
          onSelectEvent={(eventIndex) =>
            setSelectedEvents((selected) => ({
              ...selected,
              [place.id]: eventIndex,
            }))
          }
          onViewEvent={(event) => setEventID(event.id)}
          onOpenPlace={() => openLevel(districtSlug, place.slug)}
          onStartSomething={null}
          onTouchCarousel={() => setTouchOnEventRow(true)}
        />
      );
    } else {
      content = (
        <EndCard
          parentName={parentName}
          onBeginning={() => scrollToCard(0)}
          onParent={goBack}
        />
      );
    }
    return (
      <View style={[styles.page, { height: pageHeight }]}>
        <Animated.View style={motion}>{content}</Animated.View>
      </View>
    );
  }

  const childPosition =
    focusedCard?.kind === "district" || focusedCard?.kind === "place"
      ? focusedIndex
      : null;
  const railLabel = placeSlug
    ? null
    : childPosition !== null
      ? `${districtSlug ? "Place" : "District"} ${childPosition} of ${children.length}`
      : focusedCard?.kind === "end"
        ? "The end"
        : `${children.length} ${districtSlug ? "places" : "districts"} · Scroll ↓`;
  const depth = placeSlug ? 3 : districtSlug ? 2 : 1;

  return (
    <View
      style={styles.root}
      onLayout={(event) =>
        setMapSize({
          width: event.nativeEvent.layout.width,
          height: event.nativeEvent.layout.height,
        })
      }
    >
      {mapStyle && (
        <Map
          mapStyle={mapStyle}
          style={StyleSheet.absoluteFill}
          dragPan={exploring}
          touchZoom={exploring}
          touchRotate={exploring}
          touchPitch={exploring}
          doubleTapHoldZoom={exploring}
          // Above the footer controls, which sit over the bottom of the map.
          attributionPosition={{ bottom: footerHeight, right: 8 }}
          logoPosition={{ bottom: footerHeight, left: 8 }}
          onDidFinishLoadingMap={() => setMapLoaded(true)}
          onDidFinishLoadingStyle={() => setMapLoaded(true)}
        >
          <Camera
            ref={camera}
            initialViewState={{ center: [74.35, 31.5], zoom: 10.5 }}
          />
          <GeoJSONSource id="explore-district-outline" data={districtOutline}>
            <Layer
              id="explore-district-fill"
              type="fill"
              paint={{
                "fill-color": "#D66A42",
                "fill-opacity": 0.13 * outlineOpacity,
              }}
            />
            <Layer
              id="explore-district-line"
              type="line"
              paint={{
                "line-color": "#D14A35",
                "line-width": 3.5,
                "line-opacity": outlineOpacity,
                "line-dasharray": [2, 1.5],
              }}
            />
          </GeoJSONSource>
          <GeoJSONSource id="explore-place-outline" data={placeOutline}>
            <Layer
              id="explore-place-fill"
              type="fill"
              paint={{ "fill-color": "#43694D", "fill-opacity": 0.045 }}
            />
            <Layer
              id="explore-place-line"
              type="line"
              paint={{
                "line-color": "#476C51",
                "line-width": 2,
                "line-opacity": 0.65,
                "line-dasharray": [3, 2],
              }}
            />
          </GeoJSONSource>
          <GeoJSONSource id="explore-spot-outlines" data={spotOutlines}>
            <Layer
              id="explore-spot-fill"
              type="fill"
              paint={{
                // The ground of the event in view is darker, as in the prototype.
                "fill-color": [
                  "case",
                  ["==", ["get", "id"], placeEvent?.spot?.id ?? ""],
                  "#56834D",
                  "#779767",
                ],
                "fill-opacity": 0.92,
              }}
            />
            <Layer
              id="explore-spot-line"
              type="line"
              paint={{ "line-color": "#F7F2DE", "line-width": 2 }}
            />
          </GeoJSONSource>
          <GeoJSONSource id="explore-ground-markings" data={markings}>
            <Layer
              id="explore-ground-marking-lines"
              type="line"
              paint={{ "line-color": "#F2EDDC", "line-width": 1.2 }}
            />
          </GeoJSONSource>
          {focusPin && (
            <Marker
              key={`focus-${focusPin.id}`}
              id={`focus-${focusPin.id}`}
              lngLat={focusPin.coordinates}
              anchor="bottom"
              offset={[0, 16]}
            >
              <FocusPin name={focusPin.name} />
            </Marker>
          )}
          {eventPins.map((pin) => (
            <Marker
              key={`events-${pin.id}`}
              id={`events-${pin.id}`}
              lngLat={pin.coordinates}
              anchor="bottom"
            >
              <EventPin count={pin.count} />
            </Marker>
          ))}
        </Map>
      )}
      {/* The prototype's soft shade at the top and bottom keeps cards and controls readable. */}
      <LinearGradient
        pointerEvents="none"
        colors={["#776D4520", "#776D4500", "#4C653C00", "#4C653C26"]}
        locations={[0, 0.26, 0.7, 1]}
        style={StyleSheet.absoluteFill}
      />

      {!exploring && (
        <GestureDetector gesture={levelSwipe}>
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { transform: [{ translateX: swipeOffset }] },
            ]}
            onTouchEnd={() => setTouchOnEventRow(false)}
            onTouchCancel={() => setTouchOnEventRow(false)}
          >
            {!levelLoaded ? (
              <View style={styles.centred}>
                {loadError ? (
                  <>
                    <Text style={styles.body}>{loadError}</Text>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setRefreshCount((value) => value + 1)}
                      style={styles.retry}
                    >
                      <Text style={styles.retryText}>Try again</Text>
                    </Pressable>
                  </>
                ) : (
                  <ActivityIndicator color={explore.ink} />
                )}
              </View>
            ) : placeView ? (
              <ScrollView
                contentContainerStyle={[styles.page, { minHeight: pageHeight }]}
                refreshControl={
                  <RefreshControl
                    refreshing={loading}
                    onRefresh={() => setRefreshCount((value) => value + 1)}
                  />
                }
              >
                <PlaceCard
                  name={placeView.place.name}
                  count={placeView.events.length}
                  events={placeView.events}
                  selectedIndex={Math.min(
                    selectedEvents[placeView.place.id] ?? 0,
                    Math.max(0, placeView.events.length - 1),
                  )}
                  onSelectEvent={(eventIndex) =>
                    setSelectedEvents((selected) => ({
                      ...selected,
                      [placeView.place.id]: eventIndex,
                    }))
                  }
                  onViewEvent={(event) => setEventID(event.id)}
                  onOpenPlace={null}
                  onStartSomething={() => setCreating(true)}
                  onTouchCarousel={() => setTouchOnEventRow(true)}
                />
              </ScrollView>
            ) : (
              pageHeight > 0 && (
                <Animated.FlatList
                  ref={feed}
                  key={levelPath}
                  data={cards}
                  keyExtractor={(card, index) =>
                    card.kind === "district"
                      ? card.district.id
                      : card.kind === "place"
                        ? card.place.id
                        : `${card.kind}-${index}`
                  }
                  renderItem={renderCard}
                  pagingEnabled
                  showsVerticalScrollIndicator={false}
                  initialScrollIndex={Math.min(focusedIndex, cards.length - 1)}
                  getItemLayout={(_, index) => ({
                    length: pageHeight,
                    offset: pageHeight * index,
                    index,
                  })}
                  scrollEventThrottle={16}
                  onScroll={(event) => {
                    const offsetY = event.nativeEvent.contentOffset.y;
                    scrollY.setValue(offsetY);
                    followScroll(offsetY);
                  }}
                  onMomentumScrollEnd={(event) => {
                    const index = Math.round(
                      event.nativeEvent.contentOffset.y / pageHeight,
                    );
                    setFocusedIndex(index);
                    if (!districtSlug)
                      setOutline({
                        index: cards[index]?.kind === "district" ? index : null,
                        opacity: cards[index]?.kind === "district" ? 1 : 0,
                      });
                  }}
                  refreshControl={
                    <RefreshControl
                      refreshing={loading && levelLoaded}
                      onRefresh={() => setRefreshCount((value) => value + 1)}
                    />
                  }
                />
              )
            )}
          </Animated.View>
        </GestureDetector>
      )}

      <View style={styles.header} pointerEvents="box-none">
        <Text style={styles.logo}>
          join me<Text style={styles.logoDot}>.</Text>
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose city"
          onPress={() =>
            setNotice("Lahore is selected. Other cities will come later.")
          }
          style={styles.cityPicker}
        >
          <Text style={styles.cityPickerText}>Lahore ⌄</Text>
        </Pressable>
      </View>

      <View style={styles.breadcrumbs} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          onPress={() => openLevel(null, null)}
          style={styles.crumbs}
        >
          <Text style={[styles.crumb, !districtSlug && styles.currentCrumb]}>
            {cityFeed?.city.name ?? "Lahore"}
          </Text>
          {districtSlug && (
            <Text
              style={[styles.crumb, !placeSlug && styles.currentCrumb]}
              onPress={() => openLevel(districtSlug, null)}
            >
              {"  ›  "}
              {districtFeed?.district.name ??
                placeView?.place.district.name ??
                "…"}
            </Text>
          )}
          {placeSlug && (
            <Text style={[styles.crumb, styles.currentCrumb]}>
              {"  ›  "}
              {placeView?.place.name ?? "…"}
            </Text>
          )}
        </Pressable>
      </View>

      {!exploring && (
        <View style={styles.levelPill} pointerEvents="box-none">
          {openTarget && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${openTarget.name}`}
              onPress={openTarget.open}
              style={styles.levelButton}
            >
              <Text style={styles.levelText} numberOfLines={1}>
                ← Swipe {openTarget.name}
              </Text>
            </Pressable>
          )}
          <View style={styles.depth}>
            {[1, 2, 3].slice(0, depth).map((level) => (
              <View
                key={level}
                style={[styles.depthDot, level === depth && styles.depthOn]}
              />
            ))}
          </View>
          {parentName && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Back to ${parentName}`}
              onPress={goBack}
              style={styles.levelButton}
            >
              <Text style={styles.levelText} numberOfLines={1}>
                {parentName} →
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {!exploring && railLabel && levelLoaded && (
        <View style={styles.rail} pointerEvents="none">
          <Text style={styles.railLabel}>{railLabel}</Text>
          <View style={styles.railDots}>
            {children.slice(0, 14).map((_, index) => (
              <View
                key={index}
                style={[
                  styles.railDot,
                  index + 1 === focusedIndex && styles.railOn,
                ]}
              />
            ))}
          </View>
        </View>
      )}

      {levelLoaded && loadError ? (
        <View style={styles.banner}>
          <Text style={styles.body}>
            Couldn’t refresh. Showing earlier results.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setRefreshCount((value) => value + 1)}
          >
            <Text style={styles.link}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
      {notice ? (
        <View style={styles.banner} accessibilityLiveRegion="polite">
          <Text style={styles.body}>{notice}</Text>
        </View>
      ) : null}

      <View style={styles.footer} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          onPress={() => setExploring((value) => !value)}
          style={styles.footerButton}
        >
          <Text style={styles.footerText}>
            {exploring ? "⌖ Back to stories" : "⌖ Explore map"}
          </Text>
        </Pressable>
        {!exploring && !placeSlug && focusedIndex < cards.length - 1 && (
          <Pressable
            accessibilityRole="button"
            onPress={() => scrollToCard(focusedIndex + 1)}
            style={styles.scrollHelp}
          >
            <Text style={styles.scrollHelpText}>SCROLL TO DISCOVER ↓</Text>
          </Pressable>
        )}
        {!exploring && !placeSlug && focusedIndex > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Return to the start of this feed"
            onPress={() => scrollToCard(0)}
            style={styles.restart}
          >
            <Text style={styles.footerText}>↑</Text>
          </Pressable>
        )}
      </View>

      {eventID && (
        <EventDetails
          key={eventID}
          id={eventID}
          apiURL={apiURL}
          closeLabel="Back to Explore"
          source="explore"
          referrerInteractionID={
            placeVisit.current?.id ??
            (districtAreaID ? viewedAreas.get(districtAreaID) : undefined)
          }
          onClose={() => setEventID(null)}
          onEventChanged={() => setRefreshCount((value) => value + 1)}
        />
      )}
      {creating && placeView && (
        <EventForm
          place={{ id: placeView.place.id, name: placeView.place.name }}
          spots={placeView.spots}
          apiURL={apiURL}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            setRefreshCount((value) => value + 1);
          }}
        />
      )}
    </View>
  );
}

// The prototype's focus marker: a name tag over a pin that ripples three times when
// focus arrives, then rests. Reduce Motion skips the ripples.
function FocusPin({ name }: { name: string }) {
  const [ripple] = useState(() => new Animated.Value(0));
  useEffect(() => {
    let cancelled = false;
    let animation: Animated.CompositeAnimation | null = null;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (cancelled || reduceMotion) return;
      animation = Animated.loop(
        Animated.timing(ripple, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        { iterations: 3 },
      );
      animation.start();
    });
    return () => {
      cancelled = true;
      animation?.stop();
    };
  }, [ripple]);
  return (
    <View style={styles.focusPin}>
      <Text style={styles.pinLabel} numberOfLines={1}>
        {name}
      </Text>
      <View style={styles.pinSpot}>
        <Animated.View
          style={[
            styles.pinRipple,
            {
              // Hidden at rest; each ripple starts faint and fades as it grows.
              opacity: ripple.interpolate({
                inputRange: [0, 0.001, 1],
                outputRange: [0, 0.65, 0],
              }),
              transform: [
                {
                  scale: ripple.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.55, 1.8],
                  }),
                },
              ],
            },
          ]}
        />
        <View style={styles.pinDot} />
      </View>
    </View>
  );
}

function EventPin({ count }: { count: number }) {
  return (
    <View style={styles.eventPin}>
      <View style={styles.eventBubble}>
        <Text style={styles.eventPinCount}>{count}</Text>
        <Text style={styles.eventPinWord}>
          {count === 1 ? "EVENT" : "EVENTS"}
        </Text>
      </View>
      <View style={styles.eventPinTail} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#EEE9D9" },
  page: {
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    paddingBottom: footerHeight,
  },
  centred: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 12,
    paddingBottom: footerHeight + 40,
  },
  header: {
    position: "absolute",
    top: 56,
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  logo: {
    fontFamily: explore.bodyBold,
    fontSize: 30,
    letterSpacing: -1,
    color: explore.ink,
  },
  logoDot: { color: explore.red },
  cityPicker: {
    backgroundColor: explore.paper,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  cityPickerText: {
    fontFamily: explore.bodyBold,
    fontSize: 14,
    color: explore.ink,
  },
  breadcrumbs: {
    position: "absolute",
    top: 108,
    left: 16,
    right: 16,
    flexDirection: "row",
  },
  crumbs: {
    flexDirection: "row",
    flexWrap: "wrap",
    backgroundColor: explore.paper,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  crumb: { fontFamily: explore.body, fontSize: 14, color: explore.muted },
  currentCrumb: { fontFamily: explore.bodyBold, color: explore.ink },
  levelPill: {
    position: "absolute",
    top: 156,
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
  },
  levelButton: {
    flexShrink: 1,
    backgroundColor: explore.paper,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  levelText: { fontFamily: explore.bodyBold, fontSize: 13, color: explore.ink },
  depth: { flexDirection: "row", gap: 4 },
  depthDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: explore.line,
  },
  depthOn: { width: 18, backgroundColor: explore.red },
  rail: { position: "absolute", top: 212, left: 16, gap: 8 },
  railLabel: {
    alignSelf: "flex-start",
    backgroundColor: explore.paper,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    fontFamily: explore.body,
    fontSize: 11,
    color: explore.ink,
  },
  railDots: { gap: 7, paddingLeft: 12 },
  railDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#9FB08F",
  },
  railOn: { height: 20, backgroundColor: explore.red },
  banner: {
    position: "absolute",
    top: 210,
    left: 16,
    right: 16,
    backgroundColor: explore.paper,
    borderRadius: 16,
    padding: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  body: { fontFamily: explore.body, fontSize: 14, color: explore.ink },
  link: { fontFamily: explore.bodyBold, color: explore.ink },
  retry: {
    backgroundColor: explore.red,
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  retryText: { fontFamily: explore.bodyBold, color: "#FFFFFF" },
  footer: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  footerButton: {
    backgroundColor: explore.paper,
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  footerText: {
    fontFamily: explore.bodyMedium,
    fontSize: 14,
    color: explore.ink,
  },
  scrollHelp: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "#F3F1E6CC",
    borderRadius: 10,
    paddingVertical: 12,
  },
  scrollHelpText: {
    fontFamily: explore.bodyMedium,
    fontSize: 10,
    letterSpacing: 1.5,
    color: explore.ink,
  },
  restart: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: explore.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  focusPin: { alignItems: "center", gap: 4 },
  pinLabel: {
    maxWidth: 160,
    backgroundColor: "#FFF8E8",
    borderColor: "#D2D9B8",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: "#264E35",
    fontFamily: explore.bodyBold,
    fontSize: 12,
    overflow: "hidden",
  },
  pinSpot: {
    width: 33,
    height: 33,
    alignItems: "center",
    justifyContent: "center",
  },
  pinRipple: {
    position: "absolute",
    width: 33,
    height: 33,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: "#547A42",
  },
  pinDot: {
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: "#305C40",
    borderWidth: 3,
    borderColor: "#FFF8DF",
  },
  eventPin: { alignItems: "center" },
  eventBubble: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    borderColor: "#FFF8DF",
    backgroundColor: explore.red,
    alignItems: "center",
    justifyContent: "center",
  },
  eventPinCount: {
    color: "#FFFFFF",
    fontFamily: explore.display,
    fontSize: 18,
    lineHeight: 18,
  },
  eventPinWord: {
    color: "#FFFFFF",
    fontFamily: explore.bodyBold,
    fontSize: 6,
    letterSpacing: 0.4,
  },
  eventPinTail: {
    width: 10,
    height: 10,
    marginTop: -7,
    backgroundColor: explore.red,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderColor: "#FFF8DF",
    transform: [{ rotate: "45deg" }],
  },
});
