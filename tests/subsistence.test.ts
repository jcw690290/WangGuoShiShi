import assert from "node:assert/strict";
import { test } from "node:test";
import { constructionError, projectEconomy } from "../src/game/economy.ts";
import { createGame, dispatch } from "../src/game/engine.ts";
import { reformWork } from "../src/game/society.ts";
import { parseSave, saveVersion } from "../src/game/storage.ts";
import { unrestEffects } from "../src/game/unrest.ts";
import { borderScenario, scenario as world } from "../src/scenario/scenario.ts";

const countryId = "country_01", stateId = "Yunnan";
const original = borderScenario.states[stateId];
function withFarmland(cropland: number) {
  return { ...borderScenario, states: { ...borderScenario.states, [stateId]: {
    ...original, cropland, buildings: { ...original.buildings, grain: 0, fiber: 0 },
    capacity: { ...original.capacity, food: 2, fiber: 2 },
  } } };
}

test("农户留存实际收成，有成交才产生所得和租金，土地改革改变收益归属", () => {
  const map = withFarmland(20_000);
  let game = dispatch(map, createGame(map), { type: "selectCountry", countryId });
  const opening = projectEconomy(game).states[stateId];
  const rural = opening.subsistence!;
  assert.ok(rural.employed > 0);
  assert.equal(rural.produced.grain, Math.floor(rural.employed * 0.8));
  assert.equal(rural.produced.wood, Math.floor(rural.employed * 0.1));
  assert.ok(opening.householdConsumption!.grain >= rural.retained.grain && rural.retained.grain > 0);
  assert.equal(opening.industries.grain.wages, 0);
  assert.ok(rural.sold.grain + rural.sold.wood > 0);
  assert.ok(rural.landRent > 0 && rural.householdIncome > rural.landRent);
  assert.ok(rural.landRent <= (rural.householdIncome + rural.landRent) * 0.2);
  assert.ok(rural.sold.grain + rural.retained.grain <= rural.produced.grain);
  assert.ok(rural.sold.wood + rural.retained.wood <= rural.produced.wood);
  const reformed = structuredClone(game);
  reformed.nations[countryId].laws.push("小农自耕");
  const freehold = projectEconomy(reformed).states[stateId].subsistence!;
  assert.deepEqual(freehold.sold, rural.sold);
  assert.equal(freehold.landRent, 0);
  assert.equal(freehold.householdIncome, rural.householdIncome + rural.landRent);

  game.nations[countryId].laws.push("地主租佃");
  game = dispatch(map, game, { type: "proposeLaw", countryId, law: "小农自耕" });
  game.nations[countryId].reformProgress = reformWork - 0.001;
  const settled = dispatch(map, game, { type: "advanceWeek" });
  assert.ok(settled.nations[countryId].laws.includes("小农自耕"));
  assert.ok(!settled.nations[countryId].laws.includes("地主租佃"));
  assert.deepEqual(parseSave(map, { version: saveVersion, scenarioId: map.id, state: settled }), settled);
  const legacy = structuredClone(settled);
  delete legacy.stateEconomies[stateId].cropland;
  delete legacy.lastEconomy!.states[stateId].subsistence;
  const loaded = parseSave(map, { version: saveVersion, scenarioId: map.id, state: legacy });
  assert.equal(loaded.stateEconomies[stateId].cropland, 20_000);
  assert.equal(projectEconomy(loaded).states[stateId].subsistence!.landRent, 0);
});

test("政府与私人作物工程共享耕地，实际开业后挤出自给岗位", () => {
  const map = withFarmland(250);
  let game = dispatch(map, createGame(map), { type: "selectCountry", countryId });
  const before = projectEconomy(game).states[stateId].subsistence!;
  assert.equal(before.employed, 250);
  game.nations[countryId].investment = 500_000;
  game = dispatch(map, game, { type: "queueConstruction", countryId, stateId, good: "grain" });
  game = dispatch(map, game, { type: "queueConstruction", countryId, stateId, good: "food", privateBuild: true });
  assert.match(constructionError(map, game, countryId, stateId, "fiber")!, /可用耕地不足/);
  assert.equal(projectEconomy(game).states[stateId].subsistence!.employed, before.employed);
  for (let i = 0; i < 32 && (game.countryEconomies[countryId].queue.length || game.nations[countryId].privateQueue.length); i++)
    game = dispatch(map, game, { type: "advanceWeek" });
  const completed = projectEconomy(game).states[stateId].subsistence!;
  assert.equal(completed.occupied, 200);
  assert.equal(completed.employed, 50);
  const efficiency = unrestEffects(game.societies[stateId].stability).output;
  assert.equal(completed.produced.grain, Math.floor(40 * efficiency));
  assert.equal(completed.produced.wood, Math.floor(5 * efficiency));
});

test("1820 开局剧本既有完全自用的州，也有真实余粮和地租", () => {
  const game = dispatch(world, createGame(world), { type: "selectCountry", countryId });
  const report = projectEconomy(game);
  const rural = Object.values(report.states).map((site) => site.subsistence!);
  assert.ok(rural.some((site) => site.retained.grain > 0 && site.sold.grain === 0));
  assert.ok(rural.some((site) => site.sold.grain > 0 && site.landRent > 0));
});
