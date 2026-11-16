"""Local API-Football fixture explorer."""

import json
import os
import re
import sys
from datetime import date, datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import Request, urlopen

from model import analyze, eligible_matches, parse_date, validate_scenario

ROOT = Path(__file__).resolve().parent
BASE_URL = "https://v3.football.api-sports.io"


class ProviderError(Exception):
    pass


def api_get(path, params):
    key = os.environ.get("API_FOOTBALL_KEY")
    if not key:
        raise ProviderError("Set API_FOOTBALL_KEY before starting the app.")
    request = Request(BASE_URL + path + "?" + urlencode(params),
                      headers={"x-apisports-key": key})
    try:
        with urlopen(request, timeout=20) as response:
            data = json.load(response)
    except HTTPError as exc:
        raise ProviderError(f"API-Football returned HTTP {exc.code}.") from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise ProviderError("Could not reach API-Football. Check your connection.") from exc
    except (ValueError, UnicodeError) as exc:
        raise ProviderError("API-Football returned invalid JSON.") from exc
    if not isinstance(data, dict):
        raise ProviderError("API-Football returned an unexpected response.")
    if data.get("errors"):
        raise ProviderError("API-Football error: " + json.dumps(data["errors"]))
    if not isinstance(data.get("response"), list):
        raise ProviderError("API-Football returned an unexpected response.")
    return data["response"]


def fixture_summary(match):
    return {
        "id": match["fixture"]["id"],
        "date": match["fixture"]["date"],
        "league": match["league"]["name"],
        "country": match["league"]["country"],
        "home": match["teams"]["home"]["name"],
        "away": match["teams"]["away"]["name"],
    }


def list_fixtures(day):
    date.fromisoformat(day)
    now = datetime.now(timezone.utc)
    matches = api_get("/fixtures", {"date": day, "timezone": "UTC"})
    return [fixture_summary(m) for m in matches
            if m["fixture"]["status"]["short"] == "NS"
            and parse_date(m["fixture"]["date"]) > now]


def analyze_fixture(fixture_id, minute, commission, margin):
    validate_scenario(minute, commission, margin)
    matches = api_get("/fixtures", {"id": fixture_id})
    if len(matches) != 1:
        raise ValueError("Fixture not found.")
    match = matches[0]
    kickoff = parse_date(match["fixture"]["date"])
    if match["fixture"]["status"]["short"] != "NS" or kickoff <= datetime.now(timezone.utc):
        raise ValueError("Only fixtures that have not started can be analyzed.")
    histories = []
    for side in ("home", "away"):
        raw = api_get("/fixtures", {"team": match["teams"][side]["id"], "last": 10})
        histories.append(eligible_matches(raw, kickoff))
    if any(len(history) < 3 for history in histories):
        raise ValueError("At least three completed prior matches per team are required.")
    ids = {m["fixture"]["id"] for history in histories for m in history}
    events = {fixture_id: api_get("/fixtures/events", {"fixture": fixture_id})
              for fixture_id in ids}
    result = analyze(*histories, events, minute, commission, margin)
    return {"fixture": fixture_summary(match), "analysis": result}


class Handler(BaseHTTPRequestHandler):
    def send_data(self, status, content_type, body):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, status, value):
        self.send_data(status, "application/json; charset=utf-8",
                       json.dumps(value, allow_nan=False).encode())

    def do_GET(self):
        url = urlsplit(self.path)
        if url.path in ("/", "/style.css", "/app.js"):
            files = {"/": ("index.html", "text/html"),
                     "/style.css": ("style.css", "text/css"),
                     "/app.js": ("app.js", "text/javascript")}
            name, content_type = files[url.path]
            self.send_data(200, content_type + "; charset=utf-8", (ROOT / "static" / name).read_bytes())
            return
        try:
            params = parse_qs(url.query)
            if url.path == "/api/fixtures":
                day = params["date"][0]
                if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
                    raise ValueError("Date must use YYYY-MM-DD.")
                self.send_json(200, list_fixtures(day))
            elif url.path == "/api/analyze":
                fixture_id = int(params["id"][0])
                minute = int(params["minute"][0])
                commission = float(params["commission"][0]) / 100
                margin = float(params["margin"][0]) / 100
                if fixture_id <= 0:
                    raise ValueError("Invalid fixture ID.")
                self.send_json(200, analyze_fixture(fixture_id, minute, commission, margin))
            else:
                self.send_json(404, {"error": "Not found."})
        except (ValueError, KeyError, IndexError) as exc:
            self.send_json(400, {"error": str(exc) or "Invalid request."})
        except ProviderError as exc:
            self.send_json(502, {"error": str(exc)})


if __name__ == "__main__":
    if not os.environ.get("API_FOOTBALL_KEY"):
        print("Set API_FOOTBALL_KEY before starting the app.", file=sys.stderr)
        sys.exit(1)
    server = ThreadingHTTPServer(("127.0.0.1", 8000), Handler)
    print("Open http://127.0.0.1:8000", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
