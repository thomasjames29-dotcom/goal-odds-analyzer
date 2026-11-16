import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("../static/app.js", import.meta.url), "utf8");

function getJSONWithResponse(response) {
  const element = { addEventListener() {} };
  const context = {
    document: { querySelector: () => element },
    navigator: {},
    fetch: async () => response,
    SyntaxError,
  };
  runInNewContext(source, context);
  return context.getJSON("/api/fixtures");
}

test("reports HTML responses as a deployment or sign-in problem", async () => {
  const response = new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } });
  await assert.rejects(getJSONWithResponse(response), /Pages Functions.*sign in/i);
});

test("preserves API errors and reports invalid JSON", async () => {
  const errorResponse = Response.json({ error: "API key missing" }, { status: 502 });
  await assert.rejects(getJSONWithResponse(errorResponse), /API key missing/);
  const invalidResponse = new Response("{", { status: 500 });
  await assert.rejects(getJSONWithResponse(invalidResponse), /invalid API response \(500\)/);
});
