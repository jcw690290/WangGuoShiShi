import assert from "node:assert/strict";
import { test } from "node:test";
import { canAddGoal } from "../src/game/diplomacy.ts";
import { createGame, dispatch } from "../src/game/engine.ts";
import type { GameState, GameCommand } from "../src/game/engine.ts";
import { borderScenario as scenario } from "../src/scenario/scenario.ts";

test("仅能在外交博弈中追加吞并自己的附属国，且消耗博弈点", () => {
  const claimantId = "country_01";
  const defenderId = "country_26";
  const targetStateId = "Tonkin";
  const send = (state: GameState, command: GameCommand) => dispatch(scenario, state, command);
  const start = send(createGame(scenario), { type: "selectCountry", countryId: claimantId });
  const bargain = (state: GameState) =>
    send(
      send(state, { type: "demandBorder", countryId: claimantId, targetStateId, goal: "reparations" }),
      { type: "advanceWeek" },
    );
  const addAnnex = { type: "addGoal", countryId: claimantId, goal: "annex" } as const;
  const independent = bargain(start);
  assert.equal(canAddGoal(independent, independent.borderDispute!, "annex"), false);
  assert.throws(() => send(independent, addAnnex), /无效目标/);

  const puppet = send(
    send(start, { type: "demandBorder", countryId: claimantId, targetStateId, goal: "puppet" }),
    { type: "backDown", countryId: defenderId },
  );
  const negotiating = bargain(puppet);
  assert.equal(negotiating.borderDispute!.phase, "bargaining");
  assert.equal(canAddGoal(negotiating, negotiating.borderDispute!, "annex"), true);
  const annex = send(negotiating, addAnnex);
  assert.deepEqual(annex.borderDispute!.goals, ["reparations", "annex"]);
  assert.equal(annex.borderDispute!.maneuvers, negotiating.borderDispute!.maneuvers - 1);
  assert.equal(annex.nations[claimantId].infamy - negotiating.nations[claimantId].infamy, 3);
  assert.equal(canAddGoal(annex, annex.borderDispute!, "annex"), false);
  assert.throws(() => send(annex, addAnnex), /无效目标/);

  const signed = send(annex, { type: "backDown", countryId: defenderId });
  assert.equal(signed.ownerByStateId.Tonkin, defenderId);
  assert.equal(signed.ownerByStateId.Annam, defenderId);
  assert.deepEqual(signed.borderDispute!.unacceptedGoals, ["annex"]);
});
