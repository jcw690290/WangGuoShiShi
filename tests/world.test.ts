import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { scenario, atlas, borderScenario } from "../src/scenario/scenario.ts";
import { advanceDay, createGame, dispatch } from "../src/game/engine.ts";
import { diplomaticTie } from "../src/game/diplomatic-ties.ts";
import { applyPlayerCommand, decodeSnapshot, encodeSnapshot } from "../src/online/protocol.ts";
import { landBorder } from "../src/game/diplomacy.ts";
import { settleEconomy, weeklyBudgets } from "../src/game/economy.ts";
import { parseSave, saveVersion } from "../src/game/storage.ts";
import source from "../resources/1820_game_data.json" with { type: "json" };
test("1820 年开局宗藩、朝贡贸易和共主关系保有独立主权与财政", async () => {
  const qing = "country_01", vietnam = "country_26", korea = "country_28", siam = "country_25";
  const britain = "country_02", hanover = "country_14";
  const initial = dispatch(scenario, createGame(scenario), { type: "selectCountry", countryId: qing });
  assert.deepEqual(
    [diplomaticTie(initial, qing, vietnam)?.kind, diplomaticTie(initial, korea, qing)?.kind,
      diplomaticTie(initial, qing, siam)?.kind, diplomaticTie(initial, britain, hanover)?.kind],
    ["investiture", "investiture", "tributeTrade", "personalUnion"],
  );
  const settled = settleEconomy(initial);
  const entries = settled.lastEconomy.countries;
  for (const id of [vietnam, korea, siam, hanover]) {
    assert.equal(initial.nations[id].overlord, null);
    assert.equal(initial.nations[id].marketLeader, null);
    assert.ok(Object.values(initial.ownerByStateId).includes(id));
    assert.equal(entries[id].tribute, 0);
    assert.equal(settled.countryEconomies[id].treasury - initial.countryEconomies[id].treasury,
      entries[id].tax - entries[id].upkeep);
  }
  const command = { type: "endDiplomaticTie", countryId: hanover, partnerId: britain } as const;
  assert.throws(() => applyPlayerCommand(scenario, initial, qing, command), /只能操作自己控制的国家/);
  const independent = applyPlayerCommand(scenario, initial, hanover, command);
  assert.equal(diplomaticTie(independent, britain, hanover), undefined);
  assert.strictEqual(independent.ownerByStateId, initial.ownerByStateId);
  assert.strictEqual(independent.countryEconomies, initial.countryEconomies);
  assert.throws(() => dispatch(scenario, independent, command), /无可解除/);
  assert.deepEqual(await decodeSnapshot(scenario, await encodeSnapshot(scenario, independent)), independent);
  const duplicate = { ...initial, diplomaticTies: [...initial.diplomaticTies!, initial.diplomaticTies![0]] };
  assert.throws(() => parseSave(scenario, { version: saveVersion, scenarioId: scenario.id, state: duplicate }), /无效/);
});

test("宗藩关系不随争端自动解散，双方进入战争时解除", () => {
  const qing = "country_01", vietnam = "country_26";
  let game = dispatch(scenario, createGame(scenario), { type: "selectCountry", countryId: qing });
  game = dispatch(scenario, game, { type: "demandBorder", countryId: qing, targetStateId: "Tonkin", goal: "cession" });
  const humans = new Set([qing, vietnam]);
  while (game.elapsedDays < 27) game = advanceDay(scenario, game, humans);
  assert.equal(game.borderDispute?.phase, "countdown");
  assert.ok(diplomaticTie(game, qing, vietnam));
  game = advanceDay(scenario, game, humans);
  assert.equal(game.borderDispute?.phase, "war");
  assert.equal(diplomaticTie(game, qing, vietnam), undefined);
  assert.equal(game.diplomaticTies!.length, 3);
});

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
    stateEconomies: Object.fromEntries(Object.entries(r.stateEconomies).map(([id, site]) => [id, {
      population: site.population, buildings: { grain: site.buildings.grain / 12, cloth: site.buildings.cloth / 4 },
    }])),
    countryPolitics: {
      [a]: { reformWeeks: 2, researchWeeks: 3 },
      [b]: { reformWeeks: null, researchWeeks: null },
    },
    lastEconomy: null,
    borderDispute: { phase: "war", claimantId: a, defenderId: b, progress: 0, lastChange: null },
  };
  const g = parseSave(scenario, { version: 4, scenarioId: borderScenario.id, state: old });
  assert.equal(g.diplomaticTies, undefined);
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
