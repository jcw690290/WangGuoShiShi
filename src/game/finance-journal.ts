import { z } from "zod";
import type { GameState } from "./engine.ts";
import { elapsedTicks } from "./time.ts";

const financeTransactionSchema = z.object({
  transactionId: z.string().min(1),
  tick: z.int().nonnegative(),
  from: z.string().min(1),
  to: z.string().min(1),
  amount: z.int().positive(),
  reason: z.string().min(1),
  reference: z.string().min(1),
}).refine(({ from, to, tick, transactionId }) => from !== to &&
  transactionId.startsWith(`${tick}:`) && /^\d+:(week|order):\d+$/.test(transactionId));

export const financeJournalSchema = z.object({
  settled: z.array(financeTransactionSchema),
  pending: z.array(financeTransactionSchema),
}).refine(({ settled, pending }) => {
  const entries = [...settled, ...pending];
  return new Set(entries.map((entry) => entry.transactionId)).size === entries.length;
});

type Transaction = z.infer<typeof financeTransactionSchema>;
type Transfer = Omit<Transaction, "transactionId" | "tick">;
export type FinanceJournal = z.infer<typeof financeJournalSchema>;

export const treasuryAccount = (id: string) => `treasury:${id}`;
export const investmentAccount = (id: string) => `investment:${id}`;

export function weeklyFinance(tick: number) {
  const entries: Transaction[] = [];
  function transfer(from: string, to: string, amount: number, reason: string, reference: string) {
    if (amount === 0) return;
    entries.push({ transactionId: `${tick}:week:${entries.length}`, tick, from, to, amount, reason, reference });
  }
  return { entries, transfer };
}

export function recordImmediateTransfer(state: GameState, transfer: Transfer): GameState {
  if (transfer.amount === 0) return state;
  const tick = elapsedTicks(state);
  const { settled, pending } = state.financeJournal ?? { settled: [], pending: [] };
  const transaction = { ...transfer, tick, transactionId: `${tick}:order:${pending.length}` };
  return { ...state, financeJournal: { settled, pending: [...pending, transaction] } };
}
