# Campus Pickup mobile app

Expo SDK 57 runs a React Native app. `index.ts` registers `src/NativeApp.tsx`; the map illustration is drawn by `src/CampusScene.tsx` with `react-native-svg`. The v6 HTML in `design/prototype/index.html` is a visual reference, not an app screen. The current native screens contain fixture data and are not connected to the Go API.

The four native tabs, game details, create form, chat, Game Day and campus page are implemented as an initial pass. The campus scene, scroll motion, zoom transitions, Hostel Cup podium, player-card motion, and several flows still need visual and behavioral parity work before this is a 1:1 copy.

With Xcode and the iOS simulator installed, run from `frontend/`:

```bash
pnpm run ios
```

For later JavaScript-only changes:

```bash
pnpm start
```

Press `i` to open the development app in the iOS simulator. The app is native React Native; the SVG campus scene is a temporary illustration while the v6 scene is rebuilt.
