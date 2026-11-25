import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { scenario, atlas, borderScenario } from "../src/scenario/scenario.ts";
import { createGame, dispatch } from "../src/game/engine.ts";
import { landBorder } from "../src/game/diplomacy.ts";
import { settleEconomy, weeklyBudgets } from "../src/game/economy.ts";
import { parseSave, saveVersion } from "../src/game/storage.ts";
import source from "../resources/1820_game_data.json" with { type: "json" };
test("两个附属国的贡金分别扣款，宗主国面板的经常收支等于国库周结算", () => {
  const qing = "country_01", vietnam = "country_26", korea = "country_28";
  let game = dispatch(scenario, createGame(scenario), { type: "selectCountry", countryId: qing });
  for (const [id, goal] of [[vietnam, "puppet"], [korea, "vassal"]] as const) {
    const target = Object.keys(scenario.states).find(s => game.ownerByStateId[s] === id && landBorder(scenario, game, qing, s))!;
    game = dispatch(scenario, game, { type: "demandBorder", countryId: qing, targetStateId: target, goal });
    game = dispatch(scenario, game, { type: "backDown", countryId: id });
  }
  const settled = settleEconomy(game);
  const countries = settled.lastEconomy.countries;
  const budgets = weeklyBudgets(game.nations, settled.lastEconomy);
  const paid = countries[vietnam].tribute + countries[korea].tribute;
  assert.ok(countries[vietnam].tribute > 0 && countries[korea].tribute > 0);
  assert.equal(budgets[qing].tributeReceived, paid);
  assert.equal(budgets[qing].balance, countries[qing].tax - countries[qing].upkeep + paid);
  for (const id of [qing, vietnam, korea]) {
    assert.equal(settled.countryEconomies[id].treasury - game.countryEconomies[id].treasury, budgets[id].balance);
  }
});
test("660 个地图 ID、544 个属州、26 个可选国与 3 个背景势力逐项对齐，未分配州不入国库", () => {
  const features = JSON.parse(
    readFileSync(new URL("../resources/victoria3_1820_states.geojson", import.meta.url), "utf8"),
  ).features as { properties: { id: string; countryId: string | null } }[];
  assert.equal(features.length, 660);
  assert.equal(Object.keys(atlas).length, 660);
  assert.deepEqual(Object.keys(atlas).sort(), features.map((f) => f.properties.id).sort());
  assert.equal(Object.keys(scenario.states).length, 660);
  assert.equal(Object.keys(createGame(scenario).ownerByStateId).length, 544);
  assert.equal(Object.keys(scenario.countries).length, 29);
  const backgroundIds = Object.values(scenario.countries).filter((c) => c.selectable === false).map((c) => c.id);
  assert.deepEqual(backgroundIds, ["country_17", "country_23", "country_27"]);
  const g = createGame(scenario);
  for (const {
    properties: { id, countryId },
  } of features)
    assert.equal(g.ownerByStateId[id] ?? null, countryId);
  for (const c of source.countries) {
    const command = { type: "selectCountry", countryId: c.id } as const;
    if (backgroundIds.includes(c.id)) assert.throws(() => dispatch(scenario, g, command), /无法选择这个国家/);
    else assert.equal(dispatch(scenario, g, command).playerCountryId, c.id);
    assert.equal(Object.values(g.ownerByStateId).filter((id) => id === c.id).length, c.stateCount);
  }
  assert.ok(atlas.Tonkin.neighbors.includes("Guangxi"));
  assert.ok(atlas.Tonkin.neighbors.includes("Yunnan"));
});
test("清越旧档迁入世界后保留队列、改革、战争进度并可再次存读", () => {
  const r = createGame(borderScenario),
    a = "country_01",
    b = "country_26";
  r.countryEconomies[a].queue.push({ stateId: "Yunnan", good: "cloth", weeksLeft: 2 });
  const old = {
    elapsedDays: 21,
    playerCountryId: b,
    ownerByStateId: r.ownerByStateId,
    countryEconomies: r.countryEconomies,
    stateEconomies: r.stateEconomies,
    countryPolitics: {
      [a]: { reformWeeks: 2, researchWeeks: 3 },
      [b]: { reformWeeks: null, researchWeeks: null },
    },
    lastEconomy: null,
    borderDispute: { phase: "war", claimantId: a, defenderId: b, progress: 0, lastChange: null },
  };
  const g = parseSave(scenario, { version: 4, scenarioId: borderScenario.id, state: old });
  assert.equal(Object.keys(g.stateEconomies).length, 544);
  assert.equal(g.elapsedDays, 21);
  assert.equal(g.playerCountryId, b);
  assert.equal(g.nations[a].knowledge["纺织工艺"], 75);
  assert.ok(g.nations[a].laws.includes("工资税改革"));
  assert.equal(g.countryEconomies[a].queue[0].weeksLeft, 2);
  assert.equal(g.borderDispute!.targetStateId, "Tonkin");
  const saved = parseSave(scenario, { version: saveVersion, scenarioId: scenario.id, state: g });
  assert.deepEqual(
    dispatch(scenario, saved, { type: "advanceWeek" }),
    dispatch(scenario, g, { type: "advanceWeek" }),
  );
});
test("世界半年快进后人口逐州守恒，全世界存读后按日确定性续算", () => {
  const g = dispatch(scenario, createGame(scenario), { type: "selectCountry", countryId: "country_29" });
  const half = dispatch(scenario, g, { type: "advanceHalfYear" });
  assert.equal(half.elapsedDays, 182);
  const saved = parseSave(scenario, { version: saveVersion, scenarioId: scenario.id, state: half });
  assert.deepEqual(
    dispatch(scenario, saved, { type: "advanceWeek" }),
    dispatch(scenario, half, { type: "advanceWeek" }),
  );
});
