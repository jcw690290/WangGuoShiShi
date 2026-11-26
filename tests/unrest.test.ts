import assert from "node:assert/strict";
import { test } from "node:test";
import { projectEconomy } from "../src/game/economy.ts";
import { createGame, dispatch } from "../src/game/engine.ts";
import { parseSave, saveVersion } from "../src/game/storage.ts";
import { advanceUnrest, emptyStability, unrestEffects } from "../src/game/unrest.ts";
import { DAY_MS } from "../src/game/time.ts";
import { applyPlayerCommand } from "../src/online/protocol.ts";
import { borderScenario as scenario } from "../src/scenario/scenario.ts";

const qing = "country_01", vietnam = "country_26", site = "Yunnan";

test("缺粮和不满在月结触发地方停工，影响下次产出并计入战役动乱", () => {
  const campaign = { id: "adfd5df1-f02e-46f4-bb93-0c8f1fb6b5ae", endYear: 1936, tutorialEnabled: false };
  const opening = dispatch(scenario, createGame(scenario, 1820, "standard", campaign), { type: "selectCountry", countryId: qing });
  opening.societies[site].stability!.unrest = 34;
  for (const pop of opening.societies[site].pops) pop.radicals = 30;
  const report = projectEconomy(opening);
  report.states[site].foodFulfillment = 0;
  const monthEnd = { ...opening, elapsedDays: 30, tickInDay: 3, lastEconomy: report };
  const incident = dispatch(scenario, monthEnd, { type: "advanceTick" });
  const stability = incident.societies[site].stability!;
  assert.equal(stability.incident?.cause, "hardship");
  assert.equal(stability.incident?.since, 31);
  const normal = structuredClone(incident);
  normal.societies[site].stability!.incident = null;
  assert.ok(projectEconomy(incident).states[site].industries.grain.output <
    projectEconomy(normal).states[site].industries.grain.output);
  const ownStates = Object.keys(incident.ownerByStateId).filter((id) => incident.ownerByStateId[id] === qing);
  const population = ownStates.reduce((sum, id) => sum + incident.stateEconomies[id].population, 0);
  const weighted = ownStates.reduce((sum, id) => sum +
    incident.societies[id].stability!.unrest * incident.stateEconomies[id].population, 0) / population;
  assert.ok(Math.abs(incident.campaign!.outcome!.metrics.TUR! - weighted) < 1e-9);

  const order = { type: "negotiateLocalUnrest", countryId: qing, stateId: site } as const;
  assert.throws(() => applyPlayerCommand(scenario, incident, vietnam, order), /只能操作自己控制的国家/);
  const agreed = dispatch(scenario, incident, order);
  assert.ok(projectEconomy(agreed).countries[qing].tax < projectEconomy(incident).countries[qing].tax);
  assert.throws(() => dispatch(scenario, agreed, order), /没有可协商/);
  const loaded = parseSave(scenario, { version: saveVersion, scenarioId: scenario.id, state: agreed });
  assert.deepEqual(loaded, agreed);
  const later = { elapsedDays: 59, tickInDay: 3 };
  const negotiated = dispatch(scenario, { ...loaded, ...later }, { type: "advanceTick" });
  const unchanged = dispatch(scenario, { ...incident, ...later }, { type: "advanceTick" });
  assert.ok(negotiated.societies[site].stability!.unrest < unchanged.societies[site].stability!.unrest);
});

test("拒税协议不会立即提高征收比例，同原因停工有六个月时限和两年冷却", () => {
  const previous = { unrest: 80, incident: { cause: "exclusion" as const, since: 0, negotiated: false }, lastIncident: { exclusion: 0 } };
  assert.ok(unrestEffects({ ...previous, incident: { ...previous.incident, negotiated: true } }).collection <=
    unrestEffects(previous).collection);
  const pressure = { radicals: 0, excluded: 0, living: 3, food: 0, war: 0 };
  function month(date: string, previous = { ...emptyStability(), unrest: 40 }) {
    return advanceUnrest(previous, new Date(date), (Date.parse(date) - Date.parse(scenario.startDate)) / DAY_MS, pressure);
  }
  const started = month("1820-02-01");
  const expired = month("1820-08-01", started);
  assert.equal(expired.incident, null);
  assert.equal(month("1822-01-01", expired).incident, null);
  assert.equal(month("1822-02-01", expired).incident?.cause, "hardship");
});
