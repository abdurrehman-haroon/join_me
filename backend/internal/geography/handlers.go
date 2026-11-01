package geography

import (
	"errors"
	"log"
	"net/http"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"joinme/backend/internal/database"
)

type Handler struct{ Queries *database.Queries }

// Explore pages count events in the coming week, so "things happening" stays
// meaningful without counting events months away. Responses echo the end time.
const exploreWindow = 7 * 24 * time.Hour

// Matches the slug format enforced by the areas, places and place_spots tables.
var slugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

func (handler Handler) ListCityDistricts(w http.ResponseWriter, request *http.Request) {
	citySlug := request.PathValue("city")
	if !slugPattern.MatchString(citySlug) {
		http.Error(w, "invalid city slug", http.StatusBadRequest)
		return
	}
	districts, err := handler.Queries.ListCityDistricts(request.Context(), database.ListCityDistrictsParams{
		CitySlug:     citySlug,
		WindowEndsAt: pgtype.Timestamptz{Time: time.Now().Add(exploreWindow), Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "city not found", http.StatusNotFound)
		return
	}
	if err != nil {
		log.Printf("list city districts: %v", err)
		http.Error(w, "could not load districts", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(districts)
}

func (handler Handler) ListDistrictPlaces(w http.ResponseWriter, request *http.Request) {
	citySlug, districtSlug := request.PathValue("city"), request.PathValue("district")
	if !slugPattern.MatchString(citySlug) || !slugPattern.MatchString(districtSlug) {
		http.Error(w, "invalid city or district slug", http.StatusBadRequest)
		return
	}
	places, err := handler.Queries.ListDistrictPlaces(request.Context(), database.ListDistrictPlacesParams{
		CitySlug:     citySlug,
		DistrictSlug: districtSlug,
		WindowEndsAt: pgtype.Timestamptz{Time: time.Now().Add(exploreWindow), Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "district not found", http.StatusNotFound)
		return
	}
	if err != nil {
		log.Printf("list district places: %v", err)
		http.Error(w, "could not load places", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(places)
}

func (handler Handler) GetPlace(w http.ResponseWriter, request *http.Request) {
	citySlug, districtSlug, placeSlug := request.PathValue("city"), request.PathValue("district"), request.PathValue("place")
	if !slugPattern.MatchString(citySlug) || !slugPattern.MatchString(districtSlug) || !slugPattern.MatchString(placeSlug) {
		http.Error(w, "invalid city, district or place slug", http.StatusBadRequest)
		return
	}
	place, err := handler.Queries.GetPlaceBySlugs(request.Context(), database.GetPlaceBySlugsParams{
		CitySlug:     citySlug,
		DistrictSlug: districtSlug,
		PlaceSlug:    placeSlug,
		WindowEndsAt: pgtype.Timestamptz{Time: time.Now().Add(exploreWindow), Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "place not found", http.StatusNotFound)
		return
	}
	if err != nil {
		log.Printf("get place: %v", err)
		http.Error(w, "could not load place", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(place)
}
