# Deploy checklist

Things that are deliberately off or temporary in local development and must be
handled when the app is deployed. Add to this list as features land.

- [ ] Set `JOBS_ENABLED=true` on the API so River runs scheduled jobs (OSM places sync every Tuesday at 3am Asia/Karachi). Run `make osm-places` locally until then.
- [ ] Decide how the deployed OSM places job's changes reach `seeds/lahore_osm_places.sql` (today the manual run rewrites it).
- [ ] Show "© OpenStreetMap contributors" in the app's credits for place data (ODbL), and check ODbL share-alike before publishing a combined database.
- [ ] Remove the cleartext-HTTP exception from the Android release build (`android.usesCleartextTraffic` under `expo-build-properties` in `frontend/app.json`) and serve the API over HTTPS.
- [ ] Replace the shared `DEMO_USER_ID` identity with real sign-in.
- [ ] Push notifications: an Apple APNs key and a Firebase project for FCM (built on top of in-app notifications).
- [ ] Replace the `joinme://events/{id}` link in shared messages (`frontend/src/share.tsx`) with an https link on our domain (with a web page that shows a preview for people without the app), and set up Android App Links and iOS Universal Links so it opens the app (WhatsApp only makes https links tappable). Keep the `joinme` scheme for old messages.
