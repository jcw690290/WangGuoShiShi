import assert from "node:assert/strict";
import { test } from "node:test";
import { privateShareOf, projectEconomy } from "../src/game/economy.ts";
import { createGame, dispatch } from "../src/game/engine.ts";
import { livingStandardTarget, updateLivingStandard } from "../src/game/households.ts";
import { goods, industries } from "../src/game/industry.ts";
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
    const householdDemand = Math.round(game.stateEconomies.Yunnan.population * industries[good].demandPerPerson);
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
