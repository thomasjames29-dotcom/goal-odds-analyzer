const dateInput = document.querySelector("#date");
const fixtureSelect = document.querySelector("#fixture");
const analyzeButton = document.querySelector("#analyze");
const status = document.querySelector("#status");
const results = document.querySelector("#results");
dateInput.value = new Date().toISOString().slice(0, 10);

async function getJSON(path) {
  const response = await fetch(path);
  if ((response.headers.get("content-type") || "").includes("text/html")) {
    throw new Error("The server returned a web page instead of API data. Check that Cloudflare Pages Functions are deployed and sign in again if the site is protected.");
  }
  let data;
  try {
    data = await response.json();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error(`The server returned an invalid API response (${response.status}).`);
  }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

document.querySelector("#fixtures-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  fixtureSelect.disabled = true;
  analyzeButton.disabled = true;
  results.hidden = true;
  status.textContent = "Loading fixtures…";
  fixtureSelect.replaceChildren(new Option("Select a fixture", ""));
  try {
    const fixtures = await getJSON(`/api/fixtures?${new URLSearchParams({date: dateInput.value})}`);
    for (const fixture of fixtures) {
      const time = new Date(fixture.date).toISOString().slice(11, 16);
      fixtureSelect.add(new Option(`${time} UTC · ${fixture.home} vs ${fixture.away} · ${fixture.league}, ${fixture.country}`, fixture.id));
    }
    fixtureSelect.disabled = fixtures.length === 0;
    status.textContent = fixtures.length ? `${fixtures.length} upcoming fixtures found.` : "No upcoming fixtures found for this UTC date.";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

fixtureSelect.addEventListener("change", () => {
  analyzeButton.disabled = !fixtureSelect.value;
  results.hidden = true;
});

document.querySelector("#analysis-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!fixtureSelect.value) return;
  analyzeButton.disabled = true;
  fixtureSelect.disabled = true;
  results.hidden = true;
  status.textContent = "Loading recent matches and goal events. Requests are spaced out to avoid rate limits, so this may take 30 seconds or more…";
  const params = new URLSearchParams({
    id: fixtureSelect.value,
    minute: document.querySelector("#minute").value,
    commission: document.querySelector("#commission").value,
    margin: document.querySelector("#margin").value
  });
  try {
    const {fixture, analysis} = await getJSON(`/api/analyze?${params}`);
    const pct = n => `${(n * 100).toFixed(1)}%`;
    document.querySelector("#match-title").textContent = `${fixture.home} vs ${fixture.away}`;
    document.querySelector("#match-meta").textContent = `${fixture.league} · ${fixture.country} · ${new Date(fixture.date).toUTCString()} · entry minute ${params.get("minute")}`;
    document.querySelector("#price").textContent = analysis.indicative_price.toFixed(2);
    document.querySelector("#fair").textContent = analysis.fair_price.toFixed(3);
    document.querySelector("#remaining").textContent = pct(analysis.probability_goal_after_entry);
    document.querySelector("#scoreless").textContent = pct(analysis.probability_scoreless_at_entry);
    const segments = document.querySelector("#segments");
    segments.replaceChildren();
    analysis.first_goal_by_segment.forEach((value, i) => {
      const row = document.createElement("div");
      row.className = "segment";
      const label = document.createElement("span");
      label.textContent = `${i * 15 + 1}–${(i + 1) * 15}′`;
      const track = document.createElement("div");
      track.className = "track";
      const bar = document.createElement("div");
      bar.className = "bar";
      bar.style.width = `${value * 100}%`;
      track.append(bar);
      const number = document.createElement("span");
      number.textContent = pct(value);
      row.append(label, track, number);
      segments.append(row);
    });
    document.querySelector("#summary").textContent = `Estimated full-time 0–0: ${pct(analysis.probability_zero_zero)}. Expected total goals: ${analysis.expected_goals.toFixed(2)}. Recent matches: ${analysis.home_sample} home team, ${analysis.away_sample} away team. Timing sample: ${analysis.timing_sample} unique matches (${analysis.timing_excluded} excluded for incomplete events).`;
    results.hidden = false;
    status.textContent = "";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    fixtureSelect.disabled = false;
    analyzeButton.disabled = !fixtureSelect.value;
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(error => {
      console.error("Could not register the app's offline shell.", error);
    });
  });
}
