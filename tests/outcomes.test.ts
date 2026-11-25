import assert from "node:assert/strict";
import { test } from "node:test";
import { canSettleVictory } from "../src/game/campaign.ts";
import { createGame, dispatch, getGameDate } from "../src/game/engine.ts";
import { goods } from "../src/game/industry.ts";
import { parseSave, saveVersion } from "../src/game/storage.ts";
import { DAY_MS } from "../src/game/time.ts";
import { endingRules, outcomeCandidates } from "../src/scenario/endingRules.ts";
import { endingCatalog, endingTitle } from "../src/scenario/endings.ts";
import { borderScenario, scenario as world } from "../src/scenario/scenario.ts";

const id = "90495374-99bb-41fe-9c15-eafa426ea7c6";
const qing = "country_01", vietnam = "country_26", france = "country_04";
const days = (date: string) => (Date.parse(date) - Date.parse(borderScenario.startDate)) / DAY_MS;

test("26 国的专属条件可比较精确阈值，缺失指标由其他完整分支独立判定", () => {
  assert.deepEqual(Object.keys(endingRules).sort(), Object.keys(endingCatalog).sort());
  assert.equal(outcomeCandidates("country_02", { FISCAL_RUIN: 1 }).defeat, false);
  assert.equal(outcomeCandidates("country_02", { FISCAL_RUIN: 1, TUR: 45 }).defeat, false);
  assert.equal(outcomeCandidates("country_02", { FISCAL_RUIN: 1, TUR: 46 }).defeat, true);
  assert.equal(outcomeCandidates(vietnam, { PUP: 1 }).defeat, true);
  assert.equal(outcomeCandidates(france, { G: 2, SOL: 17, LIT: 65, LEG: 60 }).victory, true);
  assert.equal(outcomeCandidates(france, { G: 2, SOL: 17, LIT: 65 }).victory, false);
  assert.equal(outcomeCandidates(qing, { SOL: 18, LIT: 75, TUR: 10, BASIC_CONSUMPTION: 0.95, SUSTAINABLE_FISCAL: 1 }).genericVictory, true);
});

test("严重失败在五年保护期后累计 24 个月，并从存档延续", () => {
  const scenario = borderScenario;
  let game = dispatch(scenario, createGame(scenario, 1820, "standard", { id, endYear: 1936, tutorialEnabled: false }),
    { type: "selectCountry", countryId: vietnam });
  game = dispatch(scenario, game, { type: "demandBorder", countryId: qing, targetStateId: "Tonkin", goal: "puppet" });
  game = dispatch(scenario, game, { type: "backDown", countryId: vietnam });
  assert.equal(game.campaign!.outcome!.metrics.PUP, 1);
  assert.equal(game.campaign!.outcome!.lossSince, null);
  for (let i = 0; i < 10; i++) game = dispatch(scenario, game, { type: "advanceHalfYear" });
  assert.equal(game.elapsedDays, days("1825-01-01"));
  assert.equal(game.campaign!.outcome!.lossSince, game.elapsedDays);
  assert.equal(game.campaign!.ending, null);
  for (let i = 0; i < 3; i++) game = dispatch(scenario, game, { type: "advanceHalfYear" });
  const loaded = parseSave(scenario, { version: saveVersion, scenarioId: scenario.id, state: game });
  const tuned = dispatch(scenario, loaded, { type: "setDifficulty", difficulty: "relaxed" });
  assert.equal(tuned.campaign!.outcome!.lossSince, days("1825-01-01"));
  const ending = dispatch(scenario, tuned, { type: "advanceHalfYear" });
  assert.equal(ending.campaign!.ending?.kind, "defeat");
  assert.equal(ending.campaign!.ending?.date, "1827-01-01");
  assert.equal(ending.campaign!.ending?.endingId, vietnam + ":defeat");
  assert.equal(ending.campaign!.ending?.stateCount, 2);
  assert.equal(ending.campaign!.ending?.metrics?.PUP, 1);
  assert.equal(endingTitle(ending.campaign!.ending!), endingCatalog[vietnam].defeat.title);
  const sandbox = dispatch(scenario, ending, { type: "continueSandbox" });
  const continued = dispatch(scenario, sandbox, { type: "advanceWeek" });
  assert.deepEqual(continued.campaign!.ending, ending.campaign!.ending);
});

const frenchScenario = {
  ...borderScenario,
  countries: { [france]: { ...world.countries[france], treasury: borderScenario.countries[qing].treasury },
    [vietnam]: borderScenario.countries[vietnam] },
  states: Object.fromEntries(Object.entries(borderScenario.states).map(([id, site]) =>
    [id, { ...site, ownerId: site.ownerId === qing ? france : site.ownerId }],
  )),
};

function prosperousFrance(endYear: number) {
  const initial = dispatch(frenchScenario, createGame(frenchScenario, 1820, "standard", { id, endYear, tutorialEnabled: false }),
    { type: "selectCountry", countryId: france });
  const state = dispatch(frenchScenario, initial, { type: "advanceWeek" });
  for (const site of ["Yunnan", "Guangxi"]) {
    for (const pop of state.societies[site].pops) {
      pop.livingStandard = 19;
      pop.literacy = 71;
    }
    for (const good of goods) state.lastEconomy!.states[site].industries[good].output *= 3;
  }
  state.nations[france].government = ["乡民", "地主", "小市民", "武装部队"];
  return state;
}

test("终年采用当前专属胜利条件，提前结算重查当前指标并核对连续时长", () => {
  const scenario = frenchScenario;
  const deadline = dispatch(scenario, { ...prosperousFrance(1821), elapsedDays: days("1821-01-01") - 1 },
    { type: "advanceDay" });
  assert.equal(deadline.campaign!.ending?.kind, "victory");
  assert.equal(deadline.campaign!.ending?.endingId, france + ":victory");
  assert.equal(endingTitle(deadline.campaign!.ending!), "荣光新时代");
  assert.deepEqual(parseSave(scenario, { version: saveVersion, scenarioId: scenario.id, state: deadline }), deadline);

  const watching = dispatch(scenario, { ...prosperousFrance(1936), elapsedDays: days("1825-01-01") },
    { type: "setDifficulty", difficulty: "challenging" });
  assert.equal(watching.campaign!.outcome!.victorySince, days("1825-01-01"));
  const nearly = { ...watching, elapsedDays: days("1830-01-01") - 1 };
  assert.throws(() => dispatch(scenario, nearly, { type: "settleCampaignVictory" }), /满十年/);
  const eligible = { ...watching, elapsedDays: days("1830-01-01") };
  assert.ok(canSettleVictory(eligible, getGameDate(scenario, eligible)));
  const ceased = structuredClone(eligible);
  for (const pop of ceased.societies.Yunnan.pops) pop.livingStandard = 1;
  assert.throws(() => dispatch(scenario, ceased, { type: "settleCampaignVictory" }), /连续满足/);
  const victory = dispatch(scenario, eligible, { type: "settleCampaignVictory" });
  assert.equal(victory.campaign!.ending?.date, "1830-01-01");
  assert.equal(victory.campaign!.ending?.kind, "victory");
});
