import { AnalysisError } from "../model.js";

const BASE_URL = "https://v3.football.api-sports.io";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class ProviderError extends Error {}

export function jsonResponse(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function errorResponse(error) {
  if (error instanceof HttpError) return jsonResponse(error.status, { error: error.message });
  if (error instanceof ProviderError) return jsonResponse(502, { error: error.message });
  if (error instanceof AnalysisError) return jsonResponse(400, { error: error.message });
  console.error(error);
  return jsonResponse(500, { error: "Internal server error." });
}

export function parseDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, "Invalid date.");
  return date;
}

export function fixtureSummary(match) {
  return {
    id: match.fixture.id,
    date: match.fixture.date,
    league: match.league.name,
    country: match.league.country,
    home: match.teams.home.name,
    away: match.teams.away.name,
  };
}

function rateLimitError(response) {
  const limit = response.headers.get("x-ratelimit-limit");
  const detail = limit && /^\d{1,6}$/.test(limit) ? ` The provider reports a limit of ${limit} requests per minute.` : "";
  return new ProviderError(`API-Football reports a request rate limit.${detail} Wait a minute and try again.`);
}

export async function apiGet(path, params, env) {
  if (env.API_FOOTBALL_KEY === undefined || env.API_FOOTBALL_KEY === null) {
    throw new ProviderError("Cloudflare did not bind API_FOOTBALL_KEY to this deployment.");
  }
  if (typeof env.API_FOOTBALL_KEY !== "string") {
    throw new ProviderError("Cloudflare bound API_FOOTBALL_KEY, but it is not a text secret.");
  }
  if (!env.API_FOOTBALL_KEY.trim()) {
    throw new ProviderError("Cloudflare bound API_FOOTBALL_KEY, but its value is empty.");
  }
  const url = new URL(`${BASE_URL}${path}`);
  url.search = new URLSearchParams(params);
  let response;
  try {
    response = await fetch(url, {
      headers: { "x-apisports-key": env.API_FOOTBALL_KEY },
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new ProviderError("Could not reach API-Football. Check your connection.");
  }
  if (response.status === 429) {
    throw rateLimitError(response);
  }
  if (!response.ok) throw new ProviderError(`API-Football returned HTTP ${response.status}.`);
  let data;
  try {
    data = await response.json();
  } catch {
    throw new ProviderError("API-Football returned invalid JSON.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ProviderError("API-Football returned an unexpected response.");
  }
  const errors = data.errors;
  if (errors && typeof errors === "object" && Object.keys(errors).length === 1 && errors.rateLimit) {
    throw rateLimitError(response);
  }
  if (errors && (typeof errors !== "object" || Object.keys(errors).length > 0)) {
    throw new ProviderError(`API-Football error: ${JSON.stringify(errors)}`);
  }
  if (!Array.isArray(data.response)) {
    throw new ProviderError("API-Football returned an unexpected response.");
  }
  return data.response;
}
