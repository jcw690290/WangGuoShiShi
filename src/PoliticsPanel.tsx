import { useState } from "react";
import type { GameCommand, GameState } from "./game/engine.ts";
import {
  ownedSocieties,
  politicsError,
  researchCategory,
  availableTech,
  techEffect,
  lawEffect,
} from "./game/politics.ts";
import { groups, influence, laws, reformConditions, techs, literacyOf } from "./game/society.ts";
import type { Law } from "./game/society.ts";
interface Props {
  game: GameState;
  playerId: string;
  busy: boolean;
  send: (cmd: GameCommand) => void;
}
export function PoliticsPanel({ game, playerId: id, busy, send }: Props) {
  const n = game.nations[id],
    sites = ownedSocieties(game, id),
    power = influence(sites, id, n);
  const [selected, setLaw] = useState<Law>("工资税改革");
  const law = n.reform ?? selected,
    conditions = reformConditions(n, power, law);
  const proposal = { type: "proposeLaw", countryId: id, law } as const;
  const reason = politicsError(game, proposal);
  return (
    <section className="economy">
      <header className="economy-heading">
        <h2 id="politics-title">政治与科技</h2>
        <span>法律与技术在下一次结算生效</span>
      </header>
      <div className="economy-grid">
        <section className="panel">
          <header className="panel-header">
            <h3>政府与利益集团</h3>
            <span>合法性 {conditions.legitimacy} / 100</span>
          </header>
          <div className="control-block">
            <p>勾选执政集团。议案需要政府支持，或至少 25% 的运动支持。</p>
            <div className="group-grid">
              {groups.map((g) => (
                <label key={g}>
                  <input
                    type="checkbox"
                    checked={n.government.includes(g)}
                    disabled={busy || (n.government.length === 1 && n.government.includes(g))}
                    onChange={() =>
                      send({
                        type: "setGovernment",
                        countryId: id,
                        government: n.government.includes(g)
                          ? n.government.filter((x) => x !== g)
                          : [...n.government, g],
                      })
                    }
                  />
                  {g} {power[g].toFixed(1)}%
                </label>
              ))}
            </div>
            <p>生效法律 · {n.laws.join("、") || "传统制度"}</p>
            <select
              value={law}
              aria-label="改革法律"
              disabled={!!n.reform || busy}
              onChange={(e) => setLaw(e.target.value as Law)}
            >
              {laws.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
            <p>{lawEffect[law]}</p>
            <p>
              运动支持 {conditions.support.toFixed(1)}% · 每周审议 {conditions.speed} 点
            </p>
            {n.reform ? (
              <p role="status">
                {n.reform} · 已审议 {n.reformProgress} / 2
              </p>
            ) : (
              <>
                <button className="build" disabled={busy || !!reason} onClick={() => send(proposal)}>
                  提出改革
                </button>
                {reason && <small>{reason}</small>}
              </>
            )}
          </div>
        </section>
        <section className="panel">
          <header className="panel-header">
            <h3>研究与扩散</h3>
            <span>识字率 {literacyOf(sites.flatMap((s) => s.pops)).toFixed(1)}%</span>
          </header>
          <div className="control-block">
            {techs.map((t) => (
              <div key={t} className="research-row">
                <strong>
                  {researchCategory[t]} · {t}
                </strong>
                <progress aria-label={t + "进度"} max={100} value={n.knowledge[t]} />
                <small>
                  {n.knowledge[t].toFixed(1)}% · 本周扩散 +{n.diffusion[t].toFixed(1)} · {techEffect[t]}
                </small>
                <button
                  className="build"
                  disabled={busy || !!n.research || !availableTech(n, t)}
                  onClick={() => send({ type: "startResearch", countryId: id, tech: t })}
                >
                  {n.knowledge[t] === 100 ? "已掌握" : n.research === t ? "研究中" : "研究" + t}
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
