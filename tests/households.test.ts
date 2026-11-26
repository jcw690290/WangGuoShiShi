import assert from "node:assert/strict";
import { test } from "node:test";
import { privateShareOf, projectEconomy } from "../src/game/economy.ts";
import { createGame, dispatch } from "../src/game/engine.ts";
import { basicEquivalentSupply, livingStandardTarget, planBasicBasket, updateLivingStandard } from "../src/game/households.ts";
import { byGood, goods, industries } from "../src/game/industry.ts";
import { parseSave, saveVersion } from "../src/game/storage.ts";
import { borderScenario as scenario } from "../src/scenario/scenario.ts";

const countryId = "country_01";
const start = () => dispatch(scenario, createGame(scenario), { type: "selectCountry", countryId });

test("生活水平使用对数消费指数、缺粮上限和 20% 周调整", () => {
  assert.equal(livingStandardTarget(0, 1), 1);
  assert.equal(livingStandardTarget(1, 1), 10);
  assert.equal(livingStandardTarget(0.5, 1), 6);
  assert.equal(livingStandardTarget(4, 0.5), 6.5);
  assert.equal(livingStandardTarget(1024, 1), 30);
  assert.equal(updateLivingStandard(10, 6), 9.2);
});

test("建设与家庭分用实际到货，家庭消费只在周结更新生活水平", () => {
  const initial = start();
  const game = dispatch(scenario, initial, {
    type: "queueConstruction", countryId, stateId: "Yunnan", good: "infrastructure",
  });
  const projection = projectEconomy(game);
  const site = projection.states.Yunnan;
  assert.ok(site.builders > 0);
  for (const good of goods) {
    const householdDemand = good === "coal" || good === "food" ? site.householdSubstituteOrders![good] :
      Math.round(game.stateEconomies.Yunnan.population * industries[good].demandPerPerson);
    assert.ok(site.householdConsumption![good] <= householdDemand);
    assert.ok(site.householdConsumption![good] <= site.industries[good].bought!);
  }
  assert.equal(game.societies.Yunnan.pops[0].livingStandard, 10);
  const settled = dispatch(scenario, game, { type: "advanceWeek" });
  const report = settled.lastEconomy!.states.Yunnan;
  const expected = updateLivingStandard(10, livingStandardTarget(report.consumptionIndex!, report.foodFulfillment!));
  assert.ok(settled.societies.Yunnan.pops.every((pop) => pop.livingStandard === expected));
  assert.deepEqual(parseSave(scenario, { version: saveVersion, scenarioId: scenario.id, state: settled }), settled);
});

test("先前版本的人口从初始生活水平读入，经济体制切换建造份额", () => {
  const world = start();
  const local = world.societies.Yunnan;
  const pops = local.pops.map(({ livingStandard, ...pop }) => pop);
  const legacy = { ...world, societies: { ...world.societies, Yunnan: { ...local, pops } } };
  assert.deepEqual(parseSave(scenario, { scenarioId: scenario.id, version: 8, state: legacy }), world);
  const nation = world.nations[countryId];
  assert.equal(privateShareOf(nation), 0.2);
  assert.equal(privateShareOf({ ...nation, laws: ["干预主义"] }), 0.5);
  assert.equal(privateShareOf({ ...nation, laws: ["自由放任"] }), 0.75);
});

test("缺少粮木时才接受更贵替代，数量有上限且保留工业用煤", () => {
  const needs = { ...byGood(() => 0), grain: 100, wood: 20 };
  const supply = { ...needs, food: 70, coal: 14 };
  const prices = { ...byGood((good) => industries[good].basePrice), food: 350, coal: 300 };
  assert.deepEqual(planBasicBasket(needs, supply, prices, 5), needs);
  const substituted = planBasicBasket(needs, { ...supply, grain: 0, wood: 0 }, prices, 5);
  assert.deepEqual(substituted, { ...needs, food: 25, coal: 9, grain: 50, wood: 11 });
});

test("周结用实际副食品和煤满足基本需求，与可选消费、工业采购和旧档分开", () => {
  const stateId = "Yunnan";
  const sites = Object.fromEntries(Object.entries(scenario.states).map(([id, site]) => [id, {
    ...site, buildings: { ...site.buildings, grain: 0 },
  }]));
  const levels = { food: 2, coal: 1, paper: 1 };
  sites[stateId] = { ...sites[stateId], buildings: { ...sites[stateId].buildings, ...levels },
    capacity: { ...sites[stateId].capacity, ...levels } };
  const map = { ...scenario, states: sites };
  const game = dispatch(map, createGame(map), { type: "selectCountry", countryId });
  game.stateEconomies[stateId].discretionaryBudget = 120_000;
  const settled = dispatch(map, game, { type: "advanceWeek" });
  const site = settled.lastEconomy!.states[stateId];
  const delivered = site.householdConsumption!;
  assert.equal(site.householdSubstituteOrders!.food, 140);
  assert.equal(delivered.grain, 0);
  assert.equal(delivered.food, 140);
  assert.equal(site.householdExtras!.delivered.food, 0);
  const fuel = basicEquivalentSupply(delivered, site.householdExtras!.delivered);
  assert.equal(site.foodFulfillment, 280 / site.householdBasicOrders!.grain);
  assert.equal(fuel.wood, delivered.wood + delivered.coal);
  assert.ok(delivered.coal > 0);
  assert.ok(site.industrial!.bought.coal > 0);
  assert.equal(delivered.coal + site.industrial!.bought.coal, site.industries.coal.bought);
  assert.deepEqual(parseSave(map, { version: saveVersion, scenarioId: map.id, state: settled }), settled);
  const legacy = structuredClone(settled);
  delete legacy.lastEconomy!.states[stateId].householdSubstituteOrders;
  assert.deepEqual(parseSave(map, { version: saveVersion, scenarioId: map.id, state: legacy }), legacy);
});
