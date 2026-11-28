import assert from "node:assert/strict";
import { test } from "node:test";
import { createGame, dispatch } from "../src/game/engine.ts";
import { marketOf, projectEconomy } from "../src/game/economy.ts";
import { goods, industries } from "../src/game/industry.ts";
import { clearMarket, nextPrice, targetPrice } from "../src/game/market.ts";
import { domesticFreight } from "../src/game/domestic-market.ts";
import { parseSave, saveVersion } from "../src/game/storage.ts";
import { borderScenario, scenario } from "../src/scenario/scenario.ts";
import { claimError, settlementAt } from "../src/game/territory.ts";

test("隔绝州只成交本地货物，连通州按份额成交且尾差守恒", () => {
  const result = clearMarket([
    { supply: 9, demand: 1, access: 0 },
    { supply: 0, demand: 9, access: 0 },
    { supply: 5, demand: 0, access: 1 },
    { supply: 1, demand: 6, access: 0.5 },
    { supply: 0, demand: 4, access: 1 },
  ]);
  assert.deepEqual(result, {
    traded: 7,
    fills: [
      { local: 1, poolBought: 0, poolSold: 0 },
      { local: 0, poolBought: 0, poolSold: 0 },
      { local: 0, poolBought: 0, poolSold: 5 },
      { local: 1, poolBought: 2, poolSold: 0 },
      { local: 0, poolBought: 3, poolSold: 0 },
    ],
  });
  assert.equal(clearMarket([{ supply: 0, demand: 0, access: 1 }]).traded, 0);
  assert.equal(clearMarket([{ supply: 8, demand: 0, access: 0.5 }]).traded, 0);
  assert.equal(clearMarket([{ supply: 0, demand: 8, access: 0.5 }]).traded, 0);
});

test("国内多式运输沿相邻州成交，转运站为不同商品共享运力", () => {
  const ids = ["Yunnan", "Guangxi", "Tonkin"];
  const local = { ...borderScenario, states: { ...borderScenario.states,
    ...Object.fromEntries(ids.map((id, i) => [id, { ...borderScenario.states[id], grainTransport: 10, coastal: false,
      neighbors: [ids[i - 1], ids[i + 1]].filter(Boolean) }])),
  } };
  const state = createGame(local);
  for (const id of ids) state.societies[id] = { ...state.societies[id], infrastructure: 1, railway: 0 };
  const network = domesticFreight(local, state, { test: ids }, new Map(), new Map());
  const orders = [{ supply: 8, demand: 0 }, { supply: 0, demand: 0 }, { supply: 0, demand: 4 }];
  const first = network.clear(ids, orders, false);
  assert.equal(first.fills[0].poolSold, 4);
  assert.equal(first.fills[2].poolBought, 4);
  const second = network.clear(ids, orders, false);
  assert.equal(second.traded, 1);
  assert.equal(network.used.road.get("Guangxi"), 10);

  const ends = [ids[0], ids[2]];
  const disconnected = domesticFreight(local, state, { test: ends }, new Map(), new Map());
  assert.equal(disconnected.clear(ends, [orders[0], orders[2]], false).traded, 0);
});

test("世界各共同市场的成交、州的销量与用量逐项一致，历史周报可读回", () => {
  const game = dispatch(scenario, createGame(scenario), { type: "selectCountry", countryId: "country_29" });
  const union = dispatch(scenario, game, { type: "joinUnion", countryId: "country_28", leaderId: "country_29" });
  const projection = projectEconomy(union, undefined, scenario);
  for (const [marketId, country] of Object.entries(projection.countries)) {
    if (marketOf(union, marketId) !== marketId) continue;
    const sites = Object.entries(projection.states)
      .filter(([id]) => marketOf(union, union.ownerByStateId[id]) === marketId);
    for (const good of goods) {
      const market = country.market[good];
      assert.ok(market.traded! <= Math.min(market.supply, market.demand));
      assert.equal(sites.reduce((n, [, site]) => n + site.industries[good].sold! +
        (good === "grain" || good === "wood" ? site.subsistence?.sold[good] ?? 0 : 0), 0), market.traded);
      assert.equal(sites.reduce((n, [, site]) => n + site.industries[good].bought!, 0), market.traded);
      assert.ok(sites.every(([, site]) => site.industries[good].sold! <= site.industries[good].output));
      assert.ok(sites.every(([, site]) => site.industries[good].employed > 0 || site.industries[good].wages === 0));
    }
  }
  const settled = dispatch(scenario, union, { type: "advanceWeek" });
  assert.deepEqual(parseSave(scenario, { version: saveVersion, scenarioId: scenario.id, state: settled }), settled);
});

test("目标价对短缺与过剩对称反应，现价每周只移动差额的 35%", () => {
  assert.equal(targetPrice(100, 0, 12), 175);
  assert.equal(targetPrice(100, 12, 0), 25);
  assert.equal(targetPrice(100, 0, 0), 100);
  assert.equal(targetPrice(100, 100, 150), 125);
  assert.equal(nextPrice(100, 175), 126.25);
  assert.equal(nextPrice(175, 100), 148.75);
});

test("开局预估、建设、领土变更和读档均不会推进已经结算的报价", () => {
  const countryId = "country_29";
  const initial = dispatch(scenario, createGame(scenario), { type: "selectCountry", countryId });
  const settled = dispatch(scenario, initial, { type: "advanceWeek" });
  const siteId = Object.keys(scenario.states).find((id) => settled.ownerByStateId[id] === countryId)!;
  const original = settled.countryEconomies[countryId].referenceQuotes!;
  const built = dispatch(scenario, settled, { type: "queueConstruction", countryId, stateId: siteId, good: "infrastructure" });
  assert.deepEqual(built.countryEconomies[countryId].referenceQuotes, original);
  const claimedSite = Object.keys(scenario.states).find((id) => !claimError(scenario, built, id))!;
  const claimed = dispatch(scenario, built, { type: "claimState", stateId: claimedSite });
  assert.equal(claimed.lastEconomy, built.lastEconomy);
  assert.equal(settlementAt(claimed, claimedSite)!.progress, 0);
  const saved = parseSave(scenario, { version: saveVersion, scenarioId: scenario.id, state: claimed });
  const preview = projectEconomy(saved);
  assert.deepEqual(projectEconomy(saved), preview);
  assert.deepEqual(saved.countryEconomies[countryId].referenceQuotes, original);
  assert.deepEqual(saved.stateEconomies[siteId].localQuotes, settled.stateEconomies[siteId].localQuotes);
  const nextWeek = dispatch(scenario, saved, { type: "advanceWeek" });
  for (const good of goods) {
    const market = nextWeek.lastEconomy!.countries[countryId].market[good];
    const target = targetPrice(industries[good].basePrice, market.supply, market.demand);
    assert.equal(nextWeek.countryEconomies[countryId].referenceQuotes![good], nextPrice(original[good], target));
    assert.equal(market.price, Math.round(nextWeek.countryEconomies[countryId].referenceQuotes![good]));
  }
});
