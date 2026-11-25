import assert from "node:assert/strict";
import { test } from "node:test";
import { createGame, dispatch, isPopulationMonth } from "../src/game/engine.ts";
import { projectEconomy } from "../src/game/economy.ts";
import { parseSave, saveVersion } from "../src/game/storage.ts";
import { decodeSnapshot, encodeSnapshot } from "../src/online/protocol.ts";
import { borderScenario } from "../src/scenario/scenario.ts";
import { affinityLevel } from "../src/game/culture.ts";

const countryId = "country_01";
const start = (scenario = borderScenario) => dispatch(scenario, createGame(scenario), { type: "selectCountry", countryId });

test("月结仅在日界触发，按闰年实际天数算增长并使用实际供给", async () => {
  const scenario = borderScenario;
  const initial = start();
  initial.nations[countryId].knowledge["公共教育"] = 100;
  const report = projectEconomy(initial);
  report.states.Yunnan.foodFulfillment = 1;
  report.states.Guangxi.foodFulfillment = 0;
  const endOfJanuary = { ...initial, elapsedDays: 30, tickInDay: 2, lastEconomy: report };
  const before = dispatch(scenario, endOfJanuary, { type: "advanceTick" });
  assert.equal(before.lastPopulation, null);
  assert.equal(isPopulationMonth(scenario, before), false);
  const after = dispatch(scenario, before, { type: "advanceTick" });
  assert.equal(isPopulationMonth(scenario, after), true);
  assert.equal(after.lastPopulation!.day, 31);
  assert.equal(after.lastPopulation!.changes.Yunnan,
    Math.round(initial.stateEconomies.Yunnan.population * (0.036 - 0.030) * 31 / 366));
  assert.equal(after.lastPopulation!.changes.Guangxi,
    Math.round(initial.stateEconomies.Guangxi.population * (0.036 - 0.030 - 0.030) * 31 / 366));
  const site = initial.societies.Yunnan;
  const pop = site.pops[0];
  const coverage = Math.min(1, site.university * 100_000 / initial.stateEconomies.Yunnan.population);
  const expected = pop.literacy + 100 * ((0.0001 + 0.0006 * coverage) * (1 - pop.literacy / 100));
  assert.equal(after.societies.Yunnan.pops[0].literacy, expected);
  const subsequent = dispatch(scenario, after, { type: "advanceTick" });
  assert.equal(isPopulationMonth(scenario, subsequent), false);
  assert.strictEqual(subsequent.lastPopulation, after.lastPopulation);
  assert.strictEqual(subsequent.societies, after.societies);
  for (const [id, local] of Object.entries(after.stateEconomies))
    assert.equal(after.societies[id].pops.reduce((sum, person) => sum + person.people, 0), local.population);
  assert.deepEqual(await decodeSnapshot(scenario, await encodeSnapshot(scenario, after)), after);
});

test("周结和月结同一天先结算市场，旧档续算保持月结进度", () => {
  const scenario = { ...borderScenario, startDate: "1820-01-25" };
  const initial = start(scenario);
  const prior = { ...initial, elapsedDays: 6, tickInDay: 3 };
  const { lastPopulation, ...legacy } = prior;
  const saved = parseSave(scenario, { version: 7, scenarioId: scenario.id, state: legacy });
  assert.equal(saved.lastPopulation, lastPopulation);
  const next = dispatch(scenario, saved, { type: "advanceTick" });
  assert.ok(next.lastEconomy);
  assert.equal(next.lastPopulation!.day, 7);
  for (const [id, site] of Object.entries(next.lastEconomy.states)) {
    const shortage = Math.max(0, 1 - site.foodFulfillment! / 0.8);
    const expected = Math.round(initial.stateEconomies[id].population * (0.036 - 0.030 - 0.030 * shortage) * 7 / 366);
    assert.equal(next.lastPopulation!.changes[id], expected === 0 ? 0 : expected);
  }
  assert.deepEqual(next, dispatch(scenario, prior, { type: "advanceTick" }));
  assert.deepEqual(parseSave(scenario, { version: saveVersion, scenarioId: scenario.id, state: next }), next);
});

test("文化亲近按月从居民、邻州接触和实付教育增加，远方联系衰减且保持人口身份", async () => {
  const g = start();
  const report = projectEconomy(g);
  const from = g.societies.Yunnan;
  const adjacentCulture = g.societies.Tonkin.pops[0].culture;
  const residentCulture = from.pops[0].culture;
  assert.ok(borderScenario.states.Yunnan.neighbors.includes("Tonkin"));
  assert.ok(!Object.hasOwn(from.culturalAffinity!, adjacentCulture));
  from.culturalAffinity = { ...from.culturalAffinity, remote: 48, [residentCulture]: 99.5 };
  const before = { ...g, elapsedDays: 30, tickInDay: 3, lastEconomy: report };
  const after = dispatch(borderScenario, before, { type: "advanceTick" });
  const updated = after.societies.Yunnan.culturalAffinity!;
  assert.ok(updated[adjacentCulture] > 0 && updated[adjacentCulture] <= 1);
  assert.ok(updated[residentCulture] > 99.5 && updated[residentCulture] < 99.6);
  assert.equal(updated.remote, 47.75);
  assert.deepEqual(after.societies.Yunnan.pops.map((p) => p.culture), from.pops.map((p) => p.culture));
  assert.deepEqual([0, 25, 50, 75].map(affinityLevel), ["陌生", "接触", "熟悉", "亲近"]);
  const funded = structuredClone(before);
  funded.lastEconomy.states.Yunnan.universityStaff = 500;
  const educated = dispatch(borderScenario, funded, { type: "advanceTick" });
  assert.ok(educated.societies.Yunnan.culturalAffinity![adjacentCulture] > updated[adjacentCulture]);
  assert.deepEqual(await decodeSnapshot(borderScenario, await encodeSnapshot(borderScenario, educated)), educated);
  assert.deepEqual(parseSave(borderScenario, { version: saveVersion, scenarioId: borderScenario.id, state: educated }), educated);
});
