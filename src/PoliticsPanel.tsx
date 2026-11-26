import { useState } from "react";
import type { GameCommand, GameState } from "./game/engine.ts";
import {
  ownedSocieties,
  politicsError,
  researchCategory,
  researchCapacity,
  researchCost,
  availableTech,
  techEffect,
  lawEffect,
} from "./game/politics.ts";
import { distributionName, groups, influence, laws, literacyOf, powerDistribution, reformConditions, reformWork, techs, unrestOf } from "./game/society.ts";
import type { Law } from "./game/society.ts";
import { count } from "./format.ts";
import { institutionLawDetails, institutionLawFamilies, institutionLawKinds, institutionLawOptions } from "./game/institutions.ts";
import { laborLawCategory, laborLawFamilies } from "./game/labor.ts";

const otherLaws = laws.filter((law) => !institutionLawDetails(law) && !laborLawCategory(law));
interface Props {
  game: GameState;
  playerId: string;
  year: number;
  busy: boolean;
  send: (cmd: GameCommand) => void;
}
export function PoliticsPanel({ game, playerId: id, year, busy, send }: Props) {
  const n = game.nations[id],
    sites = ownedSocieties(game, id),
    people = sites.flatMap((site) => site.pops),
    power = influence(sites, id, n);
  const [selected, setLaw] = useState<Law>("工资税改革");
  const law = n.reform ?? selected,
    conditions = reformConditions(n, power, law, unrestOf(people));
  const progress = n.reformProgress / reformWork;
  const stage = progress < 1 / 3 ? "组织支持" : progress < 2 / 3 ? "争论修正" : "实施";
  const literacy = literacyOf(people);
  const worldReport = game.lastEconomy;
  const universityStaff = worldReport ? Object.entries(worldReport.states).reduce((sum, [siteId, snapshot]) =>
    sum + (game.ownerByStateId[siteId] === id ? snapshot.universityStaff ?? 0 : 0), 0,
  ) : 0;
  const { innovation, cap } = researchCapacity(universityStaff, literacy);
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
            <span>{distributionName[powerDistribution(n)]} · 合法性 {conditions.legitimacy} / 100</span>
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
              <optgroup label="其他法律">
                {otherLaws.map((l) => <option key={l}>{l}</option>)}
              </optgroup>
              {institutionLawKinds.map((kind) => (
                <optgroup key={kind} label={institutionLawFamilies[kind]}>
                  {institutionLawOptions[kind].map((l) => <option key={l}>{l}</option>)}
                </optgroup>
              ))}
              {Object.values(laborLawFamilies).map(({ name, options }) => (
                <optgroup key={name} label={name}>
                  {options.map((l) => <option key={l}>{l}</option>)}
                </optgroup>
              ))}
            </select>
            <p>{lawEffect[law]}</p>
            <p>
              运动支持 {conditions.support.toFixed(1)}% · 激进人口 {conditions.resistance.toFixed(1)}%
              {" · "}{conditions.speed > 0 ? `按当前条件需约 ${Math.ceil((reformWork - n.reformProgress) / conditions.speed)} 周` : "审议暂停"}
            </p>
            {n.reform ? (
              <p role="status">
                {n.reform} · {stage} · {Math.floor(progress * 100)}%
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
            <span>识字率 {literacy.toFixed(1)}%</span>
          </header>
          <div className="control-block">
            <p>周创新 {innovation.toFixed(1)} · 主动研究上限 {cap.toFixed(1)}</p>
            {techs.map((t) => (
              <div key={t} className="research-row">
                <strong>
                  {researchCategory[t]} · {t}
                </strong>
                <progress aria-label={t + "进度"} max={100} value={n.knowledge[t]} />
                <small>
                  {n.knowledge[t].toFixed(2)}% · 本周扩散 +{n.diffusion[t].toFixed(2)} · 成本 {count(researchCost(t, year))} 点 · {techEffect[t]}
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
