import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  type CameraRef,
  type GeoJSONSourceRef,
  type LngLatBounds,
} from "@maplibre/maplibre-react-native";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
const mapStyle =
  process.env.EXPO_PUBLIC_MAP_STYLE_URL ??
  "https://tiles.openfreemap.org/styles/liberty";
const emptyPlaces: Places = {
  type: "FeatureCollection",
  features: [],
  truncated: false,
};

export default function MapScreen() {
  const camera = useRef<CameraRef>(null);
  const deviceLocation = useDeviceLocation();
  const centreOnNextLocation = useRef(false);
  const placeSource = useRef<GeoJSONSourceRef>(null);
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
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [mapVersion, setMapVersion] = useState(0);
  const mapPlaces = {
    ...places,
    features: places.features.map((place) => ({
      ...place,
      properties: {
        ...place.properties,
        event_count: events.place_counts[place.properties.id] ?? 0,
      },
    })),
  };
  const placeEvents = events.events.filter(
    (event) => event.place.id === selected?.properties.id,
  );
  const coordinates = deviceLocation.position?.coords;
  // MapLibre uses a 512-pixel world at zoom zero; convert GPS metres to pixels.
  const accuracyAtZoomZero = coordinates
    ? (coordinates.accuracy ?? 0) /
      (78271.51696 *
        Math.cos(
          (Math.min(85, Math.abs(coordinates.latitude)) * Math.PI) / 180,
        ))
    : 0;

  useEffect(() => {
    if (!deviceLocation.position || !mapLoaded || !centreOnNextLocation.current)
      return;
    centreOnNextLocation.current = false;
    camera.current?.easeTo({
      center: [
        deviceLocation.position.coords.longitude,
        deviceLocation.position.coords.latitude,
      ],
      zoom: 16,
      duration: 0,
    });
  }, [deviceLocation.position, mapLoaded]);

  function showMyLocation() {
    setSelected(null);
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

  useEffect(() => {
    if (!area || mapLoaded || mapError) return;
    const timeout = setTimeout(() => setMapError(true), 20000);
    return () => clearTimeout(timeout);
  }, [area, mapLoaded, mapError, mapVersion]);

  function recentre() {
    centreOnNextLocation.current = false;
    setSelected(null);
    if (area?.bbox)
      camera.current?.fitBounds(area.bbox, {
        duration: 0,
        padding: { top: 120, right: 40, bottom: 130, left: 40 },
      });
  }

  return (
    <View style={styles.root}>
      {area?.bbox && (
        <Map
          key={mapVersion}
          mapStyle={mapStyle}
          style={StyleSheet.absoluteFill}
          attributionPosition={{ bottom: 8, left: 8 }}
          logoPosition={{ bottom: 8, right: 8 }}
          onPress={() => setSelected(null)}
          onRegionDidChange={(event) => setBounds(event.nativeEvent.bounds)}
          onDidFinishLoadingStyle={() => {
            setMapLoaded(true);
            setMapError(false);
          }}
          onDidFinishLoadingMap={() => {
            setMapLoaded(true);
            setMapError(false);
          }}
          onDidFailLoadingMap={() => {
            setMapLoaded(false);
            setMapError(true);
          }}
        >
          <Camera
            ref={camera}
            initialViewState={{
              bounds: area.bbox,
              padding: { top: 120, right: 40, bottom: 130, left: 40 },
            }}
          />
          {area.boundary && (
            <GeoJSONSource
              id="campus-outline"
              data={{
                type: "Feature",
                properties: {},
                geometry: area.boundary,
              }}
            >
              <Layer
                id="campus-fill"
                type="fill"
                paint={{ "fill-color": "#1D5B3A", "fill-opacity": 0.06 }}
              />
              <Layer
                id="campus-line"
                type="line"
                paint={{
                  "line-color": "#1D5B3A",
                  "line-width": 2,
                  "line-dasharray": [3, 2],
                }}
              />
            </GeoJSONSource>
          )}
          {selected?.properties.boundary && (
            <GeoJSONSource
              id="selected-outline"
              data={{
                type: "Feature",
                properties: {},
                geometry: selected.properties.boundary,
              }}
            >
              <Layer
                id="selected-fill"
                type="fill"
                paint={{ "fill-color": "#E3342F", "fill-opacity": 0.18 }}
              />
              <Layer
                id="selected-line"
                type="line"
                paint={{ "line-color": "#E3342F", "line-width": 2 }}
              />
            </GeoJSONSource>
          )}
          <GeoJSONSource
            ref={placeSource}
            id="places"
            data={mapPlaces}
            cluster
            clusterRadius={42}
            clusterMaxZoom={15}
            onPress={async (event) => {
              event.stopPropagation();
              const feature = event.nativeEvent.features[0];
              if (!feature) return;
              if (
                feature.properties?.cluster &&
                feature.geometry.type === "Point"
              ) {
                const zoom = await placeSource.current?.getClusterExpansionZoom(
                  feature.properties.cluster_id,
                );
                if (zoom !== undefined)
                  camera.current?.easeTo({
                    center: feature.geometry.coordinates as [number, number],
                    zoom,
                    duration: 250,
                  });
              } else {
                setSelected(
                  places.features.find((place) => place.id === feature.id) ??
                    null,
                );
              }
            }}
          >
            <Layer
              id="clusters"
              type="circle"
              filter={["has", "point_count"]}
              paint={{
                "circle-radius": 24,
                "circle-color": "#1D5B3A",
                "circle-stroke-color": "#F4F5F0",
                "circle-stroke-width": 3,
              }}
            />
            <Layer
              id="cluster-count"
              type="symbol"
              filter={["has", "point_count"]}
              layout={{
                "text-field": [
                  "concat",
                  ["to-string", ["get", "point_count_abbreviated"]],
                  "\nplaces",
                ],
                "text-font": ["Noto Sans Regular"],
                "text-size": 11,
              }}
              paint={{ "text-color": "#FFFFFF" }}
            />
            <Layer
              id="ground-pins"
              type="circle"
              filter={["!", ["has", "point_count"]]}
              paint={{
                "circle-radius": [
                  "case",
                  ["==", ["get", "id"], selected?.properties.id ?? ""],
                  16,
                  13,
                ],
                "circle-color": [
                  "case",
                  ["==", ["get", "id"], selected?.properties.id ?? ""],
                  "#E3342F",
                  "#1D5B3A",
                ],
                "circle-stroke-color": "#FFFFFF",
                "circle-stroke-width": 3,
              }}
            />
            <Layer
              id="event-counts"
              type="symbol"
              filter={["!", ["has", "point_count"]]}
              layout={{
                "text-field":
                  loadingPlaces || placesError
                    ? "…"
                    : ["to-string", ["get", "event_count"]],
                "text-font": ["Noto Sans Regular"],
                "text-size": 12,
              }}
              paint={{ "text-color": "#FFFFFF" }}
            />
            <Layer
              id="ground-labels"
              type="symbol"
              minzoom={16}
              filter={["!", ["has", "point_count"]]}
              layout={{
                "text-field": ["get", "name"],
                "text-font": ["Noto Sans Regular"],
                "text-size": 12,
                "text-anchor": "top",
                "text-offset": [0, 1.2],
              }}
              paint={{
                "text-color": "#15201B",
                "text-halo-color": "#FFFFFF",
                "text-halo-width": 2,
              }}
            />
          </GeoJSONSource>
          {coordinates && (
            <GeoJSONSource
              id="device-location"
              data={{
                type: "Feature",
                properties: {},
                geometry: {
                  type: "Point",
                  coordinates: [coordinates.longitude, coordinates.latitude],
                },
              }}
            >
              <Layer
                id="location-accuracy"
                type="circle"
                paint={{
                  "circle-radius": [
                    "interpolate",
                    ["exponential", 2],
                    ["zoom"],
                    0,
                    accuracyAtZoomZero,
                    24,
                    accuracyAtZoomZero * 2 ** 24,
                  ],
                  "circle-color": "#2678D8",
                  "circle-opacity": 0.14,
                  "circle-stroke-color": "#2678D8",
                  "circle-stroke-width": 1,
                  "circle-stroke-opacity": 0.3,
                  "circle-pitch-alignment": "map",
                }}
              />
              <Layer
                id="location-dot"
                type="circle"
                paint={{
                  "circle-radius": 8,
                  "circle-color": "#2678D8",
                  "circle-stroke-color": "#FFFFFF",
                  "circle-stroke-width": 3,
                }}
              />
            </GeoJSONSource>
          )}
        </Map>
      )}

      <View style={styles.header}>
        <Text style={styles.kicker}>CAMPUS PICKUP</Text>
        <Text style={styles.title}>{area?.name ?? "LUMS"}</Text>
        <Text style={styles.subtitle}>Find a place. See what’s happening.</Text>
        <View style={styles.filters}>
          {(["", "football", "cricket"] as const).map((type) => (
            <Pressable
              key={type}
              accessibilityRole="button"
              accessibilityState={{ selected: eventType === type }}
              onPress={() => {
                setEventType(type);
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
      </View>
      <View style={styles.mapControls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show my location"
          accessibilityState={{
            disabled: !mapLoaded || deviceLocation.finding,
            busy: deviceLocation.finding,
          }}
          disabled={!mapLoaded || deviceLocation.finding}
          onPress={showMyLocation}
          style={styles.recentre}
        >
          {deviceLocation.finding ? (
            <ActivityIndicator color="#2678D8" />
          ) : null}
          <Text style={styles.buttonText}>
            {deviceLocation.finding
              ? "Finding your location…"
              : "◎ My location"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Recentre on campus"
          onPress={recentre}
          style={styles.recentre}
        >
          <Text style={styles.buttonText}>↗ {area?.name ?? "Campus"}</Text>
        </Pressable>
      </View>

      {deviceLocation.error && (
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

      {areaError || placesError || mapError ? (
        <View style={styles.status}>
          <Text style={styles.body}>
            {areaError ||
              (mapError
                ? "The map could not load. Check your connection and try again."
                : placesError)}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setRetry((value) => value + 1);
              if (mapError) {
                setMapError(false);
                setMapLoaded(false);
                setMapVersion((value) => value + 1);
              }
            }}
            style={styles.retry}
          >
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      ) : !area || !mapLoaded || loadingPlaces ? (
        <View style={styles.loading}>
          <ActivityIndicator color="#1D5B3A" />
          <Text style={styles.body}>
            {!area
              ? "Loading campus…"
              : !mapLoaded
                ? "Loading map…"
                : "Loading places and events…"}
          </Text>
        </View>
      ) : null}

      {selected ? (
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
                    onPress={() => setEventID(event.id)}
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
            Community-mapped location · OpenStreetMap
          </Text>
        </View>
      ) : area &&
        mapLoaded &&
        !loadingPlaces &&
        !placesError &&
        !areaError &&
        !mapError ? (
        <View style={styles.hint}>
          <Text style={styles.body}>
            {places.truncated || events.truncated
              ? "Zoom in to see all places and events."
              : places.features.length
                ? events.events.length
                  ? "Zoom into clusters. Place markers show event counts."
                  : "No upcoming events in this view. Tap a place to explore."
                : "No places mapped in this view yet."}
          </Text>
        </View>
      ) : null}
      {eventID && (
        <EventDetails
          key={eventID}
          id={eventID}
          apiURL={apiURL}
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
  header: {
    position: "absolute",
    top: 62,
    left: 16,
    right: 75,
    padding: 16,
    borderRadius: 22,
    backgroundColor: "#F4F5F0",
  },
  kicker: {
    color: "#1D5B3A",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  title: {
    fontFamily: "BigShoulders",
    fontSize: 48,
    lineHeight: 52,
    color: "#15201B",
  },
  subtitle: { fontSize: 13, color: "#6C786E" },
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
  mapControls: {
    position: "absolute",
    right: 16,
    top: 245,
    gap: 8,
    alignItems: "flex-end",
  },
  recentre: {
    backgroundColor: "#F4F5F0",
    padding: 14,
    borderRadius: 24,
    flexDirection: "row",
    gap: 8,
  },
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
    bottom: 40,
    alignSelf: "center",
    padding: 14,
    backgroundColor: "#F4F5F0",
    borderRadius: 18,
  },
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
