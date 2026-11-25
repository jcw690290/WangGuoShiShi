import { z } from "zod";

export const difficultyLevels = ["relaxed", "standard", "challenging", "extreme"] as const;
export const difficultyNames = {
  relaxed: "轻松", standard: "标准", challenging: "挑战", extreme: "极难",
};
export type Difficulty = (typeof difficultyLevels)[number];
export const difficultySchema = z.enum(difficultyLevels);

const rate = z.number().min(0).max(3);
export const ruleTuningSchema = z.object({
  radicalGrowth: rate,
  radicalRelief: rate,
  aiAggression: rate,
});
export type RuleTuning = z.infer<typeof ruleTuningSchema>;

const profiles = {
  relaxed: { reserveWeeks: 36, radicalGrowth: 0.65, radicalRelief: 1.25, aiAggression: 0.75 },
  standard: { reserveWeeks: 26, radicalGrowth: 1, radicalRelief: 1, aiAggression: 1 },
  challenging: { reserveWeeks: 20, radicalGrowth: 1.2, radicalRelief: 0.9, aiAggression: 1.15 },
  extreme: { reserveWeeks: 16, radicalGrowth: 1.4, radicalRelief: 0.8, aiAggression: 1.3 },
} satisfies Record<Difficulty, RuleTuning & { reserveWeeks: number }>;

export const settingsSchema = z.object({
  difficulty: difficultySchema,
  lowestDifficulty: difficultySchema,
  difficultyHistory: z.array(z.object({ difficulty: difficultySchema, tick: z.int().nonnegative() })).min(1),
  tuning: ruleTuningSchema.nullable(),
});
export type GameSettings = z.infer<typeof settingsSchema>;

export function initialSettings(difficulty: Difficulty): GameSettings {
  return { difficulty, lowestDifficulty: difficulty, difficultyHistory: [{ difficulty, tick: 0 }], tuning: null };
}

export function changeDifficulty(settings: GameSettings, difficulty: Difficulty, tick: number): GameSettings {
  if (difficulty === settings.difficulty) return settings;
  const lowestDifficulty = difficultyLevels[Math.min(
    difficultyLevels.indexOf(settings.lowestDifficulty), difficultyLevels.indexOf(difficulty),
  )];
  return {
    ...settings, difficulty, lowestDifficulty,
    difficultyHistory: [...settings.difficultyHistory, { difficulty, tick }],
  };
}

export function validDifficultyHistory(settings: GameSettings, elapsed: number) {
  const history = settings.difficultyHistory;
  return history[0].tick === 0 &&
    history.at(-1)!.difficulty === settings.difficulty &&
    history.every(({ tick, difficulty }, index) =>
      tick <= elapsed && (index === 0 || (history[index - 1].tick <= tick && history[index - 1].difficulty !== difficulty)),
    ) &&
    settings.lowestDifficulty === difficultyLevels[history.reduce(
      (lowest, { difficulty }) => Math.min(lowest, difficultyLevels.indexOf(difficulty)), difficultyLevels.length - 1,
    )];
}

export function ruleTuning(settings: GameSettings): RuleTuning {
  const { radicalGrowth, radicalRelief, aiAggression } = settings.tuning ?? profiles[settings.difficulty];
  return { radicalGrowth, radicalRelief, aiAggression };
}

export function openingReserve(treasury: number, difficulty: Difficulty) {
  return Math.round(treasury * profiles[difficulty].reserveWeeks / profiles.standard.reserveWeeks);
}
