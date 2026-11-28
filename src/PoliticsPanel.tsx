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
import { taxLaws } from "./game/taxation.ts";
import { isTradeLaw, tradeLaws } from "./game/trade-policy.ts";
import { civicLawCategory, civicLawFamilies, enactedCivicLaws } from "./game/civic-policy.ts";
import { authorityBudget, constitutionalForms, constitutionLawCategory, representationLaw, representationLaws, stateForm } from "./game/constitution.ts";
import { governanceLaw, governanceLaws, isGovernanceLaw } from "./game/governance.ts";
import { economicLaw, economicLaws, isEconomicLaw } from "./game/ownership.ts";
import {
  compromiseCost, constitutionalCompromiseError, constitutionalCrisisWarning, constitutionalSupportByState,
} from "./game/constitutional-crises.ts";
import type { Scenario } from "./scenario/scenario.ts";

const otherLaws = laws.filter((law) => !institutionLawDetails(law) && !laborLawCategory(law) &&
  !(taxLaws as readonly Law[]).includes(law) && !isTradeLaw(law) && !civicLawCategory(law) &&
  !constitutionLawCategory(law) && !isGovernanceLaw(law) && !isEconomicLaw(law));
interface Props {
  scenario: Scenario;
  game: GameState;
  playerId: string;
  year: number;
  busy: boolean;
  send: (cmd: GameCommand) => void;
}
export function PoliticsPanel({ scenario, game, playerId: id, year, busy, send }: Props) {
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
  const effectiveLaws = n.laws.filter((law) => !civicLawCategory(law) && !constitutionLawCategory(law) && !isGovernanceLaw(law) &&
    !isEconomicLaw(law));
  const authority = authorityBudget(game, id);
  const crisis = constitutionalCrisisWarning(game, id);
  const crisisState = game.constitutionalCrises?.[id];
  const compromiseReason = crisis && constitutionalCompromiseError(game, id);
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
            <span>{stateForm(n)} · {distributionName[powerDistribution(n)]} · 合法性 {conditions.legitimacy} / 100</span>
          </header>
          {crisis && (
            <div className="control-block">
              <h4>全国政体冲突预警</h4>
              <p>反对派要求实施{crisis.demand}。政体冲突已持续 {game.elapsedDays - crisis.since} 天。</p>
              <details>
                <summary>各州支持分布</summary>
                <ul>
                  {constitutionalSupportByState(game, id, crisis.demand).map(({ stateId, opposition }) => (
                    <li key={stateId}>{scenario.states[stateId].name} · 反对派 {opposition}% · 政府 {100 - opposition}%</li>
                  ))}
                </ul>
              </details>
              <button type="button" disabled={busy || !!compromiseReason} title={compromiseReason}
                onClick={() => send({ type: "offerConstitutionalCompromise", countryId: id })}>
                协商并将诉求列入改革议程（{count(compromiseCost)}）
              </button>
            </div>
          )}
          {crisisState && "compromiseUntil" in crisisState && crisisState.compromiseUntil > game.elapsedDays && (
            <p>政体协商期还剩 {crisisState.compromiseUntil - game.elapsedDays} 天。</p>
          )}
          <div className="control-block">
            <p>权威力可用 {authority.available} · 已占用 {authority.used} / {authority.capacity}</p>
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
            <p>生效法律 · {[stateForm(n), representationLaw(n), governanceLaw(n.laws), economicLaw(n.laws),
              ...effectiveLaws, ...enactedCivicLaws(n.laws)].join("、")}</p>
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
              <optgroup label="税制">
                {taxLaws.map((l) => <option key={l}>{l}</option>)}
              </optgroup>
              <optgroup label="贸易法">
                {tradeLaws.map((l) => <option key={l}>{l}</option>)}
              </optgroup>
              {Object.values(civicLawFamilies).map(({ name, options }) => (
                <optgroup key={name} label={name}>
                  {options.map((l) => <option key={l}>{l}</option>)}
                </optgroup>
              ))}
              <optgroup label="国家体制">
                {constitutionalForms.map((l) => <option key={l}>{l}</option>)}
              </optgroup>
              <optgroup label="权力分配">
                {representationLaws.map((l) => <option key={l}>{l}</option>)}
              </optgroup>
              <optgroup label="地方治理">
                {governanceLaws.map((l) => <option key={l}>{l}</option>)}
              </optgroup>
              <optgroup label="经济体制">
                {economicLaws.map((l) => <option key={l}>{l}</option>)}
              </optgroup>
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
