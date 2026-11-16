import { apiGet, errorResponse, fixtureSummary, HttpError, jsonResponse, parseDate } from "./_shared.js";

export async function onRequestGet({ request, env }) {
  try {
    const day = new URL(request.url).searchParams.get("date");
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)
        || Number.isNaN(Date.parse(`${day}T00:00:00Z`))
        || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) {
      throw new HttpError(400, "Date must use YYYY-MM-DD.");
    }
    const now = new Date();
    const matches = await apiGet("/fixtures", { date: day, timezone: "UTC" }, env);
    const fixtures = matches.filter(match => match.fixture.status.short === "NS"
      && parseDate(match.fixture.date) > now).map(fixtureSummary);
    return jsonResponse(200, fixtures);
  } catch (error) {
    return errorResponse(error);
  }
}
