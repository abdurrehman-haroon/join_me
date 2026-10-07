# Research 1: UI tools, 3D options and references (30 Sep 2026)

## The four sites from the brief
- **threeui.com**: copy-paste Three.js/WebGL effects and templates. Web only, so no React Native code to reuse. Use it for motion ideas.
- **tasteskill.dev**: "Taste Skill", an open-source set of anti-generic design rules for AI coding agents. Works with any stack. Use it as a review checklist on every screen.
- **gsap.com (GSAP)**: the standard web animation engine. Has no React Native support. Borrow its timing and sequencing ideas and rebuild them with Reanimated.
- **21st.dev**: a registry of React + Tailwind + shadcn components. Web only, and it's the mass-produced look we want to avoid.

None of the four can be used directly in an Expo app.

## React Native / Expo 3D and motion (2026)
| Tool | Verdict |
|---|---|
| react-native-reanimated (v3/v4) + gesture-handler | Required. All sheet, pin and counter motion. |
| @shopify/react-native-skia | Core custom rendering: pins, the pitch formation, the digit roll, shaders. Mature, fast on iOS. |
| react-native-filament (margelo) | Best real 3D: Metal on iOS, loads GLB models, ~4MB. Use for the ball in Start a game and the pin drop. |
| Rive | Interactive vector icons (balls that react to taps or to a game filling up). |
| Moti | Simple declarative enter/exit transitions. |
| expo-haptics | Use everywhere: join, last spot, pin drop. |
| Lottie | One-off loaders only. Looks templated. |
| react-three-fiber/native + expo-gl | Avoid for now: its expo-gl version clashes with current Expo SDKs, and it's unreliable in the simulator. |
| Spline | Skip: no proper React Native SDK. |

## Reference apps
- **Apple product pages**: motion tied to something the user controls (scroll or a slider), not autoplay. Our time slider drives the map lighting this way.
- **Apple Activity rings**: one hero number, celebrated when it changes. This is the model for "4 spots left".
- **Partiful**: avatars pop in as people RSVP. This is the model for the formation filling up.
- **Airbnb 2025 "Lava" icons**: tactile 3D icons that react when tapped. This is the model for the ball icons.
- **Strava / Snap Map**: pulsing live pins and snapping bottom sheets.

## Patterns that look AI-generated, and what to avoid
Purple or indigo gradients, frosted-glass cards over the map, three identical rounded cards in a row, emoji as icons, Inter everywhere, gradient text on numbers, bouncy easing on everything, unmodified shadcn spacing.

## Sources
https://threeui.com · https://tasteskill.dev · https://gsap.com · https://21st.dev ·
https://github.com/pmndrs/react-three-fiber/discussions/2219 ·
https://github.com/Shopify/react-native-skia/releases ·
https://github.com/margelo/react-native-filament ·
https://www.bloomberg.com/news/articles/2025-06-13/apple-airbnb-ditch-flat-app-icons-for-new-3d-ui-design ·
https://github.com/funboy322/avoid-ai-design
