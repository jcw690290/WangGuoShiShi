import assert from "node:assert/strict";
import { test } from "node:test";
import { constructionError } from "../src/game/economy.ts";
import { createGame, dispatch } from "../src/game/engine.ts";
import { fiscalWeekFraction, settleFiscal } from "../src/game/fiscal.ts";
import { parseSave, saveVersion } from "../src/game/storage.ts";
import { borderScenario as scenario } from "../src/scenario/scenario.ts";

const period = 7 / 366;
const normal = { difficulty: "standard", fractionOfYear: period } as const;

test("贷款只补实际资金缺口，融资、支出和还款能对账", () => {
  const first = settleFiscal({ ...normal, day: 7, treasury: 0, tax: 100, receipts: 100, upkeep: 1000 });
  assert.equal(first.fiscal.week.creditLimit, 10_400);
  assert.equal(first.fiscal.debt, 900);
  assert.equal(first.fiscal.week.borrowed, 900);
  assert.equal(first.fiscal.week.upkeepPaid, 1000);
  assert.equal(first.treasury, 0);
  const next = {
    ...normal, day: 14, treasury: 5_000, fiscal: first.fiscal, tax: 200, receipts: 200, upkeep: 1000,
  };
  const closing = settleFiscal(next);
  const week = closing.fiscal.week;
  assert.equal(week.creditLimit, 15_600);
  assert.equal(week.annualRate, 0.06 + 0.10 * (900 / 15600) ** 2);
  assert.ok(week.interestPaid > 0);
  assert.equal(week.repaid, 900);
  assert.equal(closing.fiscal.debt, 0);
  assert.equal(closing.treasury, next.treasury + next.receipts + week.borrowed - week.repaid - week.interestPaid - week.upkeepPaid);
  assert.throws(() => settleFiscal({ ...next, fiscal: closing.fiscal }), /已记账/);
  const hard = settleFiscal({ ...next, difficulty: "extreme" });
  assert.equal(hard.fiscal.week.annualRate, week.annualRate * 1.3);
  assert.equal(fiscalWeekFraction(new Date("1820-01-08")), period);
  assert.equal(fiscalWeekFraction(new Date("1821-01-03")), 5 / 366 + 2 / 365);
});

test("信贷耗尽后限制新工程，连续缺口进入违约，恢复支付后解除", () => {
  const input = { ...normal, day: 7, treasury: -1000, tax: 0, receipts: 0, upkeep: 500 };
  const first = settleFiscal(input);
  assert.equal(first.fiscal.debt, 1000);
  assert.equal(first.fiscal.week.borrowed, 0);
  assert.equal(first.fiscal.week.upkeepPaid, 0);
  assert.equal(first.fiscal.week.risk, "restricted");
  assert.ok(first.fiscal.arrears > 0);
  const second = settleFiscal({ ...input, day: 14, treasury: 0, fiscal: first.fiscal });
  assert.equal(second.fiscal.week.risk, "defaulted");
  const recovered = settleFiscal({ ...input, day: 21, treasury: 10_000, fiscal: second.fiscal });
  assert.equal(recovered.fiscal.week.risk, "stable");
  assert.equal(recovered.fiscal.arrears, 0);

  const countryId = "country_01";
  const initial = dispatch(scenario, createGame(scenario), { type: "selectCountry", countryId });
  initial.countryEconomies[countryId].fiscal = first.fiscal;
  assert.match(constructionError(scenario, initial, countryId, "Yunnan", "infrastructure", false)!, /公共支出不足/);
});

test("财政随引擎周结并写入存档，预估与读档无副作用", () => {
  const countryId = "country_01";
  const initial = dispatch(scenario, createGame(scenario), { type: "selectCountry", countryId });
  const game = dispatch(scenario, initial, { type: "advanceWeek" });
  const fiscal = game.countryEconomies[countryId].fiscal!;
  assert.equal(fiscal.week.day, 7);
  assert.equal(fiscal.taxHistory.length, 1);
  assert.equal(fiscal.week.creditLimit, game.lastEconomy!.countries[countryId].tax * 104);
  assert.deepEqual(parseSave(scenario, { version: saveVersion, scenarioId: scenario.id, state: game }), game);
});
