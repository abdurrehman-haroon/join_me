package geography

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBoundsValidation(t *testing.T) {
	for _, value := range []string{"", "1,2,3", "NaN,0,1,2", "-Inf,0,1,2", "-181,0,1,2", "1,0,181,2", "0,-91,1,2", "0,0,1,91", "1,0,0,2", "0,1,2,1", "0,0,0,1"} {
		t.Run(value, func(t *testing.T) {
			if _, err := ParseBounds(value); err == nil {
				t.Fatalf("accepted invalid bounds %q", value)
			}
		})
	}
	bounds, err := ParseBounds("74.40,31.46,74.42,31.48")
	if err != nil || bounds.West != 74.40 || bounds.North != 31.48 {
		t.Fatalf("wrong coordinate order: %+v, %v", bounds, err)
	}
}

func TestInvalidRequestsDoNotReachDatabase(t *testing.T) {
	handler := Handler{}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /areas/{id}", handler.GetArea)
	mux.HandleFunc("GET /places", handler.ListPlaces)
	for _, path := range []string{"/areas/not-a-uuid", "/places?bbox=NaN,0,1,2", "/places"} {
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, httptest.NewRequest("GET", path, nil))
		if response.Code != http.StatusBadRequest {
			t.Fatalf("%s: got %d", path, response.Code)
		}
	}
}
