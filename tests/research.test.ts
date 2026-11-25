import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseUniversity, universityWage } from "../src/game/economy.ts";
import { createGame, dispatch } from "../src/game/engine.ts";
import { researchCapacity, researchCost } from "../src/game/politics.ts";
import { parseSave, saveVersion } from "../src/game/storage.ts";
import { borderScenario as scenario } from "../src/scenario/scenario.ts";

const countryId = "country_01";
const opponent = "country_26";
const start = () => dispatch(scenario, createGame(scenario), { type: "selectCountry", countryId });
const week = (game: ReturnType<typeof start>) => dispatch(scenario, game, { type: "advanceWeek" });

test("大学建成后从下一周开始用工和付薪，科研按实付岗位推进", () => {
  let game = dispatch(scenario, start(), { type: "startResearch", countryId, tech: "纺织工艺" });
  game = week(game);
  assert.equal(game.nations[countryId].knowledge["纺织工艺"], 0);
  game = dispatch(scenario, game, { type: "queueConstruction", countryId, stateId: "Yunnan", good: "university" });
  for (let i = 0; i < 10 && game.countryEconomies[countryId].queue.length; i++) game = week(game);
  assert.equal(game.societies.Yunnan.university, 1);
  assert.equal(game.lastEconomy!.states.Yunnan.universityStaff, 0);
  const before = game;
  game = week(game);
  const faculty = game.lastEconomy!.states.Yunnan.universityStaff!;
  assert.equal(faculty, 100);
  const receipts = game.countryEconomies[countryId].fiscal!.week;
  const report = game.lastEconomy!.countries[countryId];
  assert.equal(report.universityWages, faculty * universityWage);
  assert.equal(report.upkeep, receipts.upkeepPaid);
  assert.equal(game.nations[countryId].knowledge["纺织工艺"], before.nations[countryId].knowledge["纺织工艺"] + 0.25);
  assert.deepEqual(parseSave(scenario, { version: saveVersion, scenarioId: scenario.id, state: game }), game);
});

test("研究成本按年代，创新上限按识字率，外国扩散每类最多一项", () => {
  assert.equal(researchCost("纺织工艺", 1820), 4_000);
  assert.equal(researchCost("机械织造", 1820), 16_000);
  assert.equal(researchCost("机械织造", 1850), 10_000);
  assert.deepEqual(researchCapacity(2000, 50), { innovation: 200, cap: 115 });
  const world = start();
  world.nations[opponent].knowledge["纺织工艺"] = 100;
  world.nations[opponent].knowledge["机械织造"] = 100;
  world.nations[opponent].knowledge["野战后勤"] = 100;
  const next = week(world);
  assert.ok(next.nations[countryId].diffusion["纺织工艺"] > 0);
  assert.ok(next.nations[countryId].diffusion["野战后勤"] > 0);
  assert.equal(next.nations[countryId].diffusion["机械织造"], 0);
});

test("科研 AI 在现有建设与财政约束下安排大学", () => {
  const initial = start();
  initial.nations[opponent].research = "野战后勤";
  const plan = chooseUniversity(scenario, { ...initial, elapsedDays: 28 }, opponent);
  assert.deepEqual(plan, { stateId: "Tonkin", good: "university" });
  const next = week({ ...initial, elapsedDays: 21 });
  assert.ok(next.countryEconomies[opponent].queue.some((project) => project.good === "university"));
});
