# Goal Odds Analyzer

A local web app for exploring over 0.5 goals pricing with API-Football. It does not place bets.

## Run

Requires Python 3.10+. An [API-Football](https://www.api-football.com/) key with access to the relevant fixtures and events is required to load fixture data.

```sh
export API_FOOTBALL_KEY="your-api-key"
python3 app.py
```

Open http://127.0.0.1:8000. Keep the key private; do not enter it into the app or commit it. The local server listens only on localhost. Select a UTC fixture date, choose a not-yet-started fixture, and analyze it. The provider may restrict coverage, historical access, request rates or daily quota. Each analysis can use up to 23 API requests; errors and insufficient data are shown rather than replaced with invented data.

Run the local-app tests with `python3 -m unittest discover -s tests` and the Cloudflare backend tests with `npm run test:worker`.

## Deploy on Cloudflare and install on a phone

Create a Cloudflare Pages project connected to this repository. Leave the build command empty and set the build output directory to `static`; the Pages Functions under `functions/` provide the API routes. Add `API_FOOTBALL_KEY` as a secret in the Pages project's **Settings → Variables and Secrets** for the production environment, then deploy. If you are opening a preview deployment, add the secret to the preview environment too. Trigger a new deployment after changing a secret so the Functions receive it. Never commit the key or put it in a frontend variable. Use a Pages deployment, not a Workers deploy command such as `npx wrangler deploy`.

The project is configured through the Pages dashboard rather than a Wrangler configuration file. Set the Pages Functions compatibility date in the dashboard if needed. If migrating an existing deployment from a Wrangler file, deploy after removing the file, check the dashboard settings and redeploy after any changes.

API-Football applies per-minute limits separately from its daily quota. An analysis can use up to 23 requests and may exceed the per-minute limit on lower-rate plans, particularly if other applications use the same key.
Make sure the branch deployed by Cloudflare contains the `functions/` directory; local, uncommitted changes are not deployed from GitHub. To check the deployed API, open `/api/fixtures?date=invalid` on your site's address: it should return a JSON error, not an HTML page. If it returns HTML, check the deployed branch, Pages project root and Functions build logs. A Cloudflare Access sign-in page can also return HTML if your session has expired.

The Pages URL is public by default. Although the API key remains server-side, anyone can call the endpoints and use your API quota; for personal use, protect the site with Cloudflare Access before sharing the URL.

Open the deployed HTTPS address on your phone. On iPhone, use Safari's **Share → Add to Home Screen**; on Android, use Chrome's **Install app** or **Add to Home screen** menu item. The app shell is cached for launch, but fixture loading and analysis require an internet connection.

## Interpretation and limitations

The app retrieves each team's 10 most recent finished matches, retaining only matches before the selected fixture. It uses full-time scores to estimate total goals, shrinking each team's average towards a fixed 2.6-goal prior by five matches. It pools goal events from unique eligible matches into six 15-minute segments and adds two prior goals to each segment. Event sets inconsistent with the final score are excluded from the timing sample. At least three completed matches per team and five matches with complete events are required.

A piecewise Poisson process converts those rates to first-goal timing and to the probability of at least one goal remaining **conditional on 0-0 at the chosen minute**. Stoppage-time goals are assigned to their half's final segment; extra-time fixtures are excluded. This model assumes independent goal arrivals and does not model xG, lineups, weather, competition-specific strength, home advantage, live match information or the possibility that a scoreless match is systematically different. It is not a Dixon-Coles model and is not calibrated or backtested.

The displayed indicative order price is the commission-adjusted break-even price multiplied by a user-selected margin, rounded up to two decimals. The margin is an assumption, not evidence of an edge. Round up again to a valid exchange tick if necessary. Actual exchange odds, commission, liquidity, matching, market suspensions, persistence and cancellation rules vary. The chosen minute is a scenario, **not a prediction of when an order will fill**; an order might fill earlier, later, partially, or not at all. Unmatched orders are not guaranteed to be cancelled after a goal: check your exchange's rules and manage them yourself. The app does not optimize expected profit, predict order fills, calculate stakes, or guarantee profitability. Do not use the estimates as a substitute for independent validation and responsible bankroll management.
