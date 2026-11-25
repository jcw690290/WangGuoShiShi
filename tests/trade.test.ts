import assert from "node:assert/strict";
import { test } from "node:test";
import { projectEconomy } from "../src/game/economy.ts";
import { advanceDay, createGame, dispatch } from "../src/game/engine.ts";
import { parseSave, saveVersion } from "../src/game/storage.ts";
import { applyPlayerCommand, decodeSnapshot, encodeSnapshot } from "../src/online/protocol.ts";
import { borderScenario, scenario as world } from "../src/scenario/scenario.ts";

const qing = "country_01", vietnam = "country_26", to = "Tonkin", from = "Yunnan";
const scenario = {
  ...borderScenario,
  states: { ...borderScenario.states, Tonkin: { ...borderScenario.states.Tonkin, grainTransport: 100 } },
};
const order = { type: "openTradeRoute", countryId: vietnam, from, to, good: "grain", limit: 500 } as const;
const start = () => {
  const state = dispatch(scenario, createGame(scenario), { type: "selectCountry", countryId: vietnam });
  state.stateEconomies.Tonkin.buildings.grain = 0;
  state.stateEconomies.Annam.buildings.grain = 0;
  state.societies.Tonkin.infrastructure = 1;
  state.countryEconomies[qing].referenceQuotes = { grain: 45, cloth: 300 };
  state.countryEconomies[vietnam].referenceQuotes = { grain: 160, cloth: 300 };
  return state;
};

test("陆路贸易按实际发货结算供需、实收关税、运费、投资与利润", async () => {
  const initial = start();
  assert.throws(() => applyPlayerCommand(scenario, initial, qing, order), /只能操作自己控制的国家/);
  assert.throws(() => dispatch(scenario, initial, { ...order, from: "Annam" }), /不同关税市场/);
  const routed = applyPlayerCommand(scenario, initial, vietnam, order);
  assert.throws(() => dispatch(scenario, routed, order), /线路已存在/);
  assert.strictEqual(routed.countryEconomies, initial.countryEconomies);
  const before = projectEconomy(initial);
  const report = projectEconomy(routed);
  const [delivery] = report.trade!;
  assert.equal(delivery.status, "shipped");
  assert.equal(delivery.quantity, 100);
  assert.equal(report.states[from].industries.grain.sold! - before.states[from].industries.grain.sold!, delivery.quantity);
  assert.equal(report.states[to].householdConsumption!.grain - before.states[to].householdConsumption!.grain, delivery.quantity);
  assert.equal(delivery.sales, delivery.purchase + delivery.tariff + delivery.freight + delivery.profit);
  assert.equal(report.countries[vietnam].tradeTariff, delivery.tariff);
  assert.equal(report.states[to].freightWages, delivery.freight);
  assert.equal(report.states[to].dividends + report.states[to].investment -
    before.states[to].dividends - before.states[to].investment, delivery.profit);
  const week = dispatch(scenario, routed, { type: "advanceWeek" });
  const budget = week.lastEconomy!.countries[vietnam];
  assert.equal(week.countryEconomies[vietnam].treasury - initial.countryEconomies[vietnam].treasury, budget.tax - budget.upkeep);
  assert.deepEqual(await decodeSnapshot(scenario, await encodeSnapshot(scenario, week)), week);
  const monthEnd = { ...week, elapsedDays: 30, tickInDay: 3 };
  const withoutDelivery = { ...monthEnd, lastEconomy: { ...week.lastEconomy!, trade: [] } };
  const exchanged = dispatch(scenario, monthEnd, { type: "advanceTick" });
  const usual = dispatch(scenario, withoutDelivery, { type: "advanceTick" });
  assert.ok(exchanged.societies[to].culturalAffinity![qing] > usual.societies[to].culturalAffinity![qing]);
  assert.ok(exchanged.societies[from].culturalAffinity![vietnam] > usual.societies[from].culturalAffinity![vietnam]);
  const invalid = { ...routed, tradeRoutes: [{ ...routed.tradeRoutes![0], fromCapacity: 100_000 }] };
  assert.throws(() => parseSave(scenario, { version: saveVersion, scenarioId: scenario.id, state: invalid }), /无效/);
});

test("同一口岸共享运力、文化熟悉度降低运费，停运和交战时没有成交", () => {
  const initial = start();
  const route = dispatch(scenario, initial, order);
  const game = dispatch(scenario, route, { ...order, from: "Guangxi" });
  const unfamiliar = projectEconomy(game).trade!;
  assert.equal(unfamiliar[1].status, "noVolume");
  const familiar = structuredClone(game);
  familiar.societies[to].culturalAffinity = Object.fromEntries(familiar.societies[from].pops.map(({ culture }) => [culture, 100]));
  const [discount] = projectEconomy(familiar).trade!;
  assert.equal(discount.quantity, unfamiliar[0].quantity);
  assert.ok(discount.freight < unfamiliar[0].freight);
  assert.ok(discount.freight >= unfamiliar[0].freight * 0.90);
  const paused = dispatch(scenario, game, { ...order, type: "setTradeRoute", paused: true });
  const alternate = projectEconomy(paused).trade!;
  assert.equal(alternate[0].status, "paused");
  assert.equal(alternate[0].tariff, 0);
  assert.equal(alternate[1].quantity, 100);
  let war = dispatch(scenario, game, { type: "demandBorder", countryId: qing, targetStateId: to, goal: "cession" });
  const bothHumans = new Set([qing, vietnam]);
  while (war.elapsedDays < 28) war = advanceDay(scenario, war, bothHumans);
  assert.equal(war.borderDispute?.phase, "war");
  assert.deepEqual(war.lastEconomy!.trade!.map(({ status, quantity }) => [status, quantity]), [["war", 0], ["war", 0]]);
  assert.equal(war.lastEconomy!.countries[vietnam].tradeTariff, 0);
});

test("世界开局俄罗斯可在奥卢通过陆路获得诺尔兰剩余的布匹", () => {
  const countryId = "country_09";
  const initial = dispatch(world, createGame(world), { type: "selectCountry", countryId });
  const approved = dispatch(world, initial, { type: "openTradeRoute", countryId, from: "Norrland", to: "Oulu",
    good: "cloth", limit: 500 });
  const settled = dispatch(world, approved, { type: "advanceWeek" });
  const [shipment] = settled.lastEconomy!.trade!;
  assert.equal(shipment.status, "shipped");
  assert.ok(shipment.quantity > 0 && shipment.quantity <= 500);
  assert.equal(settled.lastEconomy!.countries[countryId].tradeTariff, shipment.tariff);
});
