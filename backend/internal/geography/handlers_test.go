package geography

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestInvalidRequestsDoNotReachDatabase(t *testing.T) {
	handler := Handler{}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /cities/{city}/districts", handler.ListCityDistricts)
	mux.HandleFunc("GET /cities/{city}/districts/{district}/places", handler.ListDistrictPlaces)
	mux.HandleFunc("GET /cities/{city}/districts/{district}/places/{place}", handler.GetPlace)
	for _, path := range []string{
		"/cities/Lahore/districts", "/cities/lahore/districts/dha_phase_5/places",
		"/cities/lahore/districts/dha-phase-5/places/-lums",
	} {
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, httptest.NewRequest("GET", path, nil))
		if response.Code != http.StatusBadRequest {
			t.Fatalf("%s: got %d", path, response.Code)
		}
	}
}
