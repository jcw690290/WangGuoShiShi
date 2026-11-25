import { useEffect, useRef, useState } from "react";
import { ruleTuning, ruleTuningSchema } from "./game/settings.ts";
import type { GameSettings, RuleTuning } from "./game/settings.ts";

export const defaultMaxTickRate = 32;
export const minMaxTickRate = 9;
export const maxMaxTickRate = 120;
const rateLabel = {
  radicalGrowth: "激进增长",
  radicalRelief: "激进缓解",
  aiAggression: "AI 外交施压频率",
} satisfies Record<keyof RuleTuning, string>;
const ruleKeys = Object.keys(rateLabel) as (keyof RuleTuning)[];

export function DeveloperPanel({ maxTickRate, settings, setMaxTickRate, setTuning, onClose }: {
  maxTickRate: number;
  settings: GameSettings | null;
  setMaxTickRate: (rate: number) => void;
  setTuning: (tuning: RuleTuning | null) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState("");
  useEffect(() => {
    dialog.current!.showModal();
  }, []);
  const tuning = settings ? ruleTuning(settings) : null;

  return <dialog className="online-dialog developer-dialog" ref={dialog} onClose={onClose} aria-labelledby="developer-title">
    <header className="room-heading">
      <h2 id="developer-title">开发者面板</h2>
      <button type="button" className="close-menu" aria-label="关闭开发者面板" onClick={() => dialog.current!.close()}>×</button>
    </header>
    <form onSubmit={(event) => {
      event.preventDefault();
      setMaxTickRate(Number(new FormData(event.currentTarget).get("tickRate")));
      setStatus("第五档速度已更新。");
    }}>
      <label>第五档速度（tick／秒）
        <input name="tickRate" type="number" min={minMaxTickRate} max={maxMaxTickRate} defaultValue={maxTickRate} required />
      </label>
      <button type="submit" className="menu-button">应用速度</button>
    </form>
    {tuning && <form onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      setTuning(ruleTuningSchema.parse(Object.fromEntries(ruleKeys.map((key) => [key, Number(form.get(key))]))));
      setStatus("套用至下次结算。");
    }}>
      <p>以标准难度的倍率 1 为参照。改动会写入本局存档。</p>
      <div key={settings!.tuning === null ? "profile" : "custom"}>
        {ruleKeys.map((key) => <label key={key}>{rateLabel[key]}
          <input name={key} type="number" min={0} max={3} step={0.01} defaultValue={tuning[key]} required />
        </label>)}
      </div>
      <div className="developer-actions">
        <button type="submit" className="menu-button">应用倍率</button>
        <button type="button" className="menu-button" disabled={settings!.tuning === null} onClick={() => {
          setTuning(null);
          setStatus("已恢复到当前难度的倍率。");
        }}>恢复难度倍率</button>
      </div>
    </form>}
    <p role="status">{status}</p>
  </dialog>;
}
