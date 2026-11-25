import assert from "node:assert/strict";
import { test } from "node:test";
import "fake-indexeddb/auto";
import { openDB } from "idb";
import { createGame, dispatch } from "../src/game/engine.ts";
import { autoSaveSlot, autoSaveSlots, listGameSaves, loadGame, loadRecentGame, manualSaveSlots, saveGame, saveVersion } from "../src/game/storage.ts";
import { borderScenario as scenario } from "../src/scenario/scenario.ts";

test("五个手动槽互异，自动档每月循环且跨年保持顺序", () => {
  assert.equal(new Set([...autoSaveSlots, ...manualSaveSlots]).size, 8);
  assert.equal(manualSaveSlots[0], "local");
  const months = Array.from({ length: 15 }, (_, month) => new Date(Date.UTC(1820, month, 1)));
  assert.deepEqual(months.map(autoSaveSlot), Array.from({ length: 5 }, () => autoSaveSlots).flat());
});

test("IndexedDB 升级保留旧槽，并发时拒绝未确认覆盖，最近有效档跳过损坏槽", async () => {
  const game = dispatch(scenario, createGame(scenario), { type: "selectCountry", countryId: "country_01" });
  const first = await openDB("wang-guo-shi-shi", 1, { upgrade(db) { db.createObjectStore("saves"); } });
  await first.put("saves", { version: saveVersion, scenarioId: scenario.id, state: game }, "local");
  first.close();

  assert.deepEqual(await listGameSaves(), [{ slot: "local", date: null, countryId: null, savedAt: 0 }]);
  assert.deepEqual(await loadGame(scenario, "local"), game);
  await assert.rejects(saveGame(scenario, game, "local", false), /确认覆盖/);

  const next = dispatch(scenario, game, { type: "advanceTick" });
  const attempts = await Promise.allSettled([
    saveGame(scenario, next, "manual-2", false),
    saveGame(scenario, next, "manual-2", false),
  ]);
  assert.deepEqual(attempts.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
  assert.deepEqual(await loadRecentGame(scenario), { state: next, slot: "manual-2", skipped: 0 });
  await saveGame(scenario, game, "manual-2", true);
  assert.deepEqual(await loadGame(scenario, "manual-2"), game);

  const db = await openDB("wang-guo-shi-shi");
  await db.put("saves", { version: saveVersion, scenarioId: scenario.id, state: { elapsedDays: 0 } }, "manual-2");
  db.close();
  await assert.rejects(loadGame(scenario, "manual-2"), /存档数据无效/);
  assert.deepEqual(await loadRecentGame(scenario), { state: game, slot: "local", skipped: 1 });
});
