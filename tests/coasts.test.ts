import assert from "node:assert/strict";
import { test } from "node:test";
import { createGame, dispatch } from "../src/game/engine.ts";
import { atlas, scenario } from "../src/scenario/scenario.ts";

test("内陆边界缝隙、湖岸及封闭内海不提供出海口", () => {
  for (const id of ["Alberta", "Saskatchewan", "Michigan", "Wisconsin", "Buryatia", "Mazandaran", "Syrdarya"]) {
    assert.equal(atlas[id].coastal, false, id);
  }
});

test("开放海岸、海岛及细海峡另一侧的海岸提供出海口", () => {
  for (const id of [
    "British_Columbia",
    "Connecticut",
    "Georgia",
    "Chugoku",
    "Sariwon",
    "Outer_Manchuria",
    "Sardinia",
    "Malta",
    "Riga",
    "Oulu",
    "Taurida",
    "Trabzon",
    "Western_Thrace",
    "Macedonia",
    "Hedjaz",
    "Fars",
  ]) {
    assert.equal(atlas[id].coastal, true, id);
  }
});

test("日本只能对有出海口的加拿大州声明利益并提出跨海割地要求", () => {
  const countryId = "country_29";
  const game = dispatch(scenario, createGame(scenario), { type: "selectCountry", countryId });
  assert.throws(
    () => dispatch(scenario, game, { type: "declareInterest", countryId, targetStateId: "Alberta" }),
    /需要接壤或双方沿海的目标州/,
  );
  const targetStateId = "British_Columbia";
  const interested = dispatch(scenario, game, { type: "declareInterest", countryId, targetStateId });
  const disputed = dispatch(scenario, interested, { type: "demandBorder", countryId, targetStateId, goal: "cession" });
  assert.equal(disputed.borderDispute?.targetStateId, targetStateId);
});
