import assert from "node:assert/strict";
import { test } from "node:test";
import { advanceTick, createGame, dispatch, elapsedTicks, getGameDate, TICKS_PER_DAY } from "../src/game/engine.ts";
import { parseSave, saveVersion } from "../src/game/storage.ts";
import { encodeSnapshot } from "../src/online/protocol.ts";
import { borderScenario } from "../src/scenario/scenario.ts";

const scenario = borderScenario;
const start = () => dispatch(scenario, createGame(scenario), { type: "selectCountry", countryId: "country_01" });

test("第 28 个 tick 完整结算一次，日步进与周步进结果一致", () => {
  const initial = start();
  let game = initial;
  for (let tick = 1; tick < 7 * TICKS_PER_DAY; tick++) {
    game = advanceTick(scenario, game);
    assert.equal(elapsedTicks(game), tick);
    assert.equal(game.lastEconomy, null);
  }
  game = advanceTick(scenario, game);
  let daily = initial;
  for (let day = 0; day < 7; day++) daily = dispatch(scenario, daily, { type: "advanceDay" });
  assert.deepEqual(game, daily);
  assert.deepEqual(game, dispatch(scenario, initial, { type: "advanceWeek" }));
});

test("1820 年闰日只在跨过日界时改变日期", () => {
  const eve = { ...start(), elapsedDays: 58, tickInDay: 2 };
  const sameDay = advanceTick(scenario, eve);
  assert.equal(getGameDate(scenario, sameDay).toISOString().slice(0, 10), "1820-02-28");
  const leapDay = advanceTick(scenario, sameDay);
  assert.equal(getGameDate(scenario, leapDay).toISOString().slice(0, 10), "1820-02-29");
  assert.equal(getGameDate(scenario, dispatch(scenario, leapDay, { type: "advanceDay" })).toISOString().slice(0, 10), "1820-03-01");
});

test("日内存档续算与不中断一致，版本 5 从日界恢复", async () => {
  const { tickInDay, ...legacy } = start();
  const state = { ...legacy, elapsedDays: 6, tickInDay: TICKS_PER_DAY - 1 };
  const envelope = { version: saveVersion, scenarioId: scenario.id, state };
  const restored = parseSave(scenario, envelope);
  assert.deepEqual(restored, state);
  assert.deepEqual(advanceTick(scenario, restored), advanceTick(scenario, state));
  assert.throws(() => parseSave(scenario, { ...envelope, state: { ...state, tickInDay: 4 } }), /存档数据无效/);
  assert.equal(parseSave(scenario, { ...envelope, version: 5, state: legacy }).tickInDay, tickInDay);
  await assert.rejects(encodeSnapshot(scenario, state), /必须在日界提交/);
});
