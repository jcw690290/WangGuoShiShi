import assert from "node:assert/strict";
import { test } from "node:test";
import { scenario } from "../src/scenario/scenario.ts";
import { createGame, dispatch } from "../src/game/engine.ts";
import type { GameState } from "../src/game/engine.ts";
import { CLAIM_COST, claimError } from "../src/game/territory.ts";
import { constructionError, projectEconomy } from "../src/game/economy.ts";
import { canReach } from "../src/game/diplomacy.ts";
import { parseSave, saveVersion } from "../src/game/storage.ts";

const player = "country_01";
const neutral = Object.values(scenario.states).filter(
  (s) => s.ownerId === null,
);
const target = "Syrdarya";
const start = () =>
  dispatch(scenario, createGame(scenario), {
    type: "selectCountry",
    countryId: player,
  });
const claim = (g: GameState, stateId = target) =>
  dispatch(scenario, g, { type: "claimState", stateId });
const load = (state: GameState) =>
  parseSave(
    scenario,
    JSON.parse(
      JSON.stringify({ version: saveVersion, scenarioId: scenario.id, state }),
    ),
  );

test("116 个无主州保持静态定义，开局不进入任何国家结算", () => {
  const g = start(),
    report = projectEconomy(g);
  assert.equal(neutral.length, 116);
  assert.equal(Object.keys(g.ownerByStateId).length, 544);
  for (const site of neutral) {
    assert.equal(Object.hasOwn(g.stateEconomies, site.id), false);
    assert.equal(Object.hasOwn(g.societies, site.id), false);
    assert.equal(Object.hasOwn(report.states, site.id), false);
    assert.equal(canReach(scenario, g, player, site.id), false);
  }
  assert.deepEqual(load(g), g); // Unmodified, published version-5 shape remains valid.
});

test("占领只收取一次费用，不修改输入或模板，立即加入市场并清空过期周报", () => {
  const before = dispatch(scenario, start(), { type: "advanceWeek" });
  const snapshot = structuredClone(before),
    template = structuredClone(scenario.states[target]);
  const next = claim(before);
  assert.deepEqual(before, snapshot);
  assert.deepEqual(scenario.states[target], template);
  assert.equal(next.ownerByStateId[target], player);
  assert.equal(
    next.countryEconomies[player].treasury,
    before.countryEconomies[player].treasury - CLAIM_COST,
  );
  assert.equal(next.lastEconomy, null);
  assert.equal(next.stateEconomies[target].population, template.population);
  assert.notEqual(next.stateEconomies[target].buildings, template.buildings);
  assert.equal(
    next.societies[target].pops.reduce((n, p) => n + p.people, 0),
    template.population,
  );
  assert.ok(
    next.societies[target].pops.every(
      (p) => p.culture !== "" && p.religion !== "",
    ),
  );
  assert.ok(projectEconomy(next).states[target]);
  assert.equal(
    constructionError(scenario, next, player, target, "infrastructure"),
    undefined,
  );
  const built = dispatch(scenario, next, {
    type: "queueConstruction",
    countryId: player,
    stateId: target,
    good: "infrastructure",
  });
  assert.equal(built.countryEconomies[player].queue.at(-1)!.stateId, target);
  assert.throws(() => claim(next), /只能占领无主领土/);
});

test("未选国、非法州、他国州、余额不足及期末拒绝，余额正好足够可占领", () => {
  assert.throws(() => claim(createGame(scenario)), /请先选择国家/);
  const before = start(),
    snapshot = structuredClone(before);
  for (const id of ["missing", "__proto__", "constructor"])
    assert.throws(() => claim(before, id), /不存在/);
  const foreign = Object.keys(before.ownerByStateId).find(
    (id) => before.ownerByStateId[id] !== player,
  )!;
  assert.throws(() => claim(before, foreign), /只能占领无主领土/);
  const poor = structuredClone(before);
  poor.countryEconomies[player].treasury = CLAIM_COST - 1;
  assert.equal(claimError(scenario, poor, target), "国库资金不足");
  assert.throws(() => claim(poor), /资金不足/);
  assert.equal(Object.hasOwn(poor.ownerByStateId, target), false);
  poor.countryEconomies[player].treasury = CLAIM_COST;
  assert.equal(claim(poor).countryEconomies[player].treasury, 0);
  assert.throws(() => claim({ ...before, elapsedDays: 1096 }), /剧本已结束/);
  assert.equal(
    claimError(scenario, { ...before, elapsedDays: 1096 }, target),
    "剧本已结束",
  );
  assert.deepEqual(before, snapshot);
});

test("所有无主州（含跨海州）均可占领，存读档及半年续算包含新州", () => {
  let g = start();
  g.countryEconomies[player].treasury = neutral.length * CLAIM_COST + 1_000_000;
  for (const site of neutral) g = claim(g, site.id);
  assert.equal(Object.keys(g.ownerByStateId).length, 660);
  assert.equal(g.countryEconomies[player].treasury, 1_000_000);
  assert.deepEqual(load(g), g);
  const week = dispatch(scenario, g, { type: "advanceWeek" });
  assert.equal(Object.keys(week.lastEconomy!.states).length, 660);
  for (const site of neutral)
    assert.equal(
      week.societies[site.id].pops.reduce((n, p) => n + p.people, 0),
      week.stateEconomies[site.id].population,
    );
  assert.deepEqual(
    dispatch(scenario, load(week), { type: "advanceHalfYear" }),
    dispatch(scenario, week, { type: "advanceHalfYear" }),
  );
});

test("读档拒绝孤立经济、缺少原属州、无社会人口、非法归属及不完整周报", () => {
  const valid = claim(start());
  const missingSocial = structuredClone(valid);
  delete missingSocial.societies[target];
  assert.throws(() => load(missingSocial), /无效/);
  const missingOwner = structuredClone(valid);
  delete missingOwner.ownerByStateId[target];
  assert.throws(() => load(missingOwner), /无效/);
  const missingOriginal = structuredClone(valid);
  for (const record of [
    missingOriginal.ownerByStateId,
    missingOriginal.stateEconomies,
    missingOriginal.societies,
  ])
    delete record.Guangxi;
  assert.throws(() => load(missingOriginal), /无效/);
  const badOwner = structuredClone(valid);
  badOwner.ownerByStateId[target] = "not-a-country";
  assert.throws(() => load(badOwner), /无效/);
  const badReport = dispatch(scenario, valid, { type: "advanceWeek" });
  delete badReport.lastEconomy!.states[target];
  assert.throws(() => load(badReport), /无效/);
});
