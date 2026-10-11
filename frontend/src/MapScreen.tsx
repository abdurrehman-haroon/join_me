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
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

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
  const placeSource = useRef<GeoJSONSourceRef>(null);
  const [area, setArea] = useState<Area | null>(null);
  const [bounds, setBounds] = useState<LngLatBounds | null>(null);
  const [places, setPlaces] = useState<Places>(emptyPlaces);
  const [selected, setSelected] = useState<Place | null>(null);
  const [areaError, setAreaError] = useState("");
  const [placesError, setPlacesError] = useState("");
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [mapVersion, setMapVersion] = useState(0);

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
      setPlacesError("");
      try {
        const response = await fetch(
          `${apiURL}/places?bbox=${bounds.join(",")}`,
          { signal: controller.signal },
        );
        if (!response.ok)
          throw new Error(`Places request failed (${response.status})`);
        const loadedPlaces: Places = await response.json();
        if (active) {
          setPlaces(loadedPlaces);
          setSelected((current) =>
            current
              ? (loadedPlaces.features.find(
                  (place) => place.id === current.id,
                ) ?? null)
              : null,
          );
        }
      } catch {
        if (active) setPlacesError("Could not refresh places. Try again.");
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
  }, [bounds, retry]);

  useEffect(() => {
    if (!area || mapLoaded || mapError) return;
    const timeout = setTimeout(() => setMapError(true), 20000);
    return () => clearTimeout(timeout);
  }, [area, mapLoaded, mapError, mapVersion]);

  function recentre() {
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
            data={places}
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
                "circle-radius": 20,
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
                "text-field": ["get", "point_count_abbreviated"],
                "text-font": ["Noto Sans Regular"],
                "text-size": 13,
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
                  12,
                  9,
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
        </Map>
      )}

      <View style={styles.header}>
        <Text style={styles.kicker}>CAMPUS PICKUP</Text>
        <Text style={styles.title}>{area?.name ?? "LUMS"}</Text>
        <Text style={styles.subtitle}>Find your ground. Bring your game.</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Recentre on campus"
        onPress={recentre}
        style={styles.recentre}
      >
        <Text style={styles.buttonText}>↗ {area?.name ?? "Campus"}</Text>
      </Pressable>

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
                : "Loading places…"}
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
          <Text style={styles.body}>
            Ground details are ready. Games are coming next.
          </Text>
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
            {places.truncated
              ? "Zoom in to see all places."
              : places.features.length
                ? "Tap a ground or court to explore."
                : "No places mapped in this view yet."}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F4F5F0" },
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
  recentre: {
    position: "absolute",
    right: 16,
    top: 210,
    backgroundColor: "#F4F5F0",
    padding: 14,
    borderRadius: 24,
  },
  buttonText: { color: "#1D5B3A", fontWeight: "700", fontSize: 14 },
  loading: {
    position: "absolute",
    top: 270,
    alignSelf: "center",
    flexDirection: "row",
    gap: 10,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#F4F5F0",
  },
  status: {
    position: "absolute",
    top: 270,
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
