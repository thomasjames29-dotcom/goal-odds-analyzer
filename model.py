"""Illustrative first-goal model, not an exchange-price or fill model."""

import math
from datetime import datetime


def parse_date(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def eligible_matches(matches, kickoff):
    result = []
    for match in matches:
        fixture = match["fixture"]
        score = match["goals"]
        if (fixture["status"]["short"] == "FT"
                and parse_date(fixture["date"]) < kickoff
                and isinstance(score["home"], int)
                and isinstance(score["away"], int)
                and score["home"] >= 0 and score["away"] >= 0):
            result.append(match)
    return result


def event_buckets(match, events):
    counts = [0] * 6
    for event in events:
        if event["type"] != "Goal" or event["detail"] not in (
                "Normal Goal", "Own Goal", "Penalty"):
            continue
        elapsed = event["time"]["elapsed"]
        if not isinstance(elapsed, int) or elapsed < 1:
            return None
        # API-Football represents stoppage time using elapsed=45/90 and extra.
        counts[min((elapsed - 1) // 15, 5)] += 1
    if sum(counts) != match["goals"]["home"] + match["goals"]["away"]:
        return None
    return counts


def validate_scenario(minute, commission, margin):
    if not 0 <= minute <= 75:
        raise ValueError("Entry minute must be between 0 and 75.")
    if not 0 <= commission <= 0.10 or not 0 <= margin <= 0.20:
        raise ValueError("Commission must be 0–10% and margin 0–20%.")


def analyze(home_matches, away_matches, events_by_id, minute, commission, margin):
    validate_scenario(minute, commission, margin)
    if len(home_matches) < 3 or len(away_matches) < 3:
        raise ValueError("At least three completed prior matches per team are required.")

    def shrunk_average(matches):
        goals = sum(m["goals"]["home"] + m["goals"]["away"] for m in matches)
        return (goals + 5 * 2.6) / (len(matches) + 5)

    expected_goals = (shrunk_average(home_matches) + shrunk_average(away_matches)) / 2
    unique = {m["fixture"]["id"]: m for m in home_matches + away_matches}
    buckets = [2] * 6
    usable = 0
    for fixture_id, match in unique.items():
        counts = event_buckets(match, events_by_id[fixture_id])
        if counts is not None:
            usable += 1
            buckets = [a + b for a, b in zip(buckets, counts)]
    if usable < 5:
        raise ValueError("At least five prior matches with complete goal-event data are required.")

    rates = [expected_goals * count / sum(buckets) for count in buckets]
    elapsed_hazard = sum(rate * max(0, min(15, minute - 15 * i)) / 15
                         for i, rate in enumerate(rates))
    remaining = expected_goals - elapsed_hazard
    probability = -math.expm1(-remaining)
    fair_price = 1 + (1 - probability) / (probability * (1 - commission))
    indicative = math.ceil(fair_price * (1 + margin) * 100 - 1e-10) / 100

    survival = 1.0
    first_goal = []
    for rate in rates:
        next_survival = survival * math.exp(-rate)
        first_goal.append(survival - next_survival)
        survival = next_survival
    return {
        "expected_goals": expected_goals,
        "probability_zero_zero": survival,
        "probability_goal_after_entry": probability,
        "probability_scoreless_at_entry": math.exp(-elapsed_hazard),
        "fair_price": fair_price,
        "indicative_price": indicative,
        "first_goal_by_segment": first_goal,
        "home_sample": len(home_matches),
        "away_sample": len(away_matches),
        "timing_sample": usable,
        "timing_excluded": len(unique) - usable,
    }
