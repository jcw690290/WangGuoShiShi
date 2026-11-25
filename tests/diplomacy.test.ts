import assert from "node:assert/strict";
import { administrationWage, governanceOf, integrationStaffNeeded } from "../src/game/governance.ts";
import { test } from "node:test";
import { createGame, dispatch } from "../src/game/engine.ts";
import type { GameState, GameCommand } from "../src/game/engine.ts";
import { projectEconomy } from "../src/game/economy.ts";
import { infamyLevel, planWar, swayCost } from "../src/game/diplomacy.ts";
import { parseSave, saveVersion } from "../src/game/storage.ts";
import { borderScenario as scenario } from "../src/scenario/scenario.ts";
const a = "country_01",
  b = "country_26",
  targetStateId = "Tonkin";
const send = (s: GameState, c: GameCommand) => dispatch(scenario, s, c);
const start = () => send(createGame(scenario), { type: "selectCountry", countryId: a });
const demand = (s: GameState) =>
  send(s, { type: "demandBorder", countryId: a, targetStateId, goal: "cession" });
const week = (s: GameState) => send(s, { type: "advanceWeek" });
const load = (s: GameState) =>
  parseSave(scenario, { version: saveVersion, scenarioId: scenario.id, state: structuredClone(s) });
test("接壤利益校验、三阶段时限与和平让步仅执行核心要求", () => {
  let g = start();
  assert.throws(
    () => send(g, { type: "demandBorder", countryId: a, targetStateId: "Annam", goal: "cession" }),
    /接壤/,
  );
  g = send(g, { type: "queueConstruction", countryId: b, stateId: targetStateId, good: "cloth" });
  g = demand(g);
  assert.equal(g.borderDispute!.phase, "escalation");
  assert.throws(() => send(g, { type: "addGoal", countryId: a, goal: "reparations" }), /博弈点/);
  g = week(load(g));
  assert.equal(g.borderDispute!.phase, "bargaining");
  g = send(g, { type: "addGoal", countryId: a, goal: "reparations" });
  assert.equal(g.borderDispute!.maneuvers, 1);
  const paid = g.countryEconomies[b].treasury;
  const signed = send(g, { type: "backDown", countryId: b });
  assert.equal(signed.ownerByStateId.Tonkin, a);
  assert.equal(signed.borderDispute!.outcome, "victory");
  assert.ok(signed.countryEconomies[b].queue.every((p) => p.stateId !== targetStateId));
  assert.equal(signed.countryEconomies[b].treasury, paid);
  assert.deepEqual(signed.borderDispute!.goals, ["cession"]);
  assert.deepEqual(signed.borderDispute!.unacceptedGoals, ["reparations"]);
  assert.deepEqual(signed.stateEconomies.Tonkin, g.stateEconomies.Tonkin);
  assert.equal(signed.lastEconomy, null);
  assert.deepEqual(week(load(signed)), week(signed));
  assert.equal(projectEconomy(signed).states.Tonkin.conscripts, 0);
  assert.throws(() => load({ ...signed, ownerByStateId: g.ownerByStateId }), /无效/);
});
test("恶名分段提高合作成本，并以日历一年 2 点衰减", () => {
  assert.deepEqual([24, 25, 50, 75, 125].map(infamyLevel),
    ["常规警惕", "合作受阻", "联合风险", "遏制风险", "遏制风险"]);
  assert.deepEqual([24, 25, 50, 75, 125].map(swayCost), [1, 2, 2, 3, 3]);
  const game = start();
  game.nations[a].infamy = 125;
  assert.equal(week(game).nations[a].infamy, 125 - 2 * (7 / 366));
});
test("常备军和平支薪，征兵占用产业工人；战线受命令和补给约束", () => {
  let g = demand(start());
  assert.ok(projectEconomy(g).countries[a].upkeep > 0);
  g = week(week(week(g)));
  assert.equal(g.borderDispute!.phase, "countdown");
  g = week(g);
  assert.equal(g.borderDispute!.phase, "war");
  const before = projectEconomy(g, planWar(scenario, g));
  assert.equal(before.countries[a].military.conscripts, 0);
  g = send(g, { type: "mobilize", countryId: a });
  const mobilized = projectEconomy(g, planWar(scenario, g));
  assert.ok(
    mobilized.states.Yunnan.industries.grain.employed < before.states.Yunnan.industries.grain.employed,
  );
  assert.ok(mobilized.countries[a].military.conscripts > 0);
  assert.equal(mobilized.states.Annam.conscripts, 0);
  assert.ok(mobilized.countries[a].military.grainDrawn <= mobilized.countries[a].military.grainTransport);
  assert.equal(g.borderDispute!.progress, 0);
  assert.throws(() => send(g, { type: "signTreaty", countryId: a }), /战线进度/);
  g = send(g, { type: "orderAdvance", countryId: a });
  assert.deepEqual(week(load(g)), week(g));
  const signed = send(week(g), { type: "armistice", countryId: a });
  assert.equal(signed.ownerByStateId.Tonkin, b);
  assert.equal(week(signed).lastEconomy!.countries[a].military.conscripts, 0);
});
test("后方驻军使用本地物资，前线运输限额仅约束参战部队", () => {
  let g = demand(start());
  for (let i = 0; i < 4; i++) g = week(g);
  const plan = planWar(scenario, g)!;
  const route = plan.routes[b];
  assert.deepEqual([...route.recruitmentStates], ["Tonkin"]);
  route.mobilized = false;
  route.grainTransport = 100 * (1 + plan.grainPerRecruit);
  const report = projectEconomy(g, plan);
  const { military, market } = report.countries[b];
  const rear = report.states.Annam.regulars;
  assert.equal(military.grainDrawn, route.grainTransport + rear);
  assert.equal(military.grainDrawn, military.grainDemand);
  assert.equal(military.readiness, 1);
  for (const good of ["grain", "cloth"] as const) {
    const produced = report.states.Tonkin.industries[good].output + report.states.Annam.industries[good].output;
    const issued = good === "grain" ? military.grainDrawn : military.equipment.uniforms.delivered;
    assert.equal(produced, market[good].supply + issued);
  }
  route.grainTransport = 0;
  const cut = projectEconomy(g, plan).countries[b].military;
  assert.equal(cut.readiness, 0);
  assert.equal(cut.grainDrawn, rear);
});
test("同盟成员共享市场并能退出，傀儡交贡金，吞并恶名四分之一", () => {
  const g = send(start(), { type: "joinUnion", countryId: b, leaderId: a });
  const shared = projectEconomy(g);
  assert.deepEqual(shared.countries[a].market, shared.countries[b].market);
  const out = send(g, { type: "leaveUnion", countryId: b });
  assert.equal(out.nations[b].marketLeader, null);
  const puppet = send(send(out, { type: "demandBorder", countryId: a, targetStateId, goal: "puppet" }), {
    type: "backDown",
    countryId: b,
  });
  assert.equal(puppet.nations[b].overlord, a);
  assert.throws(() => send(puppet, { type: "leaveUnion", countryId: b }), /退出/);
  assert.equal(
    projectEconomy(puppet).countries[b].tribute,
    Math.floor(projectEconomy(puppet).countries[b].tax * 0.15),
  );
  const annex = send(puppet, { type: "demandBorder", countryId: a, targetStateId, goal: "annex" });
  assert.equal(annex.nations[a].infamy - puppet.nations[a].infamy, 3);
  const won = send(annex, { type: "backDown", countryId: b });
  assert.ok(Object.values(won.ownerByStateId).every((id) => id === a));
  assert.deepEqual(load(won), won);
});

test("同盟内技术人口迁往接纳其身份的国家，迁入与迁出人数相等", () => {
  let g = send(start(), { type: "joinUnion", countryId: b, leaderId: a });
  g.nations[a].laws.push("平等公民权", "信仰自由");
  const countEngineers = (state: GameState, country: string) => Object.entries(state.societies)
    .filter(([id]) => state.ownerByStateId[id] === country)
    .flatMap(([, site]) => site.pops)
    .filter((p) => p.culture === "地方文化-Tonkin" && p.occupation === "工程师")
    .reduce((sum, p) => sum + p.people, 0);
  while (g.elapsedDays < 30) g = send(g, { type: "advanceDay" });
  assert.equal(countEngineers(g, a), 0);
  const localCulture = "地方文化-Tonkin";
  const cohorts = g.societies.Tonkin.pops;
  const farmers = cohorts.find((p) => p.culture === localCulture && p.occupation === "农民")!;
  const engineers = cohorts.find((p) => p.culture === localCulture && p.occupation === "工程师")!;
  assert.ok(farmers.people > 200);
  farmers.people -= 200;
  engineers.people += 200;
  const closed = structuredClone(g);
  closed.nations[a].laws = closed.nations[a].laws.filter((law) => law !== "信仰自由");
  const baseline = send(closed, { type: "advanceDay" });
  const moved = send(g, { type: "advanceDay" });
  const arrivals = countEngineers(moved, a);
  assert.ok(arrivals > 0);
  assert.equal(countEngineers(baseline, b) - countEngineers(moved, b), arrivals);
  assert.deepEqual(load(moved), moved);
  const familiar = structuredClone(g);
  for (const [id, site] of Object.entries(familiar.societies)) {
    if (familiar.ownerByStateId[id] === a) site.culturalAffinity![localCulture] = 100;
  }
  const established = send(familiar, { type: "advanceDay" });
  assert.ok(countEngineers(established, a) > arrivals);
  assert.equal(countEngineers(established, a) + countEngineers(established, b), countEngineers(baseline, b));
});
test("补足粮食后推进到和约门槛，移交州并结束征兵", () => {
  let g = send(start(), { type: "queueConstruction", countryId: a, stateId: "Yunnan", good: "grain" });
  for (let i = 0; i < 7 && g.countryEconomies[a].queue.length; i++) g = week(g);
  assert.equal(g.stateEconomies.Yunnan.buildings.grain, scenario.states.Yunnan.buildings.grain + 1);
  g = demand(g);
  for (let i = 0; i < 4; i++) g = week(g);
  g = send(g, { type: "promoteGeneral", countryId: a });
  g = send(g, { type: "mobilize", countryId: a });
  g = send(g, { type: "orderAdvance", countryId: a });
  for (let i = 0; i < 60 && g.borderDispute!.progress < scenario.borderDispute.cessionProgress; i++)
    g = week(g);
  assert.ok(g.borderDispute!.progress >= scenario.borderDispute.cessionProgress);
  assert.deepEqual(g.occupation, { stateId: targetStateId, controllerId: a });
  assert.equal(g.ownerByStateId[targetStateId], b);
  assert.deepEqual(load(g), g);
  const { occupation, ...legacy } = g;
  assert.deepEqual(load(legacy), g);
  assert.throws(() => load({ ...g, occupation: { ...occupation!, controllerId: b } }), /数据无效/);
  const priorTax = projectEconomy(legacy, planWar(scenario, legacy));
  const occupiedTax = projectEconomy(g, planWar(scenario, g));
  assert.ok(occupiedTax.countries[b].tax < priorTax.countries[b].tax);
  assert.equal(occupiedTax.countries[a].tax, priorTax.countries[a].tax);
  assert.throws(() => send(g, { type: "queueConstruction", countryId: b, stateId: targetStateId, good: "infrastructure" }), /军事占领/);
  const armistice = send(load(g), { type: "armistice", countryId: a });
  assert.equal(armistice.occupation, undefined);
  assert.equal(armistice.ownerByStateId[targetStateId], b);
  const signed = send(load(g), { type: "signTreaty", countryId: a });
  assert.equal(signed.occupation, undefined);
  assert.equal(signed.ownerByStateId.Tonkin, a);
  assert.equal(signed.lastEconomy, null);
  assert.deepEqual(week(load(signed)), week(signed));
});

test("军需缺口压低士气；保护国与封臣的贡金按类型结算", () => {
  let g = demand(start());
  for (let i = 0; i < 4; i++) g = week(g);
  g = send(g, { type: "mobilize", countryId: a });
  const core = g.societies.Yunnan;
  g = {
    ...g,
    societies: {
      ...g.societies,
      Yunnan: { ...core, ammunition: 0 },
      Guangxi: { ...g.societies.Guangxi, ammunition: 0 },
    },
  };
  g = week(g);
  const m = g.lastEconomy!.countries[a].military;
  assert.ok(m.equipment.ammunition.demand > 0);
  assert.equal(m.equipment.ammunition.delivered, 0);
  assert.equal(m.readiness, 0);
  assert.ok(g.nations[a].morale < 100);
  for (const [goal, rate] of [
    ["protectorate", 0.1],
    ["vassal", 0.2],
  ] as const) {
    const s = send(send(start(), { type: "demandBorder", countryId: a, targetStateId, goal }), {
      type: "backDown",
      countryId: b,
    });
    const r = projectEconomy(s).countries[b];
    assert.equal(r.tribute, Math.floor(r.tax * rate));
    assert.equal(load(s).nations[b].subjectType, goal);
  }
});

test("新割让州保留产业和居民，治理方式只改变中央税权和军事额度", () => {
  const opening = start();
  const frontier = send(demand(opening), { type: "backDown", countryId: b });
  assert.equal(governanceOf(frontier.societies[targetStateId]).mode, "FRONTIER");
  assert.equal(governanceOf(frontier.societies[targetStateId]).integrated, false);
  assert.equal(frontier.stateEconomies[targetStateId], opening.stateEconomies[targetStateId]);
  assert.equal(frontier.societies[targetStateId].pops, opening.societies[targetStateId].pops);
  const mode = { type: "setLocalGovernance", countryId: a, stateId: targetStateId } as const;
  assert.throws(() => send(frontier, { ...mode, countryId: b, mode: "INDIRECT" }), /只能管理本国领土/);
  assert.throws(() => send(frontier, { ...mode, mode: "PROVINCE" }), /先完成整合/);
  const indirect = send(frontier, { ...mode, mode: "INDIRECT" });
  const before = projectEconomy(frontier), after = projectEconomy(indirect);
  assert.equal(after.states[targetStateId].regulars, Math.floor(before.states[targetStateId].regulars * 0.25));
  assert.ok(after.countries[a].tax < before.countries[a].tax);
  assert.deepEqual(load(indirect), indirect);
});

test("行政整合按实付岗位和开工时间增长，整合后可选择设为正式州", () => {
  let game = send(demand(start()), { type: "backDown", countryId: b });
  for (let i = 0; i < 6; i++) game = send(game, { type: "advanceDay" });
  const started = send(game, { type: "startIntegration", countryId: a, stateId: targetStateId });
  const required = integrationStaffNeeded(started.stateEconomies[targetStateId].population, started.settings.difficulty);
  const settled = send(started, { type: "advanceDay" });
  const paid = Math.floor(required * administrationWage / 7);
  assert.equal(settled.lastEconomy!.countries[a].administrationWages, paid);
  assert.equal(settled.lastEconomy!.states[targetStateId].administrationStaff, paid / administrationWage);
  const progress = governanceOf(settled.societies[targetStateId]).integration!.months;
  assert.ok(progress > 0 && progress < 0.05);
  assert.deepEqual(load(settled), settled);
  const cancelled = send(settled, { type: "cancelIntegration", countryId: a, stateId: targetStateId });
  assert.equal(week(cancelled).lastEconomy!.countries[a].administrationWages, 0);
  const next = week(settled);
  assert.equal(next.lastEconomy!.countries[a].administrationWages, required * administrationWage);
  assert.ok(governanceOf(next.societies[targetStateId]).integration!.months > progress);
  next.societies[targetStateId].governance!.integration!.months = 59.99;
  const integrated = week(next);
  assert.equal(governanceOf(integrated.societies[targetStateId]).integrated, true);
  assert.equal(governanceOf(integrated.societies[targetStateId]).mode, "FRONTIER");
  const province = send(integrated, { type: "setLocalGovernance", countryId: a, stateId: targetStateId, mode: "PROVINCE" });
  assert.equal(governanceOf(province.societies[targetStateId]).mode, "PROVINCE");
});
