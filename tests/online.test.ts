import assert from "node:assert/strict";
import test from "node:test";
import { advanceDay, createGame, dispatch } from "../src/game/engine.ts";
import { applyPlayerCommand, decodeSnapshot, encodeSnapshot } from "../src/online/protocol.ts";
import { scenario } from "../src/scenario/scenario.ts";

const [host, guest] = Object.keys(scenario.countries);
const create = () => dispatch(scenario, createGame(scenario), { type: "selectCountry", countryId: host });

test("a guest can govern its own country without changing the authority's player country", () => {
  const game = create();
  const command = { type: "startResearch", countryId: guest, tech: "纺织工艺" };
  const result = applyPlayerCommand(scenario, game, guest, command);
  assert.equal(result.playerCountryId, host);
  assert.equal(result.nations[guest].research, command.tech);
  assert.equal(result.nations[host], game.nations[host]);
  assert.throws(() => applyPlayerCommand(scenario, game, host, command), /只能操作自己控制的国家/);
  assert.throws(() => applyPlayerCommand(scenario, game, guest, { type: "advanceDay" }), /无效的联机指令/);

  const stateId = Object.keys(scenario.states).find((id) => !Object.hasOwn(game.ownerByStateId, id))!;
  const claimed = applyPlayerCommand(scenario, game, guest, { type: "claimState", stateId });
  assert.equal(claimed.ownerByStateId[stateId], guest);
  assert.equal(claimed.countryEconomies[host], game.countryEconomies[host]);
});

test("weekly settlement respects all player seats and round-trips the world's cloud save", async () => {
  let game = create();
  const humans = new Set([host, guest]);
  for (let day = 0; day < 7; day++) game = advanceDay(scenario, game, humans);
  assert.equal(game.nations[host].research, null);
  assert.equal(game.nations[guest].research, null);
  assert.ok(Object.entries(game.nations).some(([id, nation]) => !humans.has(id) && nation.research !== null));
  const snapshot = await encodeSnapshot(scenario, game);
  const restored = await decodeSnapshot(scenario, snapshot);
  assert.deepEqual(restored, game);
  for (let day = 0, a = game, b = restored; day < 49; day++) {
    a = advanceDay(scenario, a, humans);
    b = advanceDay(scenario, b, humans);
    assert.deepEqual(b, a);
  }
});
