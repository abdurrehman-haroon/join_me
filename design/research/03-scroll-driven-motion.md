# Research 3: Scroll-driven motion (7 Oct 2026)

## Scrollytelling maps
- Mapbox's storytelling template and its scroll fly-to example: each chapter has center, zoom, bearing and pitch. A scroll listener finds the chapter on screen and calls `flyTo`, with a guard so the same chapter doesn't restart. Pitch stays between 0 and 45. Layer opacity changes on chapter enter and exit; set it for both so scrolling back up works.
  - https://docs.mapbox.com/mapbox-gl-js/example/scroll-fly-to/
  - https://maplibre.org/maplibre-gl-js/docs/examples/fly-to-a-location-based-on-scroll-position/
- There are two ways to do it:
  - **Snapping:** time-based, triggered when a chapter is reached.
  - **Scrubbing:** scroll progress is linked directly to the animation and plays backwards too.
- Comfort:
  - Change one thing at a time. Turning, zooming and tilting all at once is what makes people sick.
  - Apple names spinning, movement in several directions or at several speeds, and dolly-zoom as vestibular triggers. https://webkit.org/blog/7551/responsive-design-for-motion/

## Native iOS techniques (from the agent's own knowledge, not fetched)
- Large titles that collapse.
- Apple Maps-style card detents, where the card's position drives the map's padding.
- Parallax at about 0.5× scroll speed.
- Cards that scale to about 0.96 and fade at the edges.
- A small `rotateX` on cards as they enter.
- iOS 26 scroll-edge effects, which native bars get automatically. https://www.createwithswift.com/define-the-scroll-edge-effect-style-of-a-scroll-view-for-liquid-glass/

## React Native
- **Reanimated 4:** `useScrollOffset(animatedRef)` (it replaces `useScrollViewOffset`) returns a shared value. Use `interpolate` for transforms and opacity. https://docs.swmansion.com/react-native-reanimated/docs/scroll/useScrollOffset
- **MapLibre React Native v11:**
  - The camera has `flyTo`, `easeTo`, `jumpTo`, `fitBounds` and `setStop`. `setCamera` was removed. https://maplibre.org/maplibre-react-native/docs/components/camera
  - There's no documented way to drive the camera every frame from the UI thread, and no benchmark. Treat per-frame driving as unproven.
- **FlashList v2:** an `AnimatedFlashList` is available. Work out each cell's motion from its own layout position, because cells are recycled. https://shopify.engineering/flashlist-v2
- The agent found no existing React Native library or example of a scroll-driven map story.

## Recommendations taken
1. Glide the camera per chapter with `easeTo` (700–900 ms) and use `flyTo` for long jumps. Test throttled `jumpTo` on a real device before trying continuous scrubbing.
2. Keep bearing and pitch nearly constant between grounds, at most about 20° of turn per screen of scroll.
3. Drive the title, cards and header from one scroll value, changing transform and opacity only.
4. Collapse the game sheet's hero into a sticky header that keeps the Join button.
5. Hostel Cup: pin the podium and scrub progress through the standings.
6. Player card: keep the tilt small and turn it off under Reduce Motion.
7. Time-of-day lighting: switch per chapter with a cross-fade.
8. Reduce Motion: replace flights, parallax and tilt with cuts and short cross-fades, and add a Calm motion switch.
9. Use native tab and navigation bars.
