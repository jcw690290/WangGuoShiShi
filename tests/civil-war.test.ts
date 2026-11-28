import assert from "node:assert/strict";
import { test } from "node:test";
import { advanceCivilWar, oppositionId, scenarioWithCivilWar } from "../src/game/civil-war.ts";
import { occupationAt } from "../src/game/conflict-state.ts";
import { applyBorderCommand, planWar } from "../src/game/diplomacy.ts";
import { projectEconomy } from "../src/game/economy.ts";
import { advanceDay, createGame, dispatch } from "../src/game/engine.ts";
import { parseSave, saveVersion } from "../src/game/storage.ts";
import { foreignTradeStatus } from "../src/game/trade.ts";
import { borderScenario, scenario as world } from "../src/scenario/scenario.ts";

test("参与国分开的内战与对外战争各自结算，内战结束保留对外战线", () => {
  const home = "country_01", attacker = "country_26", defender = "country_07";
  const scenario = { ...borderScenario,
    countries: { ...borderScenario.countries, [defender]: world.countries[defender] },
    states: { ...borderScenario.states, Annam: { ...borderScenario.states.Annam, ownerId: defender } },
  };
  const opening = dispatch(scenario, createGame(scenario), { type: "selectCountry", countryId: home });
  const foreign = {
    targetStateId: "Annam", claimantId: attacker, defenderId: defender, phase: "war" as const, since: 56,
    goals: ["cession" as const], maneuvers: 0, allies: [], promises: [], defenders: [],
    mobilized: [], advance: [attacker], raid: [], progress: 65, lastChange: null, outcome: null,
  };
  const atWar = { ...opening, elapsedDays: 84, borderDispute: foreign,
    occupation: { stateId: "Annam", controllerId: attacker },
    constitutionalCrises: { [home]: { since: 0, demand: "共和制" as const } },
  };
  const overlapping = { ...atWar, borderDispute: { ...foreign, allies: [home] } };
  assert.equal(advanceCivilWar(scenario, overlapping), overlapping);

  const divided = advanceCivilWar(scenario, atWar);
  assert.equal(divided.civilWar?.countryId, home);
  assert.deepEqual(divided.foreignTheater?.dispute, foreign);
  assert.equal(occupationAt(divided, "Annam")?.controllerId, attacker);
  assert.equal(foreignTradeStatus(divided, attacker, defender), "war");
  for (const countryId of [home, oppositionId(home), attacker, defender])
    assert.ok(planWar(scenarioWithCivilWar(scenario, divided.civilWar), divided)?.routes[countryId]);
  const dividedScenario = scenarioWithCivilWar(scenario, divided.civilWar);
  const navy = { ...divided.nations[attacker].navy, warships: 4, armored: 0 };
  const fleet = { ...divided, nations: { ...divided.nations, [attacker]: { ...divided.nations[attacker], navy } } };
  const mission = { ...fleet, foreignTheater: { ...fleet.foreignTheater!, dispute: {
    ...foreign, navalMissions: { [attacker]: { task: "escort" as const, portId: "Tonkin" } },
  } } };
  const peacetimeMaintenance = projectEconomy(fleet, planWar(dividedScenario, fleet), dividedScenario).countries[attacker].navy!.maintenanceDue;
  assert.ok(peacetimeMaintenance > 0);
  assert.equal(projectEconomy(mission, planWar(dividedScenario, mission), dividedScenario).countries[attacker].navy!.maintenanceDue,
    peacetimeMaintenance * 2);

  const chosen = dispatch(scenario, divided, { type: "chooseCivilWarSide", countryId: home, side: "government" });
  const load = (state: typeof chosen) => parseSave(scenario, { version: saveVersion, scenarioId: scenario.id, state });
  let fought = load(chosen);
  const humans = new Set([home, oppositionId(home), attacker, defender]);
  for (let day = 0; day < 7; day++) fought = advanceDay(scenario, fought, humans);
  assert.notEqual(fought.borderDispute?.lastChange, null);
  assert.notEqual(fought.foreignTheater?.dispute.lastChange, null);
  fought = load(fought);
  const defended = applyBorderCommand(scenarioWithCivilWar(scenario, fought.civilWar), fought,
    { type: "orderDefend", countryId: attacker });
  assert.equal(defended.borderDispute, fought.borderDispute);
  assert.ok(!defended.foreignTheater!.dispute.advance.includes(attacker));
  const united = applyBorderCommand(scenarioWithCivilWar(scenario, defended.civilWar), defended,
    { type: "armistice", countryId: oppositionId(home) });
  assert.equal(united.civilWar, undefined);
  assert.equal(united.foreignTheater, undefined);
  assert.equal(united.borderDispute, defended.foreignTheater!.dispute);
  assert.deepEqual(load(united).borderDispute, united.borderDispute);
});
