# Goal Odds Analyzer

A local web app for exploring over 0.5 goals pricing with API-Football. It does not place bets.

## Run

Requires Python 3.10+ and an [API-Football](https://www.api-football.com/) account with access to the relevant fixtures and events.

```sh
export API_FOOTBALL_KEY="your-api-key"
python3 app.py
```

Open http://127.0.0.1:8000. Keep the key private; do not enter it into the app or commit it. The server listens only on localhost. Select a UTC fixture date, choose a not-yet-started fixture, and analyze it. The provider may restrict coverage, historical access, request rates or daily quota. Each analysis can use up to 23 API requests; errors and insufficient data are shown rather than replaced with invented data.

Run tests with `python3 -m unittest discover -s tests`.

## Interpretation and limitations

The app retrieves each team's 10 most recent finished matches, retaining only matches before the selected fixture. It uses full-time scores to estimate total goals, shrinking each team's average towards a fixed 2.6-goal prior by five matches. It pools goal events from unique eligible matches into six 15-minute segments and adds two prior goals to each segment. Event sets inconsistent with the final score are excluded from the timing sample. At least three completed matches per team and five matches with complete events are required.

A piecewise Poisson process converts those rates to first-goal timing and to the probability of at least one goal remaining **conditional on 0-0 at the chosen minute**. Stoppage-time goals are assigned to their half's final segment; extra-time fixtures are excluded. This model assumes independent goal arrivals and does not model xG, lineups, weather, competition-specific strength, home advantage, live match information or the possibility that a scoreless match is systematically different. It is not a Dixon-Coles model and is not calibrated or backtested.

The displayed indicative order price is the commission-adjusted break-even price multiplied by a user-selected margin, rounded up to two decimals. The margin is an assumption, not evidence of an edge. Round up again to a valid exchange tick if necessary. Actual exchange odds, commission, liquidity, matching, market suspensions, persistence and cancellation rules vary. The chosen minute is a scenario, **not a prediction of when an order will fill**; an order might fill earlier, later, partially, or not at all. Unmatched orders are not guaranteed to be cancelled after a goal: check your exchange's rules and manage them yourself. The app does not optimize expected profit, predict order fills, calculate stakes, or guarantee profitability. Do not use the estimates as a substitute for independent validation and responsible bankroll management.
