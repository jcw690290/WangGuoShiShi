import assert from "node:assert/strict";
import { test } from "node:test";
import { createGame, dispatch } from "../src/game/engine.ts";
import { marketOf, projectEconomy } from "../src/game/economy.ts";
import { goods } from "../src/game/industry.ts";
import { clearMarket } from "../src/game/market.ts";
import { parseSave, saveVersion } from "../src/game/storage.ts";
import { scenario } from "../src/scenario/scenario.ts";

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

test("世界各共同市场的成交、州的销量与用量逐项一致，历史周报可读回", () => {
  const game = dispatch(scenario, createGame(scenario), { type: "selectCountry", countryId: "country_29" });
  const union = dispatch(scenario, game, { type: "joinUnion", countryId: "country_28", leaderId: "country_29" });
  const projection = projectEconomy(union);
  for (const [marketId, country] of Object.entries(projection.countries)) {
    if (marketOf(union, marketId) !== marketId) continue;
    const sites = Object.entries(projection.states)
      .filter(([id]) => marketOf(union, union.ownerByStateId[id]) === marketId);
    for (const good of goods) {
      const market = country.market[good];
      assert.ok(market.traded! <= Math.min(market.supply, market.demand));
      assert.equal(sites.reduce((n, [, site]) => n + site.industries[good].sold!, 0), market.traded);
      assert.equal(sites.reduce((n, [, site]) => n + site.industries[good].bought!, 0), market.traded);
      assert.ok(sites.every(([, site]) => site.industries[good].sold! <= site.industries[good].output));
      assert.ok(sites.every(([, site]) => site.industries[good].sold! > 0 || site.industries[good].wages === 0));
    }
  }
  const settled = dispatch(scenario, union, { type: "advanceWeek" });
  assert.deepEqual(parseSave(scenario, { version: saveVersion, scenarioId: scenario.id, state: settled }), settled);
});
