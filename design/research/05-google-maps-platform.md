# Research 5: Google Maps Platform fit (7 Oct 2026)

## Demo key
- No billing, not for production, 100 calls per API per day.
- Covers: Maps JS (2D/3D), Places (New), Geocoding, Routes and Weather.
- Doesn't cover: the iOS SDKs, Map Tiles API and Air Quality.
- https://developers.google.com/maps/demo-key

## Photorealistic 3D
- JS `gmp-map-3d` has `flyCameraTo` and `flyCameraAround`, markers, polygons and glTF models. https://developers.google.com/maps/documentation/javascript/3d/overview
- Native iOS and Android Maps 3D SDKs launched as Experimental. https://mapsplatform.google.com/resources/blog/introducing-3d-maps-on-mobile-build-immersive-experiences-for-android-and-ios/
- There's no React Native path except a custom native module or a WebView.
- **Our test: Lahore has no photorealistic 3D buildings. It's flat satellite imagery.**
- Raw 3D tiles cost $6 per 1,000 root requests (1,000 free per month). There's no caching or offline use, attribution is required, and mixing with MapLibre is a grey area.
  - https://developers.google.com/maps/billing-and-pricing/pricing
  - https://developers.google.com/maps/documentation/tile/policies

## Places (New)
- Essentials: 10k free per month, Details $5 per 1,000.
- Pro: Details $17 per 1,000.
- Only the place ID may be stored. Fine for one-off venue verification. Live cards per view get expensive (roughly $200–850 a month at 5k MAU).

## Weather and Air Quality
- Pakistan is covered by both. Weather alerts aren't available in Pakistan, and Air Quality uses the US EPA index.
- Weather: $0.15 per 1,000 (10k free). Air Quality: $5 per 1,000.
- Poll server-side every 15–30 minutes per area, so the cost is close to zero.

## Cost at 5k MAU × 10 opens a month
| Option | Monthly |
|---|---|
| Google 2D mobile SDK | about $0 |
| Google 3D tiles | about $290 |
| Places, live cards | $200–850 |
| Weather and Air Quality, cached | about $0–5 |
| MapLibre self-hosted | $5–20 |

## Decision
- Keep MapLibre.
- Use Google Places for verification only.
- Run a Weather and Air Quality poller for the conditions strip.
- Skip Google 3D: there's no Lahore coverage and no React Native path.
