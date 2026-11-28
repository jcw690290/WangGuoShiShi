import assert from "node:assert/strict";
import { test } from "node:test";
import { advanceDay, createGame, dispatch, getGameDate, isScenarioFinished, spanDays } from "../src/game/engine.ts";
import { parseSave, saveVersion } from "../src/game/storage.ts";
import { borderScenario, scenario } from "../src/scenario/scenario.ts";

const countryId = "country_29";
const deadline = 1096;
const spans = [
  ["day", "advanceDay"],
  ["week", "advanceWeek"],
  ["halfYear", "advanceHalfYear"],
] as const;

test("世界剧本截断全部推进跨度，期末停止日步进与玩家指令", () => {
  const start = dispatch(scenario, createGame(scenario), { type: "selectCountry", countryId });
  const eve = { ...start, elapsedDays: deadline - 1 };
  const result = advanceDay(scenario, eve);
  assert.equal(getGameDate(scenario, result).toISOString().slice(0, 10), "1823-01-01");
  assert.equal(isScenarioFinished(scenario, eve), false);
  assert.equal(isScenarioFinished(scenario, result), true);
  for (const [span, type] of spans) {
    assert.equal(spanDays(scenario, eve, span), 1);
    assert.deepEqual(dispatch(scenario, eve, { type }), result);
    assert.equal(spanDays(scenario, result, span), 0);
    assert.strictEqual(dispatch(scenario, result, { type }), result);
  }
  assert.strictEqual(advanceDay(scenario, result), result);
  assert.throws(() => dispatch(scenario, result, {
    type: "startResearch", countryId, tech: "纺织工艺",
  }), /剧本已结束/);
  assert.deepEqual(parseSave(scenario, { version: saveVersion, scenarioId: scenario.id, state: result }), result);
});

test("跨期推进照常经过周结算，超期的真实版本 5 存档保留日期和状态", () => {
  const { endDate, ...historicalScenario } = scenario;
  const start = dispatch(scenario, createGame(scenario), { type: "selectCountry", countryId });
  let beforeDeadline = start;
  for (let i = 0; i < 5; i++) beforeDeadline = dispatch(scenario, beforeDeadline, { type: "advanceHalfYear" });
  const july = advanceDay(scenario, beforeDeadline);
  const result = dispatch(scenario, july, { type: "advanceHalfYear" });
  let daily = july;
  while (daily.elapsedDays < deadline - 5) daily = advanceDay(historicalScenario, daily);
  const weekStart = daily;
  while (daily.elapsedDays < deadline) daily = advanceDay(historicalScenario, daily);
  assert.equal(result.elapsedDays, deadline);
  assert.equal(spanDays(scenario, weekStart, "week"), 5);
  assert.notEqual(result.rng, weekStart.rng);
  assert.deepEqual(dispatch(scenario, weekStart, { type: "advanceWeek" }), daily);
  assert.deepEqual(result, daily);

  const historical = dispatch(historicalScenario, result, { type: "advanceWeek" });
  const saved = parseSave(scenario, { version: 5, scenarioId: scenario.id, weeklyConstruction: true, state: historical });
  assert.deepEqual(saved, historical);
  assert.equal(saved.elapsedDays, deadline + 7);
  assert.equal(isScenarioFinished(scenario, saved), true);
  for (const [span, type] of spans) {
    assert.equal(spanDays(scenario, saved, span), 0);
    assert.strictEqual(dispatch(scenario, saved, { type }), saved);
  }
});

test("期限正好落在周结算日时，完整执行当日结算和 AI 指令", () => {
  const bounded = { ...borderScenario, endDate: "1820-01-08" };
  const start = dispatch(bounded, createGame(bounded), { type: "selectCountry", countryId: "country_01" });
  const result = dispatch(bounded, start, { type: "advanceHalfYear" });
  assert.equal(result.elapsedDays, 7);
  assert.ok(result.lastEconomy);
  assert.deepEqual(result, dispatch(borderScenario, start, { type: "advanceWeek" }));
});
