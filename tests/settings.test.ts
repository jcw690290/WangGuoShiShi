import assert from "node:assert/strict";
import { test } from "node:test";
import { aiDiplomacy } from "../src/game/diplomacy.ts";
import { createGame, dispatch } from "../src/game/engine.ts";
import { settleEconomy } from "../src/game/economy.ts";
import { parseSave, saveVersion } from "../src/game/storage.ts";
import { encodeSnapshot } from "../src/online/protocol.ts";
import { borderScenario as scenario } from "../src/scenario/scenario.ts";

const countryId = "country_01";

test("改难度保留资金和人口，最低难度与变更时刻随存档续玩", async () => {
  const fresh = createGame(scenario, 1820, "extreme");
  const expected = Math.round(scenario.countries[countryId].treasury * 16 / 26);
  assert.equal(fresh.countryEconomies[countryId].treasury, expected);
  const selected = dispatch(scenario, fresh, { type: "selectCountry", countryId });
  const tick = dispatch(scenario, selected, { type: "advanceTick" });
  const relaxed = dispatch(scenario, tick, { type: "setDifficulty", difficulty: "relaxed" });
  const extreme = dispatch(scenario, relaxed, { type: "setDifficulty", difficulty: "extreme" });
  assert.strictEqual(dispatch(scenario, extreme, { type: "setDifficulty", difficulty: "extreme" }), extreme);
  assert.strictEqual(extreme.countryEconomies, fresh.countryEconomies);
  assert.strictEqual(extreme.stateEconomies, fresh.stateEconomies);
  assert.equal(extreme.settings.lowestDifficulty, "relaxed");
  assert.deepEqual(extreme.settings.difficultyHistory.map(({ tick }) => tick), [0, 1, 1]);
  const save = { scenarioId: scenario.id, version: saveVersion, state: extreme };
  assert.deepEqual(parseSave(scenario, save), extreme);
  assert.throws(() => parseSave(scenario, {
    ...save, state: { ...extreme, settings: { ...extreme.settings, lowestDifficulty: "extreme" } },
  }), /存档难度记录无效/);
  const { settings, ...legacy } = extreme;
  const migrated = parseSave(scenario, { ...save, version: 6, state: legacy });
  assert.equal(migrated.settings.difficulty, "standard");
  assert.equal(migrated.tickInDay, extreme.tickInDay);
  await assert.rejects(encodeSnapshot(scenario, { ...extreme, tickInDay: 0 }), /联机房间使用标准规则/);
});

test("开发者倍率在结算中影响激进与 AI 施压，可恢复难度倍率", () => {
  const game = dispatch(scenario, createGame(scenario), { type: "selectCountry", countryId });
  const tuned = dispatch(scenario, game, { type: "setRuleTuning",
    tuning: { radicalGrowth: 0, radicalRelief: 0, aiAggression: 0 } });
  const normalWeek = settleEconomy(game);
  const tunedWeek = settleEconomy(tuned);
  const radicals = Object.values(normalWeek.societies).flatMap((site) => site.pops).map((pop) => pop.radicals);
  assert.ok(radicals.some((value) => value > 0));
  assert.ok(Object.values(tunedWeek.societies).every((site) => site.pops.every((pop) => pop.radicals === 0)));
  assert.ok(aiDiplomacy(scenario, { ...game, elapsedDays: 56 }).length > 0);
  assert.deepEqual(aiDiplomacy(scenario, { ...tuned, elapsedDays: 56 }), []);
  assert.deepEqual(dispatch(scenario, tuned, { type: "setRuleTuning", tuning: null }), game);
});
