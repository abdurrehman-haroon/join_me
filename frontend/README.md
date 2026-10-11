# Campus Pickup mobile app

Expo SDK 57 / React Native, with a native MapLibre map and OpenFreeMap Liberty tiles. `index.ts` registers `src/NativeApp.tsx`; `src/MapScreen.tsx` owns the connected map. The earlier `CampusScene.tsx` illustration remains a reference and is not rendered by the map tab.

## Run

Start the Go API and PostGIS database first (see `../backend/README.md`). With Xcode and an iOS simulator:

```sh
pnpm run ios
```

MapLibre requires a development build; Expo Go does not include its native module. After changing config plugins, run `pnpm exec expo prebuild --platform ios` before rebuilding. For later JavaScript updates, use `pnpm start`, then `i` to open the app or `r` to reload it.

Configuration (Expo public environment variables, no secrets):

- `EXPO_PUBLIC_API_URL`: defaults to `http://localhost:8080` for the iOS simulator. On a physical phone, use your computer's reachable LAN address; production needs HTTPS.
- `EXPO_PUBLIC_INITIAL_AREA_ID`: defaults to the seeded LUMS UUID. Select another mapped area without changing geographic code.
- `EXPO_PUBLIC_MAP_STYLE_URL`: defaults to `https://tiles.openfreemap.org/styles/liberty`. A replacement style must include the Noto Sans Regular glyphs used by our labels, or adjust the label font with the style.

Restart Metro after changing environment values.

## Connected map behavior

The map opens at the area's bounds, supports free pan/zoom and campus recentring, fetches viewport places after movement settles, clusters points at low zoom, and opens place details with a highlighted outline. Loading, empty, timeout, failed-request, and retry states are present. No location permission or sign-in is requested. Map attribution remains enabled.

The initial six places and campus outline come from OpenStreetMap, not verified campus records. Games are not connected yet. Other tabs remain labelled prototype previews with sample data; their actions do not create real games, messages, or accounts. Full illustrated-v6 parity is deferred under the current slim scope.

Checks: `pnpm exec expo lint index.ts src` and `pnpm exec tsc --noEmit`.
