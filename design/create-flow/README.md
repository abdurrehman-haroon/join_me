# Create flow prototype

An interactive HTML mock of the event-creation revamp, used to discuss the user experience before building it. The phone copies the app's styles: the raised ＋ in the tab bar, today's EventForm and the Explore cards. Beside it are the open decisions; changing an answer changes the phone.

It currently covers step 3, finding the place: ＋ from anywhere, the new "Where" field, and a map-first picker over all active Lahore places with search on top, kind filters, a list of places in view and a preview of dropping a pin (step 4) with the duplicate check. The map is drawn on a canvas from the district outlines, because real map tiles cannot load inside an artifact. Later steps (the pin in detail, the form redesign, after posting) get added here as they are discussed.

- `index.html` is the page; `places.json` is every active place (name, kind, district, longitude, latitude, Urdu or alternative names), exported from the local `joinme` database; `districts.json` is the 68 district outlines simplified to about 6,000 points, with a label point each.
- Search mimics the proposed Postgres `pg_trgm` search: prefix and substring matches first, then trigram similarity of at least 0.3. Results are ranked by match, then by distance from a stand-in location at Liberty Market, Gulberg.
- "Happening this week" uses the 25 places that have sample events.

Run it from the repository root with `python3 -m http.server 4181 --bind 127.0.0.1 --directory design/create-flow`, then open http://127.0.0.1:4181. Opening the file directly will not load `places.json`. The published copy is a claude.ai artifact; republish it after changing these files.

Refresh `places.json` after the OSM places change:

```sh
psql -d joinme -Atc "select json_agg(json_build_array(p.name, p.type, a.name, round(st_x(p.location)::numeric,5), round(st_y(p.location)::numeric,5), nullif(concat_ws(' | ', case when p.osm_tags->>'name' !~ '[A-Za-z]' then p.osm_tags->>'name' end, p.osm_tags->>'name:ur', p.osm_tags->>'alt_name', p.osm_tags->>'old_name'),'')) order by p.name) from places p join areas a on a.id=p.area_id where p.status='active'" > design/create-flow/places.json
```
