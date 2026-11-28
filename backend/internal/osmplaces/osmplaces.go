// Package osmplaces keeps Lahore's places in step with OpenStreetMap: it fetches
// the event-relevant places, adds new ones, updates changed ones and marks the
// ones OSM no longer lists. The weekly River job and `make osm-places` both run it.
package osmplaces

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
)

const overpassURL = "https://overpass-api.de/api/interpreter"

// Lahore District is OSM relation 16117666; Overpass areas add 3600000000.
const overpassQuery = `[out:json][timeout:170];
area(id:3616117666)->.lahore;
(
  nwr["amenity"~"^(restaurant|cafe|fast_food|ice_cream|food_court|bar|cinema|theatre|arts_centre|events_venue|community_centre|library|marketplace|university|college)$"]["name"](area.lahore);
  nwr["leisure"~"^(park|garden|playground|pitch|sports_centre|fitness_centre|swimming_pool|golf_course|stadium)$"]["name"](area.lahore);
  nwr["shop"="mall"]["name"](area.lahore);
  nwr["tourism"~"^(attraction|museum|gallery|zoo|theme_park|viewpoint|hotel)$"]["name"](area.lahore);
  nwr["historic"~"^(monument|tomb|city_gate|fort|manor|castle)$"]["name"](area.lahore);
);
out geom;`

// placeTypes maps an OSM tag to our place kind. The first matching key wins, in
// the order of tagKeys.
var placeTypes = map[string]string{
	"amenity=restaurant": "restaurant", "amenity=fast_food": "restaurant", "amenity=food_court": "restaurant", "amenity=bar": "restaurant",
	"amenity=cafe": "cafe", "amenity=ice_cream": "cafe",
	"amenity=cinema": "culture", "amenity=theatre": "culture", "amenity=arts_centre": "culture",
	"amenity=events_venue": "community", "amenity=community_centre": "community", "amenity=library": "community",
	"amenity=marketplace": "mall", "shop=mall": "mall",
	"amenity=university": "campus", "amenity=college": "campus",
	"leisure=park": "park", "leisure=garden": "park", "leisure=playground": "park",
	"leisure=pitch": "sports_club", "leisure=sports_centre": "sports_club", "leisure=fitness_centre": "sports_club",
	"leisure=swimming_pool": "sports_club", "leisure=golf_course": "sports_club",
	"leisure=stadium":    "stadium",
	"tourism=attraction": "heritage", "tourism=viewpoint": "heritage", "tourism=zoo": "park", "tourism=theme_park": "park",
	"tourism=museum": "culture", "tourism=gallery": "exhibition", "tourism=hotel": "hotel",
	"historic=monument": "heritage", "historic=tomb": "heritage", "historic=city_gate": "heritage",
	"historic=fort": "heritage", "historic=manor": "heritage", "historic=castle": "heritage",
}

var tagKeys = []string{"amenity", "leisure", "shop", "tourism", "historic"}

// Place is one OSM place ready to sync. Geometry is WKT: a point for nodes, a
// polygon or line for ways, and outer rings for relations.
type Place struct {
	OSMRef   string
	Name     string
	Type     string
	Geometry string
	Tags     map[string]string
}

// Result counts what one sync changed.
type Result struct {
	Fetched int
	Skipped int
	Added   int
	Updated int
	Missing int
}

type overpassResponse struct {
	Elements []struct {
		Type     string            `json:"type"`
		ID       int64             `json:"id"`
		Lat      float64           `json:"lat"`
		Lon      float64           `json:"lon"`
		Tags     map[string]string `json:"tags"`
		Geometry []coordinate      `json:"geometry"`
		Members  []struct {
			Role     string       `json:"role"`
			Geometry []coordinate `json:"geometry"`
		} `json:"members"`
	} `json:"elements"`
}

type coordinate struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

// Fetch asks Overpass for Lahore's places. skipped counts places without a
// Latin-letter name or a kind we use.
func Fetch(ctx context.Context) (places []Place, skipped int, err error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, overpassURL,
		strings.NewReader(url.Values{"data": {overpassQuery}}.Encode()))
	if err != nil {
		return nil, 0, err
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("User-Agent", "joinme-osm-places")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil, 0, fmt.Errorf("fetch OSM places: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, 0, fmt.Errorf("fetch OSM places: Overpass returned %s", response.Status)
	}
	var body overpassResponse
	if err = json.NewDecoder(response.Body).Decode(&body); err != nil {
		return nil, 0, fmt.Errorf("read OSM places: %w", err)
	}

	for _, element := range body.Elements {
		name := ChooseName(element.Tags)
		placeType := TypeFor(element.Tags)
		if name == "" || placeType == "" {
			skipped++
			continue
		}
		var geometry string
		switch element.Type {
		case "node":
			geometry = fmt.Sprintf("POINT(%v %v)", element.Lon, element.Lat)
		case "way":
			geometry = wayGeometry(element.Geometry)
		case "relation":
			var rings []string
			for _, member := range element.Members {
				if member.Role == "outer" && len(member.Geometry) >= 2 {
					rings = append(rings, "("+coordinateList(member.Geometry)+")")
				}
			}
			if len(rings) > 0 {
				geometry = "MULTILINESTRING(" + strings.Join(rings, ",") + ")"
			}
		}
		if geometry == "" {
			skipped++
			continue
		}
		places = append(places, Place{
			OSMRef: fmt.Sprintf("%s/%d", element.Type, element.ID), Name: name, Type: placeType,
			Geometry: geometry, Tags: element.Tags,
		})
	}
	return places, skipped, nil
}

// A closed way is an outline; an open one (a path or a row of pitches) is a line.
func wayGeometry(points []coordinate) string {
	if len(points) == 0 {
		return ""
	}
	if len(points) == 1 {
		return fmt.Sprintf("POINT(%v %v)", points[0].Lon, points[0].Lat)
	}
	if len(points) >= 4 && points[0] == points[len(points)-1] {
		return "POLYGON((" + coordinateList(points) + "))"
	}
	return "LINESTRING(" + coordinateList(points) + ")"
}

func coordinateList(points []coordinate) string {
	parts := make([]string, len(points))
	for i, point := range points {
		parts[i] = fmt.Sprintf("%v %v", point.Lon, point.Lat)
	}
	return strings.Join(parts, ",")
}

// ChooseName picks a Latin-letter (Roman Urdu or English) name, preferring the
// English name over an Urdu-script main name. It returns "" when OSM has none.
func ChooseName(tags map[string]string) string {
	for _, key := range []string{"name:en", "official_name:en", "int_name", "name"} {
		name := strings.Join(strings.Fields(tags[key]), " ")
		if strings.ContainsFunc(name, func(r rune) bool { return r < unicode.MaxASCII && unicode.IsLetter(r) }) {
			return name
		}
	}
	return ""
}

// TypeFor returns our place kind for the place's main OSM tag, or "" if unused.
func TypeFor(tags map[string]string) string {
	for _, key := range tagKeys {
		if value, ok := tags[key]; ok {
			if placeType, ok := placeTypes[key+"="+value]; ok {
				return placeType
			}
		}
	}
	return ""
}

var notSlug = regexp.MustCompile(`[^a-z0-9]+`)

// Slugify turns a name into a URL part: "Faletti's Hotel" becomes "faletti-s-hotel".
func Slugify(name string) string {
	slug := strings.Trim(notSlug.ReplaceAllString(strings.ToLower(name), "-"), "-")
	if slug == "" {
		return "place"
	}
	return slug
}

// Sync applies fetched places in one transaction. It refuses to run on a fetch
// much smaller than what is stored, so a partial Overpass answer cannot mark
// most of Lahore missing.
func Sync(ctx context.Context, pool *pgxpool.Pool, places []Place) (Result, error) {
	result := Result{Fetched: len(places)}
	transaction, err := pool.Begin(ctx)
	if err != nil {
		return result, err
	}
	defer transaction.Rollback(ctx)

	var activeOSMPlaces int
	if err = transaction.QueryRow(ctx, `SELECT count(*) FROM places WHERE source = 'osm' AND status = 'active'`).Scan(&activeOSMPlaces); err != nil {
		return result, err
	}
	if len(places) < activeOSMPlaces/2 {
		return result, fmt.Errorf("fetched %d places but %d are stored; refusing a partial sync", len(places), activeOSMPlaces)
	}

	_, err = transaction.Exec(ctx, `CREATE TEMP TABLE osm_import (
        osm_ref text PRIMARY KEY, name text NOT NULL, type place_type NOT NULL,
        geometry_wkt text NOT NULL, tags jsonb NOT NULL) ON COMMIT DROP`)
	if err != nil {
		return result, err
	}
	rows := make([][]any, len(places))
	for i, place := range places {
		tags, _ := json.Marshal(place.Tags)
		rows[i] = []any{place.OSMRef, place.Name, place.Type, place.Geometry, string(tags)}
	}
	if _, err = transaction.CopyFrom(ctx, pgx.Identifier{"osm_import"},
		[]string{"osm_ref", "name", "type", "geometry_wkt", "tags"}, pgx.CopyFromRows(rows)); err != nil {
		return result, fmt.Errorf("load OSM places: %w", err)
	}

	// Relations arrive as outer rings and are assembled into areas here. A place
	// belongs to the district that contains a point on it; places outside every
	// Lahore district (or with broken outlines) are left out.
	_, err = transaction.Exec(ctx, `CREATE TEMP TABLE osm_prepared ON COMMIT DROP AS
        WITH shaped AS (
            SELECT osm_ref, name, type, tags, ST_MakeValid(CASE
                WHEN geometry_wkt LIKE 'MULTILINESTRING%' THEN ST_BuildArea(ST_LineMerge(ST_GeomFromText(geometry_wkt, 4326)))
                ELSE ST_GeomFromText(geometry_wkt, 4326) END) AS shape
            FROM osm_import
        ), located AS (
            SELECT osm_ref, name, type, tags, ST_PointOnSurface(shape) AS location,
                ST_Multi(ST_CollectionExtract(shape, 3)) AS polygons
            FROM shaped WHERE shape IS NOT NULL AND NOT ST_IsEmpty(shape)
        ), outlined AS (
            -- Points and lines have no outline.
            SELECT osm_ref, name, type, tags, location,
                CASE WHEN ST_IsEmpty(polygons) THEN NULL ELSE polygons END AS boundary
            FROM located
        )
        SELECT outlined.*, districts.id AS area_id, NULL::text AS slug
        FROM outlined
        JOIN areas AS city ON city.type = 'city' AND city.slug = 'lahore'
        JOIN areas AS districts ON districts.parent_id = city.id AND districts.type = 'district'
            AND ST_Contains(districts.boundary, outlined.location)`)
	if err != nil {
		return result, fmt.Errorf("prepare OSM places: %w", err)
	}
	var prepared int
	if err = transaction.QueryRow(ctx, `SELECT count(*) FROM osm_prepared`).Scan(&prepared); err != nil {
		return result, err
	}
	result.Skipped = len(places) - prepared

	if err = assignSlugs(ctx, transaction); err != nil {
		return result, err
	}

	tag, err := transaction.Exec(ctx, `UPDATE places SET name = osm.name, slug = osm.slug, type = osm.type,
            location = osm.location, boundary = osm.boundary, osm_tags = osm.tags, area_id = osm.area_id, status = 'active'
        FROM osm_prepared AS osm
        WHERE places.osm_ref = osm.osm_ref AND (
            (places.name, places.slug, places.type, places.area_id, places.status, places.osm_tags)
                IS DISTINCT FROM (osm.name, osm.slug, osm.type, osm.area_id, 'active'::place_status, osm.tags)
            OR NOT ST_Equals(places.location, osm.location)
            OR (places.boundary IS NULL) <> (osm.boundary IS NULL)
            OR NOT ST_Equals(places.boundary, osm.boundary))`)
	if err != nil {
		return result, fmt.Errorf("update OSM places: %w", err)
	}
	result.Updated = int(tag.RowsAffected())

	tag, err = transaction.Exec(ctx, `INSERT INTO places (area_id, name, slug, type, location, boundary, source, osm_ref, osm_tags)
        SELECT area_id, name, slug, type, location, boundary, 'osm', osm_ref, tags FROM osm_prepared
        WHERE NOT EXISTS (SELECT 1 FROM places WHERE places.osm_ref = osm_prepared.osm_ref)`)
	if err != nil {
		return result, fmt.Errorf("add OSM places: %w", err)
	}
	result.Added = int(tag.RowsAffected())

	tag, err = transaction.Exec(ctx, `UPDATE places SET status = 'missing_from_osm'
        WHERE source = 'osm' AND status = 'active'
            AND NOT EXISTS (SELECT 1 FROM osm_prepared WHERE osm_prepared.osm_ref = places.osm_ref)`)
	if err != nil {
		return result, fmt.Errorf("mark missing OSM places: %w", err)
	}
	result.Missing = int(tag.RowsAffected())

	return result, transaction.Commit(ctx)
}

// assignSlugs keeps a place's slug once given, so its address does not change.
// New places, and places that moved into a district where their slug is taken,
// get the first free one of name, name-2, name-3 and so on.
func assignSlugs(ctx context.Context, transaction pgx.Tx) error {
	taken := map[string]bool{}
	rows, err := transaction.Query(ctx, `SELECT area_id::text, slug FROM places`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var areaID, slug string
		if err = rows.Scan(&areaID, &slug); err != nil {
			return err
		}
		taken[areaID+"/"+slug] = true
	}
	if err = rows.Err(); err != nil {
		return err
	}

	type pending struct{ osmRef, name, areaID, currentSlug, currentAreaID string }
	var places []pending
	rows, err = transaction.Query(ctx, `SELECT osm.osm_ref, osm.name, osm.area_id::text,
            COALESCE(places.slug, ''), COALESCE(places.area_id::text, '')
        FROM osm_prepared AS osm LEFT JOIN places ON places.osm_ref = osm.osm_ref
        ORDER BY osm.osm_ref`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var place pending
		if err = rows.Scan(&place.osmRef, &place.name, &place.areaID, &place.currentSlug, &place.currentAreaID); err != nil {
			return err
		}
		places = append(places, place)
	}
	if err = rows.Err(); err != nil {
		return err
	}

	slugs := make([][]any, 0, len(places))
	for _, place := range places {
		slug := place.currentSlug
		movedIntoTakenSlug := place.currentAreaID != place.areaID && taken[place.areaID+"/"+slug]
		if slug == "" || movedIntoTakenSlug {
			base := Slugify(place.name)
			slug = base
			for number := 2; taken[place.areaID+"/"+slug]; number++ {
				slug = fmt.Sprintf("%s-%d", base, number)
			}
			taken[place.areaID+"/"+slug] = true
		}
		slugs = append(slugs, []any{place.osmRef, slug})
	}

	if _, err = transaction.Exec(ctx, `CREATE TEMP TABLE osm_slugs (osm_ref text PRIMARY KEY, slug text NOT NULL) ON COMMIT DROP`); err != nil {
		return err
	}
	if _, err = transaction.CopyFrom(ctx, pgx.Identifier{"osm_slugs"}, []string{"osm_ref", "slug"}, pgx.CopyFromRows(slugs)); err != nil {
		return err
	}
	_, err = transaction.Exec(ctx, `UPDATE osm_prepared SET slug = osm_slugs.slug FROM osm_slugs WHERE osm_slugs.osm_ref = osm_prepared.osm_ref`)
	return err
}

// WriteSeed writes every OSM place to a seed file, so a fresh database gets the
// same places without calling Overpass. Districts are worked out again on load.
func WriteSeed(ctx context.Context, pool *pgxpool.Pool, path string) (int, error) {
	rows, err := pool.Query(ctx, `SELECT osm_ref, name, slug, type::text, ST_AsText(location),
            COALESCE(ST_AsText(boundary), ''), COALESCE(osm_tags::text, '{}')
        FROM places WHERE source = 'osm' AND status = 'active' ORDER BY osm_ref`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	var values []string
	for rows.Next() {
		var osmRef, name, slug, placeType, location, boundary, tags string
		if err = rows.Scan(&osmRef, &name, &slug, &placeType, &location, &boundary, &tags); err != nil {
			return 0, err
		}
		boundaryValue := "NULL"
		if boundary != "" {
			boundaryValue = quote(boundary)
		}
		values = append(values, fmt.Sprintf("    (%s, %s, %s, %s, %s, %s, %s)",
			quote(osmRef), quote(name), quote(slug), quote(placeType), quote(location), boundaryValue, quote(tags)))
	}
	if err = rows.Err(); err != nil {
		return 0, err
	}
	if len(values) == 0 {
		return 0, errors.New("no OSM places to write; run the sync first")
	}
	sort.Strings(values)

	seed := `-- Lahore's places from OpenStreetMap (© OpenStreetMap contributors, ODbL).
-- Generated by ` + "`make osm-places`" + `; do not edit by hand. Apply after lahore_districts.sql
-- with psql --single-transaction -v ON_ERROR_STOP=1. Each place joins the district
-- whose outline contains it; rerunning updates places in place by their OSM reference.
INSERT INTO places (area_id, name, slug, type, location, boundary, source, osm_ref, osm_tags)
SELECT districts.id, osm.name, osm.slug, osm.type::place_type, ST_GeomFromText(osm.location, 4326),
    ST_GeomFromText(osm.boundary, 4326), 'osm', osm.osm_ref, osm.osm_tags::jsonb
FROM (VALUES
` + strings.Join(values, ",\n") + `
) AS osm (osm_ref, name, slug, type, location, boundary, osm_tags)
JOIN areas AS city ON city.type = 'city' AND city.slug = 'lahore'
JOIN areas AS districts ON districts.parent_id = city.id AND districts.type = 'district'
    AND ST_Contains(districts.boundary, ST_GeomFromText(osm.location, 4326))
ON CONFLICT (osm_ref) WHERE osm_ref IS NOT NULL DO UPDATE SET
    area_id = EXCLUDED.area_id, name = EXCLUDED.name, slug = EXCLUDED.slug, type = EXCLUDED.type,
    location = EXCLUDED.location, boundary = EXCLUDED.boundary, osm_tags = EXCLUDED.osm_tags, status = 'active';
`
	return len(values), os.WriteFile(path, []byte(seed), 0o644)
}

func quote(text string) string {
	return "'" + strings.ReplaceAll(text, "'", "''") + "'"
}

// SyncArgs is the weekly River job that keeps places in step with OSM.
type SyncArgs struct{}

func (SyncArgs) Kind() string { return "osm_places_sync" }

type SyncWorker struct {
	river.WorkerDefaults[SyncArgs]
	Pool *pgxpool.Pool
}

func (worker *SyncWorker) Work(ctx context.Context, job *river.Job[SyncArgs]) error {
	places, skipped, err := Fetch(ctx)
	if err != nil {
		return err
	}
	result, err := Sync(ctx, worker.Pool, places)
	if err != nil {
		return err
	}
	log.Printf("OSM places: fetched %d, skipped %d, added %d, updated %d, missing %d",
		result.Fetched, skipped+result.Skipped, result.Added, result.Updated, result.Missing)
	return nil
}

// The job is slow (one large Overpass request), so give it room.
func (worker *SyncWorker) Timeout(*river.Job[SyncArgs]) time.Duration { return 10 * time.Minute }
