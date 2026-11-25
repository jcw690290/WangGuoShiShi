import assert from "node:assert/strict";
import { test } from "node:test";
import "fake-indexeddb/auto";
import { completeGuideStep, defaultEndYear, guideSteps } from "../src/game/campaign.ts";
import { campaignEndDate, createGame, dispatch, isScenarioFinished } from "../src/game/engine.ts";
import { archiveEnding, listEndings, parseSave, saveVersion } from "../src/game/storage.ts";
import { endingCatalog } from "../src/scenario/endings.ts";
import { borderScenario, scenario as world } from "../src/scenario/scenario.ts";

const id = "67dc097d-1110-4acf-b838-a9bd606a3f20";
const countryId = "country_01";

test("战役终年按配置结算并存快照，续玩沙盒保留原结局", async () => {
  const scenario = { ...borderScenario, startDate: "1820-12-25" };
  const fresh = createGame(scenario, 1820, "relaxed", { id, endYear: 1821, tutorialEnabled: false });
  const start = dispatch(scenario, fresh, { type: "selectCountry", countryId });
  assert.equal(campaignEndDate(scenario, start), "1821-01-01");
  assert.equal(start.elapsedDays, 0);
  assert.equal(start.lastEconomy, null);
  const end = dispatch(scenario, start, { type: "advanceWeek" });
  assert.equal(isScenarioFinished(scenario, end), true);
  assert.ok(end.lastEconomy);
  assert.ok(end.lastPopulation);
  const result = end.campaign!.ending!;
  assert.equal(result.kind, "neutral");
  assert.equal(result.date, "1821-01-01");
  assert.equal(result.stateCount, 2);
  const loaded = parseSave(scenario, { version: saveVersion, scenarioId: scenario.id, state: end });
  assert.deepEqual(loaded, end);
  await archiveEnding(result);
  await archiveEnding(result);
  assert.deepEqual(await listEndings(), [result]);
  const sandbox = dispatch(scenario, loaded, { type: "continueSandbox" });
  assert.equal(isScenarioFinished(scenario, sandbox), false);
  const played = dispatch(scenario, sandbox, { type: "advanceDay" });
  assert.equal(played.elapsedDays, 8);
  assert.deepEqual(played.campaign!.ending, result);
});

test("正式吞并立即结算被吞并的玩家国", () => {
  const scenario = borderScenario;
  const defender = "country_26";
  const targetStateId = scenario.borderDispute.targetStateId;
  let game = dispatch(scenario, createGame(scenario, 1820, "standard", {
    id, endYear: defaultEndYear, tutorialEnabled: false,
  }), { type: "selectCountry", countryId: defender });
  assert.equal(campaignEndDate(scenario, game), "1936-01-01");
  for (const goal of ["puppet", "annex"] as const) {
    game = dispatch(scenario, game, { type: "demandBorder", countryId, targetStateId, goal });
    game = dispatch(scenario, game, { type: "backDown", countryId: defender });
  }
  assert.equal(isScenarioFinished(scenario, game), true);
  assert.equal(game.campaign!.ending!.kind, "extinct");
  assert.equal(game.campaign!.ending!.stateCount, 0);
  assert.throws(() => dispatch(scenario, game, { type: "continueSandbox" }), /无法继续/);
});

test("52 条专属结局覆盖可选国家，教程按本局实际顺序推进并可存档", () => {
  const countries = Object.values(world.countries).filter((c) => c.selectable !== false).map((c) => c.id);
  assert.deepEqual(Object.keys(endingCatalog).sort(), countries.sort());
  assert.equal(new Set(Object.values(endingCatalog).flatMap((entry) => [entry.victory.title, entry.defeat.title])).size, 52);
  let game = dispatch(borderScenario, createGame(borderScenario, 1820, "relaxed", {
    id, endYear: defaultEndYear, tutorialEnabled: true,
  }), { type: "selectCountry", countryId });
  assert.strictEqual(completeGuideStep(game, 1), game);
  for (let step = 0; step < guideSteps.length; step++) game = completeGuideStep(game, step);
  assert.equal(game.campaign!.guideStep, guideSteps.length);
  assert.deepEqual(parseSave(borderScenario, { version: saveVersion, scenarioId: borderScenario.id, state: game }), game);
});
