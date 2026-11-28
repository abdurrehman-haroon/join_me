package geography

import (
	"compress/gzip"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgtype"
	"joinme/backend/internal/database"
)

const (
	defaultSearchLimit = 20
	maxSearchLimit     = 50
	maxQueryLength     = 100
)

// ListPickerPlaces sends every place the create flow's picker can show, once, as
// compact rows the phone filters by kind and by what is on screen.
func (handler Handler) ListPickerPlaces(w http.ResponseWriter, request *http.Request) {
	citySlug := request.PathValue("city")
	if !slugPattern.MatchString(citySlug) {
		http.Error(w, "invalid city slug", http.StatusBadRequest)
		return
	}
	places, err := handler.Queries.ListPickerPlaces(request.Context(), database.ListPickerPlacesParams{
		CitySlug:     citySlug,
		WindowEndsAt: pgtype.Timestamptz{Time: time.Now().Add(exploreWindow), Valid: true},
		ViewerID:     handler.DemoUserID,
	})
	if err != nil {
		log.Printf("list picker places: %v", err)
		http.Error(w, "could not load places", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Vary", "Accept-Encoding")
	// About 300 KB of JSON shrinks to under a third; phones ask for gzip and unpack it.
	if strings.Contains(request.Header.Get("Accept-Encoding"), "gzip") {
		w.Header().Set("Content-Encoding", "gzip")
		compressed := gzip.NewWriter(w)
		compressed.Write(places)
		compressed.Close()
		return
	}
	w.Write(places)
}

// SearchPlaces finds places by any of their names. The optional near=lng,lat
// only orders results by distance; it is never stored or logged.
func (handler Handler) SearchPlaces(w http.ResponseWriter, request *http.Request) {
	citySlug := request.PathValue("city")
	if !slugPattern.MatchString(citySlug) {
		http.Error(w, "invalid city slug", http.StatusBadRequest)
		return
	}
	values := request.URL.Query()
	query := strings.TrimSpace(values.Get("q"))
	if query == "" || utf8.RuneCountInString(query) > maxQueryLength || strings.IndexFunc(query, unicode.IsControl) >= 0 {
		http.Error(w, "q must be 1 to 100 characters on one line", http.StatusBadRequest)
		return
	}
	params := database.SearchPlacesParams{Query: query, CitySlug: citySlug, ResultLimit: defaultSearchLimit, ViewerID: handler.DemoUserID}
	if raw := values.Get("limit"); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > maxSearchLimit {
			http.Error(w, "limit must be 1 to 50", http.StatusBadRequest)
			return
		}
		params.ResultLimit = int32(limit)
	}
	if raw := values.Get("near"); raw != "" {
		lng, lat, ok := parseNear(raw)
		if !ok {
			http.Error(w, "near must be longitude,latitude", http.StatusBadRequest)
			return
		}
		params.NearLng = pgtype.Float8{Float64: lng, Valid: true}
		params.NearLat = pgtype.Float8{Float64: lat, Valid: true}
	}
	results, err := handler.Queries.SearchPlaces(request.Context(), params)
	if err != nil {
		log.Printf("search places: %v", err)
		http.Error(w, "could not search places", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(results)
}

// PlacesNear tells the pin which district it is in and, once a name is typed,
// which similar places are within 150 m. The point is never stored or logged.
func (handler Handler) PlacesNear(w http.ResponseWriter, request *http.Request) {
	citySlug := request.PathValue("city")
	if !slugPattern.MatchString(citySlug) {
		http.Error(w, "invalid city slug", http.StatusBadRequest)
		return
	}
	values := request.URL.Query()
	lng, lat, ok := parseNear(values.Get("lng") + "," + values.Get("lat"))
	if !ok {
		http.Error(w, "lng and lat must be a valid point", http.StatusBadRequest)
		return
	}
	query := strings.TrimSpace(values.Get("q"))
	if utf8.RuneCountInString(query) > maxQueryLength || strings.IndexFunc(query, unicode.IsControl) >= 0 {
		http.Error(w, "q must be at most 100 characters on one line", http.StatusBadRequest)
		return
	}
	results, err := handler.Queries.PlacesNear(request.Context(), database.PlacesNearParams{
		Lng: lng, Lat: lat, CitySlug: citySlug, Query: query, ViewerID: handler.DemoUserID,
	})
	if err != nil {
		log.Printf("places near: %v", err)
		http.Error(w, "could not check nearby places", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(results)
}

func parseNear(raw string) (float64, float64, bool) {
	parts := strings.Split(raw, ",")
	if len(parts) != 2 {
		return 0, 0, false
	}
	lng, lngErr := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64)
	lat, latErr := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
	if lngErr != nil || latErr != nil || lng < -180 || lng > 180 || lat < -90 || lat > 90 {
		return 0, 0, false
	}
	return lng, lat, true
}
