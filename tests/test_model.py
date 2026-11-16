import math
import json
import threading
import unittest
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import urlopen

import app
from model import analyze, eligible_matches, event_buckets


def match(i, home=1, away=1, date="2025-01-01T12:00:00+00:00", status="FT"):
    return {"fixture": {"id": i, "date": date, "status": {"short": status}},
            "goals": {"home": home, "away": away}}


def goal(minute, extra=None):
    return {"type": "Goal", "detail": "Normal Goal",
            "time": {"elapsed": minute, "extra": extra}}


class ModelTests(unittest.TestCase):
    def setUp(self):
        self.home = [match(i) for i in range(1, 4)]
        self.away = [match(i) for i in range(4, 7)]
        self.events = {i: [goal(10), goal(90, 4)] for i in range(1, 7)}

    def test_timing_and_commission_adjusted_price(self):
        result = analyze(self.home, self.away, self.events, 45, 0.05, 0.05)
        p = result["probability_goal_after_entry"]
        self.assertAlmostEqual(result["fair_price"], 1 + (1 - p) / (p * .95))
        self.assertGreaterEqual(result["indicative_price"], result["fair_price"] * 1.05)
        self.assertAlmostEqual(sum(result["first_goal_by_segment"]) + result["probability_zero_zero"], 1)
        self.assertGreater(result["first_goal_by_segment"][0], result["first_goal_by_segment"][1])
        self.assertEqual(result["timing_sample"], 6)

    def test_scoreless_entry_decreases_and_fair_price_increases(self):
        early = analyze(self.home, self.away, self.events, 0, 0, 0)
        late = analyze(self.home, self.away, self.events, 75, 0, 0)
        self.assertAlmostEqual(early["probability_scoreless_at_entry"], 1)
        self.assertLess(late["probability_scoreless_at_entry"], 1)
        self.assertGreater(late["fair_price"], early["fair_price"])

    def test_stoppage_and_incomplete_events(self):
        m = match(1)
        self.assertEqual(event_buckets(m, [goal(45, 2), goal(90, 5)]), [0, 0, 1, 0, 0, 1])
        self.assertIsNone(event_buckets(m, [goal(45)]))
        self.events[1] = []
        self.events[2] = []
        with self.assertRaisesRegex(ValueError, "five prior matches"):
            analyze(self.home, self.away, self.events, 45, .05, .05)

    def test_eligible_matches_exclude_future_and_non_ft(self):
        cutoff = datetime(2025, 1, 2, tzinfo=timezone.utc)
        prior = match(1)
        matches = [prior, match(2, date="2025-01-03T00:00:00+00:00"), match(3, status="AET")]
        self.assertEqual(eligible_matches(matches, cutoff), [prior])

    def test_invalid_inputs(self):
        for minute, commission, margin in [(76, 0, 0), (45, -1, 0), (45, 0, math.nan)]:
            with self.subTest(minute=minute, commission=commission, margin=margin):
                with self.assertRaises(ValueError):
                    analyze(self.home, self.away, self.events, minute, commission, margin)

    def test_duplicate_fixture_not_double_counted_in_timing_sample(self):
        home = self.home
        away = [self.home[0], *self.away]
        result = analyze(home, away, self.events, 45, 0, 0)
        self.assertEqual(result["timing_sample"], 6)


class IntegrationTests(unittest.TestCase):
    def test_fixture_analysis_fetches_deduplicated_events(self):
        upcoming = match(99, date="2099-01-01T12:00:00+00:00", status="NS")
        upcoming["teams"] = {"home": {"id": 1, "name": "Home"}, "away": {"id": 2, "name": "Away"}}
        upcoming["league"] = {"name": "League", "country": "Country"}
        history = [match(i) for i in range(1, 7)]

        def fake_api(path, params):
            if path == "/fixtures/events":
                return [goal(10), goal(90)]
            if "id" in params:
                return [upcoming]
            return history[:3] if params["team"] == 1 else history[3:]

        with patch.object(app, "api_get", side_effect=fake_api) as api:
            result = app.analyze_fixture(99, 45, .05, .05)
        self.assertEqual(result["fixture"]["home"], "Home")
        self.assertEqual(result["analysis"]["timing_sample"], 6)
        self.assertEqual(api.call_count, 9)

    def test_rejects_started_fixture(self):
        with patch.object(app, "api_get", return_value=[match(1)]):
            with self.assertRaisesRegex(ValueError, "not started"):
                app.analyze_fixture(1, 45, .05, .05)

    def test_invalid_scenario_does_not_consume_api_requests(self):
        with patch.object(app, "api_get") as api:
            with self.assertRaises(ValueError):
                app.analyze_fixture(1, 90, .05, .05)
            api.assert_not_called()

    def test_http_routes_serve_ui_and_surface_provider_errors(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        try:
            url = f"http://127.0.0.1:{server.server_port}"
            with urlopen(url) as response:
                self.assertIn(b"Goal Odds Analyzer", response.read())
            with patch.object(app, "api_get", side_effect=app.ProviderError("quota exceeded")):
                with self.assertRaises(HTTPError) as raised:
                    urlopen(url + "/api/fixtures?date=2026-01-01")
                self.assertEqual(raised.exception.code, 502)
                self.assertEqual(json.load(raised.exception)["error"], "quota exceeded")
        finally:
            server.shutdown()
            thread.join()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
