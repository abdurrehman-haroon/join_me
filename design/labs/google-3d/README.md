# Google Maps test page

A local-only page for testing Google Maps Platform against the Campus Pickup idea. It runs a scroll story over Google's 3D map (LUMS → weather → CBTL → DHA), finds LUMS and every CBTL in Lahore with Places, and reads current weather at LUMS.

## Run it
1. Copy `config.example.js` to `config.local.js` and paste your key. `config.local.js` is git-ignored, so the key never reaches the repo.
2. Serve the folder locally. The Maps API won't load from `file://`.
   ```bash
   cd ~/dev/campus-pickup/labs/google-3d && python3 -m http.server 8766 --bind 127.0.0.1
   ```
3. Open http://localhost:8766 and scroll the cards.

Each page load uses about 2 Places calls and 1 Weather call. The demo key allows 100 calls per API per day.

## What we found (7 Oct 2026)
- **3D map:** loads, but Lahore has **no photorealistic 3D buildings**. Even at a steep close-up it's flat satellite imagery on terrain. Google 3D can't give us real-building 3D in Lahore today.
- **Places:** found LUMS and 10 CBTL branches in Lahore, **3 of them in DHA**: Phase 3 (Z Block commercial), Phase 5 (A Block) and Phase 6 (Raya). So CBTL DHA is real.
- **Weather:** works for Lahore: temperature, feels-like, humidity, conditions.
- **Gotcha:** camera targets need ground height. Lahore is about 210 m above sea level, so `altitude: 0` puts the camera underground.

## Recommendation
- **Keep MapLibre** for the app's map. It's flat-cost, and nothing better is available in 3D for Lahore.
- **Use Google Places** to look up and verify venues once, storing only the place ID, per Google's terms.
- **Use a server-side Weather and Air Quality poller** for the conditions strip, refreshed every 15–30 minutes for everyone.
- Full research: `../../research/05-google-maps-platform.md`.
- **Key safety:** restrict the key to localhost and these APIs in Google Cloud console, or rotate it. It was pasted into a chat.
