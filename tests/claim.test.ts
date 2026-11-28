import assert from "node:assert/strict";
import { test } from "node:test";
import { borderScenario, scenario as world } from "../src/scenario/scenario.ts";
import { advanceDay, createGame, dispatch } from "../src/game/engine.ts";
import type { GameState } from "../src/game/engine.ts";
import { CLAIM_COST, claimError, settlementAt, territoryType } from "../src/game/territory.ts";
import { constructionError, projectEconomy } from "../src/game/economy.ts";
import { canReach } from "../src/game/diplomacy.ts";
import { parseSave, saveVersion } from "../src/game/storage.ts";

const player = "country_01";
const neutral = Object.values(world.states).filter(
  (s) => s.ownerId === null,
);
const target = "Syrdarya";
const localPolity = "Outlet";
const { Guangxi } = borderScenario.states;
const scenario = { ...borderScenario, endDate: world.endDate, states: { ...borderScenario.states,
  Guangxi: { ...Guangxi, startingOffices: 1, neighbors: [...Guangxi.neighbors, target, localPolity],
    buildings: { ...Guangxi.buildings, paper: 2, services: 2 }, capacity: { ...Guangxi.capacity, paper: 2, services: 2 } },
  [target]: { ...Guangxi, id: target, ownerId: null, neighbors: ["Guangxi"] },
  [localPolity]: { ...Guangxi, id: localPolity, ownerId: null, neighbors: ["Guangxi"], unownedStatus: "LOCAL_POLITY" as const },
} };
const humans = new Set(Object.keys(scenario.countries));
const start = () =>
  dispatch(scenario, createGame(scenario), {
    type: "selectCountry",
    countryId: player,
  });
const claim = (g: GameState, stateId = target) =>
  dispatch(scenario, g, { type: "claimState", stateId });
function week(g: GameState) {
  for (let day = 0; day < 7; day++) g = advanceDay(scenario, g, humans);
  return g;
}
function acquire(g: GameState, stateId = target) {
  for (let i = 0; i < 24 && settlementAt(g, stateId); i++) g = week(g);
  assert.equal(g.ownerByStateId[stateId], player);
  return g;
}
const load = (state: GameState) =>
  parseSave(
    scenario,
    JSON.parse(
      JSON.stringify({ version: saveVersion, scenarioId: scenario.id, state }),
    ),
  );

test("116 个未分配州有各自的地方状态，开局留在国家结算之外", () => {
  const g = dispatch(world, createGame(world), { type: "selectCountry", countryId: player }),
    report = projectEconomy(g);
  assert.equal(neutral.length, 116);
  assert.equal(Object.keys(g.ownerByStateId).length, 544);
  for (const site of neutral) {
    assert.equal(Object.hasOwn(g.stateEconomies, site.id), false);
    assert.equal(Object.hasOwn(g.societies, site.id), false);
    assert.equal(Object.hasOwn(report.states, site.id), false);
    assert.equal(canReach(world, g, player, site.id), false);
    assert.ok(territoryType(world, g, site.id) !== "STATE_OWNED");
  }
  assert.deepEqual(parseSave(world, { version: saveVersion, scenarioId: world.id, state: g }), g);
});

test("移民开发先扣项目费，行政进度完成后迁入人口并开放市场和建设", () => {
  const before = week(start());
  const snapshot = structuredClone(before),
    template = structuredClone(scenario.states[target]);
  const project = claim(before);
  assert.deepEqual(before, snapshot);
  assert.deepEqual(scenario.states[target], template);
  assert.equal(project.ownerByStateId[target], undefined);
  assert.equal(
    project.countryEconomies[player].treasury,
    before.countryEconomies[player].treasury - CLAIM_COST,
  );
  assert.equal(project.lastEconomy, before.lastEconomy);
  assert.equal(settlementAt(project, target)!.progress, 0);
  const next = acquire(load(project));
  assert.equal(next.lastEconomy, null);
  assert.ok(next.stateEconomies[target].population > template.population);
  assert.notEqual(next.stateEconomies[target].buildings, template.buildings);
  assert.equal(
    next.societies[target].pops.reduce((n, p) => n + p.people, 0),
    next.stateEconomies[target].population,
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
  assert.throws(() => claim(next), /未分配地区/);
});

test("未选国、非法州、他国州、余额不足及期末拒绝，余额正好足够可启动项目", () => {
  assert.throws(() => claim(createGame(scenario)), /请先选择国家/);
  const before = start(),
    snapshot = structuredClone(before);
  for (const id of ["missing", "__proto__", "constructor"])
    assert.throws(() => claim(before, id), /不存在/);
  const foreign = Object.keys(before.ownerByStateId).find(
    (id) => before.ownerByStateId[id] !== player,
  )!;
  assert.throws(() => claim(before, foreign), /未分配地区/);
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

test("地方协议形成间接辖区，存档可延续项目", () => {
  const pending = week(claim(start(), localPolity));
  assert.equal(settlementAt(pending, localPolity)!.mode, "INDIRECT");
  assert.equal(pending.ownerByStateId[localPolity], undefined);
  assert.deepEqual(week(pending), week(load(pending)));
  const g = acquire(pending, localPolity);
  assert.equal(g.societies[localPolity].governance!.mode, "INDIRECT");
  assert.equal(g.stateEconomies[localPolity].population, scenario.states[localPolity].population);
});

test("读档拒绝孤立经济、缺少原属州、无社会人口、非法归属及不完整周报", () => {
  const valid = acquire(claim(start()));
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
