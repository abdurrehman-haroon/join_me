# Explore performance rules

Read before any Explore or map UX change (cards, markers, outlines, camera, level swipes). Target: under 2% janky frames for scrolling and swiping. Details of each experiment are in `handoff.md` (2026-11-03/04).

## Rules for anything on or over the map

1. No looping or decorative animations on map markers. Markers are native views; animating one makes Android redraw the whole screen every frame. The focus pin's ripple alone made swipes about five times worse.
2. Never re-render the screen to animate. Fades and motion tied to scrolling are driven natively from the feed's scroll value, not from React state updated during the scroll. The old bubble fade re-rendered the whole Explore screen about ten times per card.
3. Prefer map layers over markers for anything numerous (counts, bubbles, labels). Each marker is repositioned on every camera frame.
4. The camera follows the feed with short linear eases, not jumps. Scroll events reach JavaScript about 80 times a second while the screen draws up to 120; `jumpTo` left the map a step behind the cards.
5. Start camera flights immediately when the level changes, not after the next level renders.
6. Build views before they are needed, but not mid-scroll. Creating views while the user scrolls drops frames; build at rest or ahead of time.
7. Keep see-through layers over the map to a minimum. Translucent cards over a moving map cost GPU time on every frame.

## Android gotchas

- `RefreshControl` must stay mounted on a list; adding or removing it recreates the native scroll view at the top.
- Touches only reach views inside their parent's bounds; a track of side-by-side pages must be as wide as all its pages.
- `removeClippedSubviews` breaks list pages that slide back into view.

## Measuring

Always measure in a release build. Debug builds run unoptimised native code and are several times slower, so they report jank that real users never see.

## Status (2026-11-04, Redmi Note 13 Pro, 120Hz, release)

Swiping between levels 1.3–1.9% janky; scrolling the feed about 3%. Remaining scroll cost: views created as cards scroll into view, and GPU time drawing cards over the map. Untried levers: cap MapLibre's frame rate, move card motion to Reanimated, fewer translucent layers. Not yet measured on iOS, a cheaper Android phone or a 60Hz screen.
