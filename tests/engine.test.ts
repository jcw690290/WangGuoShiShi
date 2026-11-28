import assert from "node:assert/strict";
import { test } from "node:test";
import { advanceDay, createGame, dispatch, getGameDate, spanDays } from "../src/game/engine.ts";
import type { GameState, GameCommand } from "../src/game/engine.ts";
import { projectEconomy, constructionError, projectDeposit, projects, remainingProjectPoints } from "../src/game/economy.ts";
import { constructionSpending } from "../src/game/construction.ts";
import { parseSave, saveVersion } from "../src/game/storage.ts";
import { decodeSnapshot, encodeSnapshot } from "../src/online/protocol.ts";
import { influence, reformConditions, reformWork } from "../src/game/society.ts";
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
      buildings: { grain: 20, cloth: 0, wood: 1, iron: 1, coal: 1, tools: 1, fiber: 1 },
      capacity: { grain: 21, cloth: 1, wood: 1, iron: 1, coal: 1, tools: 1, fiber: 1 },
    },
    coast: {
      id: "coast",
      name: "沿海州",
      label: [0, 0],
      ownerId: "second",
      population: 12_000,
      neighbors: ["border"],
      grainTransport: 4_000,
      buildings: { grain: 20, cloth: 0, wood: 1, iron: 1, coal: 1, tools: 1, fiber: 1 },
      capacity: { grain: 21, cloth: 8, wood: 1, iron: 1, coal: 1, tools: 1, fiber: 6 },
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
  // Fund construction and stock its inputs through the first textile hiring round.
  g.countryEconomies.first.treasury = 10_000_000;
  g.stateEconomies.border.constructionStock = { public: { wood: 800, tools: 200, iron: 200 }, private: { wood: 0, tools: 0, iron: 0 } };
  g.stateEconomies.border.industrial!.stocks.fiber += 2_200;
  g.stateEconomies.border.industrial!.stocks.tools += 600;
  const old = g;
  g = send(g, job);
  assert.equal(g.countryEconomies.first.treasury, old.countryEconomies.first.treasury - projectDeposit("cloth"));
  assert.throws(() => send(g, job), /容量已满/);
  assert.throws(() => send(g, { ...job, stateId: "coast" }), /本国州内/);
  for (let i = 0; i < 60 && !g.stateEconomies.border.buildings.cloth; i++) g = week(g);
  assert.equal(g.stateEconomies.border.buildings.cloth, 1);
  assert.equal(g.lastEconomy!.states.border.industries.cloth.employed, 0);
  g = week(g);
  const report = g.lastEconomy!;
  assert.equal(report.states.border.industries.cloth.employed, 10);
  assert.ok(report.states.border.industries.cloth.output > 0);
  assert.ok(report.states.border.industries.cloth.wages > 0);
  assert.ok(report.countries.first.tax > 0);
  assert.ok(
    report.countries.first.market.cloth.targetPrice! < projectEconomy(old).countries.first.market.cloth.targetPrice!,
  );
  assert.ok(report.states.border.regulars > 0 && report.states.border.regulars <= 100);
});
test("AI 使用共用建设指令，全国市场价格与本州供需按接入混合", () => {
  let g = start();
  g.ownerByStateId.coast = "first";
  g.stateEconomies.coast.buildings.cloth = 8;
  g.stateEconomies.coast.industrial!.stocks.fiber = 560;
  g.stateEconomies.coast.industrial!.stocks.tools += 8;
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
test("投资池与国库单独扣款，两类工程共享建造力，闲置份额可接管", async () => {
  const old = start();
  old.nations.first.investment = 500000;
  const both = send(
    send(old, { type: "queueConstruction", countryId: "first", stateId: "border", good: "grain" }),
    { type: "queueConstruction", countryId: "first", stateId: "border", good: "cloth", privateBuild: true },
  );
  assert.equal(both.nations.first.investment, old.nations.first.investment - projectDeposit("cloth"));
  assert.equal(both.countryEconomies.first.treasury, old.countryEconomies.first.treasury - projectDeposit("grain"));
  const legacy = structuredClone(both);
  legacy.countryEconomies.first.treasury = old.countryEconomies.first.treasury - projects.grain.cost;
  legacy.nations.first.investment = old.nations.first.investment - projects.cloth.cost;
  assert.deepEqual(parseSave(scenario, { version: 11, scenarioId: scenario.id, state: legacy }), both);
  const g = week(both);
  assert.ok(g.nations.first.privateQueue[0].weeksLeft < 3);
  assert.ok(g.countryEconomies.first.queue[0].weeksLeft < 2);
  const report = g.lastEconomy!.countries.first;
  const { public: publicBill, private: privateBill } = report.construction!;
  assert.ok(publicBill.wages > 0 && publicBill.materials > 0 && privateBill.wages > 0 && privateBill.materials > 0);
  const used = g.lastEconomy!.states.border.constructionGoods!;
  assert.ok(used.wood > 0 && used.iron > 0 && used.tools > 0);
  assert.equal(used.grain + used.cloth, 0);
  const stock = g.stateEconomies.border.constructionStock!;
  assert.ok(stock.public.tools + stock.private.tools > 0);
  assert.ok(Math.abs(remainingProjectPoints(g.countryEconomies.first.queue[0]) + publicBill.points - 100) < 1e-6);
  assert.equal(g.nations.first.investment, both.nations.first.investment + report.investment - constructionSpending(privateBill));
  assert.equal(g.countryEconomies.first.treasury, both.countryEconomies.first.treasury + report.tax - report.upkeep);
  const canceled = send(g, { type: "cancelConstruction", countryId: "first", stateId: "border",
    good: "cloth", index: 0, privateBuild: true });
  assert.equal(canceled.nations.first.privateQueue.length, 0);
  assert.equal(canceled.nations.first.investment - g.nations.first.investment, projectDeposit("cloth"));
  assert.deepEqual(load(canceled), canceled);
  assert.deepEqual(await decodeSnapshot(scenario, await encodeSnapshot(scenario, canceled)), canceled);
  assert.match(constructionError(scenario, g, "first", "border", "university", true)!, /私人资金/);
});
test("施工闲置维护购买实物并占用国库现款，和在建岗位分别结算", () => {
  const initial = start();
  const normal = projectEconomy(initial);
  const standby = normal.states.border.constructionMaintenance!;
  assert.equal(standby.workers, 10);
  assert.equal(standby.wages, 1000);
  assert.equal(standby.tools, 1);
  assert.ok(standby.materials > 0);
  assert.equal(normal.states.border.builders, 0);
  assert.equal(normal.states.border.constructionGoods!.tools, 0);
  assert.equal(normal.countries.first.capacity, 0);

  const worked = send(initial, { type: "queueConstruction", countryId: "first", stateId: "border", good: "cloth" });
  const active = projectEconomy(worked).states.border;
  assert.equal(active.builders, 100);
  assert.equal(active.constructionMaintenance!.workers, 0);

  const shortage = structuredClone(initial);
  shortage.stateEconomies.border.industrial!.stocks.iron = 0;
  const awaitingTools = projectEconomy(shortage).states.border.constructionMaintenance!;
  assert.deepEqual(awaitingTools, { workers: 10, wages: 1000, tools: 0, materials: 0 });
  shortage.countryEconomies.first.treasury = 100;
  assert.deepEqual(projectEconomy(shortage).states.border.constructionMaintenance!, { workers: 0, wages: 0, tools: 0, materials: 0 });

  const settled = week(initial);
  const report = settled.lastEconomy!.countries.first;
  assert.deepEqual(report.constructionMaintenance, standby);
  assert.equal(settled.countryEconomies.first.treasury, initial.countryEconomies.first.treasury + report.tax - report.upkeep);
  assert.equal(settled.countryEconomies.first.fiscal!.week.upkeepPaid, report.upkeep);
  assert.deepEqual(load(settled), settled);
});

test("职业支持分配与选举权重改变八个集团，合法性和激进度影响审议", () => {
  const g = start(),
    n = g.nations.first,
    site = g.societies.border;
  const before = influence([site], "first", n);
  const farmer = site.pops.find((p) => p.occupation === "农民")!;
  const ruralOnly = influence([{ ...site, pops: [farmer] }], "first", n);
  assert.ok(ruralOnly["乡民"] > ruralOnly["地主"] && ruralOnly["地主"] > ruralOnly["教会"]);
  assert.ok(ruralOnly["教会"] > 0);
  assert.ok(Math.abs(ruralOnly["乡民"] + ruralOnly["地主"] + ruralOnly["教会"] - 100) < 1e-9);
  assert.ok(Math.abs(Object.values(before).reduce((a, b) => a + b) - 100) < 1e-9);
  const limited = influence([site], "first", { ...n, startingRepresentation: "limited" });
  assert.ok(limited["乡民"] > before["乡民"]);
  const sample = { 乡民: 30, 工会: 0, 知识分子: 0, 武装部队: 30, 教会: 0, 小市民: 0, 实业家: 0, 地主: 40 };
  n.laws = [];
  n.government = ["地主", "武装部队"];
  const supported = reformConditions(n, sample, "普选制");
  assert.equal(supported.legitimacy, 67);
  assert.ok(supported.weeks >= 8 && supported.weeks <= 104);
  assert.equal(supported.speed, reformWork / supported.weeks);
  assert.ok(reformConditions(n, sample, "普选制", 70).weeks > supported.weeks);
  n.government = ["知识分子", "教会"];
  assert.equal(reformConditions(n, sample, "出版自由").speed, 0);
  n.laws = ["平等公民权", "信仰自由", "普选制"];
  const votes = influence([site], "first", n);
  assert.ok(votes["乡民"] > before["乡民"]);
});
test("改革和研究进入下一期结算，科技只有在外国掌握之后才扩散", () => {
  let g = start();
  g = send(g, { type: "setGovernment", countryId: "first", government: ["地主", "乡民", "实业家"] });
  g.societies.border.university = 1;
  g.nations.first.knowledge["纺织工艺"] = 99.9;
  g = send(g, { type: "proposeLaw", countryId: "first", law: "工资税改革" });
  g = send(g, { type: "startResearch", countryId: "first", tech: "纺织工艺" });
  assert.throws(() => send(g, { type: "proposeLaw", countryId: "first", law: "工资税改革" }), /议案/);
  g = week(g);
  assert.equal(g.nations.first.knowledge["野战后勤"], 0);
  for (let i = 0; i < 30 && g.nations.first.knowledge["纺织工艺"] < 100; i++) g = week(g);
  assert.equal(g.nations.first.knowledge["纺织工艺"], 100);
  assert.equal(g.lastEconomy!.countries.first.clothOutputBonus, 0);
  g = week(g);
  assert.equal(g.lastEconomy!.countries.first.clothOutputBonus, 25);
  for (let i = 0; i < 104 && !g.nations.first.laws.includes("工资税改革"); i++) g = week(g);
  assert.ok(g.nations.first.laws.includes("工资税改革"));
  assert.equal(g.lastEconomy!.countries.first.wageTaxRate, 10);
  g = week(g);
  assert.equal(g.lastEconomy!.countries.first.wageTaxRate, 14);
  const contact = start();
  contact.nations.second.knowledge["公共教育"] = 100;
  assert.ok(week(contact).nations.first.diffusion["公共教育"] > 0);
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
