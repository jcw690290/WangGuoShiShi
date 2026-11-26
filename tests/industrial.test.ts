import assert from "node:assert/strict";
import { test } from "node:test";
import { projectEconomy, projects } from "../src/game/economy.ts";
import { createGame, dispatch } from "../src/game/engine.ts";
import { industrialGoods } from "../src/game/industry.ts";
import { workingCapitalPerLevel } from "../src/game/industrial.ts";
import { parseSave, saveVersion } from "../src/game/storage.ts";
import { borderScenario, scenario as world } from "../src/scenario/scenario.ts";

const countryId = "country_01", stateId = "Yunnan";
const original = borderScenario.states[stateId];
const scenario = {
  ...borderScenario,
  states: {
    ...borderScenario.states,
    [stateId]: { ...original, capacity: { ...original.capacity, wood: 4, iron: 3, coal: 3, tools: 3 },
      buildings: { ...original.buildings, wood: 1, iron: 1, coal: 1, tools: 1 } },
  },
};
const start = (map: typeof borderScenario = scenario) =>
  dispatch(map, createGame(map), { type: "selectCountry", countryId });

test("工商业按真实员工、库存和已落实资金生产并结算，预估无副作用", () => {
  const initial = start();
  const original = structuredClone(initial);
  const forecast = projectEconomy(initial).states[stateId];
  assert.deepEqual(initial, original);
  assert.equal(forecast.industries.wood.output, 100);
  assert.equal(forecast.industries.iron.output, 80);
  assert.equal(forecast.industries.coal.output, 100);
  assert.equal(forecast.industries.tools.output, 80);
  assert.deepEqual(forecast.industrial!.used, { wood: 20, iron: 30, coal: 5, tools: 8, paper: 0, services: 0 });
  assert.equal(forecast.industries.tools.wages, 11_600);
  const shortage = structuredClone(initial);
  shortage.stateEconomies[stateId].industrial!.stocks.iron = 15;
  const reduced = projectEconomy(shortage).states[stateId];
  assert.equal(reduced.industries.tools.employed, 50);
  assert.equal(reduced.industries.tools.output, 40);
  assert.equal(reduced.industrial?.used.iron, 15);

  const settled = dispatch(scenario, initial, { type: "advanceWeek" });
  const week = settled.lastEconomy!.states[stateId];
  const before = initial.stateEconomies[stateId].industrial!;
  const after = settled.stateEconomies[stateId].industrial!;
  const wages = industrialGoods.reduce((sum, good) => sum + week.industries[good].wages, 0);
  const record = week.industrial!;
  assert.ok(record.spent <= before.capital - wages);
  assert.equal(after.capital + record.distributed, before.capital + record.sales - wages - record.spent);
  for (const good of industrialGoods) assert.equal(after.stocks[good], before.stocks[good] - record.used[good] + record.bought[good]);
  assert.ok(week.householdConsumption!.wood > 0);
  assert.deepEqual(parseSave(scenario, { version: saveVersion, scenarioId: scenario.id, state: settled }), settled);
});

test("新工具厂的周转金来自项目费用，旧档保留既有产量和建筑", () => {
  const map = { ...scenario, states: { ...scenario.states, [stateId]: {
    ...scenario.states[stateId], buildings: original.buildings,
  } } };
  const initial = start(map);
  let game = dispatch(map, initial, { type: "queueConstruction", countryId, stateId, good: "tools" });
  assert.equal(initial.countryEconomies[countryId].treasury - game.countryEconomies[countryId].treasury, projects.tools.cost);
  assert.equal(game.stateEconomies[stateId].industrial, undefined);
  for (let i = 0; i < 8 && game.countryEconomies[countryId].queue.length; i++)
    game = dispatch(map, game, { type: "advanceWeek" });
  assert.equal(game.stateEconomies[stateId].buildings.tools, 1);
  assert.equal(game.stateEconomies[stateId].industrial!.capital, workingCapitalPerLevel("tools"));
  assert.ok(Object.values(game.stateEconomies[stateId].industrial!.stocks).every((stock) => stock === 0));

  const legacy = dispatch(borderScenario, createGame(borderScenario), { type: "selectCountry", countryId });
  const restored = parseSave(borderScenario, { version: 8, scenarioId: borderScenario.id, state: {
    ...legacy, stateEconomies: Object.fromEntries(Object.entries(legacy.stateEconomies).map(([id, local]) => [id, {
      ...local, buildings: { grain: local.buildings.grain, cloth: local.buildings.cloth },
    }])),
  } });
  assert.deepEqual(restored, legacy);
  assert.ok(Object.values(createGame(world).stateEconomies).some((local) => local.buildings.tools > 0));
});

test("造纸和服务使用实际原料与共享技术劳动力，服务在本州成交", () => {
  const withServices: typeof borderScenario = {
    ...scenario,
    states: { ...scenario.states, [stateId]: {
      ...scenario.states[stateId],
      capacity: { ...scenario.states[stateId].capacity, paper: 2, services: 2 },
      buildings: { ...scenario.states[stateId].buildings, paper: 1, services: 1 },
    } },
  };
  const id = "61807366-1ff3-4587-aeca-a09187e16fe5";
  const initial = dispatch(withServices, createGame(withServices, 1820, "standard", { id, endYear: 1936, tutorialEnabled: false }),
    { type: "selectCountry", countryId });
  const report = projectEconomy(initial);
  const local = report.states[stateId];
  assert.equal(local.industries.paper.output, 100);
  assert.equal(local.industries.services.output, 100);
  assert.equal(local.industries.services.wages, 12_500);
  assert.equal(local.industrial?.skilledWages, 14_700);
  assert.deepEqual(local.industrial?.used, { wood: 60, iron: 30, coal: 15, tools: 10, paper: 2, services: 0 });
  assert.equal(local.householdConsumption?.services, 100);
  assert.equal(report.states.Guangxi.householdConsumption?.services, 0);
  assert.throws(() => dispatch(withServices, initial, { type: "openTradeRoute", countryId,
    from: "Tonkin", to: "Yunnan", good: "services", limit: 100 }), /只能在本州成交/);
  const settled = dispatch(withServices, initial, { type: "advanceWeek" });
  assert.ok(settled.campaign?.outcome?.metrics.BASIC_CONSUMPTION !== undefined);
  assert.ok(settled.campaign.outcome.metrics.BASIC_CONSUMPTION <= 100 / 440);
  assert.deepEqual(parseSave(withServices, { version: saveVersion, scenarioId: withServices.id, state: settled }), settled);
});
