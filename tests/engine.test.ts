import assert from "node:assert/strict";
import { test } from "node:test";
import { advanceDay, createGame, dispatch, getGameDate, spanDays } from "../src/game/engine.ts";
import type { GameState, GameCommand } from "../src/game/engine.ts";
import { projectEconomy, constructionError } from "../src/game/economy.ts";
import { parseSave, saveVersion } from "../src/game/storage.ts";
import { influence, reformConditions } from "../src/game/society.ts";
import type { Scenario } from "../src/scenario/scenario.ts";
const scenario: Scenario = {
  id: "test",
  name: "测试剧本",
  startDate: "1820-01-01",
  borderDispute: {
    targetStateId: "coast",
    compromiseBorders: 1,
    recruitPercent: 25,
    supplyPercent: 35,
    grainPerRecruit: 12,
    strengthPerPoint: 20,
    cessionProgress: 60,
  },
  countries: {
    first: { id: "first", name: "甲国", color: "#cc3333", treasury: 1_200_000 },
    second: { id: "second", name: "乙国", color: "#e17c05", treasury: 900_000 },
  },
  states: {
    border: {
      id: "border",
      name: "边境州",
      label: [0, 0],
      ownerId: "first",
      population: 12_000,
      neighbors: ["coast"],
      grainTransport: 4_000,
      buildings: { grain: 1, cloth: 0 },
      capacity: { grain: 2, cloth: 1 },
    },
    coast: {
      id: "coast",
      name: "沿海州",
      label: [0, 0],
      ownerId: "second",
      population: 12_000,
      neighbors: ["border"],
      grainTransport: 4_000,
      buildings: { grain: 1, cloth: 0 },
      capacity: { grain: 2, cloth: 1 },
    },
  },
};

const send = (state: GameState, cmd: GameCommand) => dispatch(scenario, state, cmd);
const start = () => send(createGame(scenario), { type: "selectCountry", countryId: "first" });
const week = (s: GameState) => send(s, { type: "advanceWeek" });
const load = (s: GameState) =>
  parseSave(scenario, { version: saveVersion, scenarioId: scenario.id, state: structuredClone(s) });
test("开局暂停，日周半年共用日步进，跨月按历法截断", () => {
  const fresh = createGame(scenario);
  assert.equal(fresh.playerCountryId, null);
  assert.throws(() => week(fresh), /请先选择国家/);
  let daily = start();
  assert.equal(getGameDate(scenario, daily).toISOString().slice(0, 10), "1820-01-01");
  for (let i = 0; i < 6; i++) daily = advanceDay(scenario, daily);
  assert.equal(daily.lastEconomy, null);
  daily = advanceDay(scenario, daily);
  assert.deepEqual(daily, week(start()));
  assert.equal(getGameDate(scenario, daily).toISOString().slice(0, 10), "1820-01-08");
  const half = send(start(), { type: "advanceHalfYear" });
  assert.equal(half.elapsedDays, 182);
  while (daily.elapsedDays < 182) daily = advanceDay(scenario, daily);
  assert.deepEqual(daily, half);
  const august = { ...half, elapsedDays: 243 };
  assert.equal(getGameDate(scenario, august).toISOString().slice(0, 10), "1820-08-31");
  assert.equal(spanDays(scenario, august, "halfYear"), 181);
});
test("政府队列付款、所有权与容量校验，完工带来就业、产出与税收", () => {
  let g = start();
  const job = { type: "queueConstruction", countryId: "first", stateId: "border", good: "cloth" } as const;
  const old = g;
  g = send(g, job);
  assert.equal(g.countryEconomies.first.treasury, old.countryEconomies.first.treasury - 360000);
  assert.throws(() => send(g, job), /容量已满/);
  assert.throws(() => send(g, { ...job, stateId: "coast" }), /本国州内/);
  for (let i = 0; i < 15 && !g.stateEconomies.border.buildings.cloth; i++) g = week(g);
  assert.equal(g.stateEconomies.border.buildings.cloth, 1);
  const report = g.lastEconomy!;
  assert.equal(report.states.border.industries.cloth.employed, 400);
  assert.ok(report.states.border.industries.cloth.wages > 0);
  assert.ok(report.countries.first.tax > 0);
  assert.ok(
    report.countries.first.market.cloth.targetPrice! < projectEconomy(old).countries.first.market.cloth.targetPrice!,
  );
  assert.equal(report.states.border.regulars, 100);
});
test("AI 使用共用建设指令，全国市场价格与本州供需按接入混合", () => {
  let g = start();
  g.ownerByStateId.coast = "first";
  g.stateEconomies.coast.buildings.cloth = 1;
  g.societies.border.infrastructure = 1;
  g.societies.coast.infrastructure = 3;
  const isolated = projectEconomy(g);
  assert.ok(isolated.states.border.localPrices.cloth > isolated.countries.first.market.cloth.price);
  g.societies.border.infrastructure = 10;
  assert.equal(
    projectEconomy(g).states.border.localPrices.cloth,
    isolated.countries.first.market.cloth.price,
  );
  g = week(start());
  assert.equal(g.countryEconomies.second.queue[0].good, "cloth");
  assert.deepEqual(week(load(g)), week(g));
  const bad = structuredClone(g);
  bad.countryEconomies.second.queue[0].stateId = "border";
  assert.throws(() => load(bad), /无效/);
});
test("投资池与国库单独扣款，两类工程共享建造力，闲置份额可接管", () => {
  const old = start();
  old.nations.first.investment = 500000;
  const both = send(
    send(old, { type: "queueConstruction", countryId: "first", stateId: "border", good: "grain" }),
    { type: "queueConstruction", countryId: "first", stateId: "border", good: "cloth", privateBuild: true },
  );
  assert.equal(both.nations.first.investment, 140000);
  assert.equal(both.countryEconomies.first.treasury, old.countryEconomies.first.treasury - 240000);
  const g = week(both);
  assert.ok(g.nations.first.privateQueue[0].weeksLeft < 3);
  assert.ok(g.countryEconomies.first.queue[0].weeksLeft < 2);
  assert.ok(g.lastEconomy!.countries.first.investment > 0);
  assert.match(constructionError(scenario, g, "first", "border", "university", true)!, /私人资金/);
});
test("职业、财富与接纳影响八个集团；合法性不足暂停，低合法性减半", () => {
  const g = start(),
    n = g.nations.first,
    site = g.societies.border;
  const before = influence([site], "first", n);
  site.pops.find((p) => p.occupation === "工程师")!.wealth *= 5;
  const after = influence([site], "first", n);
  assert.ok(after["知识分子"] > before["知识分子"]);
  assert.ok(Math.abs(Object.values(after).reduce((a, b) => a + b) - 100) < 1e-9);
  n.government = ["知识分子"];
  assert.equal(reformConditions(n, after, "出版自由").speed, 0.5);
  n.government = ["知识分子", "教会"];
  assert.equal(reformConditions(n, before, "出版自由").speed, 0);
  n.laws = ["平等公民权", "信仰自由", "普选制"];
  const votes = influence([site], "first", n);
  assert.ok(votes["乡民"] > before["乡民"]);
});
test("改革和研究进入下一期结算，科技只有在外国掌握之后才扩散", () => {
  let g = start();
  g = send(g, { type: "setGovernment", countryId: "first", government: ["地主", "乡民", "实业家"] });
  g = send(g, { type: "proposeLaw", countryId: "first", law: "工资税改革" });
  g = send(g, { type: "startResearch", countryId: "first", tech: "纺织工艺" });
  assert.throws(() => send(g, { type: "proposeLaw", countryId: "first", law: "工资税改革" }), /议案/);
  g = week(g);
  assert.equal(g.nations.first.knowledge["野战后勤"], 0);
  while (!g.nations.first.laws.includes("工资税改革")) g = week(g);
  assert.equal(g.lastEconomy!.countries.first.wageTaxRate, 10);
  g = week(g);
  assert.equal(g.lastEconomy!.countries.first.wageTaxRate, 14);
  while (g.nations.first.knowledge["纺织工艺"] < 100) g = week(g);
  assert.equal(g.lastEconomy!.countries.first.clothOutputBonus, 0);
  assert.equal(week(g).lastEconomy!.countries.first.clothOutputBonus, 25);
  g.nations.second.knowledge["公共教育"] = 100;
  assert.ok(week(g).nations.first.diffusion["公共教育"] > 0);
});
test("第一版存档保留日期和实际归属，损坏的存档在输入边界拒绝", () => {
  const legacy = {
    elapsedDays: 7,
    playerCountryId: "first",
    ownerByStateId: { border: "second", coast: "first" },
  };
  const g = parseSave(scenario, { version: 1, scenarioId: scenario.id, state: legacy });
  assert.deepEqual(g.ownerByStateId, legacy.ownerByStateId);
  assert.equal(week(g).elapsedDays, 14);
  const broken = structuredClone(g);
  broken.societies.coast.pops[0].people++;
  assert.throws(() => load(broken), /无效/);
});
