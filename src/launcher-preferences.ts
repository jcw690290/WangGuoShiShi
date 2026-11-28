import { z } from "zod";
import { difficultySchema } from "./game/settings.ts";

export const tickRates = [1, 2, 4, 8] as const;
export const playbackSpeedSchema = z.literal([...tickRates, 5]);
export const interfaceVolumeSchema = z.int().min(0).max(100);
const preferencesSchema = z.object({
  difficulty: difficultySchema,
  speed: playbackSpeedSchema,
  volume: interfaceVolumeSchema,
});
export type LauncherPreferences = z.infer<typeof preferencesSchema>;
const defaults: LauncherPreferences = { difficulty: "relaxed", speed: 2, volume: 0 };
const storageKey = "wang-guo-shi-shi:launcher-preferences";

export function loadLauncherPreferences() {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === null) return { preferences: defaults, message: "" };
    const parsed = preferencesSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return { preferences: parsed.data, message: "" };
  } catch {
    return { preferences: defaults, message: "无法读取本机设置，已使用默认值。" };
  }
  return { preferences: defaults, message: "本机设置格式无效，已使用默认值。" };
}

export function saveLauncherPreferences(preferences: LauncherPreferences) {
  window.localStorage.setItem(storageKey, JSON.stringify(preferences));
}

export async function playInterfaceCue(context: AudioContext, volume: number) {
  if (context.state === "suspended") await context.resume();
  const start = context.currentTime, end = start + 0.14;
  const oscillator = context.createOscillator(), gain = context.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(523.25, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(0.10 * volume / 100, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  oscillator.connect(gain).connect(context.destination);
  oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  oscillator.start(start);
  oscillator.stop(end);
}
