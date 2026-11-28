import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  type CameraRef,
  type LngLatBounds,
  type MapRef,
  type StyleSpecification,
} from "@maplibre/maplibre-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { explore as theme, formatStart } from "./ExploreCards";
import { loadSkinnedMapStyle, mapStyleURL } from "./exploreMap";
import {
  askForLocation,
  currentPosition,
  formatDistance,
  hasLocationPermission,
  metresBetween,
  type LngLat,
  type LocationAnswer,
} from "./location";
import { lookedEnough } from "./lookAround";
import PinSheet, {
  type Nearby,
  type PinnedPlace,
  type PinTracking,
  type PinVia,
} from "./PinSheet";

export type PickerPlace = {
  id: string;
  slug: string;
  name: string;
  type: string;
  district: string;
  coordinates: [number, number];
  events: number;
  // The kind someone typed when the type is "other".
  kindText: string | null;
  // Someone's own private place; only they get it.
  private: boolean;
};
// Where the map opens: a district's extent, a place, or the whole city.
export type PickerStart =
  { bounds: LngLatBounds } | { center: [number, number]; zoom: number } | null;
export type PickVia = "map_dot" | "list" | "search" | "pin_duplicate_check";
const sheetHeight = 320;
type UpcomingEvent = { id: string; title: string; starts_at: string };

const citySlug = "lahore";
const lahore: [number, number] = [74.34, 31.52];

// Kinds, with the colour of their dots, and the filter chips that group them the
// way people think of places.
const kinds: Record<string, [string, string]> = {
  cafe: ["Café", "#B5652C"],
  restaurant: ["Restaurant", "#C2462F"],
  park: ["Park", "#3F7D4E"],
  sports_club: ["Sports", "#1D6E8C"],
  stadium: ["Stadium", "#1D6E8C"],
  campus: ["Campus", "#355C8A"],
  culture: ["Culture", "#7A4E8C"],
  heritage: ["Heritage", "#8A6A2E"],
  mall: ["Mall", "#5C6670"],
  hotel: ["Hotel", "#6B5B95"],
  community: ["Community", "#2F7A7A"],
  exhibition: ["Exhibition", "#7A4E8C"],
};
const groups: [string, string, string[]][] = [
  ["", "All", []],
  ["cafe", "Cafés", ["cafe"]],
  ["food", "Food", ["restaurant"]],
  ["sports", "Sports", ["sports_club", "stadium"]],
  ["parks", "Parks", ["park"]],
  ["culture", "Culture", ["culture", "heritage", "exhibition"]],
  ["campus", "Campus", ["campus"]],
  ["malls", "Malls", ["mall"]],
  ["hotels", "Hotels", ["hotel"]],
  ["community", "Community", ["community"]],
];
const kindColour: unknown[] = [
  "match",
  ["get", "type"],
  ...Object.entries(kinds).flatMap(([kind, [, colour]]) => [kind, colour]),
  theme.muted,
];
const labelFont = ["Noto Sans Regular"];
const boldFont = ["Noto Sans Bold"];

// All places download once per app run (about 110 KB) and are filtered here.
// The phone's location prompt comes once someone has clearly been looking
// around (see lookedEnough). It is shown at most once per app run; ⌖ asks any time.
let askedThisRun = false;

let placesRequest: Promise<{
  places: PickerPlace[];
  districts: Record<string, string>;
}> | null = null;
function loadPlaces(apiURL: string) {
  placesRequest ??= fetch(`${apiURL}/cities/${citySlug}/places`)
    .then(async (response) => {
      if (!response.ok) throw new Error(await response.text());
      const body: {
        fields: string[];
        districts: Record<string, string>;
        places: unknown[][];
      } = await response.json();
      const at = (field: string) => body.fields.indexOf(field);
      const [id, slug, name, type, district, lng, lat, events, kindText, own] =
        [
          "id",
          "slug",
          "name",
          "type",
          "district_slug",
          "longitude",
          "latitude",
          "upcoming_event_count",
          "kind_text",
          "private",
        ].map(at);
      return {
        districts: body.districts,
        places: body.places.map((row) => ({
          id: row[id] as string,
          slug: row[slug] as string,
          name: row[name] as string,
          type: row[type] as string,
          district: row[district] as string,
          coordinates: [row[lng], row[lat]] as [number, number],
          events: row[events] as number,
          kindText: (row[kindText] as string | null) ?? null,
          private: row[own] === true,
        })),
      };
    })
    .catch((failure) => {
      placesRequest = null;
      throw failure;
    });
  return placesRequest;
}

// A new pin's place is missing from the downloaded list until it is fetched again.
export function forgetPickerPlaces() {
  placesRequest = null;
}

export function kindName(type: string, kindText?: string | null) {
  return (type === "other" && kindText) || kinds[type]?.[0] || "Place";
}

export default function PlacePicker({
  apiURL,
  start,
  onPick,
  onBack,
  onLocationAnswered,
  onPinned,
}: {
  apiURL: string;
  start: PickerStart;
  onPick: (
    place: PickerPlace,
    districtName: string,
    via: PickVia,
    position: number | null,
    resultCount: number,
    query: string,
    locationOn: boolean,
  ) => void;
  // Left without picking: how many places the list showed, and what was typed.
  onBack: (resultCount: number, query: string, locationOn: boolean) => void;
  // The phone's location prompt was shown and answered.
  onLocationAnswered: (answer: LocationAnswer) => void;
  // A new place was pinned and named; it is created with the event.
  onPinned: (
    place: PinnedPlace,
    district: { slug: string; name: string },
    tracking: PinTracking,
    locationOn: boolean,
  ) => void;
}) {
  const camera = useRef<CameraRef>(null);
  const map = useRef<MapRef>(null);
  const [mapStyle, setMapStyle] = useState<StyleSpecification | null>(null);
  const [data, setData] = useState<{
    places: PickerPlace[];
    districts: Record<string, string>;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [group, setGroup] = useState("");
  const [bounds, setBounds] = useState<LngLatBounds | null>(null);
  const [selected, setSelected] = useState<{
    place: PickerPlace;
    via: PickVia;
    position: number | null;
  } | null>(null);
  // What was typed, and the server's ranked results for it.
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<{
    query: string;
    ids: string[];
    count: number;
  } | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const typed = query.trim();
  // Where the phone is, once allowed; used only to order and measure.
  const [here, setHere] = useState<LngLat | null>(null);
  const [locationBlocked, setLocationBlocked] = useState(false);
  const looked = useRef({ swipes: 0, map: 0, lastMap: 0, asking: false });
  // Dropping a pin: placing it (the map moves under a fixed pin), then naming it.
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [pin, setPin] = useState<{
    via: PinVia;
    stage: "placing" | "naming";
    at: LngLat | null;
    district: { slug: string; name: string } | null;
    checking: boolean;
  } | null>(null);
  const pinLookup = useRef<AbortController | null>(null);
  // Where the fixed pin points: the middle of the map between the top bar and the sheet.
  const pinPoint: [number, number] | null = size.height
    ? [size.width / 2, 150 + (size.height - sheetHeight - 150) / 2]
    : null;

  // The spot under the pin, and which district of the city it is in.
  async function locatePin() {
    if (!pinPoint || !map.current) return;
    pinLookup.current?.abort();
    const controller = new AbortController();
    pinLookup.current = controller;
    try {
      const at = (await map.current.unproject(pinPoint)) as LngLat;
      setPin((current) => current && { ...current, at, checking: true });
      const response = await fetch(
        `${apiURL}/cities/${citySlug}/places/nearby?lng=${at[0].toFixed(6)}&lat=${at[1].toFixed(6)}`,
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error();
      const body: { district: { slug: string; name: string } | null } =
        await response.json();
      setPin(
        (current) =>
          current && { ...current, district: body.district, checking: false },
      );
    } catch {
      if (!controller.signal.aborted)
        setPin((current) => current && { ...current, checking: false });
    }
  }
  async function startPin(via: PinVia, pressed?: { point: [number, number] }) {
    setSelected(null);
    setPin({ via, stage: "placing", at: null, district: null, checking: true });
    if (pressed && pinPoint && map.current) {
      // Slide the map so the pressed spot sits under the pin.
      const center = (await map.current.unproject([
        size.width / 2 + (pressed.point[0] - pinPoint[0]),
        size.height / 2 + (pressed.point[1] - pinPoint[1]),
      ])) as LngLat;
      camera.current?.easeTo({ center, duration: 350 });
    } else void locatePin();
  }
  function fromNearby(place: Nearby): PickerPlace {
    return {
      id: place.id,
      slug: place.slug,
      name: place.name,
      type: place.type,
      district: place.district.slug,
      coordinates: place.coordinates,
      events: 0,
      kindText: place.kind_text,
      private: place.private,
    };
  }

  // Already allowed: no prompt, just find the phone.
  useEffect(() => {
    let active = true;
    hasLocationPermission()
      .then((granted) => (granted ? currentPosition() : null))
      .then((position) => {
        if (active && position) setHere(position);
      });
    return () => {
      active = false;
    };
  }, []);

  async function askLocation(flyTo: boolean) {
    if (looked.current.asking) return;
    looked.current.asking = true;
    askedThisRun = true;
    const result = await askForLocation();
    looked.current.asking = false;
    if (result.answer) onLocationAnswered(result.answer);
    setLocationBlocked(result.blocked);
    if (!result.granted) return;
    const position = await currentPosition();
    if (!position) return;
    setHere(position);
    if (flyTo)
      camera.current?.easeTo({ center: position, zoom: 14.5, duration: 600 });
  }
  function lookedAround(kind: "swipes" | "map") {
    if (here || askedThisRun || looked.current.asking) return;
    // The map reports one drag or pinch more than once (as it starts, and
    // again as it glides to a stop), so map events this close are one touch.
    if (kind === "map") {
      const now = Date.now();
      const sameTouch = now - looked.current.lastMap < 800;
      looked.current.lastMap = now;
      if (sameTouch) return;
    }
    looked.current[kind] += 1;
    if (lookedEnough(looked.current.swipes, looked.current.map))
      // Fly to the phone only if nothing is picked or searched for yet.
      void askLocation(!selected && !typed);
  }
  function locate() {
    if (here) camera.current?.easeTo({ center: here, zoom: 15, duration: 500 });
    else if (locationBlocked) void Linking.openSettings();
    else void askLocation(true);
  }
  // While typing, the last results stay up until the new ones arrive.
  const results = typed ? search : null;
  // The next events at the place on the card, so the host sees what is on.
  const [upcoming, setUpcoming] = useState<{
    id: string;
    events: UpcomingEvent[];
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadSkinnedMapStyle(mapStyleURL, controller.signal)
      .then(setMapStyle)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    loadPlaces(apiURL)
      .then((loaded) => {
        if (!controller.signal.aborted) setData(loaded);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [apiURL, attempt]);

  const byID = useMemo(
    () =>
      new globalThis.Map(
        (data?.places ?? []).map((place) => [place.id, place]),
      ),
    [data],
  );
  // Search ranks across all of Lahore, a moment after typing stops. Results
  // are matched to the downloaded places so dots and the card have everything.
  useEffect(() => {
    if (!typed || !data) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(
        `${apiURL}/cities/${citySlug}/places/search?q=${encodeURIComponent(typed)}&limit=50${here ? `&near=${here[0].toFixed(5)},${here[1].toFixed(5)}` : ""}`,
        { signal: controller.signal },
      )
        .then((response) =>
          response.ok ? response.json() : Promise.reject(new Error()),
        )
        .then((body: { result_count: number; places: { id: string }[] }) => {
          const ids = body.places
            .map((place) => place.id)
            .filter((id) => byID.has(id));
          setSearch({ query: typed, ids, count: body.result_count });
          setSearching(false);
          setSearchFailed(false);
          // Fly to the best match, or fit the best few.
          const top = ids.slice(0, 8).map((id) => byID.get(id)!);
          if (top.length === 1)
            camera.current?.easeTo({
              center: top[0].coordinates,
              zoom: 15,
              duration: 500,
            });
          else if (top.length > 1) {
            const lngs = top.map((place) => place.coordinates[0]);
            const lats = top.map((place) => place.coordinates[1]);
            camera.current?.fitBounds(
              [
                Math.min(...lngs),
                Math.min(...lats),
                Math.max(...lngs),
                Math.max(...lats),
              ],
              {
                // Clear of the top bar, and of the list and the map buttons above it.
                padding: { top: 170, bottom: 420, left: 50, right: 50 },
                duration: 500,
              },
            );
          }
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setSearching(false);
          setSearchFailed(true);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [apiURL, typed, data, byID, here]);

  useEffect(() => {
    const place = selected?.place;
    if (!place || place.events === 0) return;
    const controller = new AbortController();
    fetch(
      `${apiURL}/cities/${citySlug}/districts/${place.district}/places/${place.slug}`,
      { signal: controller.signal },
    )
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error()),
      )
      .then((view: { events: UpcomingEvent[] }) =>
        setUpcoming({ id: place.id, events: view.events.slice(0, 2) }),
      )
      .catch(() => {});
    return () => controller.abort();
  }, [apiURL, selected?.place]);

  function changeQuery(text: string) {
    setQuery(text);
    setSelected(null);
    setSearchFailed(false);
    setSearching(!!text.trim());
    if (!text.trim()) setSearch(null);
  }

  const members = groups.find(([key]) => key === group)?.[2] ?? [];
  const shown = useMemo(
    () =>
      (results
        ? results.ids.map((id) => byID.get(id)!)
        : (data?.places ?? [])
      ).filter((place) => members.length === 0 || members.includes(place.type)),
    // members follows group.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, group, results, byID],
  );
  // Places with something on stand out; the rest are quiet and cluster when far out.
  const [busy, quiet] = useMemo(() => {
    const feature = (place: PickerPlace) => ({
      type: "Feature" as const,
      id: place.id,
      geometry: { type: "Point" as const, coordinates: place.coordinates },
      properties: { id: place.id, name: place.name, type: place.type },
    });
    return [
      {
        type: "FeatureCollection" as const,
        features: shown.filter((place) => place.events > 0).map(feature),
      },
      {
        type: "FeatureCollection" as const,
        features: shown.filter((place) => place.events === 0).map(feature),
      },
    ];
  }, [shown]);
  // The list under the map: search results in rank order, otherwise the
  // places in view with ones that have something on first.
  const inView = useMemo(() => {
    if (results) return shown;
    if (!bounds) return [];
    const [west, south, east, north] = bounds;
    return shown
      .filter(
        ({ coordinates: [lng, lat] }) =>
          lng >= west && lng <= east && lat >= south && lat <= north,
      )
      .sort((a, b) => b.events - a.events || a.name.localeCompare(b.name));
  }, [shown, bounds, results]);
  const selectedShape = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: selected
        ? [
            {
              type: "Feature" as const,
              geometry: {
                type: "Point" as const,
                coordinates: selected.place.coordinates,
              },
              properties: { type: selected.place.type },
            },
          ]
        : [],
    }),
    [selected],
  );

  function select(place: PickerPlace, via: PickVia, position: number | null) {
    setSelected({ place, via, position });
    camera.current?.easeTo({
      center: place.coordinates,
      zoom: 15.5,
      duration: 450,
    });
  }
  function pressPlace(event: { nativeEvent: { features: GeoJSON.Feature[] } }) {
    if (pin) return;
    const id = event.nativeEvent.features[0]?.properties?.id;
    const place = data?.places.find((candidate) => candidate.id === id);
    if (place) select(place, "map_dot", null);
  }
  function back() {
    if (pin?.stage === "naming") setPin({ ...pin, stage: "placing" });
    else if (pin) setPin(null);
    else if (selected) setSelected(null);
    else onBack(inView.length, typed, !!here);
  }

  const initialViewState = !start
    ? { center: lahore, zoom: 10.6 }
    : "bounds" in start
      ? {
          bounds: start.bounds,
          padding: { top: 150, bottom: 410, left: 24, right: 24 },
        }
      : { center: start.center, zoom: start.zoom };
  const districtName = (place: PickerPlace) =>
    data?.districts[place.district] ?? "";

  return (
    <Modal visible animationType="slide" onRequestClose={back}>
      <View
        style={styles.root}
        onLayout={(event) => setSize(event.nativeEvent.layout)}
      >
        {mapStyle && (
          <Map
            ref={map}
            mapStyle={mapStyle}
            style={StyleSheet.absoluteFill}
            compass={false}
            touchPitch={false}
            touchRotate={false}
            attributionPosition={{ bottom: 330, right: 8 }}
            logoPosition={{ bottom: 330, left: 8 }}
            onRegionDidChange={(event) => {
              setBounds(event.nativeEvent.bounds);
              if (pin?.stage === "placing") void locatePin();
            }}
            onLongPress={(event) => {
              if (!pin)
                void startPin("long_press", {
                  point: event.nativeEvent.point as [number, number],
                });
            }}
            // Each pan, pinch or zoom a person starts, and each tap, counts
            // towards asking for location.
            onRegionWillChange={(event) => {
              if (event.nativeEvent.userInteraction) lookedAround("map");
            }}
            onPress={() => lookedAround("map")}
            // The list needs the first view too, before anyone moves the map.
            onDidFinishLoadingMap={() =>
              map.current
                ?.getViewState()
                .then((view) => setBounds(view.bounds))
                .catch(() => {})
            }
            onDidFailLoadingMap={() => setFailed(true)}
          >
            <Camera
              ref={camera}
              initialViewState={initialViewState}
              minZoom={9}
              maxZoom={18}
            />
            <GeoJSONSource
              id="picker-quiet"
              data={quiet}
              cluster
              clusterRadius={44}
              clusterMaxZoom={14}
              onPress={(event) => {
                const feature = event.nativeEvent.features[0];
                if (feature?.properties?.cluster) {
                  const [lng, lat] = (feature.geometry as GeoJSON.Point)
                    .coordinates;
                  camera.current?.easeTo({
                    center: [lng, lat],
                    zoom: Math.min(18, (bounds ? zoomFor(bounds) : 12) + 2),
                    duration: 400,
                  });
                } else pressPlace(event);
              }}
            >
              <Layer
                id="picker-cluster"
                type="circle"
                filter={["has", "point_count"]}
                paint={{
                  "circle-color": theme.ink,
                  "circle-opacity": 0.72,
                  "circle-radius": [
                    "step",
                    ["get", "point_count"],
                    13,
                    20,
                    17,
                    80,
                    21,
                  ],
                  "circle-stroke-color": theme.cream,
                  "circle-stroke-width": 2,
                }}
              />
              <Layer
                id="picker-cluster-count"
                type="symbol"
                filter={["has", "point_count"]}
                layout={{
                  "text-field": ["get", "point_count_abbreviated"],
                  "text-font": boldFont,
                  "text-size": 12,
                  "text-allow-overlap": true,
                }}
                paint={{ "text-color": theme.cream }}
              />
              <Layer
                id="picker-quiet-dot"
                type="circle"
                filter={["!", ["has", "point_count"]]}
                paint={{
                  "circle-color": kindColour as never,
                  "circle-radius": 5.5,
                  "circle-stroke-color": "#FFFFFF",
                  "circle-stroke-width": 1.5,
                }}
              />
              <Layer
                id="picker-quiet-label"
                type="symbol"
                minzoom={15}
                filter={["!", ["has", "point_count"]]}
                layout={{
                  "text-field": ["get", "name"],
                  "text-font": labelFont,
                  "text-size": 11,
                  "text-anchor": "left",
                  "text-offset": [0.8, 0],
                  "text-optional": true,
                }}
                paint={{
                  "text-color": theme.ink,
                  "text-halo-color": theme.cream,
                  "text-halo-width": 1.5,
                }}
              />
            </GeoJSONSource>
            <GeoJSONSource id="picker-busy" data={busy} onPress={pressPlace}>
              <Layer
                id="picker-busy-dot"
                type="circle"
                paint={{
                  "circle-color": theme.red,
                  "circle-radius": 8,
                  "circle-stroke-color": theme.cream,
                  "circle-stroke-width": 2.5,
                }}
              />
              <Layer
                id="picker-busy-label"
                type="symbol"
                minzoom={11.5}
                layout={{
                  "text-field": ["get", "name"],
                  "text-font": boldFont,
                  "text-size": 12,
                  "text-anchor": "left",
                  "text-offset": [0.9, 0],
                  "text-optional": true,
                }}
                paint={{
                  "text-color": theme.ink,
                  "text-halo-color": theme.cream,
                  "text-halo-width": 1.8,
                }}
              />
            </GeoJSONSource>
            {here && (
              <GeoJSONSource
                id="picker-you"
                data={{
                  type: "Feature",
                  geometry: { type: "Point", coordinates: here },
                  properties: {},
                }}
              >
                <Layer
                  id="picker-you-halo"
                  type="circle"
                  paint={{
                    "circle-color": "rgba(43, 108, 232, 0.18)",
                    "circle-radius": 16,
                  }}
                />
                <Layer
                  id="picker-you-dot"
                  type="circle"
                  paint={{
                    "circle-color": "#2B6CE8",
                    "circle-radius": 7,
                    "circle-stroke-color": "#FFFFFF",
                    "circle-stroke-width": 2.5,
                  }}
                />
              </GeoJSONSource>
            )}
            <GeoJSONSource id="picker-selected" data={selectedShape}>
              <Layer
                id="picker-selected-ring"
                type="circle"
                paint={{
                  "circle-color": "rgba(227, 52, 47, 0.18)",
                  "circle-radius": 20,
                }}
              />
              <Layer
                id="picker-selected-dot"
                type="circle"
                paint={{
                  "circle-color": theme.red,
                  "circle-radius": 10,
                  "circle-stroke-color": "#FFFFFF",
                  "circle-stroke-width": 3,
                }}
              />
            </GeoJSONSource>
          </Map>
        )}

        <View style={styles.top} pointerEvents="box-none">
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                selected ? "Back to the list" : "Back to the form"
              }
              onPress={back}
              style={styles.back}
            >
              <Text style={styles.backText}>‹</Text>
            </Pressable>
            <View style={styles.searchPill}>
              <View style={styles.searchText}>
                <Text style={styles.kicker}>WHERE</Text>
                <TextInput
                  accessibilityLabel="Search places in Lahore"
                  value={query}
                  onChangeText={changeQuery}
                  placeholder="Search places in Lahore"
                  placeholderTextColor={theme.muted}
                  returnKeyType="search"
                  autoCorrect={false}
                  maxLength={100}
                  style={styles.searchInput}
                />
              </View>
              {searching ? (
                <ActivityIndicator color={theme.red} />
              ) : query ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  onPress={() => changeQuery("")}
                  hitSlop={10}
                  style={styles.clear}
                >
                  <Text style={styles.clearText}>×</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            keyboardShouldPersistTaps="handled"
          >
            {groups.map(([key, label]) => (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityState={{ selected: group === key }}
                onPress={() => {
                  setGroup(key);
                  setSelected(null);
                }}
                style={[styles.chip, group === key && styles.chipOn]}
              >
                <Text
                  style={[styles.chipText, group === key && styles.chipTextOn]}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {pin?.stage === "placing" && pinPoint && (
          <View
            pointerEvents="none"
            style={[
              styles.pinMarker,
              { left: pinPoint[0] - 16, top: pinPoint[1] - 40 },
            ]}
          >
            <View style={styles.pinHead}>
              <View style={styles.pinHole} />
            </View>
            <View style={styles.pinShadow} />
          </View>
        )}

        <View style={styles.locateRow} pointerEvents="box-none">
          {locationBlocked && !here && (
            <Text style={styles.locateNote}>
              Location is off for Join Me. Tap ⌖ to open Settings.
            </Text>
          )}
          {!pin && data && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Drop a pin"
              onPress={() => void startPin("pin_button")}
              style={({ pressed }) => [
                styles.locate,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.pinButtonHead}>
                <View style={styles.pinButtonHole} />
              </View>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={here ? "Show where I am" : "Use my location"}
            onPress={locate}
            style={({ pressed }) => [styles.locate, pressed && styles.pressed]}
          >
            <Text style={[styles.locateText, here && styles.locateOn]}>⌖</Text>
          </Pressable>
        </View>

        <View
          style={[
            styles.sheet,
            pin?.stage === "naming" && {
              height: Math.min(600, size.height * 0.78),
            },
          ]}
        >
          <View style={styles.handle} />
          {pin?.stage === "naming" && pin.at && pin.district ? (
            <PinSheet
              apiURL={apiURL}
              citySlug={citySlug}
              coordinates={pin.at}
              districtName={pin.district.name}
              via={pin.via}
              initialName={pin.via === "cant_find" ? typed : ""}
              onUseExisting={(place, suggested, name) => {
                const existing = byID.get(place.id) ?? fromNearby(place);
                onPick(
                  existing,
                  place.district.name,
                  "pin_duplicate_check",
                  null,
                  suggested,
                  name,
                  !!here,
                );
              }}
              onDone={(place, tracking) =>
                pin.district && onPinned(place, pin.district, tracking, !!here)
              }
              onCancel={() => setPin({ ...pin, stage: "placing" })}
            />
          ) : pin ? (
            <View style={styles.card}>
              <Text style={styles.cardKicker}>DROP A PIN</Text>
              <Text style={styles.cardName} numberOfLines={1}>
                {pin.checking && !pin.district
                  ? "Finding the spot…"
                  : pin.district
                    ? `In ${pin.district.name}`
                    : "Outside Lahore"}
              </Text>
              <Text style={styles.muted}>
                {pin.district || pin.checking
                  ? "Move the map so the pin sits on the spot."
                  : "Pins must be inside Lahore. Move the map back in."}
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={!pin.district || pin.checking}
                onPress={() => setPin({ ...pin, stage: "naming" })}
                style={({ pressed }) => [
                  styles.use,
                  (!pin.district || pin.checking) && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.useText}>Pin it here</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setPin(null)}
                style={styles.secondary}
              >
                <Text style={styles.action}>Cancel</Text>
              </Pressable>
            </View>
          ) : failed ? (
            <View style={styles.message}>
              <Text style={styles.body}>Could not load the map or places.</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setFailed(false);
                  setAttempt((value) => value + 1);
                }}
              >
                <Text style={styles.action}>Try again</Text>
              </Pressable>
            </View>
          ) : !data || !mapStyle ? (
            <View style={styles.message}>
              <ActivityIndicator color={theme.red} />
            </View>
          ) : selected ? (
            <View style={styles.card}>
              <Text style={styles.cardKicker}>
                {kindName(
                  selected.place.type,
                  selected.place.kindText,
                ).toUpperCase()}{" "}
                · {districtName(selected.place).toUpperCase()}
                {here &&
                  ` · ${formatDistance(metresBetween(here, selected.place.coordinates)).toUpperCase()} AWAY`}
              </Text>
              <Text style={styles.cardName} numberOfLines={2}>
                {selected.place.name}
              </Text>
              <Text style={styles.muted}>
                {selected.place.events > 0
                  ? `${selected.place.events} ${selected.place.events === 1 ? "thing" : "things"} on here this week`
                  : "Nothing on here yet. Be the first."}
              </Text>
              {upcoming?.id === selected.place.id &&
                upcoming.events.map((event) => (
                  <View key={event.id} style={styles.upcoming}>
                    <View style={styles.upcomingDot} />
                    <Text style={styles.upcomingTitle} numberOfLines={1}>
                      {event.title}
                    </Text>
                    <Text style={styles.upcomingTime}>
                      {formatStart(event.starts_at)}
                    </Text>
                  </View>
                ))}
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  onPick(
                    selected.place,
                    districtName(selected.place),
                    selected.via,
                    selected.position,
                    inView.length,
                    typed,
                    !!here,
                  )
                }
                style={({ pressed }) => [styles.use, pressed && styles.pressed]}
              >
                <Text style={styles.useText}>Use this place</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setSelected(null)}
                style={styles.secondary}
              >
                <Text style={styles.action}>Back to the list</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={styles.count}>
                {searchFailed
                  ? "Search did not work. Check the connection."
                  : typed && !results
                    ? "Searching…"
                    : results && inView.length === 0
                      ? `Nothing matches “${typed}”. Try another spelling.`
                      : results
                        ? `${inView.length} ${inView.length === 1 ? "match" : "matches"} for “${typed}”`
                        : inView.length === 0
                          ? "No places here. Move the map or pick another kind."
                          : `${inView.length} ${inView.length === 1 ? "place" : "places"} in view`}
              </Text>
              <FlatList
                // New search results start at the top, not where the last list was scrolled.
                key={results ? `search:${results.query}` : "in-view"}
                data={inView}
                keyExtractor={(place) => place.id}
                initialNumToRender={12}
                windowSize={7}
                keyboardShouldPersistTaps="handled"
                onScrollBeginDrag={() => lookedAround("swipes")}
                // Not on the map: drop a pin, named after what was searched.
                ListFooterComponent={
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void startPin("cant_find")}
                    style={({ pressed }) => [
                      styles.row,
                      styles.pinRow,
                      pressed && styles.rowPressed,
                    ]}
                  >
                    <View style={styles.pinRowIcon}>
                      <View style={styles.pinButtonHead}>
                        <View style={styles.pinButtonHole} />
                      </View>
                    </View>
                    <View style={styles.rowText}>
                      <Text style={styles.rowName}>
                        Can&apos;t find it? Drop a pin
                      </Text>
                      <Text style={styles.rowSub}>
                        Add the place yourself. It goes live with your plan.
                      </Text>
                    </View>
                  </Pressable>
                }
                renderItem={({ item, index }) => (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      select(item, results ? "search" : "list", index + 1)
                    }
                    style={({ pressed }) => [
                      styles.row,
                      pressed && styles.rowPressed,
                    ]}
                  >
                    <View
                      style={[
                        styles.dot,
                        {
                          backgroundColor:
                            item.events > 0
                              ? theme.red
                              : (kinds[item.type]?.[1] ?? theme.muted),
                        },
                      ]}
                    />
                    <View style={styles.rowText}>
                      <Text style={styles.rowName} numberOfLines={1}>
                        <Highlighted text={item.name} query={typed} />
                      </Text>
                      <Text style={styles.rowSub} numberOfLines={1}>
                        {kindName(item.type, item.kindText)} ·{" "}
                        {districtName(item)}
                        {here &&
                          ` · ${formatDistance(metresBetween(here, item.coordinates))}`}
                        {item.private && (
                          <Text style={styles.yours}> · Your place</Text>
                        )}
                        {item.events > 0 && (
                          <Text style={styles.happening}> · On this week</Text>
                        )}
                      </Text>
                    </View>
                  </Pressable>
                )}
              />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

// The typed text in bold red inside a result's name, where it appears as typed.
function Highlighted({ text, query }: { text: string; query: string }) {
  const at =
    query.length >= 2 ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <Text style={styles.match}>{text.slice(at, at + query.length)}</Text>
      {text.slice(at + query.length)}
    </>
  );
}

// Web Mercator zoom from the visible longitude span, for zooming into a cluster.
function zoomFor([west, , east]: LngLatBounds) {
  return Math.log2((360 / Math.max(east - west, 1e-6)) * 0.75);
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#EEE9D9" },
  top: { position: "absolute", top: 0, left: 0, right: 0, paddingTop: 44 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
  },
  back: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: theme.cream,
    borderWidth: 1,
    borderColor: theme.line,
    alignItems: "center",
    justifyContent: "center",
  },
  backText: {
    fontFamily: theme.bodyBold,
    fontSize: 30,
    lineHeight: 34,
    color: theme.ink,
    marginTop: -3,
  },
  locateRow: {
    position: "absolute",
    right: 16,
    left: 16,
    bottom: 334,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
  },
  locate: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.cream,
    borderWidth: 1,
    borderColor: theme.line,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#203E30",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  locateText: {
    fontFamily: theme.bodyBold,
    fontSize: 24,
    lineHeight: 28,
    color: theme.ink,
  },
  locateOn: { color: "#2B6CE8" },
  locateNote: {
    flexShrink: 1,
    fontFamily: theme.bodyMedium,
    fontSize: 12,
    color: theme.ink,
    backgroundColor: theme.cream,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    overflow: "hidden",
  },
  searchPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: theme.cream,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: theme.line,
    paddingLeft: 16,
    paddingRight: 14,
    paddingTop: 6,
    paddingBottom: 2,
  },
  searchText: { flex: 1 },
  searchInput: {
    fontFamily: theme.bodyBold,
    fontSize: 16,
    color: theme.ink,
    padding: 0,
    paddingBottom: 4,
  },
  clear: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: theme.sage,
    alignItems: "center",
    justifyContent: "center",
  },
  clearText: {
    fontFamily: theme.bodyBold,
    fontSize: 17,
    lineHeight: 20,
    color: theme.ink,
  },
  match: { color: theme.red },
  upcoming: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: theme.cream,
    borderWidth: 1,
    borderColor: theme.line,
  },
  upcomingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: theme.red,
  },
  upcomingTitle: {
    flex: 1,
    fontFamily: theme.bodyBold,
    fontSize: 13,
    color: theme.ink,
  },
  upcomingTime: { fontFamily: theme.body, fontSize: 12, color: theme.muted },
  kicker: {
    fontFamily: theme.bodyBold,
    fontSize: 9,
    letterSpacing: 1.4,
    color: theme.red,
  },
  chips: { gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: theme.cream,
    borderWidth: 1,
    borderColor: theme.line,
  },
  chipOn: { backgroundColor: theme.ink, borderColor: theme.ink },
  chipText: { fontFamily: theme.bodyBold, fontSize: 13, color: theme.ink },
  chipTextOn: { color: theme.cream },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 320,
    backgroundColor: theme.paper,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: theme.line,
    paddingTop: 8,
    shadowColor: "#203E30",
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: -4 },
    elevation: 10,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.line,
    marginBottom: 8,
  },
  count: {
    fontFamily: theme.bodyBold,
    fontSize: 11,
    letterSpacing: 1.2,
    color: theme.muted,
    paddingHorizontal: 22,
    paddingBottom: 6,
    textTransform: "uppercase",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: "#EDE8D6",
  },
  rowPressed: { backgroundColor: theme.cream },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  rowText: { flex: 1, gap: 2 },
  rowName: { fontFamily: theme.bodyBold, fontSize: 15, color: theme.ink },
  rowSub: { fontFamily: theme.body, fontSize: 12, color: theme.muted },
  yours: { fontFamily: theme.bodyBold, color: theme.ink },
  pinRow: { borderBottomWidth: 0, paddingVertical: 16 },
  pinRowIcon: { width: 12, alignItems: "center" },
  // The dropped pin: a red teardrop whose tip marks the spot.
  pinMarker: { position: "absolute", width: 32, alignItems: "center" },
  pinHead: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderBottomRightRadius: 0,
    backgroundColor: theme.red,
    borderWidth: 3,
    borderColor: "#FFFFFF",
    transform: [{ rotate: "45deg" }],
    alignItems: "center",
    justifyContent: "center",
  },
  pinHole: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "#FFFFFF",
  },
  pinShadow: {
    marginTop: 4,
    width: 10,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(32, 62, 48, 0.35)",
  },
  pinButtonHead: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderBottomRightRadius: 0,
    backgroundColor: theme.red,
    transform: [{ rotate: "45deg" }],
    alignItems: "center",
    justifyContent: "center",
  },
  pinButtonHole: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: theme.cream,
  },
  disabled: { opacity: 0.45 },
  happening: { fontFamily: theme.bodyBold, color: theme.red },
  message: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  body: { fontFamily: theme.body, fontSize: 15, color: theme.ink },
  action: { fontFamily: theme.bodyBold, fontSize: 15, color: theme.ink },
  card: { paddingHorizontal: 22, paddingTop: 6, gap: 8 },
  cardKicker: {
    fontFamily: theme.bodyBold,
    fontSize: 10,
    letterSpacing: 1.4,
    color: theme.red,
  },
  cardName: {
    fontFamily: theme.display,
    fontSize: 34,
    lineHeight: 36,
    color: theme.ink,
  },
  muted: { fontFamily: theme.body, fontSize: 14, color: theme.muted },
  use: {
    marginTop: 8,
    backgroundColor: theme.red,
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: "center",
  },
  pressed: { transform: [{ scale: 0.98 }] },
  useText: { fontFamily: theme.bodyBold, fontSize: 16, color: theme.cream },
  secondary: { alignItems: "center", paddingVertical: 12 },
});
