import assert from "node:assert/strict";
import test from "node:test";

import { analyze, eligibleMatches } from "../functions/model.js";
import { apiGet } from "../functions/api/_shared.js";
import { onRequestGet as listFixtures } from "../functions/api/fixtures.js";
import { onRequestGet as analyzeFixture } from "../functions/api/analyze.js";

function match(id, home = 1, away = 1, date = "2025-01-01T12:00:00Z", status = "FT") {
  return {
    fixture: { id, date, status: { short: status } },
    goals: { home, away },
  };
}

function goal(minute, detail = "Normal Goal") {
  return { type: "Goal", detail, time: { elapsed: minute } };
}

test("Cloudflare model produces valid first-goal and conditional probabilities", () => {
  const home = [match(1), match(2), match(3)];
  const away = [match(4), match(5), match(6)];
  const events = new Map([...home, ...away].map(item => [item.fixture.id, [goal(10), goal(90)]]));
  const result = analyze(home, away, events, 45, 0.05, 0.05);

  assert.equal(result.timing_sample, 6);
  assert.equal(result.first_goal_by_segment.length, 6);
  assert.ok(Math.abs(result.first_goal_by_segment.reduce((sum, value) => sum + value, 0)
    + result.probability_zero_zero - 1) < 1e-12);
});

test("Cloudflare model excludes future and unfinished matches", () => {
  const cutoff = new Date("2025-01-02T00:00:00Z");
  assert.deepEqual(eligibleMatches([
    match(1),
    match(2, 1, 1, "2025-01-03T00:00:00Z"),
    match(3, 1, 1, "2025-01-01T00:00:00Z", "AET"),
  ], cutoff).map(item => item.fixture.id), [1]);
});

test("fixture route rejects malformed dates and reports a missing secret", async () => {
  const malformed = await listFixtures({
    request: new Request("https://example.test/api/fixtures?date=not-a-date"),
    env: {},
  });
  assert.equal(malformed.status, 400);

  const missingSecret = await listFixtures({
    request: new Request("https://example.test/api/fixtures?date=2026-01-01"),
    env: {},
  });
  assert.equal(missingSecret.status, 502);
  assert.match((await missingSecret.json()).error, /did not bind API_FOOTBALL_KEY/);

  const emptySecret = await listFixtures({
    request: new Request("https://example.test/api/fixtures?date=2026-01-01"),
    env: { API_FOOTBALL_KEY: "" },
  });
  assert.equal(emptySecret.status, 502);
  assert.match((await emptySecret.json()).error, /value is empty/);

  const nonTextSecret = await listFixtures({
    request: new Request("https://example.test/api/fixtures?date=2026-01-01"),
    env: { API_FOOTBALL_KEY: {} },
  });
  assert.equal(nonTextSecret.status, 502);
  assert.match((await nonTextSecret.json()).error, /not a text secret/);
});

test("analysis route rejects invalid scenarios before API calls", async () => {
  const response = await analyzeFixture({
    request: new Request("https://example.test/api/analyze?id=1&minute=76&commission=5&margin=5"),
    env: {},
  });
  assert.equal(response.status, 400);
});

test("retries per-minute rate limits once without restarting earlier requests", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return requests === 1
      ? Response.json({ errors: { rateLimit: "Too many requests." }, response: [] })
      : Response.json({ errors: [], response: ["fixture"] });
  };
  try {
    const result = apiGet("/fixtures", {}, { API_FOOTBALL_KEY: "test-secret" });
    await new Promise(setImmediate);
    assert.equal(requests, 1);
    t.mock.timers.tick(64999);
    await new Promise(setImmediate);
    assert.equal(requests, 1);
    t.mock.timers.tick(1);
    assert.deepEqual(await result, ["fixture"]);
    assert.equal(requests, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reports a persistent HTTP rate limit after one retry", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return new Response(null, { status: 429 });
  };
  try {
    const result = apiGet("/fixtures", {}, { API_FOOTBALL_KEY: "test-secret" });
    const rejection = assert.rejects(result, /rate limit is still exceeded/);
    await new Promise(setImmediate);
    t.mock.timers.tick(65000);
    await rejection;
    assert.equal(requests, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("analysis continues across rate limits without repeating successful requests", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const upcoming = match(99, 0, 0, "2099-01-01T12:00:00Z", "NS");
  upcoming.teams = { home: { id: 1, name: "Home" }, away: { id: 2, name: "Away" } };
  upcoming.league = { name: "League", country: "Country" };
  const history = Array.from({ length: 20 }, (_, i) => match(i + 1));
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async input => {
    requests++;
    if (requests === 11 || requests === 22) {
      return Response.json({ errors: { rateLimit: "Too many requests." }, response: [] });
    }
    const url = new URL(input);
    if (url.pathname === "/fixtures/events") {
      return Response.json({ errors: [], response: [goal(10), goal(90)] });
    }
    if (url.searchParams.has("id")) {
      return Response.json({ errors: [], response: [upcoming] });
    }
    return Response.json({
      errors: [],
      response: Number(url.searchParams.get("team")) === 1 ? history.slice(0, 10) : history.slice(10),
    });
  };
  try {
    const result = analyzeFixture({
      request: new Request("https://example.test/api/analyze?id=99&minute=45&commission=5&margin=5"),
      env: { API_FOOTBALL_KEY: "test-secret" },
    });
    await new Promise(setImmediate);
    assert.equal(requests, 11);
    t.mock.timers.tick(65000);
    await new Promise(setImmediate);
    assert.equal(requests, 22);
    t.mock.timers.tick(65000);
    const response = await result;
    assert.equal(response.status, 200);
    assert.equal((await response.json()).analysis.timing_sample, 20);
    assert.equal(requests, 25);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("analysis route fetches and deduplicates prior match events", async () => {
  const upcoming = match(99, 0, 0, "2099-01-01T12:00:00Z", "NS");
  upcoming.teams = { home: { id: 1, name: "Home" }, away: { id: 2, name: "Away" } };
  upcoming.league = { name: "League", country: "Country" };
  const history = [match(1), match(2), match(3), match(4), match(5), match(6)];
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(input);
    requests.push({ url, init });
    if (url.pathname === "/fixtures/events") {
      return Response.json({ errors: [], response: [goal(10), goal(90)] });
    }
    if (url.searchParams.has("id")) {
      return Response.json({ errors: [], response: [upcoming] });
    }
    return Response.json({
      errors: [],
      response: Number(url.searchParams.get("team")) === 1 ? history.slice(0, 3) : history.slice(3),
    });
  };
  try {
    const response = await analyzeFixture({
      request: new Request("https://example.test/api/analyze?id=99&minute=45&commission=5&margin=5"),
      env: { API_FOOTBALL_KEY: "test-secret" },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.fixture.home, "Home");
    assert.equal(body.analysis.timing_sample, 6);
    assert.equal(requests.length, 9);
    assert.ok(requests.every(({ init }) => init.headers["x-apisports-key"] === "test-secret"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
