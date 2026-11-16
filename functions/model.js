export class AnalysisError extends Error {}

export function parseDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("Invalid date.");
  return parsed;
}

export function eligibleMatches(matches, kickoff) {
  return matches.filter(match => {
    const { fixture, goals } = match;
    return fixture.status.short === "FT"
      && parseDate(fixture.date) < kickoff
      && Number.isInteger(goals.home)
      && Number.isInteger(goals.away)
      && goals.home >= 0
      && goals.away >= 0;
  });
}

function eventBuckets(match, events) {
  const counts = Array(6).fill(0);
  for (const event of events) {
    if (event.type !== "Goal" || !["Normal Goal", "Own Goal", "Penalty"].includes(event.detail)) {
      continue;
    }
    const elapsed = event.time.elapsed;
    if (!Number.isInteger(elapsed) || elapsed < 1) return null;
    counts[Math.min(Math.floor((elapsed - 1) / 15), 5)] += 1;
  }
  const totalGoals = match.goals.home + match.goals.away;
  return counts.reduce((sum, count) => sum + count, 0) === totalGoals ? counts : null;
}

export function validateScenario(minute, commission, margin) {
  if (!Number.isInteger(minute) || minute < 0 || minute > 75) {
    throw new AnalysisError("Entry minute must be between 0 and 75.");
  }
  if (!Number.isFinite(commission) || !Number.isFinite(margin)
      || commission < 0 || commission > 0.1 || margin < 0 || margin > 0.2) {
    throw new AnalysisError("Commission must be 0–10% and margin 0–20%.");
  }
}

export function analyze(homeMatches, awayMatches, eventsById, minute, commission, margin) {
  validateScenario(minute, commission, margin);
  if (homeMatches.length < 3 || awayMatches.length < 3) {
    throw new AnalysisError("At least three completed prior matches per team are required.");
  }

  function shrunkAverage(matches) {
    const goals = matches.reduce((sum, match) => sum + match.goals.home + match.goals.away, 0);
    return (goals + 5 * 2.6) / (matches.length + 5);
  }

  const expectedGoals = (shrunkAverage(homeMatches) + shrunkAverage(awayMatches)) / 2;
  const unique = new Map([...homeMatches, ...awayMatches].map(match => [match.fixture.id, match]));
  let buckets = Array(6).fill(2);
  let usable = 0;
  for (const [fixtureId, match] of unique) {
    const counts = eventBuckets(match, eventsById.get(fixtureId));
    if (counts) {
      usable += 1;
      buckets = buckets.map((count, index) => count + counts[index]);
    }
  }
  if (usable < 5) {
    throw new AnalysisError("At least five prior matches with complete goal-event data are required.");
  }

  const bucketTotal = buckets.reduce((sum, count) => sum + count, 0);
  const rates = buckets.map(count => expectedGoals * count / bucketTotal);
  const elapsedHazard = rates.reduce((sum, rate, index) =>
    sum + rate * Math.max(0, Math.min(15, minute - 15 * index)) / 15, 0);
  const remaining = expectedGoals - elapsedHazard;
  const probability = -Math.expm1(-remaining);
  const fairPrice = 1 + (1 - probability) / (probability * (1 - commission));
  const indicativePrice = Math.ceil(fairPrice * (1 + margin) * 100 - 1e-10) / 100;

  let survival = 1;
  const firstGoal = [];
  for (const rate of rates) {
    const nextSurvival = survival * Math.exp(-rate);
    firstGoal.push(survival - nextSurvival);
    survival = nextSurvival;
  }
  return {
    expected_goals: expectedGoals,
    probability_zero_zero: survival,
    probability_goal_after_entry: probability,
    probability_scoreless_at_entry: Math.exp(-elapsedHazard),
    fair_price: fairPrice,
    indicative_price: indicativePrice,
    first_goal_by_segment: firstGoal,
    home_sample: homeMatches.length,
    away_sample: awayMatches.length,
    timing_sample: usable,
    timing_excluded: unique.size - usable,
  };
}
