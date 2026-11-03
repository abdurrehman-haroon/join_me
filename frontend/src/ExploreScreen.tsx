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
import {
  memo,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  AppState,
  BackHandler,
  Easing,
  type FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useActivities } from "./ActivitiesProvider";
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
// Cards on a level: the hero introduces it, its children follow, the end card
// closes it.
type Card =
  | { kind: "hero" }
  | { kind: "district"; district: DistrictSummary }
  | { kind: "place"; place: PlaceSummary }
  | { kind: "end" };
// Where Explore is: the city (no district) or a district.
type Level = { district: string | null };

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
  // Each level's feed, by feed key: the one in view and the levels either side.
  const [feedLists] = useState(() => new globalThis.Map<string, FlatList<Card> | null>());
  // The camera follows the feed only while someone scrolls it. A feed that has
  // just appeared reports its starting position too, which would cut the camera's
  // ease to the new level short.
  const feedScrolling = useRef(false);
  const [districtSlug, setDistrictSlug] = useState<string | null>(null);
  const [cityFeed, setCityFeed] = useState<CityFeed | null>(null);
  const [districtFeeds, setDistrictFeeds] = useState<
    Record<string, DistrictFeed>
  >({});
  const [placeViews, setPlaceViews] = useState<Record<string, PlaceView>>({});
  // Only a pull shows the refresh spinner. Showing it for background reloads makes
  // iOS inset the feed by the spinner's height, so pages stop lining up with cards.
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [mapLoaded, setMapLoaded] = useState(false);
  // The skinned style. Like the prototype, a style or map that fails to load shows
  // an error with Reload instead of an unstyled map.
  const [mapStyle, setMapStyle] = useState<StyleSpecification | null>(null);
  const [mapFailed, setMapFailed] = useState(false);
  const [mapAttempt, setMapAttempt] = useState(0);
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });
  const [reduceMotion, setReduceMotion] = useState(false);
  const [notice, setNotice] = useState("");
  const [eventID, setEventID] = useState<string | null>(null);
  // The place an event is being created at, from its place view.
  const [creating, setCreating] = useState<PlaceView | null>(null);
  // Explore map mode hides the stories and lets the same map pan freely.
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
  // Sends the scroll's per-frame outline cross-fade to CityOutlines; null clears it.
  const cityOutlineFades = useRef<((fades: OutlineFade | null) => void) | null>(
    null,
  );
  // Measured layout the camera keeps its target clear of: the bottom of the top
  // controls, and the top of each card within its page.
  const [controlsBottom, setControlsBottom] = useState(150);
  const [cardTops, setCardTops] = useState<Record<string, number>>({});
  // Levels sit side by side, one screen wide each (city, district); this
  // moves along them, resting at -(depth - 1) screens.
  const [swipeOffset] = useState(() => new Animated.Value(0));
  // The target of the flight openLevel started, so the focus effect does not
  // restart it once the next level renders.
  const flownCamera = useRef<string | null>(null);
  // The card the rail scrub last moved to, while a finger is on the rail.
  const scrubIndex = useRef<number | null>(null);
  // Each feed's scroll position, which drives its cards' motion on the native thread.
  const [scrollValues] = useState(() => new globalThis.Map<string, Animated.Value>());
  // The level just left, kept built so swiping back to it is instant.
  const [leftKey, setLeftKey] = useState<string | null>(null);

  const pageHeight = mapSize.height;

  // Levels are described here so a swipe can preview the level it would open.
  function pathFor(atLevel: Level) {
    if (atLevel.district)
      return `/cities/${citySlug}/districts/${atLevel.district}/places`;
    return `/cities/${citySlug}/districts`;
  }

  // Identifies a level's card list.
  function feedKeyFor(atLevel: Level) {
    return atLevel.district ?? citySlug;
  }

  function cardsFor(atLevel: Level): Card[] {
    const levelChildren: Card[] = atLevel.district
      ? (districtFeeds[atLevel.district]?.places ?? []).map((place) => ({
          kind: "place" as const,
          place,
        }))
      : (cityFeed?.districts ?? []).map((district) => ({
          kind: "district" as const,
          district,
        }));
    return [{ kind: "hero" }, ...levelChildren, { kind: "end" }];
  }

  // A level reopens on the card it was left at.
  function openingIndex(atLevel: Level) {
    return savedIndexes[pathFor(atLevel)] ?? 0;
  }

  function depthOf(atLevel: Level) {
    return atLevel.district ? 2 : 1;
  }

  // A feed's native scroll value, created at its opening card.
  function scrollValueFor(key: string, startIndex: number) {
    let value = scrollValues.get(key);
    if (!value) {
      value = new Animated.Value(startIndex * pageHeight);
      scrollValues.set(key, value);
    }
    return value;
  }

  const level: Level = { district: districtSlug };
  const depth = depthOf(level);
  const levelPath = pathFor(level);
  const feedKey = feedKeyFor(level);
  const districtFeed = districtSlug ? districtFeeds[districtSlug] : undefined;
  const levelLoaded = districtSlug ? Boolean(districtFeed) : Boolean(cityFeed);
  const cards = cardsFor(level);
  const children = cards.filter(
    (card) => card.kind === "district" || card.kind === "place",
  );
  // The hero comes before the districts or places.
  const heroOffset = 1;
  const focusedCard = cards[focusedIndex];
  // The focused place's full view (spots, outline, every event), once loaded. On
  // the district feed it is fetched for the place card in view.
  const focusedPlaceView =
    districtSlug && focusedCard?.kind === "place"
      ? placeViews[`${districtSlug}/${focusedCard.place.slug}`]
      : undefined;

  // Opening moves one level down: from the hero into the first child, otherwise into the focused child.
  const openTarget: { name: string; level: Level } | null = (() => {
    if (districtSlug || focusedCard?.kind === "end") return null;
    const child = focusedCard?.kind === "hero" ? cards[1] : focusedCard;
    if (child?.kind === "district")
      return {
        name: child.district.name,
        level: { district: child.district.slug },
      };
    return null;
  })();
  const parentLevel: Level | null = districtSlug ? { district: null } : null;
  function parentNameFor(atLevel: Level) {
    const atDistrict = atLevel.district
      ? districtFeeds[atLevel.district]
      : undefined;
    return atLevel.district
      ? (cityFeed?.city.name ?? atDistrict?.district.city.name ?? "Lahore")
      : null;
  }

  const districtAreaID = districtFeed?.district.id;

  // The feed came to rest on a card: it becomes the focused card, and on the city
  // feed the outlined district.
  function settleOnCard(index: number) {
    feedScrolling.current = false;
    setFocusedIndex(index);
    const settledCard = cards[index];
    cityOutlineFades.current?.(null);
    if (!districtSlug)
      setOutline({
        index: settledCard?.kind === "district" ? index : null,
        opacity: settledCard?.kind === "district" ? 1 : 0,
      });
  }

  function scrollToCard(index: number) {
    const target = Math.max(0, Math.min(cards.length - 1, index));
    feedScrolling.current = !reduceMotion;
    feedLists.get(feedKey)?.scrollToOffset({
      offset: target * pageHeight,
      animated: !reduceMotion,
    });
    // An animated scroll settles through onMomentumScrollEnd; a jump does not.
    if (reduceMotion) settleOnCard(target);
  }


  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setForeground(state === "active"),
    );
    return () => subscription.remove();
  }, []);


  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    async function loadLevel() {
      try {
        const response = await fetch(`${apiURL}${levelPath}`, {
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(`Explore request failed (${response.status})`);
        if (districtSlug) {
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
        if (active) setPullRefreshing(false);
      }
    }
    void loadLevel();
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [levelPath, districtSlug, refreshCount]);

  // The districts beside the focused card are fetched ahead, so a swipe can open
  // a district whose page is already built.
  const nearbyDistrictSlugs = districtSlug
    ? []
    : [focusedIndex - 1, focusedIndex, focusedIndex + 1].flatMap((index) => {
        const card = cards[index];
        return card?.kind === "district" && !districtFeeds[card.district.slug]
          ? [card.district.slug]
          : [];
      });
  const nearbyDistrictsKey = nearbyDistrictSlugs.join(",");
  useEffect(() => {
    if (!nearbyDistrictsKey) return;
    const controller = new AbortController();
    for (const slug of nearbyDistrictsKey.split(",")) {
      fetch(`${apiURL}/cities/${citySlug}/districts/${slug}/places`, {
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((loadedDistrict: DistrictFeed | null) => {
          if (loadedDistrict)
            setDistrictFeeds((feeds) => ({ ...feeds, [slug]: loadedDistrict }));
        })
        // Pins are a preview; the cards stay usable without them.
        .catch(() => {});
    }
    return () => controller.abort();
  }, [nearbyDistrictsKey]);

  // On the district feed the map draws the focused place's outline and grounds,
  // which come from its place view; creating an event there uses its spots.
  const placeToPreview =
    districtSlug && focusedCard?.kind === "place"
      ? focusedCard.place.slug
      : null;
  const placePreviewCached = placeToPreview
    ? Boolean(placeViews[`${districtSlug}/${placeToPreview}`])
    : true;
  useEffect(() => {
    if (!districtSlug || !placeToPreview || placePreviewCached) return;
    const controller = new AbortController();
    fetch(
      `${apiURL}/cities/${citySlug}/districts/${districtSlug}/places/${placeToPreview}`,
      { signal: controller.signal },
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((loadedPlace: PlaceView | null) => {
        if (loadedPlace)
          setPlaceViews((views) => ({
            ...views,
            [`${districtSlug}/${placeToPreview}`]: loadedPlace,
          }));
      })
      // The outline is a preview; the card stays usable without it.
      .catch(() => {});
    return () => controller.abort();
  }, [districtSlug, placeToPreview, placePreviewCached]);

  // One area_viewed per area per session, once its page has loaded while visible.
  const viewedAreaID = districtSlug
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
        if (!controller.signal.aborted) setMapFailed(true);
      });
    return () => controller.abort();
  }, [mapAttempt]);

  function reloadMap() {
    setMapFailed(false);
    setMapLoaded(false);
    setMapStyle(null);
    setMapAttempt((attempt) => attempt + 1);
  }

  // A place card lists its full place view once loaded, otherwise the feed's events.
  function placeEvents(place: PlaceSummary, district: string | null) {
    const view = district ? placeViews[`${district}/${place.slug}`] : undefined;
    return view?.events ?? place.events;
  }

  // The event shown in a place's carousel, and where it happens.
  function selectedEvent(placeID: string, events: EventSummary[]) {
    return events[Math.min(selectedEvents[placeID] ?? 0, events.length - 1)];
  }

  function cardKey(card: Card) {
    if (card.kind === "district") return card.district.id;
    if (card.kind === "place") return card.place.id;
    return card.kind;
  }

  // The prototype keeps the camera's target in the clear map between the top
  // controls and the top of the card in view. The hero is text over the map, not a
  // card, so it leaves the map clear down to the footer.
  function cameraPadding(atLevel: Level, index: number) {
    const top = Math.min(pageHeight - 60, Math.max(24, controlsBottom + 18));
    const card = cardsFor(atLevel)[index];
    const cardTop =
      !card || card.kind === "hero"
        ? pageHeight - 100
        : (cardTops[`${feedKeyFor(atLevel)}/${cardKey(card)}`] ??
          pageHeight * 0.5);
    const clearBottom = Math.max(
      top + 24,
      Math.min(pageHeight - 48, cardTop - 28),
    );
    return { top, right: 0, bottom: pageHeight - clearBottom, left: 0 };
  }

  // The prototype's camera for one event on a phone: a ground inside a campus is
  // shown closer and at the campus angle; otherwise the feed's alternating turn.
  function eventCamera(
    placeCoordinates: Coordinates,
    event: EventSummary | undefined,
    turn: number,
  ): CameraTarget {
    if (event?.spot)
      return {
        center: event.spot.coordinates,
        zoom: 16.65,
        pitch: 52,
        bearing: -23,
      };
    return { center: placeCoordinates, zoom: 16.25, pitch: 48, bearing: turn };
  }

  // Prototype camera: flat over the city, tilted for districts and places, with a
  // slight alternating turn per card. Targets fit the clear map above the card.
  function cameraFor(atLevel: Level, index: number): CameraTarget | null {
    const card = cardsFor(atLevel)[index];
    if (card?.kind === "end") return cameraFor(atLevel, index - 1);
    const turn = index % 2 ? 10 : -9;
    // Areas fit the map left visible between the top controls and the card. The
    // tilt makes the near edge larger, so the fit keeps a little height spare.
    const padding = cameraPadding(atLevel, index);
    const viewWidth = mapSize.width - 48;
    const viewHeight = Math.max(
      120,
      (pageHeight - padding.top - padding.bottom) * 0.85,
    );
    if (card?.kind === "district" && card.district.bbox)
      return {
        center: boundsCentre(card.district.bbox),
        zoom: zoomToFit(card.district.bbox, viewWidth, viewHeight, 15),
        pitch: 35,
        bearing: turn,
      };
    if (card?.kind === "place") {
      const events = placeEvents(card.place, atLevel.district);
      return eventCamera(
        card.place.coordinates,
        selectedEvent(card.place.id, events),
        turn,
      );
    }
    const levelBounds = atLevel.district
      ? districtFeeds[atLevel.district]?.district.bbox
      : cityFeed?.city.bbox;
    if (!levelBounds) return null;
    return {
      center: boundsCentre(levelBounds),
      zoom: zoomToFit(levelBounds, viewWidth, viewHeight, 15),
      pitch: atLevel.district ? 35 : 0,
      bearing: 0,
    };
  }
  function openLevel(nextDistrict: string | null) {
    const nextLevel = { district: nextDistrict };
    const nextIndex = openingIndex(nextLevel);
    // Levels slide like pages: opening a district, it comes in from the right;
    // going back, the city comes in from the left. The level either side is usually built
    // already, so this only moves it into view, continuing from wherever a
    // swipe left it. Reduce Motion changes level in place.
    const rest = -(depthOf(nextLevel) - 1) * mapSize.width;
    const animate = !reduceMotion && mapSize.width > 0;
    if (animate)
      Animated.timing(swipeOffset, {
        toValue: rest,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    else swipeOffset.setValue(rest);
    // The camera sets off now too; it flies natively while the level renders.
    const nextCamera =
      animate && mapLoaded ? cameraFor(nextLevel, nextIndex) : null;
    if (nextCamera) {
      flownCamera.current = JSON.stringify(nextCamera);
      camera.current?.flyTo({
        ...nextCamera,
        padding: cameraPadding(nextLevel, nextIndex),
        duration: 1200,
      });
    }
    // The state change renders on the next frame, after both have started.
    requestAnimationFrame(() => {
      setSavedIndexes((saved) => ({ ...saved, [levelPath]: focusedIndex }));
      setLeftKey(feedKey);
      setFocusedIndex(nextIndex);
      // Returning to the city feed on a district card shows its outline straight away.
      cityOutlineFades.current?.(null);
      setOutline({
        index: !nextDistrict && nextIndex > 0 ? nextIndex : null,
        opacity: !nextDistrict && nextIndex > 0 ? 1 : 0,
      });
      setDistrictSlug(nextDistrict);
      setLoadError("");
    });
  }

  function goBack() {
    if (districtSlug) openLevel(null);
    else setNotice("Lahore is the only city for now.");
  }

  // Horizontal drags change level; any clear vertical movement fails this gesture
  // so the feed keeps scrolling. Event carousels disable it to scroll between events.
  // The builder only stores these callbacks; they run on touch events, not during
  // render, so moving the camera from them is safe.
  /* eslint-disable react-hooks/refs */
  const levelSwipe = Gesture.Pan()
    .runOnJS(true)
    .enabled(!touchOnEventRow)
    .activeOffsetX([-15, 15])
    .failOffsetY([-15, 15])
    .onUpdate((event) => {
      if (reduceMotion) return;
      // The next level follows the finger; with nowhere to go, the feed resists.
      const canGo = event.translationX < 0 ? openTarget : parentLevel;
      swipeOffset.setValue(
        -(depth - 1) * mapSize.width +
          event.translationX * (canGo ? 1 : 0.35),
      );
      followLevelSwipe(event.translationX);
    })
    .onEnd((event) => {
      // Right to left opens the focused district; left to right goes back.
      // A quarter of the screen or a quick flick changes level, and the slide and
      // the camera finish from where the drag left them.
      const far =
        Math.abs(event.translationX) > mapSize.width * 0.25 ||
        (Math.abs(event.translationX) > levelSwipeDistance &&
          Math.abs(event.velocityX) > 600);
      if (far && event.translationX < 0 && openTarget) {
        openLevel(openTarget.level.district);
        return;
      }
      if (far && event.translationX > 0 && districtSlug) {
        goBack();
        return;
      }
      cancelLevelSwipe();
      // On the city feed this explains that there is no level above Lahore.
      if (event.translationX > levelSwipeDistance) goBack();
    });
  /* eslint-enable react-hooks/refs */

  // Android Back climbs a level; at the city it falls through and leaves the app. Re-subscribed each render so goBack
  // sees the current level.
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (!districtSlug) return false;
        goBack();
        return true;
      },
    );
    return () => subscription.remove();
  });

  const focusedTarget = cameraFor(level, focusedIndex);
  // A string key keeps the effect from re-running for an identical target.
  const focusedCameraKey = JSON.stringify({
    target: focusedTarget,
    padding: cameraPadding(level, focusedIndex),
  });

  // The scroll moves the camera itself, so when a card settles the camera is
  // already there. A level change has no scroll, so the camera eases to the new
  // level while the feeds slide. Reduce Motion jumps instead.
  useEffect(() => {
    const focusedCamera: {
      target: CameraTarget | null;
      padding: ReturnType<typeof cameraPadding>;
    } = JSON.parse(focusedCameraKey);
    if (!mapLoaded || !focusedCamera.target || !pageHeight) return;
    if (reduceMotion)
      camera.current?.jumpTo({
        ...focusedCamera.target,
        padding: focusedCamera.padding,
      });
    // A level change flies (rising and landing); after a scroll the camera is
    // already there and this does nothing. A flight openLevel already started
    // is left to land.
    else if (JSON.stringify(focusedCamera.target) === flownCamera.current)
      flownCamera.current = null;
    else
      camera.current?.flyTo({
        ...focusedCamera.target,
        padding: focusedCamera.padding,
        duration: 1200,
      });
  }, [mapLoaded, focusedCameraKey, pageHeight, reduceMotion]);

  // While the feed scrolls, the camera moves with it between the two nearest cards,
  // and on the city feed the outline fades out of one district and into the next.
  // Reduce Motion switches at the halfway point instead of travelling.
  function followScroll(offsetY: number) {
    if (!mapLoaded || !pageHeight || !cards.length) return;
    const progress = Math.max(0, offsetY / pageHeight);
    const leaving = Math.min(Math.floor(progress), cards.length - 1);
    const approaching = Math.min(leaving + 1, cards.length - 1);
    const fraction = progress - leaving;
    const travel = reduceMotion ? (fraction > 0.5 ? 1 : 0) : fraction;
    const from = cameraFor(level, leaving);
    const to = cameraFor(level, approaching);
    if (from && to)
      glideTo({
        ...blendCamera(from, to, travel),
        padding: cameraPadding(level, Math.round(progress)),
      });
    if (districtSlug) return;
    const amount = travel * travel * (3 - 2 * travel);
    const fromKind = cards[leaving]?.kind;
    const toKind = cards[approaching]?.kind;
    // Outlines cross-fade every frame: the district being left fades out while
    // the next fades in.
    const fades: OutlineFade = [];
    if (fromKind === "district")
      fades.push({ index: leaving, opacity: toKind === "district" || toKind === "end" ? 1 - amount : 1 });
    if (toKind === "district" && approaching !== leaving)
      fades.push({ index: approaching, opacity: amount });
    cityOutlineFades.current?.(fades);
  }

  // While a place's carousel scrolls, the camera glides between the grounds of the
  // two nearest events, as the prototype's does.
  function followEventScroll(
    place: PlaceSummary,
    events: EventSummary[],
    progress: number,
    index: number,
  ) {
    if (!mapLoaded || !events.length || index !== focusedIndex) return;
    const clamped = Math.max(0, Math.min(events.length - 1, progress));
    const leaving = Math.floor(clamped);
    const approaching = Math.min(leaving + 1, events.length - 1);
    const fraction = clamped - leaving;
    const turn = index % 2 ? 10 : -9;
    const from = eventCamera(place.coordinates, events[leaving], turn);
    const to = eventCamera(place.coordinates, events[approaching], turn);
    glideTo({
      ...blendCamera(from, to, reduceMotion ? (fraction > 0.5 ? 1 : 0) : fraction),
      padding: cameraPadding(level, index),
    });
  }

  // While a sideways drag is under way the camera travels toward the level it
  // would open, as far as the drag has gone: most of the screen's width takes it
  // all the way. Letting go finishes the trip or takes it back.
  function followLevelSwipe(translationX: number) {
    const nextLevel = translationX < 0 ? openTarget?.level : parentLevel;
    if (!nextLevel || !mapLoaded || !mapSize.width) return;
    const from = cameraFor(level, focusedIndex);
    const to = cameraFor(nextLevel, openingIndex(nextLevel));
    if (!from || !to) return;
    const progress = Math.min(1, Math.abs(translationX) / mapSize.width);
    glideTo({
      ...blendCamera(from, to, progress),
      padding: cameraPadding(level, focusedIndex),
    });
  }

  // Scroll and drag events reach JavaScript about 80 times a second, while the
  // screen draws up to 120: jumping to each position left the map a step behind
  // the cards. A short linear ease lets MapLibre draw every frame between them.
  function glideTo(target: CameraTarget & { padding: ReturnType<typeof cameraPadding> }) {
    if (reduceMotion) camera.current?.jumpTo(target);
    else camera.current?.easeTo({ ...target, duration: 60, easing: "linear" });
  }

  // A drag that does not change level puts the feed and the camera back.
  function cancelLevelSwipe() {
    Animated.spring(swipeOffset, {
      toValue: -(depth - 1) * mapSize.width,
      useNativeDriver: true,
    }).start();
    const currentCamera = cameraFor(level, focusedIndex);
    if (currentCamera && mapLoaded && !reduceMotion)
      camera.current?.easeTo({
        ...currentCamera,
        padding: cameraPadding(level, focusedIndex),
        duration: 300,
      });
  }

  // Prototype markers: one focus pin with a name tag for what the card shows.
  const focusedEvent =
    focusedCard?.kind === "place"
      ? selectedEvent(
          focusedCard.place.id,
          placeEvents(focusedCard.place, districtSlug),
        )
      : undefined;
  // A district's pin has no name tag; its card already names it.
  const focusPin: {
    id: string;
    name: string | null;
    coordinates: Coordinates;
  } | null =
    focusedCard?.kind === "district" && focusedCard.district.bbox
      ? {
          id: focusedCard.district.id,
          name: null,
          coordinates: boundsCentre(focusedCard.district.bbox),
        }
      : focusedCard?.kind === "place"
        ? {
            id: focusedEvent?.spot?.id ?? focusedCard.place.id,
            name: focusedEvent?.spot?.name ?? focusedCard.place.name,
            coordinates:
              focusedEvent?.spot?.coordinates ?? focusedCard.place.coordinates,
          }
        : null;

  // On the city feed CityOutlines draws the outlines.
  const districtBoundary = districtSlug ? districtFeed?.district.boundary : null;
  const districtOutline: GeoJSON.FeatureCollection<GeoJSON.MultiPolygon> = {
    type: "FeatureCollection",
    features: districtBoundary
      ? [{ type: "Feature", properties: {}, geometry: districtBoundary }]
      : [],
  };

  const placeOutline: GeoJSON.FeatureCollection<GeoJSON.MultiPolygon> = {
    type: "FeatureCollection",
    features: focusedPlaceView?.place.boundary
      ? [
          {
            type: "Feature",
            properties: {},
            geometry: focusedPlaceView.place.boundary,
          },
        ]
      : [],
  };
  const markings = groundMarkings(focusedPlaceView?.spots ?? []);
  const spotOutlines: GeoJSON.FeatureCollection<GeoJSON.MultiPolygon> = {
    type: "FeatureCollection",
    features: (focusedPlaceView?.spots ?? [])
      .filter((spot) => spot.boundary)
      .map((spot) => ({
        type: "Feature",
        properties: { id: spot.id },
        geometry: spot.boundary!,
      })),
  };

  function districtHero(slug: string) {
    const heroFeed = districtFeeds[slug];
    const places = heroFeed?.places ?? [];
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
        tone="district"
        kicker="LAHORE / DISTRICT"
        title={heroFeed?.district.name ?? ""}
        intro="Scroll to see what’s happening here. One place, one moment at a time."
        portalKicker={`COMING UP IN ${(heroFeed?.district.name ?? "").toUpperCase()}`}
        portalStat={`${places.length} ${places.length === 1 ? "place" : "places"} · ${count} ${count === 1 ? "thing" : "things"} happening`}
        portalNote={
          firstUp
            ? `First up · ${firstUp.place} · ${formatStart(firstUp.event.starts_at)}`
            : "Nothing coming up yet"
        }
        actionLabel="See places"
        actionArrow="↓"
        onAction={() => scrollToCard(1)}
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
        tone="city"
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
        actionLabel="Explore districts"
        actionArrow="↓"
        onAction={() => scrollToCard(1)}
      />
    );
  }

  // Cards move like the prototype's: the next card rises, tilts and fades in as it
  // approaches; the hero fades and lifts away. Reduce Motion users get plain scrolling.
  function renderCard(
    atLevel: Level,
    scrollY: Animated.Value,
    { item: card, index }: { item: Card; index: number },
  ) {
    const atCard = index * pageHeight;
    const motion = reduceMotion
      ? null
      : card.kind === "hero"
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
                // A leaving card reaches its full -10° tilt under halfway (22° per page).
                rotateX: scrollY.interpolate({
                  inputRange: [
                    atCard - pageHeight,
                    atCard,
                    atCard + (pageHeight * 10) / 22,
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
      content = atLevel.district ? districtHero(atLevel.district) : cityHero();
    } else if (card.kind === "district") {
      const { district } = card;
      content = (
        <DistrictCard
          name={district.name}
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
        />
      );
    } else if (card.kind === "place") {
      const { place } = card;
      const events = placeEvents(place, atLevel.district);
      const view = placeViews[`${atLevel.district}/${place.slug}`];
      content = (
        <PlaceCard
          name={place.name}
          count={place.upcoming_event_count}
          events={events}
          selectedIndex={Math.min(
            selectedEvents[place.id] ?? 0,
            Math.max(0, events.length - 1),
          )}
          reduceMotion={reduceMotion}
          onSelectEvent={(eventIndex) =>
            setSelectedEvents((selected) => ({
              ...selected,
              [place.id]: eventIndex,
            }))
          }
          onScrollEvents={(progress) =>
            followEventScroll(place, events, progress, index)
          }
          onViewEvent={(event) => setEventID(event.id)}
          // Creating needs the place's spots, from its place view.
          onStartSomething={view ? () => setCreating(view) : null}
          onTouchCarousel={() => setTouchOnEventRow(true)}
        />
      );
    } else {
      content = (
        <EndCard
          parentName={parentNameFor(atLevel)}
          onBeginning={() => scrollToCard(0)}
          onParent={goBack}
        />
      );
    }
    const topKey = `${feedKeyFor(atLevel)}/${cardKey(card)}`;
    return (
      <View style={[styles.page, { height: pageHeight }]}>
        {/* On Android the card is drawn once into a GPU texture, so the scroll's
            fade and tilt move an image instead of redrawing text and shadows
            every frame. */}
        <Animated.View
          style={motion}
          renderToHardwareTextureAndroid
          onLayout={(event) => {
            const top = event.nativeEvent.layout.y;
            setCardTops((tops) =>
              tops[topKey] === top ? tops : { ...tops, [topKey]: top },
            );
          }}
        >
          {content}
        </Animated.View>
      </View>
    );
  }

  const childPosition =
    focusedCard?.kind === "district" || focusedCard?.kind === "place"
      ? focusedIndex + 1 - heroOffset
      : null;
  const railLabel =
    childPosition !== null
      ? `${districtSlug ? "Place" : "District"} ${childPosition} of ${children.length}`
      : focusedCard?.kind === "end"
        ? "The end"
        : `${children.length} ${districtSlug ? "place" : "district"}${children.length === 1 ? "" : "s"} · Scroll ↓`;
  // The levels built either side of the one in view: its parent, and the level a
  // left swipe opens, built a moment after scrolling stops so building it never
  // competes with the scroll. The level just left stays built until then.
  const childKey = openTarget ? feedKeyFor(openTarget.level) : null;
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setPreviewKey(childKey), 250);
    return () => clearTimeout(timer);
  }, [childKey]);
  const pages: Level[] = [
    ...(parentLevel ? [parentLevel] : []),
    level,
    ...(openTarget && (childKey === previewKey || childKey === leftKey)
      ? [openTarget.level]
      : []),
  ];
  // Scroll positions of feeds no longer built are dropped, so a rebuilt feed
  // starts from its opening card.
  const pageKeys = pages.map(feedKeyFor).join("|");
  useEffect(() => {
    const built = pageKeys.split("|");
    for (const key of [...scrollValues.keys()])
      if (!built.includes(key)) scrollValues.delete(key);
  }, [pageKeys, scrollValues]);

  function renderFeed(atLevel: Level) {
    const key = feedKeyFor(atLevel);
    const current = key === feedKey;
    const loaded = atLevel.district
      ? Boolean(districtFeeds[atLevel.district])
      : Boolean(cityFeed);
    const startIndex = current ? focusedIndex : openingIndex(atLevel);
    const scrollY = scrollValueFor(key, startIndex);
    const pageCards = cardsFor(atLevel);
    return (
      <View
        key={key}
        pointerEvents={current ? "auto" : "none"}
        style={[
          styles.levelPage,
          {
            left: (depthOf(atLevel) - 1) * mapSize.width,
            width: mapSize.width,
          },
        ]}
      >
        {!loaded ? (
          current && (
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
          )
        ) : (
          pageHeight > 0 && (
            <Animated.FlatList
              ref={(list: FlatList<Card> | null) => {
                feedLists.set(key, list);
              }}
              data={pageCards}
              keyExtractor={cardKey}
              renderItem={(item) => renderCard(atLevel, scrollY, item)}
              pagingEnabled
              showsVerticalScrollIndicator={false}
              // Cards are a page each: build the one in view and its neighbours.
              initialNumToRender={2}
              windowSize={3}
              maxToRenderPerBatch={2}
              // Android clips list children it thinks are off screen and does not
              // restore them when a level page slides back into view.
              removeClippedSubviews={false}
              initialScrollIndex={Math.min(startIndex, pageCards.length - 1)}
              getItemLayout={(_, index) => ({
                length: pageHeight,
                offset: pageHeight * index,
                index,
              })}
              scrollEventThrottle={16}
              onScrollBeginDrag={() => {
                feedScrolling.current = true;
              }}
              // Card tilt and fade follow the scroll on the native thread; the
              // listener moves the camera and outline from JavaScript.
              onScroll={Animated.event(
                [{ nativeEvent: { contentOffset: { y: scrollY } } }],
                {
                  useNativeDriver: true,
                  listener: (
                    event: NativeSyntheticEvent<NativeScrollEvent>,
                  ) => {
                    if (current && feedScrolling.current)
                      followScroll(event.nativeEvent.contentOffset.y);
                  },
                },
              )}
              onMomentumScrollEnd={(event) => {
                if (current)
                  settleOnCard(
                    Math.round(event.nativeEvent.contentOffset.y / pageHeight),
                  );
              }}
              // Always present: on Android it wraps the scroll view, and adding or
              // removing it recreates the list at the top.
              refreshControl={
                <RefreshControl
                  enabled={current}
                  refreshing={current && pullRefreshing}
                  onRefresh={() => {
                    setPullRefreshing(true);
                    setRefreshCount((value) => value + 1);
                  }}
                />
              }
            />
          )
        )}
      </View>
    );
  }

  // Holding and dragging along the rail's dots moves through the feed's
  // districts or places quickly, one dot per card. As with the level swipe, the
  // builder only stores callbacks that run on touch events.
  const [railHeight, setRailHeight] = useState(0);
  const railDotCount = Math.min(children.length, 14);
  /* eslint-disable react-hooks/refs */
  const railScrub = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onUpdate((event) => {
      if (!railHeight || !railDotCount) return;
      const position = Math.floor((event.y / railHeight) * railDotCount);
      const index =
        Math.max(0, Math.min(railDotCount - 1, position)) + heroOffset;
      if (index !== scrubIndex.current) {
        scrubIndex.current = index;
        scrollToCard(index);
      }
    })
    .onFinalize(() => {
      scrubIndex.current = null;
    });
  /* eslint-enable react-hooks/refs */

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
      {mapStyle && !mapFailed && (
        <Map
          mapStyle={mapStyle}
          style={StyleSheet.absoluteFill}
          // The feed moves the camera; the map itself takes no gestures.
          dragPan={false}
          touchZoom={false}
          touchRotate={false}
          touchPitch={false}
          doubleTapHoldZoom={false}
          // Above the footer controls, which sit over the bottom of the map.
          attributionPosition={{ bottom: footerHeight, right: 8 }}
          logoPosition={{ bottom: footerHeight, left: 8 }}
          compass={false}
          // Android's scale bar only supports top/left, under the status bar.
          scaleBar={Platform.OS === "ios"}
          scaleBarPosition={{ bottom: footerHeight + 4, right: 40 }}
          onDidFinishLoadingMap={() => setMapLoaded(true)}
          onDidFinishLoadingStyle={() => setMapLoaded(true)}
          onDidFailLoadingMap={() => setMapFailed(true)}
        >
          <Camera
            ref={camera}
            initialViewState={{ center: [74.35, 31.5], zoom: 10.5 }}
          />
          {!districtSlug && cityFeed && (
            <CityOutlines
              districts={cityFeed.districts}
              rest={outline}
              liveRef={cityOutlineFades}
            />
          )}
          <GeoJSONSource id="explore-district-outline" data={districtOutline}>
            <Layer
              id="explore-district-fill"
              type="fill"
              paint={{
                "fill-color": "#D66A42",
                "fill-opacity": 0.13,
              }}
            />
            <Layer
              id="explore-district-line"
              type="line"
              paint={{
                "line-color": "#D14A35",
                "line-width": 3.5,
                "line-opacity": 1,
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
                  ["==", ["get", "id"], focusedEvent?.spot?.id ?? ""],
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
        </Map>
      )}
      {/* The prototype's soft shade at the top and bottom keeps cards and controls readable. */}
      <LinearGradient
        pointerEvents="none"
        colors={["#776D4520", "#776D4500", "#4C653C00", "#4C653C22"]}
        locations={[0, 0.26, 0.7, 1]}
        style={StyleSheet.absoluteFill}
      />

      <GestureDetector gesture={levelSwipe}>
        {/* Two screens wide, one per level: Android only delivers touches
            to views inside their parent's bounds. */}
        <Animated.View
          style={[
            styles.levelTrack,
            {
              width: mapSize.width * 2,
              transform: [{ translateX: swipeOffset }],
            },
          ]}
          onTouchEnd={() => setTouchOnEventRow(false)}
          onTouchCancel={() => setTouchOnEventRow(false)}
        >
          {/* Each feed's ref callback and scroll listener only run after
              render, on mount and while scrolling. */}
          {/* eslint-disable-next-line react-hooks/refs */}
          {pages.map(renderFeed)}
        </Animated.View>
      </GestureDetector>

      <View style={styles.header} pointerEvents="box-none">
        <Text style={styles.logo}>
          join me<Text style={styles.logoDot}>.</Text>
        </Text>
      </View>

      <View
        style={styles.breadcrumbs}
        pointerEvents="box-none"
        onLayout={(event) =>
          setControlsBottom(
            event.nativeEvent.layout.y + event.nativeEvent.layout.height,
          )
        }
      >
        <Pressable
          accessibilityRole="button"
          onPress={() => openLevel(null)}
          style={styles.crumbs}
        >
          <Text style={[styles.crumb, !districtSlug && styles.currentCrumb]}>
            {cityFeed?.city.name ?? "Lahore"}
          </Text>
          {districtSlug && (
            <Text style={[styles.crumb, styles.currentCrumb]}>
              {"  ›  "}
              {districtFeed?.district.name ?? "…"}
            </Text>
          )}
        </Pressable>
      </View>

      {levelLoaded && (
        <View style={styles.rail} pointerEvents="box-none">
          <Text style={styles.railLabel} pointerEvents="none">
            {railLabel}
          </Text>
          <GestureDetector gesture={railScrub}>
            <View
              style={styles.railDots}
              accessibilityLabel={`${children.length} ${districtSlug ? "places" : "districts"}; drag to move through them`}
              onLayout={(event) =>
                setRailHeight(event.nativeEvent.layout.height)
              }
            >
              {children.slice(0, railDotCount).map((_, index) => (
                <View
                  key={index}
                  style={[
                    styles.railDot,
                    index + heroOffset === focusedIndex && styles.railOn,
                  ]}
                />
              ))}
            </View>
          </GestureDetector>
        </View>
      )}

      {mapFailed ? (
        <View style={styles.banner}>
          <Text style={styles.body}>
            Map couldn’t load. Check your connection.
          </Text>
          <Pressable accessibilityRole="button" onPress={reloadMap}>
            <Text style={styles.link}>Reload</Text>
          </Pressable>
        </View>
      ) : levelLoaded && loadError ? (
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
        <View
          style={styles.toast}
          pointerEvents="none"
          accessibilityLiveRegion="polite"
        >
          <Text style={styles.toastText}>{notice}</Text>
        </View>
      ) : null}

      <View style={styles.footer} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Return to the start of this feed"
          onPress={() => scrollToCard(0)}
          style={styles.restart}
        >
          <Text style={styles.footerText}>↑</Text>
        </Pressable>
      </View>

      {eventID && (
        <EventDetails
          key={eventID}
          id={eventID}
          apiURL={apiURL}
          closeLabel="Back to Explore"
          source="explore"
          referrerInteractionID={
            districtAreaID ? viewedAreas.get(districtAreaID) : undefined
          }
          onClose={() => setEventID(null)}
          onEventChanged={() => setRefreshCount((value) => value + 1)}
        />
      )}
      {creating && (
        <EventForm
          place={{ id: creating.place.id, name: creating.place.name }}
          spots={creating.spots}
          apiURL={apiURL}
          onClose={() => setCreating(null)}
          onSaved={() => {
            setCreating(null);
            setRefreshCount((value) => value + 1);
          }}
        />
      )}
    </View>
  );
}

type OutlineFade = { index: number; opacity: number }[];

// Every district outline on the city feed, drawn from one source that never
// changes so a fade only updates paint. While the feed scrolls, the parent sends
// a cross-fade through `liveRef` every frame; this small component re-renders,
// not the whole screen. `null` hands back to the settled outline in `rest`.
const CityOutlines = memo(function CityOutlines({
  districts,
  rest,
  liveRef,
}: {
  districts: DistrictSummary[];
  rest: { index: number | null; opacity: number };
  liveRef: RefObject<((fades: OutlineFade | null) => void) | null>;
}) {
  const [fades, setFades] = useState<OutlineFade | null>(null);
  useEffect(() => {
    liveRef.current = setFades;
    return () => {
      liveRef.current = null;
    };
  }, [liveRef]);
  const data = useMemo<GeoJSON.FeatureCollection<GeoJSON.MultiPolygon>>(
    () => ({
      type: "FeatureCollection",
      features: districts.flatMap((district, position) =>
        district.boundary
          ? [
              {
                type: "Feature" as const,
                // Card index: the hero card comes first.
                properties: { index: position + 1 },
                geometry: district.boundary,
              },
            ]
          : [],
      ),
    }),
    [districts],
  );
  const shown =
    fades ?? (rest.index === null ? [] : [{ index: rest.index, opacity: rest.opacity }]);
  // A match needs at least one card/opacity pair; index -1 never matches.
  const [first, ...others] = shown.length
    ? shown
    : [{ index: -1, opacity: 0 }];
  const opacity = (
    scale: number,
  ): ["match", ["get", string], number, number, ...number[], number] => [
    "match",
    ["get", "index"],
    first.index,
    first.opacity * scale,
    ...others.flatMap((fade) => [fade.index, fade.opacity * scale]),
    0,
  ];
  return (
    <GeoJSONSource id="explore-city-outlines" data={data}>
      <Layer
        id="explore-city-outline-fill"
        type="fill"
        paint={{ "fill-color": "#D66A42", "fill-opacity": opacity(0.13) }}
      />
      <Layer
        id="explore-city-outline-line"
        type="line"
        paint={{
          "line-color": "#D14A35",
          "line-width": 3.5,
          "line-opacity": opacity(1),
          "line-dasharray": [2, 1.5],
        }}
      />
    </GeoJSONSource>
  );
});

// The prototype's focus marker: a name tag over a pin. It used to ripple when
// focus arrived; the ripple redrew the whole window on every frame of a level
// change's camera flight, so it was removed.
function FocusPin({ name }: { name: string | null }) {
  return (
    <View style={styles.focusPin}>
      {name && (
        <Text style={styles.pinLabel} numberOfLines={1}>
          {name}
        </Text>
      )}
      <View style={styles.pinSpot}>
        <View style={styles.pinDot} />
      </View>
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
    top: 102,
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
  rail: { position: "absolute", top: 152, left: 16, gap: 4 },
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
  // A finger-wide strip, so the dots can be held and dragged.
  railDots: { gap: 7, paddingLeft: 12, paddingVertical: 4, width: 44 },
  railDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#9FB08F",
  },
  railOn: { height: 20, backgroundColor: explore.red },
  banner: {
    position: "absolute",
    top: 152,
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
  // Short messages appear as a dark toast above the footer, as in the prototype.
  toast: {
    position: "absolute",
    bottom: footerHeight + 24,
    alignSelf: "center",
    maxWidth: "85%",
    backgroundColor: explore.ink,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  toastText: {
    fontFamily: explore.body,
    fontSize: 14,
    lineHeight: 22,
    color: explore.paper,
  },
  footer: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 14,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  footerText: {
    fontFamily: explore.bodyMedium,
    fontSize: 14,
    color: explore.ink,
  },
  levelTrack: { position: "absolute", top: 0, bottom: 0, left: 0 },
  levelPage: { position: "absolute", top: 0, bottom: 0 },
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
  pinDot: {
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: "#305C40",
    borderWidth: 3,
    borderColor: "#FFF8DF",
  },
});
