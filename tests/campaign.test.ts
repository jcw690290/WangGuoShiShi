import assert from "node:assert/strict";
import { test } from "node:test";
import "fake-indexeddb/auto";
import { openDB } from "idb";
import { completeGuideStep, defaultEndYear, guideSteps } from "../src/game/campaign.ts";
import { advanceDay, campaignEndDate, createGame, dispatch, isScenarioFinished } from "../src/game/engine.ts";
import { archiveAchievements, archiveEnding, listAchievements, listEndings, parseSave, saveVersion } from "../src/game/storage.ts";
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
  const previousDb = await openDB("wang-guo-shi-shi", 3, {
    upgrade(db) {
      for (const store of ["saves", "saveIndex", "endings"]) db.createObjectStore(store);
    },
  });
  await previousDb.put("endings", result, result.campaignId);
  previousDb.close();
  assert.deepEqual(await listEndings(), [result]);
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

test("实际建设、教育与外交结算解锁成就，读取存档和归档不会重复计数", async () => {
  const scenario = borderScenario;
  let game = dispatch(scenario, createGame(scenario, 1820, "standard", {
    id, endYear: 1936, tutorialEnabled: false,
  }), { type: "selectCountry", countryId });
  game = dispatch(scenario, game, { type: "queueConstruction", countryId, stateId: "Yunnan", good: "university" });
  const medals = () => game.campaign!.achievements!.records;
  assert.equal(medals().length, 0);
  for (let week = 0; week < 10 && !medals().some((record) => record.id === "education"); week++)
    game = dispatch(scenario, game, { type: "advanceWeek" });
  assert.deepEqual(new Set(medals().map((record) => record.id)), new Set(["construction", "materials", "education"]));
  game = dispatch(scenario, game, { type: "demandBorder", countryId, targetStateId: "Tonkin", goal: "cession" });
  assert.equal(medals().length, 3);
  game = dispatch(scenario, game, { type: "backDown", countryId: "country_26" });
  assert.equal(medals().at(-1)?.id, "diplomacy");
  game = dispatch(scenario, game, { type: "startIntegration", countryId, stateId: "Tonkin" });
  game.societies.Tonkin.governance!.integration!.months = 59.99;
  game = dispatch(scenario, game, { type: "advanceWeek" });
  assert.equal(medals().at(-1)?.id, "integration");
  assert.deepEqual(parseSave(scenario, { version: saveVersion, scenarioId: scenario.id, state: game }), game);
  const forged = structuredClone(game);
  forged.campaign!.achievements!.records[0].date = "1935-01-01";
  assert.throws(() => parseSave(scenario, { version: saveVersion, scenarioId: scenario.id, state: forged }), /成就记录无效/);
  await Promise.all([archiveAchievements(medals()), archiveAchievements(medals())]);
  await archiveAchievements(medals().map((record) => ({ ...record, date: "1935-01-01" })));
  assert.equal((await listAchievements()).length, 5);
  assert.deepEqual(new Set(await listAchievements()), new Set(medals()));
});

test("文化月结跨过阈值和实际财政恢复各自只授予一次", () => {
  const scenario = borderScenario;
  const start = () => dispatch(scenario, createGame(scenario, 1820, "standard", {
    id, endYear: 1936, tutorialEnabled: false,
  }), { type: "selectCountry", countryId });
  const beforeContact = { ...start(), elapsedDays: 30 };
  beforeContact.societies.Tonkin.culturalAffinity![countryId] = 59.9;
  const contact = dispatch(scenario, beforeContact, { type: "advanceDay" });
  assert.equal(contact.campaign!.achievements!.records.filter((record) => record.id === "culture").length, 1);
  const following = dispatch(scenario, contact, { type: "advanceWeek" });
  assert.equal(following.campaign!.achievements!.records.filter((record) => record.id === "culture").length, 1);
  const distressed = dispatch(scenario, start(), { type: "advanceWeek" });
  distressed.countryEconomies[countryId].fiscal!.week.risk = "defaulted";
  const recovered = dispatch(scenario, distressed, { type: "advanceWeek" });
  assert.equal(recovered.countryEconomies[countryId].fiscal!.week.risk, "stable");
  assert.equal(recovered.campaign!.achievements!.records.filter((record) => record.id === "recovery").length, 1);
});

test("十年和平按实际历年计算，交战使和平时长重新开始", () => {
  const scenario = borderScenario;
  const start = () => dispatch(scenario, createGame(scenario, 1820, "standard", {
    id, endYear: 1936, tutorialEnabled: false,
  }), { type: "selectCountry", countryId });
  const anniversary = (Date.parse("1830-01-01") - Date.parse(scenario.startDate)) / 86_400_000;
  let game = dispatch(scenario, { ...start(), elapsedDays: anniversary - 2 }, { type: "advanceDay" });
  assert.ok(!game.campaign!.achievements!.records.some(({ id }) => id === "peace"));
  game = dispatch(scenario, game, { type: "advanceDay" });
  assert.ok(game.campaign!.achievements!.records.some((record) => record.id === "peace" && record.date === "1830-01-01"));

  let war = dispatch(scenario, start(), { type: "demandBorder", countryId, targetStateId: "Tonkin", goal: "cession" });
  const humans = new Set([countryId, "country_26"]);
  while (war.elapsedDays < 28) war = advanceDay(scenario, war, humans);
  assert.equal(war.campaign!.achievements!.peaceSince, null);
  const peace = dispatch(scenario, war, { type: "armistice", countryId });
  assert.equal(peace.campaign!.achievements!.peaceSince, peace.elapsedDays);
  const loaded = parseSave(scenario, { version: saveVersion, scenarioId: scenario.id, state: peace });
  assert.equal(loaded.campaign!.achievements!.peaceSince, 28);
});
