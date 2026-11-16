import { analyze, eligibleMatches, validateScenario } from "../model.js";
import { apiGet, errorResponse, fixtureSummary, HttpError, jsonResponse, parseDate } from "./_shared.js";

function requiredInteger(params, name) {
  const value = params.get(name);
  if (!value || !/^-?\d+$/.test(value)) throw new HttpError(400, `Invalid ${name}.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new HttpError(400, `Invalid ${name}.`);
  return parsed;
}

function requiredNumber(params, name) {
  const value = params.get(name);
  if (!value || !/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) {
    throw new HttpError(400, `Invalid ${name}.`);
  }
  return Number(value);
}

export async function onRequestGet({ request, env }) {
  try {
    const params = new URL(request.url).searchParams;
    const fixtureId = requiredInteger(params, "id");
    const minute = requiredInteger(params, "minute");
    const commission = requiredNumber(params, "commission") / 100;
    const margin = requiredNumber(params, "margin") / 100;
    if (fixtureId <= 0) throw new HttpError(400, "Invalid fixture ID.");
    validateScenario(minute, commission, margin);

    const fixtures = await apiGet("/fixtures", { id: fixtureId }, env);
    if (fixtures.length !== 1) throw new HttpError(400, "Fixture not found.");
    const match = fixtures[0];
    const kickoff = parseDate(match.fixture.date);
    if (match.fixture.status.short !== "NS" || kickoff <= new Date()) {
      throw new HttpError(400, "Only fixtures that have not started can be analyzed.");
    }

    const histories = [];
    for (const side of ["home", "away"]) {
      const raw = await apiGet("/fixtures", {
        team: match.teams[side].id,
        last: 10,
      }, env);
      histories.push(eligibleMatches(raw, kickoff));
    }
    if (histories.some(history => history.length < 3)) {
      throw new HttpError(400, "At least three completed prior matches per team are required.");
    }

    const ids = new Set(histories.flatMap(history => history.map(item => item.fixture.id)));
    const eventsById = new Map();
    for (const id of ids) {
      eventsById.set(id, await apiGet("/fixtures/events", { fixture: id }, env));
    }
    const result = analyze(...histories, eventsById, minute, commission, margin);
    return jsonResponse(200, { fixture: fixtureSummary(match), analysis: result });
  } catch (error) {
    return errorResponse(error);
  }
}
