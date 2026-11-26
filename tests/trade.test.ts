import assert from "node:assert/strict";
import { test } from "node:test";
import { projectEconomy } from "../src/game/economy.ts";
import { planWar } from "../src/game/diplomacy.ts";
import { advanceDay, createGame, dispatch } from "../src/game/engine.ts";
import { byGood, industries } from "../src/game/industry.ts";
import { parseSave, saveVersion } from "../src/game/storage.ts";
import { applyPlayerCommand, decodeSnapshot, encodeSnapshot } from "../src/online/protocol.ts";
import { borderScenario, scenario as world } from "../src/scenario/scenario.ts";
import { effectiveConvoyCapacity } from "../src/game/fleet.ts";
import { seaVoyageCargoCost } from "../src/game/transport.ts";

const qing = "country_01", vietnam = "country_26", to = "Tonkin", from = "Yunnan";
const scenario = {
  ...borderScenario,
  states: { ...borderScenario.states,
    Yunnan: { ...borderScenario.states.Yunnan, buildings: { ...borderScenario.states.Yunnan.buildings, grain: 32 } },
    Guangxi: { ...borderScenario.states.Guangxi, buildings: { ...borderScenario.states.Guangxi.buildings, grain: 32 } },
    Tonkin: { ...borderScenario.states.Tonkin, grainTransport: 100 },
  },
};
const order = { type: "openTradeRoute", countryId: vietnam, from, to, good: "grain", limit: 500 } as const;
const start = () => {
  const state = dispatch(scenario, createGame(scenario), { type: "selectCountry", countryId: vietnam });
  state.stateEconomies.Tonkin.buildings.grain = 0;
  state.stateEconomies.Annam.buildings.grain = 0;
  state.societies.Tonkin.infrastructure = 1;
  state.countryEconomies[qing].referenceQuotes = byGood((good) => good === "grain" ? 45 : industries[good].basePrice);
  state.countryEconomies[vietnam].referenceQuotes = byGood((good) => good === "grain" ? 160 : industries[good].basePrice);
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
  assert.equal(week.countryEconomies[vietnam].treasury - initial.countryEconomies[vietnam].treasury,
    budget.tax + budget.publicIndustryIncome! - budget.upkeep);
  assert.deepEqual(await decodeSnapshot(scenario, await encodeSnapshot(scenario, week)), week);
  const priceAfterImports = projectEconomy(week).countries[vietnam].market.grain.targetPrice!;
  const noExpectedImports = { ...week, lastEconomy: { ...week.lastEconomy!, trade: [] } };
  assert.ok(priceAfterImports < projectEconomy(noExpectedImports).countries[vietnam].market.grain.targetPrice!);
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

test("地方运输受阻降低实际进口容量", () => {
  const approved = dispatch(scenario, start(), order);
  assert.equal(projectEconomy(approved).trade![0].quantity, 100);
  approved.societies[to].stability = { unrest: 50, incident: { cause: "war", since: 0, negotiated: false }, lastIncident: { war: 0 } };
  assert.equal(projectEconomy(approved).trade![0].quantity, 80);
});

test("世界开局俄罗斯可在奥卢通过陆路获得诺尔兰剩余的布匹", () => {
  const countryId = "country_09";
  const initial = dispatch(world, createGame(world, 1820, "standard", {
    id: "f2a10071-5c11-4b3e-a1ec-d56607cee5b8", endYear: 1936, tutorialEnabled: false,
  }), { type: "selectCountry", countryId });
  const approved = dispatch(world, initial, { type: "openTradeRoute", countryId, from: "Norrland", to: "Oulu",
    good: "cloth", limit: 500 });
  const settled = dispatch(world, approved, { type: "advanceWeek" });
  const [shipment] = settled.lastEconomy!.trade!;
  assert.equal(shipment.status, "shipped");
  assert.ok(shipment.quantity > 0 && shipment.quantity <= 500);
  assert.equal(settled.lastEconomy!.countries[countryId].tradeTariff, shipment.tariff);
  assert.ok(approved.campaign!.achievements!.records.every((record) => record.id !== "trade"));
  assert.ok(settled.campaign!.achievements!.records.some((record) => record.id === "trade"));
});

test("沿海州能按海运结算，旧陆路档继续可读，跨图边界按短航程计算", async () => {
  const countryId = "country_09";
  const command = { type: "openTradeRoute", countryId, from: "Norrland", to: "Oulu", good: "cloth", limit: 500 } as const;
  const initial = dispatch(world, createGame(world), { type: "selectCountry", countryId });
  assert.throws(() => dispatch(world, initial, { ...command, mode: "sea", from: "Alberta" }), /沿海外国出口州/);
  const land = dispatch(world, initial, command);
  const old = structuredClone(land) as unknown as { tradeRoutes: Record<string, unknown>[] };
  delete old.tradeRoutes[0].mode;
  delete old.tradeRoutes[0].cargoCost;
  assert.deepEqual(parseSave(world, { version: saveVersion, scenarioId: world.id, state: old }), land);
  const sea = applyPlayerCommand(world, initial, countryId, { ...command, mode: "sea" });
  const settled = dispatch(world, sea, { type: "advanceWeek" });
  const [shipment] = settled.lastEconomy!.trade!;
  assert.equal(shipment.mode, "sea");
  assert.equal(shipment.status, "shipped");
  assert.equal(settled.lastEconomy!.countries[countryId].tradeSeaCargo, shipment.quantity * sea.tradeRoutes![0].cargoCost);
  assert.deepEqual(await decodeSnapshot(world, await encodeSnapshot(world, settled)), settled);
  assert.equal(seaVoyageCargoCost([5, 70], [1195, 70]), 1);
  assert.ok(seaVoyageCargoCost([25, 50], [625, 400]) > 1);
});

test("商运使用海军军需后的剩余船队，破交只暂停受影响口岸的海运", () => {
  const trader = "country_16";
  const { Guangxi, Yunnan, Tonkin, Annam } = borderScenario.states;
  const coastal = {
    ...borderScenario,
    countries: { ...borderScenario.countries, [trader]: world.countries[trader] },
    states: {
      Guangxi: { ...Guangxi, coastal: true, neighbors: ["Yunnan"] },
      Yunnan: { ...Yunnan, coastal: true, neighbors: ["Guangxi"] },
      Tonkin: { ...Tonkin, coastal: true, neighbors: ["Annam"] },
      Annam: { ...Annam, coastal: true },
      Outlet: { ...Tonkin, id: "Outlet", ownerId: trader, coastal: true, neighbors: [], population: 6000,
        buildings: { grain: 1, cloth: 2 }, label: [920, 240] as [number, number] },
    },
  };
  let game = dispatch(coastal, createGame(coastal), { type: "selectCountry", countryId: qing });
  game.nations[qing].convoys = 1;
  game.societies.Guangxi.infrastructure = 1;
  game.societies.Guangxi.port = 5;
  game.countryEconomies[qing].referenceQuotes = byGood((good) => good === "cloth" ? 500 : industries[good].basePrice);
  const importCloth = { type: "openTradeRoute", countryId: qing, from: "Outlet", to: "Guangxi", mode: "sea",
    good: "cloth", limit: 500 } as const;
  game = dispatch(coastal, game, importCloth);
  game = dispatch(coastal, game, { ...importCloth, to: "Yunnan" });
  assert.equal(projectEconomy(game).trade![0].status, "shipped");
  game = dispatch(coastal, game, { type: "declareInterest", countryId: qing, targetStateId: "Tonkin" });
  game = dispatch(coastal, game, { type: "demandBorder", countryId: qing, targetStateId: "Tonkin", goal: "cession" });
  const allHumans = new Set([qing, vietnam, trader]);
  while (game.elapsedDays < 56) game = advanceDay(coastal, game, allHumans);
  game = dispatch(coastal, game, { type: "mobilize", countryId: qing });
  game = { ...game, elapsedDays: game.borderDispute!.mobilization![qing].readyDay };
  const report = projectEconomy(game, planWar(coastal, game));
  const { military, tradeSeaCargo } = report.countries[qing];
  const availableCargo = effectiveConvoyCapacity(game.nations[qing]);
  assert.ok(military.seaCargoUsed! > 0);
  assert.ok(military.seaCargoUsed! + tradeSeaCargo! <= availableCargo);
  assert.equal(military.seaCargoUsed, availableCargo);
  assert.equal(tradeSeaCargo, 0);
  const raided = dispatch(coastal, game, { type: "raid", countryId: vietnam });
  const blocked = projectEconomy(raided, planWar(coastal, raided));
  assert.equal(blocked.trade![0].status, "blockaded");
  assert.notEqual(blocked.trade![1].status, "blockaded");
  assert.equal(blocked.states.Guangxi.portMilitaryCargo ?? 0, 0);
  assert.ok(blocked.states.Yunnan.portMilitaryCargo! > 0);
  const raiding = dispatch(coastal, game, { type: "setNavalMission", countryId: vietnam,
    mission: { task: "raid", portId: "Guangxi" } });
  const raid = planWar(coastal, raiding)!.naval;
  assert.ok(raid.portAccess.get("Guangxi")! < 1);
  assert.equal(raid.blockadedPorts.has("Guangxi"), false);
  const escorted = dispatch(coastal, raided, { type: "setNavalMission", countryId: qing,
    mission: { task: "escort", portId: "Guangxi" } });
  const loaded = parseSave(coastal, { version: saveVersion, scenarioId: coastal.id, state: escorted });
  assert.equal(planWar(coastal, loaded)!.naval.blockadedPorts.has("Guangxi"), false);
  const landing = dispatch(coastal, game, { type: "setNavalMission", countryId: qing,
    mission: { task: "landing", portId: "Tonkin" } });
  assert.ok(planWar(coastal, landing)!.naval.landing.get(qing)!.power > 0);
});
