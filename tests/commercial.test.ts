import assert from "node:assert/strict";
import { test } from "node:test";
import { projectEconomy } from "../src/game/economy.ts";
import { createGame, dispatch } from "../src/game/engine.ts";
import { workingCapitalPerLevel } from "../src/game/industrial.ts";
import { byProductiveBuilding, goods } from "../src/game/industry.ts";
import { parseSave, saveVersion } from "../src/game/storage.ts";
import { borderScenario } from "../src/scenario/scenario.ts";

const countryId = "country_01", stateId = "Yunnan";

test("粮食农场和纺织厂使用实际原料、专业岗位和企业工资", () => {
  const original = borderScenario.states[stateId];
  const scenario = { ...borderScenario, states: { ...borderScenario.states,
    [stateId]: { ...original, buildings: { grain: 1, cloth: 1 } },
  } };
  const game = dispatch(scenario, createGame(scenario), { type: "selectCountry", countryId });
  const forecast = projectEconomy(game).states[stateId];
  const byLine = (line: "grain" | "cloth") => {
    const { employed, output, wages } = forecast.industries[line];
    return [employed, output, wages];
  };
  assert.deepEqual(byLine("grain"), [100, 180, 10_000]);
  assert.deepEqual(byLine("cloth"), [100, 100, 10_800]);
  assert.equal(forecast.industrial!.used.tools, 2);
  assert.equal(forecast.industrial!.used.fiber, 70);
  assert.equal(forecast.industrial!.skilledWages, 1_800);
  const short = structuredClone(game);
  short.stateEconomies[stateId].industrial!.stocks.fiber = 35;
  const textile = projectEconomy(short).states[stateId];
  assert.equal(textile.industries.cloth.output, 50);
  assert.equal(textile.industrial!.used.fiber, 35);
  short.stateEconomies[stateId].industrial!.stocks.tools = 0;
  const stopped = projectEconomy(short).states[stateId];
  assert.equal(stopped.industries.grain.output + stopped.industries.cloth.output, 0);
  assert.equal(stopped.industries.grain.wages + stopped.industries.cloth.wages, 0);

  const settled = dispatch(scenario, game, { type: "advanceWeek" });
  const week = settled.lastEconomy!.states[stateId];
  const account = week.industrial!;
  const wages = goods.reduce((sum, line) => sum + week.industries[line].wages, 0);
  assert.equal(account.capital + account.distributed,
    game.stateEconomies[stateId].industrial!.capital + account.sales - account.spent - wages);
});

test("版本 8 的农田、纺织和已付款工程只转换一次并可继续推进", () => {
  const scenario = borderScenario;
  const old = dispatch(scenario, createGame(scenario), { type: "selectCountry", countryId });
  const local = old.stateEconomies[stateId];
  delete local.commercialRecipes;
  delete local.industrial;
  local.buildings = { ...byProductiveBuilding(() => 0), grain: 2, cloth: 1 };
  old.countryEconomies[countryId].queue.push({ stateId, good: "grain", weeksLeft: 0.5 });
  const restored = parseSave(scenario, { version: 8, scenarioId: scenario.id, state: old });
  const funded = restored.stateEconomies[stateId];
  assert.equal(funded.buildings.grain, 24);
  assert.equal(funded.buildings.cloth, 4);
  assert.equal(funded.industrial!.capital, 24 * workingCapitalPerLevel("grain") + 4 * workingCapitalPerLevel("cloth"));
  assert.deepEqual(restored.countryEconomies[countryId].queue[0], { stateId, good: "grain", weeksLeft: 0.5, levels: 12 });
  assert.equal(restored.countryEconomies[countryId].treasury, old.countryEconomies[countryId].treasury);
  assert.deepEqual(parseSave(scenario, { version: saveVersion, scenarioId: scenario.id, state: restored }), restored);
  restored.stateEconomies[stateId].constructionStock = { public: { wood: 240, tools: 60, iron: 60 }, private: { wood: 0, tools: 0, iron: 0 } };
  let next = restored;
  for (let week = 0; week < 12 && next.countryEconomies[countryId].queue.length; week++)
    next = dispatch(scenario, next, { type: "advanceWeek" });
  assert.equal(next.stateEconomies[stateId].buildings.grain, 36);
});
