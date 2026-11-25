import assert from "node:assert/strict";
import { test } from "node:test";
import { createGame, dispatch } from "../src/game/engine.ts";
import type { GameState, GameCommand } from "../src/game/engine.ts";
import { projectEconomy } from "../src/game/economy.ts";
import { planWar } from "../src/game/diplomacy.ts";
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
test("接壤利益校验、三阶段时限、追加要求与和平让步移交州及队列", () => {
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
  assert.ok(signed.countryEconomies[b].treasury < paid);
  assert.deepEqual(signed.stateEconomies.Tonkin, g.stateEconomies.Tonkin);
  assert.equal(signed.lastEconomy, null);
  assert.deepEqual(week(load(signed)), week(signed));
  assert.equal(projectEconomy(signed).states.Tonkin.conscripts, 0);
  assert.throws(() => load({ ...signed, ownerByStateId: g.ownerByStateId }), /无效/);
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
  const closed = structuredClone(g);
  closed.nations[a].laws = closed.nations[a].laws.filter((law) => law !== "信仰自由");
  const baseline = send(closed, { type: "advanceDay" });
  const moved = send(g, { type: "advanceDay" });
  const arrivals = countEngineers(moved, a);
  assert.ok(arrivals > 0);
  assert.equal(countEngineers(baseline, b) - countEngineers(moved, b), arrivals);
  assert.deepEqual(load(moved), moved);
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
