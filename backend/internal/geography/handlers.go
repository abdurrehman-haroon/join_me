package geography

import (
	"errors"
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"joinme/backend/internal/database"
)

type Handler struct{ Queries *database.Queries }

func (handler Handler) GetArea(w http.ResponseWriter, request *http.Request) {
	var areaID pgtype.UUID
	if err := areaID.Scan(request.PathValue("id")); err != nil || !areaID.Valid {
		http.Error(w, "invalid area ID", http.StatusBadRequest)
		return
	}
	area, err := handler.Queries.GetArea(request.Context(), areaID)
	if errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "area not found", http.StatusNotFound)
		return
	}
	if err != nil {
		log.Printf("get area: %v", err)
		http.Error(w, "could not load area", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(area)
}

func (handler Handler) ListChildAreas(w http.ResponseWriter, request *http.Request) {
	var areaID pgtype.UUID
	if err := areaID.Scan(request.PathValue("id")); err != nil || !areaID.Valid {
		http.Error(w, "invalid area ID", http.StatusBadRequest)
		return
	}
	children, err := handler.Queries.ListChildAreas(request.Context(), areaID)
	if errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "area not found", http.StatusNotFound)
		return
	}
	if err != nil {
		log.Printf("list child areas: %v", err)
		http.Error(w, "could not load areas", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(children)
}

// ParseBounds accepts west,south,east,north without crossing the antimeridian.
func ParseBounds(value string) (database.ListPlacesInBoundsParams, error) {
	parts := strings.Split(value, ",")
	if len(parts) != 4 {
		return database.ListPlacesInBoundsParams{}, errors.New("bbox must be west,south,east,north")
	}
	var bounds [4]float64
	for index, part := range parts {
		number, err := strconv.ParseFloat(part, 64)
		if err != nil || math.IsNaN(number) || math.IsInf(number, 0) {
			return database.ListPlacesInBoundsParams{}, errors.New("bbox must contain four finite numbers")
		}
		bounds[index] = number
	}
	west, south, east, north := bounds[0], bounds[1], bounds[2], bounds[3]
	if west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north {
		return database.ListPlacesInBoundsParams{}, errors.New("bbox must have ordered longitude/latitude bounds within the world")
	}
	return database.ListPlacesInBoundsParams{West: west, South: south, East: east, North: north}, nil
}

func (handler Handler) ListPlaces(w http.ResponseWriter, request *http.Request) {
	bounds, err := ParseBounds(request.URL.Query().Get("bbox"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	places, err := handler.Queries.ListPlacesInBounds(request.Context(), bounds)
	if err != nil {
		log.Printf("list places: %v", err)
		http.Error(w, "could not load places", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	// SQL returns bounded GeoJSON; no geographic filtering happens in Go.
	w.Write(places)
}
