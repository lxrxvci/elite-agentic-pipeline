"""Tests for the Google Places API adapter."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app.config import settings
from infrastructure.adapters.google_places import (
    PlaceDetails,
    _normalize_time_range,
    _parse_weekday_text,
    find_business,
    get_place_details,
    search_places,
)


def _place_response(place_id: str = "place_123", name: str = "Taco Fiesta") -> dict:
    return {
        "id": place_id,
        "displayName": {"text": name},
        "formattedAddress": "123 Main St, Austin, TX",
        "internationalPhoneNumber": "+1 555-123-4567",
        "websiteUri": "https://tacofiesta.example",
        "googleMapsUri": "https://maps.google.com/?q=place_123",
        "regularOpeningHours": {
            "weekdayDescriptions": [
                "Monday: 9:00 AM – 10:00 PM",
                "Tuesday: 11:30 AM – 9:00 PM",
                "Wednesday: Closed",
            ]
        },
        "photos": [{"name": "photo_1"}, {"name": "photo_2"}],
    }


class TestTimeNormalization:
    @pytest.mark.parametrize(
        "time_range, expected",
        [
            ("9:00 AM – 10:00 PM", "09:00-22:00"),
            ("11:30 AM - 9:00 PM", "11:30-21:00"),
            ("12:00 AM – 12:00 PM", "00:00-12:00"),
            ("12:00 PM – 12:00 AM", "12:00-00:00"),
            ("9 AM – 10 PM", "09:00-22:00"),
        ],
    )
    def test_normalize_time_range(self, time_range, expected):
        assert _normalize_time_range(time_range) == expected

    def test_normalize_invalid_time_range_returns_none(self):
        assert _normalize_time_range("not-a-time") is None

    def test_parse_weekday_text(self):
        weekday_text = [
            "Monday: 9:00 AM – 10:00 PM",
            "Tuesday: 11:30 AM – 9:00 PM",
            "Wednesday: Closed",
            "Sunday: 8 AM – 8 PM",
        ]
        hours = _parse_weekday_text(weekday_text)
        assert hours["monday"] == "09:00-22:00"
        assert hours["tuesday"] == "11:30-21:00"
        assert "wednesday" not in hours
        assert hours["sunday"] == "08:00-20:00"


class TestSearchPlaces:
    def test_returns_empty_list_without_api_key(self, monkeypatch):
        monkeypatch.setattr(settings, "google_places_api_key", "")
        assert search_places("Taco Fiesta") == []

    def test_returns_parsed_places(self, monkeypatch):
        monkeypatch.setattr(settings, "google_places_api_key", "fake-key")

        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.json.return_value = {"places": [_place_response()]}
        mock_response.raise_for_status.return_value = None
        mock_client.__enter__.return_value.post.return_value = mock_response
        mock_client.__exit__.return_value = False

        with patch("infrastructure.adapters.google_places.httpx.Client", return_value=mock_client):
            results = search_places("Taco Fiesta", location_bias="Austin, TX")

        assert len(results) == 1
        place = results[0]
        assert place.place_id == "place_123"
        assert place.name == "Taco Fiesta"
        assert place.address == "123 Main St, Austin, TX"
        assert place.phone == "+1 555-123-4567"
        assert place.website == "https://tacofiesta.example"
        assert place.google_maps_url == "https://maps.google.com/?q=place_123"
        assert place.hours["monday"] == "09:00-22:00"
        assert place.photo_references == ["photo_1", "photo_2"]

    def test_http_error_returns_empty_list(self, monkeypatch):
        monkeypatch.setattr(settings, "google_places_api_key", "fake-key")

        mock_client = MagicMock()
        mock_client.__enter__.return_value.post.side_effect = Exception("API error")
        mock_client.__exit__.return_value = False

        with patch("infrastructure.adapters.google_places.httpx.Client", return_value=mock_client):
            assert search_places("Taco Fiesta") == []


class TestFindBusiness:
    def test_returns_best_name_match(self, monkeypatch):
        monkeypatch.setattr(settings, "google_places_api_key", "fake-key")

        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "places": [
                _place_response(place_id="p1", name="Taco Fiesta Truck"),
                _place_response(place_id="p2", name="Burrito Barn"),
            ]
        }
        mock_response.raise_for_status.return_value = None
        mock_client.__enter__.return_value.post.return_value = mock_response
        mock_client.__exit__.return_value = False

        with patch("infrastructure.adapters.google_places.httpx.Client", return_value=mock_client):
            result = find_business("Taco Fiesta", location_hints=["Austin, TX"])

        assert result is not None
        assert result.place_id == "p1"

    def test_returns_first_result_when_no_name_match(self, monkeypatch):
        monkeypatch.setattr(settings, "google_places_api_key", "fake-key")

        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "places": [
                _place_response(place_id="p2", name="Burrito Barn"),
            ]
        }
        mock_response.raise_for_status.return_value = None
        mock_client.__enter__.return_value.post.return_value = mock_response
        mock_client.__exit__.return_value = False

        with patch("infrastructure.adapters.google_places.httpx.Client", return_value=mock_client):
            result = find_business("Taco Fiesta")

        assert result is not None
        assert result.place_id == "p2"

    def test_returns_none_for_empty_results(self, monkeypatch):
        monkeypatch.setattr(settings, "google_places_api_key", "fake-key")

        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.json.return_value = {"places": []}
        mock_response.raise_for_status.return_value = None
        mock_client.__enter__.return_value.post.return_value = mock_response
        mock_client.__exit__.return_value = False

        with patch("infrastructure.adapters.google_places.httpx.Client", return_value=mock_client):
            assert find_business("Taco Fiesta") is None


class TestGetPlaceDetails:
    def test_returns_none_without_api_key(self, monkeypatch):
        monkeypatch.setattr(settings, "google_places_api_key", "")
        assert get_place_details("place_123") is None

    def test_fetches_and_parses_details(self, monkeypatch):
        monkeypatch.setattr(settings, "google_places_api_key", "fake-key")

        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.json.return_value = _place_response()
        mock_response.raise_for_status.return_value = None
        mock_client.__enter__.return_value.get.return_value = mock_response
        mock_client.__exit__.return_value = False

        with patch("infrastructure.adapters.google_places.httpx.Client", return_value=mock_client):
            result = get_place_details("place_123")

        assert isinstance(result, PlaceDetails)
        assert result.name == "Taco Fiesta"
        assert result.hours["monday"] == "09:00-22:00"
