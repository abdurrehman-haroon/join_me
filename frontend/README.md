# MapLibre spike

This screen uses sample game pins near LUMS. The public OpenFreeMap style is temporary; set `EXPO_PUBLIC_MAP_STYLE_URL` to use a self-hosted style later.

MapLibre needs an Expo development build. It will not run in Expo Go.

On the current Mac, build the iOS app in Expo's cloud. From `frontend/`:

```bash
npx eas-cli@latest login
npx eas-cli@latest build --platform ios --profile ios-simulator
```

The first build may ask for an iOS bundle identifier and to create/link an Expo project. When the build finishes, accept the prompt to install it in the simulator. Then run:

```bash
pnpm exec expo start --dev-client
```

Press `i` to open the installed development app. Expo Go cannot run MapLibre. If a compatible Xcode is installed later, a local build is also possible:

```bash
pnpm exec expo run:ios
```
