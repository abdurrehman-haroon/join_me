# Lahore map skin study

Independent disposable design study. Run `python3 -m http.server 4174 --bind 127.0.0.1 --directory design/lahore-skin` from the repository root. Open http://127.0.0.1:4174/?view=skin#lums or #lahore-fort.

Warm cream buildings, sage land, pale roads, muted water and quieter labels. Existing real geometry is preserved; building heights remain illustrative. LUMS has a subtle footprint outline; its selected event ground retains the existing colour highlight. One geographic marker emits three one-second CSS ripples on focus, then rests. Reduced Motion disables ripples. No continuous map animation or new renderer loop. `skin.js` owns the experimental palette and campus outline; `style.css` owns marker motion.

Uses 26 real place names, approximate pins and 40 fictional sample events. This skin study now uses exactly three navigation levels: City → District → Place. DHA phases are Lahore districts, so LUMS is reached through Lahore → DHA Phase 5 → LUMS without an extra DHA level. Grounds at LUMS remain event locations rather than navigation levels.

District cards in the Lahore feed and district introductions include a visible “Tonight inside” portal with place and activity counts, a timely first suggestion and a direct place action. The existing vertical place feed and horizontal event browsing remain below it. MapLibre/OpenFreeMap external resources still require internet; attribution remains visible. No native app/backend changes, tracking, new API, polling or freshness transport. Local fixtures load on page entry. Delete this directory to discard the experiment.

At district focus, the map fits the complete illustrative district extent and draws a dashed outline derived from that district’s child-place/event coordinates. Red count bubbles mark the existing approximate fixture positions, grouping events that share a coordinate. These are prototype cues, not authoritative administrative boundaries or surveyed event locations.
