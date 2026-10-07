# MapLibre spike

This screen uses sample game pins near LUMS. The public OpenFreeMap style is temporary; set `EXPO_PUBLIC_MAP_STYLE_URL` to use a self-hosted style later.

MapLibre needs an Expo development build. It will not run in Expo Go.

From `frontend/`, after installing a compatible Xcode and iOS simulator:

```bash
pnpm install
pnpm exec expo run:ios
```

For later JavaScript changes, start the development server with `pnpm exec expo start --dev-client`, then open the installed development app in the simulator.
