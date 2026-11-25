import assert from "node:assert/strict";
import { test } from "node:test";
import { officeNeed } from "../src/game/administration.ts";
import { projectEconomy, weeklyBudgets } from "../src/game/economy.ts";
import { createGame, dispatch } from "../src/game/engine.ts";
import { parseSave, saveVersion } from "../src/game/storage.ts";
import { borderScenario } from "../src/scenario/scenario.ts";

const countryId = "country_01", stateId = "Yunnan";
const base = borderScenario.states[stateId];
const scenario: typeof borderScenario = {
  ...borderScenario,
  states: { ...borderScenario.states, [stateId]: {
    ...base, startingOffices: 1,
    capacity: { ...base.capacity, paper: 2, services: 2 },
    buildings: { ...base.buildings, paper: 1, services: 1 },
  } },
};
const campaign = { id: "61807366-1ff3-4587-aeca-a09187e16fe5", endYear: 1936, tutorialEnabled: false };
const start = (map = scenario) => dispatch(map, createGame(map, 1820, "standard", campaign), { type: "selectCountry", countryId });

test("行政岗位采购真实物资，必要支出只记账一次，治理覆盖可存读", () => {
  const initial = start();
  const before = structuredClone(initial);
  const forecast = projectEconomy(initial);
  assert.deepEqual(initial, before);
  const office = forecast.states[stateId].office!;
  assert.equal(office.need, officeNeed(base.population, initial.societies[stateId], initial.nations[countryId], "standard"));
  assert.equal(office.staff, Math.ceil(office.need));
  assert.equal(office.coverage, 1);
  assert.ok(office.wages > 0 && office.purchases > 0);
  assert.equal(office.paper, office.paperDemand);
  assert.equal(office.services, office.serviceDemand);

  const settled = dispatch(scenario, initial, { type: "advanceWeek" });
  const report = settled.lastEconomy!;
  const country = report.countries[countryId];
  const { fiscal, treasury } = settled.countryEconomies[countryId];
  const opening = initial.countryEconomies[countryId].treasury;
  assert.equal(country.officeUpkeep, office.wages + office.purchases);
  assert.equal(fiscal!.week.upkeepPaid, country.upkeep);
  assert.equal(treasury, opening + weeklyBudgets(settled.nations, report)[countryId].balance);
  const held = Object.keys(settled.ownerByStateId).filter((id) => settled.ownerByStateId[id] === countryId);
  const people = held.reduce((sum, id) => sum + settled.stateEconomies[id].population, 0);
  assert.equal(settled.campaign!.outcome!.metrics.GOV, settled.stateEconomies[stateId].population / people);
  assert.deepEqual(parseSave(scenario, { version: saveVersion, scenarioId: scenario.id, state: settled }), settled);
});

test("没有周初现款就不雇用，失去纸张供应就失去覆盖", () => {
  const initial = start();
  initial.countryEconomies[countryId].treasury = 0;
  const unfunded = projectEconomy(initial);
  assert.equal(unfunded.states[stateId].office!.staff, 0);
  assert.equal(unfunded.countries[countryId].officeUpkeep, 0);

  const noPaper = start();
  noPaper.stateEconomies[stateId].buildings.paper = 0;
  const undersupplied = projectEconomy(noPaper).states[stateId].office!;
  assert.ok(undersupplied.staff > 0);
  assert.equal(undersupplied.paper, 0);
  assert.equal(undersupplied.coverage, 0);
});
