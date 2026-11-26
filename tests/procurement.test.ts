import assert from "node:assert/strict";
import { test } from "node:test";
import { militaryProcurementCost, projectEconomy } from "../src/game/economy.ts";
import { createGame, dispatch } from "../src/game/engine.ts";
import { byGood, industries } from "../src/game/industry.ts";
import { parseSave, saveVersion } from "../src/game/storage.ts";
import { borderScenario } from "../src/scenario/scenario.ts";

const countryId = "country_01", stateId = "Yunnan";
const source = borderScenario.states[stateId];
const scenario = { ...borderScenario, countries: { [countryId]: borderScenario.countries[countryId] }, states: {
  [stateId]: { ...source, population: 4_000, neighbors: [], buildings: { grain: 5, cloth: 2 } },
} };
const start = () => {
  const game = dispatch(scenario, createGame(scenario), { type: "selectCountry", countryId });
  game.countryEconomies[countryId].referenceQuotes = byGood((good) =>
    good === "grain" ? 125 : good === "cloth" ? 360 : industries[good].basePrice);
  return game;
};

test("实付军粮和军服从商品供给发出，国库与生产企业只各记一笔", () => {
  const initial = start();
  const original = structuredClone(initial);
  const forecast = projectEconomy(initial);
  assert.deepEqual(initial, original);
  const settled = dispatch(scenario, initial, { type: "advanceWeek" });
  const { military: m, upkeep, tax, market } = settled.lastEconomy!.countries[countryId];
  const { industries: production, industrial, access } = settled.lastEconomy!.states[stateId];
  assert.deepEqual(m.procurement, forecast.countries[countryId].military.procurement);
  assert.ok(m.grainDrawn > 0 && m.equipment.uniforms.delivered > 0);
  assert.deepEqual(m.procurement, { grain: m.grainDrawn * 125, cloth: m.equipment.uniforms.delivered * 360 });
  assert.equal(production.grain.output, market.grain.supply + m.grainDrawn);
  assert.equal(production.cloth.output, market.cloth.supply + m.equipment.uniforms.delivered);
  assert.equal(access, 1);
  const purchases = militaryProcurementCost(m.procurement);
  assert.equal(industrial!.sales, production.grain.sold! * market.grain.price + production.cloth.sold! * market.cloth.price + purchases);

  const { treasury, fiscal } = settled.countryEconomies[countryId];
  assert.equal(fiscal!.week.upkeepPaid, upkeep);
  assert.equal(upkeep, purchases + m.regulars * 12 + settled.lastEconomy!.states[stateId].armourers * 8);
  assert.equal(treasury, initial.countryEconomies[countryId].treasury + tax - upkeep);
  assert.deepEqual(parseSave(scenario, { version: saveVersion, scenarioId: scenario.id, state: settled }), settled);
});

test("预付受现款限制，剩余物资进入市场，当周税收不补记军粮采购", () => {
  const initial = start();
  initial.countryEconomies[countryId].treasury = 5_040;
  const settled = dispatch(scenario, initial, { type: "advanceWeek" });
  const { military, market, tax } = settled.lastEconomy!.countries[countryId];
  assert.ok(tax > 0 && military.grainDemand > 40);
  assert.equal(military.grainDrawn, 40);
  assert.equal(military.equipment.uniforms.delivered, 0);
  assert.deepEqual(military.procurement, { grain: 5_000, cloth: 0 });
  assert.equal(market.grain.supply, settled.lastEconomy!.states[stateId].industries.grain.output - 40);
  assert.equal(military.readiness, 0);
});

test("国库现款用完后可动用已核定授信采购，汇总借款与债务只增加一次", () => {
  const initial = dispatch(scenario, start(), { type: "advanceWeek" });
  initial.countryEconomies[countryId].treasury = 0;
  const stocks = initial.stateEconomies[stateId].industrial!.stocks;
  stocks.tools += 7;
  stocks.fiber += 140;
  const priorFiscal = initial.countryEconomies[countryId].fiscal!;
  const restricted = structuredClone(initial);
  restricted.countryEconomies[countryId].fiscal!.week.risk = "restricted";
  assert.equal(militaryProcurementCost(projectEconomy(restricted).countries[countryId].military.procurement), 0);

  const next = dispatch(scenario, initial, { type: "advanceWeek" });
  const { military, tax, upkeep } = next.lastEconomy!.countries[countryId];
  const { fiscal, treasury } = next.countryEconomies[countryId];
  const cost = militaryProcurementCost(military.procurement);
  assert.ok(cost > 0 && cost <= priorFiscal.week.creditLimit - priorFiscal.debt);
  assert.equal(fiscal!.week.borrowed, cost);
  assert.equal(fiscal!.debt, priorFiscal.debt + cost - fiscal!.week.repaid);
  assert.equal(treasury, tax + fiscal!.week.borrowed - upkeep - fiscal!.week.interestPaid - fiscal!.week.repaid);
  assert.deepEqual(parseSave(scenario, { version: saveVersion, scenarioId: scenario.id, state: next }), next);
});
