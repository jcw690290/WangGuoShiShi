import { useMemo } from "react";
import { facilityNames, facilityTypes, livingStandardOf, socialTags } from "./game/society.ts";
import { civicPolicy, civicStanding, nationalIdentity } from "./game/civic-policy.ts";
import { privateShareOf, projectDeposit, projectName, projectPoints, remainingProjectPoints, weeklyBudgets } from "./game/economy.ts";
import { count, silver } from "./format.ts";
import { fiscalRiskNames } from "./game/fiscal.ts";
import { publicPayBands, publicPayBandSchema, publicPayNames } from "./game/public-pay.ts";
import { CommodityDetails } from "./CommodityDetails.tsx";
import { buildingCapacity, constructionError, workForce } from "./game/economy.ts";
import type { EconomyReport } from "./game/economy.ts";
import type { GameCommand, GameState } from "./game/engine.ts";
import { goods, industrialGoods, industries } from "./game/industry.ts";
import { industryMethodAt, isIndustrialRetrofit, productionTierAt } from "./game/industrial.ts";
import { productionProject, productionTierNames, productionTiers } from "./game/production-methods.ts";
import type { Scenario } from "./scenario/scenario.ts";
import { affinityLevel, culturalAffinityOf, cultureName } from "./game/culture.ts";
import { governanceLaw, governanceModeAllowed, governanceModes, governanceOf, governanceRules,
  integrationDuration, integrationStaffNeeded, localGovernanceRule } from "./game/governance.ts";
import type { GovernanceMode } from "./game/governance.ts";
import { TradePanel } from "./TradePanel.tsx";
import { portCapacity } from "./game/transport.ts";
import { effectiveConvoyCapacity, maxConvoyOrder, rubberPerMotor, shipGoodsPerConvoy, shipGoodsPerMotor } from "./game/fleet.ts";
import { incidentNames, localIncidentMonths, unrestEffects } from "./game/unrest.ts";
import { basicEquivalentSupply, extraGoods } from "./game/households.ts";
import { institutionCommands, institutionGoods, institutionLawLimit, institutionLevelError,
  institutionNames, institutions } from "./game/institutions.ts";
import { bondedRuralWorkers, ruralPopulation } from "./game/labor.ts";
import { exciseGoods, taxBandNames, taxBands, taxPolicy } from "./game/taxation.ts";
import { tariffBandNames, tariffBands, tariffRate, tariffRates, tradeLaw } from "./game/trade-policy.ts";
import { authorityBudget, countryDisplayName, localNegotiationAuthority } from "./game/constitution.ts";
import { ownedLevels, ownershipKinds, ownershipNames } from "./game/ownership.ts";
import { opiumLaw } from "./game/opium.ts";

interface Props {
  scenario: Scenario;
  game: GameState;
  playerId: string;
  selectedId: string | null;
  report: EconomyReport;
  busy: boolean;
  send: (command: GameCommand) => void;
  onPopulationOpen: () => void;
}

function StateIndustry({
  scenario,
  game,
  playerId,
  stateId,
  report,
  busy,
  send,
  onPopulationOpen,
}: Omit<Props, "selectedId"> & { stateId: string }) {
  const site = scenario.states[stateId];
  const local = game.stateEconomies[stateId];
  const { industries: activity, populationChange, conscripts } = report.states[stateId];
  const monthlyChange = game.lastPopulation?.changes[stateId];
  const movements = game.lastPopulation?.moves?.reduce((totals, { from, to, people }) => ({
    entered: totals.entered + (to === stateId ? people : 0),
    left: totals.left + (from === stateId ? people : 0),
  }), { entered: 0, left: 0 });
  const employed = goods.reduce((sum, good) => sum + activity[good].employed, report.states[stateId].subsistence?.employed ?? 0);
  const society = game.societies[stateId];
  const workforce =
    (report.states[stateId].workforce ?? workForce(local.population, society.laborParticipation)) -
    conscripts -
    report.states[stateId].builders -
    (report.states[stateId].constructionMaintenance?.workers ?? 0) -
    report.states[stateId].regulars -
    Math.ceil(report.states[stateId].universityStaff ?? 0) -
    Math.ceil(report.states[stateId].administrationStaff ?? 0) -
    (report.states[stateId].office?.staff ?? 0) -
    institutions.reduce((jobs, kind) => jobs + (report.states[stateId][kind]?.staff ?? 0), 0);
  const isOwnState = game.ownerByStateId[stateId] === playerId;

  const owner = game.ownerByStateId[stateId],
    snapshot = report.states[stateId];
  const governance = governanceOf(society);
  const nation = game.nations[owner];
  const subsidyLimit = game.countryEconomies[owner].industrySubsidies?.[stateId] ?? 0;
  const civic = civicPolicy(nation.laws);
  const boundWorkers = bondedRuralWorkers(ruralPopulation(society.pops), society.laborParticipation, nation.laws);
  const order = nation.fleet.order;
  const motorizationHere = nation.fleet.motorizationPort === stateId;
  const movesOrder = order !== null && order.stateId !== stateId;
  const rule = localGovernanceRule(society, nation.laws);
  const occupied = game.occupation?.stateId === stateId;
  const integrationActive = governance.integration !== null;
  const stability = society.stability;
  const incident = stability?.incident;
  const negotiationAuthority = incident && isOwnState ? authorityBudget(game, playerId).available : 0;
  const localEffects = unrestEffects(stability);
  const fuelNeed = snapshot.householdBasicOrders?.wood;
  const basicSupply = snapshot.householdConsumption &&
    basicEquivalentSupply(snapshot.householdConsumption, snapshot.householdExtras?.delivered);
  return (
    <section className="panel" aria-labelledby="industry-title">
      <header className="panel-header">
        <h3 id="industry-title">{site.name}产业</h3>
      </header>
      <dl className="economy-stats">
        <div>
          <dt>人口</dt>
          <dd>
            {count(local.population)} 人
            {monthlyChange !== undefined && (
              <small>（上次月结 {monthlyChange > 0 ? "+" : ""}{count(monthlyChange)}）</small>
            )}
            {movements && (movements.entered > 0 || movements.left > 0) &&
              <small>上次月结迁入 {count(movements.entered)} · 迁出 {count(movements.left)}</small>}
            {monthlyChange === undefined && populationChange !== undefined && populationChange !== 0 && (
              <small>
                （{populationChange > 0 ? "+" : ""}
                {count(populationChange)}）
              </small>
            )}
          </dd>
        </div>
        <div>
          <dt>就业 / 劳动力</dt>
          <dd>
            {count(employed)} / {count(workforce)} 人
          </dd>
          <small>参与率 {(society.laborParticipation * 100).toFixed(1)}%
            {boundWorkers > 0 && ` · 受约束的农村劳力 ${count(boundWorkers)} 人`}</small>
        </div>
        <div>
          <dt>市场接入</dt>
          <dd>{Math.round(snapshot.access * 100)}%</dd>
        </div>
        {snapshot.power && <div>
          <dt>本州用电</dt>
          <dd>到电 {count(snapshot.power.delivered)} / {count(snapshot.power.requested)} · 实付 {silver(snapshot.power.spending)}</dd>
        </div>}
        {site.coastal && <div>
          <dt>港口每周吞吐</dt>
          <dd>{count(portCapacity(site.grainTransport, society))}</dd>
          <small>商运 {count(snapshot.portTradeCargo ?? 0)} · 军需 {count(snapshot.portMilitaryCargo ?? 0)}</small>
        </div>}
        <div>
          <dt>生活水平</dt>
          <dd>{livingStandardOf(society.pops).toFixed(1)}</dd>
        </div>
        {snapshot.householdConsumption && <div>
          <dt>家庭到货</dt>
          <dd>粮食 {count(snapshot.householdConsumption.grain)} · 副食品 {count(snapshot.householdConsumption.food)} · 布匹 {count(snapshot.householdConsumption.cloth)} ·
            木材 {count(snapshot.householdConsumption.wood)} · 煤 {count(snapshot.householdConsumption.coal)} · 服务 {count(snapshot.householdConsumption.services)}</dd>
          <small>基本食品满足 {Math.round(snapshot.foodFulfillment! * 100)}%
            {fuelNeed !== undefined && basicSupply && ` · 基本燃料满足 ${Math.round((fuelNeed > 0 ? basicSupply.wood / fuelNeed : 1) * 100)}%`}</small>
          {snapshot.householdBasicPurchases && <small>基本消费实付 {silver(snapshot.householdBasicPurchases.spending)} ·
            周初预算 {silver(snapshot.householdBasicPurchases.budget)}</small>}
        </div>}
        <div>
          <dt>常备军 / 建筑 / 军工</dt>
          <dd>
            {snapshot.regulars} / {snapshot.builders} / {activity.arms.employed + activity.ammo.employed}
          </dd>
        </div>
        {snapshot.universityStaff !== undefined && society.university > 0 && <div>
          <dt>大学周实付岗位</dt>
          <dd>{snapshot.universityStaff.toFixed(1)}（全周等效）</dd>
        </div>}
        {conscripts > 0 && (
          <div>
            <dt>征兵占用</dt>
            <dd>{count(conscripts)} 人</dd>
          </div>
        )}
      </dl>
      <ul className="industry-list">
        {goods.map((good) => {
          const industry = industries[good];
          const jobs = activity[good];
          const tier = productionTierAt(good, society), method = industryMethodAt(good, society);
          const owned = ownedLevels(good, local.buildings[good], local.ownership);
          const problem = isOwnState ? constructionError(scenario, game, playerId, stateId, good) : undefined;
          return (
            <li key={good}>
              <div>
                <strong>{industry.name}</strong>{" "}
                <span>
                  {local.buildings[good]} / {buildingCapacity(site, local, good)} 级
                  {ownershipKinds.filter((kind) => owned[kind] > 0).map((kind) => ` · ${ownershipNames[kind]} ${owned[kind]}`).join("")}
                </span>
                <p>
                  {productionTierNames[tier]}工序 · 就业 {count(jobs.employed)} 人 · 周产出 {count(jobs.output)} · 本地价{" "}
                  {silver(snapshot.localPrices[good])} · 人均周工资{" "}
                  {jobs.employed === 0 ? "—" : silver(jobs.wages / jobs.employed)}
                </p>
                {local.buildings[good] > 0 && <details>
                  <summary>生产方式</summary>
                  <p>每级满员 {count(method.jobs)} 人 · 基础周产 {count(method.output)}
                    {method.power > 0 && ` · 每级需电力 ${count(method.power)}`}</p>
                  <p>每级周投入 {industrialGoods.filter((material) => method.recipe[material]).map((material) =>
                    `${industries[material].goodName} ${count(method.recipe[material]!)}`).join(" · ")}</p>
                  {isOwnState && <div className="diplomacy-actions">
                    {productionTiers.filter((target) => target !== tier).map((target) => {
                      const project = productionProject(good, target);
                      const reason = constructionError(scenario, game, playerId, stateId, project);
                      return <button type="button" key={target} className="build" disabled={busy || reason !== undefined}
                        onClick={() => send({ type: "queueConstruction", countryId: playerId, stateId, good: project })}>
                        改造为{productionTierNames[target]}工序
                        <small>{reason ?? `按周实付 · ${projectPoints(project)} 施工点`}</small>
                      </button>;
                    })}
                  </div>}
                </details>}
              </div>
              {isOwnState && (
                <button
                  className="build"
                  disabled={busy || problem !== undefined}
                  aria-label={`建设${industry.name}`}
                  onClick={() => send({ type: "queueConstruction", countryId: playerId, stateId, good })}
                >
                  建设{industry.name}
                  <small>{problem ?? `预留周转金 ${silver(projectDeposit(good))} · ${projectPoints(good)} 施工点`}</small>
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="control-block">
        {institutions.filter((kind) => isOwnState || society[kind] > 0 || snapshot[kind]).map((kind) => {
          const name = institutionNames[kind], level = society[kind], service = snapshot[kind];
          const limit = institutionLawLimit(nation.laws, kind);
          const locked = level < 3 ? institutionLevelError(kind, level + 1, nation.laws, nation.knowledge) : undefined;
          const relief = kind === "welfare" ? snapshot.welfareRelief : undefined;
          const updateLevel = (newLevel: number) =>
            send({ type: institutionCommands[kind], countryId: playerId, stateId, level: newLevel });
          return <details key={kind}>
            <summary>{name} · {level} 级{level > limit ? ` · 法律上限 ${limit} 级` : ""}</summary>
            {service && <>
              <p>{service.equivalentLevel === undefined ? `周结 ${service.level} 级` : `周均运行 ${service.equivalentLevel.toFixed(2)} 级`}
                {" · "}覆盖 {Math.round(service.coverage * 100)}% · 实付岗位 {count(service.staff)} / {count(service.needed)} 人</p>
              <p>工资 {silver(service.wages)} · 采购 {silver(service.spending)} · 到货{" "}
                {institutionGoods.map((good) =>
                  `${industries[good].goodName} ${count(service.delivered[good])} / ${count(service.orders[good])}`).join(" · ")}</p>
            </>}
            {relief && <>
              <p>周救济实付 · 农民 {silver(relief.paid.农民)} · 劳工 {silver(relief.paid.劳工)}</p>
              <p>符合条件 · 农民 {count(relief.eligible.农民)} 人 · 劳工 {count(relief.eligible.劳工)} 人</p>
            </>}
            {isOwnState && <div className="diplomacy-actions">
              <button className="build" disabled={busy || level === 0} onClick={() => updateLevel(level - 1)}>
                降低{name}等级
              </button>
              <button className="build" disabled={busy || occupied || level === 3 || locked !== undefined} onClick={() => updateLevel(level + 1)}>
                提升{name}等级
                {locked && <small>{locked}</small>}
              </button>
            </div>}
          </details>;
        })}
        {site.coastal && isOwnState && <div className="diplomacy-actions">
          <button className="build" disabled={busy || occupied || (!movesOrder && order?.remaining === maxConvoyOrder)}
            onClick={() => send({ type: "setConvoyOrder", countryId: playerId, stateId,
              operation: movesOrder ? "move" : "add" })}>
            {movesOrder ? "把商船订单转至本港" : "订造一艘商船"}
            <small>{shipGoodsPerConvoy} 单位船舶制品{order?.stateId === stateId && ` · 待交付 ${order.remaining} 艘`}</small>
          </button>
          {order?.stateId === stateId && <button className="build" disabled={busy}
            onClick={() => send({ type: "setConvoyOrder", countryId: playerId, stateId, operation: "cancel" })}>取消商船订单</button>}
          <button className="build" disabled={busy || (!motorizationHere &&
            (occupied || nation.knowledge["内燃机"] < 100 || nation.fleet.motorized >= nation.convoys))}
            onClick={() => send({ type: "setFleetMotorization", countryId: playerId, stateId, enabled: !motorizationHere })}>
            {motorizationHere ? "取消商船内燃机改装" : "在本港改装商船内燃机"}
            <small>{nation.knowledge["内燃机"] < 100 ? "需要掌握内燃机技术" :
              `每艘船舶制品 ${shipGoodsPerMotor} · 橡胶 ${rubberPerMotor}`}</small>
          </button>
        </div>}
        {snapshot.subsistence && <details>
          <summary>自给农业 · {snapshot.subsistence.rentRate > 0 ? "地主租佃" : "小农自耕"}</summary>
          <p>耕地 {count(snapshot.subsistence.cropland)} · 商品农业占用 {count(snapshot.subsistence.occupied)} · 自给就业 {count(snapshot.subsistence.employed)} 人</p>
          <p>留存 粮食 {count(snapshot.subsistence.retained.grain)} · 木材 {count(snapshot.subsistence.retained.wood)}</p>
          <p>余粮和木材成交后，农户所得 {silver(snapshot.subsistence.householdIncome)} · 地租 {silver(snapshot.subsistence.landRent)}</p>
        </details>}
        {snapshot.householdExtras && <details>
          <summary>家庭可选消费</summary>
          <p>可用资金 {silver(snapshot.householdExtras.budget)} · 实付 {silver(snapshot.householdExtras.spending)}</p>
          <ul>{extraGoods.map((good) => <li key={good}>{industries[good].goodName} {count(snapshot.householdExtras!.delivered[good])} / {count(snapshot.householdExtras!.orders[good])}</li>)}</ul>
        </details>}
        {snapshot.opium && <details>
          <summary>鸦片消费与依赖</summary>
          <p>{opiumLaw(nation.laws)} · 地方依赖负担 {(society.opiumBurden ?? 0).toFixed(1)} / 100</p>
          {snapshot.opium.recoverySupport !== undefined && <p>实付教育、救助及医疗支持 {Math.round(snapshot.opium.recoverySupport * 100)}%</p>}
          <p>医疗采购 {count(snapshot.opium.medical.delivered)} / {count(snapshot.opium.medical.ordered)} · 机构实付 {silver(snapshot.opium.medical.spending)}</p>
          <p>非医疗消费 {count(snapshot.opium.nonMedical.consumed)} / {count(snapshot.opium.nonMedical.ordered)} · 家庭实付 {silver(snapshot.opium.nonMedical.spending)}</p>
          {snapshot.opium.illicit && <p>非法流量尝试 {count(snapshot.opium.illicit.attempted)} · 查缉 {count(snapshot.opium.illicit.seized)} · 到货 {count(snapshot.opium.illicit.delivered)}</p>}
        </details>}
        {snapshot.industrial && <details>
          <summary>工业库存与周转资金</summary>
          <p>周转金 {silver(snapshot.industrial.capital)} · 销售 {silver(snapshot.industrial.sales)} · 采购 {silver(snapshot.industrial.spent)} · 可分配结余 {silver(snapshot.industrial.distributed)}</p>
          {snapshot.industrySubsidy && <p>周转金缺口 {silver(snapshot.industrySubsidy.shortfall)} · 实付产业补贴 {silver(snapshot.industrySubsidy.paid)}</p>}
          {isOwnState && <form className="diplomacy-actions" onSubmit={(event) => {
            event.preventDefault();
            const limit = Number(new FormData(event.currentTarget).get("limit"));
            send({ type: "setIndustrySubsidy", countryId: playerId, stateId, limit });
          }}>
            <label>每周补贴上限
              <input key={`${stateId}:${subsidyLimit}`} name="limit" type="number" min="0" step="1" defaultValue={subsidyLimit} required />
            </label>
            <button className="build" type="submit" disabled={busy}>保存补贴上限</button>
            <small>{occupied ? "军事占领期间暂停补贴，可填 0 撤销。" : "填 0 可撤销。补贴在必要财政支出后支付。"}</small>
          </form>}
          {snapshot.ownershipIncome && <p>收益实付 · {ownershipKinds.map((kind) =>
            `${ownershipNames[kind]} ${silver(snapshot.ownershipIncome![kind])}`).join(" · ")}</p>}
          <div className="economy-table">
            <table>
              <thead><tr><th scope="col">商品</th><th scope="col">消耗</th><th scope="col">采购</th><th scope="col">余量</th></tr></thead>
              <tbody>{industrialGoods.map((good) => <tr key={good}>
                <td>{industries[good].goodName}</td>
                <td>{count(snapshot.industrial!.used[good])}</td>
                <td>{count(snapshot.industrial!.bought[good])}</td>
                <td>{count(snapshot.industrial!.stocks[good])}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </details>}
        <div className="diplomacy-actions">
          {facilityTypes.filter((g) => {
            if (g === "port") return site.coastal;
            if (g === "administrativeArchive") return society.bureaucracy > 0;
            if (isIndustrialRetrofit(g)) return false;
            return true;
          }).map((g) => {
            const problem = isOwnState ? constructionError(scenario, game, playerId, stateId, g) : undefined;
            return (
            <button
              key={g}
              className="build"
              disabled={!isOwnState || busy || problem !== undefined}
              onClick={() => send({ type: "queueConstruction", countryId: playerId, stateId, good: g })}
            >
              {g === "administrativeArchive"
                ? `${facilityNames[g]}${society[g] ? " · 已启用" : ""}`
                : `${facilityNames[g]} ${society[g]} 级 · 扩建`}
              <small>
                {problem ?? `按周实付 · ${projectPoints(g)} 施工点`}
              </small>
          {snapshot.industrialWage !== undefined && <small>产业普通岗位周薪 {silver(snapshot.industrialWage)}</small>}
            </button>
            );
          })}
        </div>
        <details onToggle={(event) => { if (event.currentTarget.open) onPopulationOpen(); }}>
          <summary>人口群体 · 职业、文化与生活水平</summary>
          <div className="economy-table">
            <table>
              <thead>
                <tr>
                  {["职业 / 阶层", "文化 / 信仰", "人口", "财富", "生活水平", "识字率", "忠诚", "中立", "激进"].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {society.pops.map((p) => {
                  const standing = civicStanding(p, owner, society, civic);
                  return (
                    <tr key={JSON.stringify([p.occupation, p.culture, p.religion])}>
                      <td>
                        {p.occupation} / {socialTags[p.occupation][0]}
                      </td>
                      <td>
                        {cultureName(scenario, p.culture)} / {p.religion === nationalIdentity(owner) ? "国教" : "其他信仰"} ·{" "}
                        {standing === 1 ? "完整待遇" : standing > 0 ? "有限待遇" : "受限制"}
                      </td>
                      <td>{count(p.people)}</td>
                      <td>{p.wealth.toFixed(1)}</td>
                      <td>{p.livingStandard.toFixed(1)}</td>
                      <td>{p.literacy.toFixed(1)}%</td>
                      <td>{p.loyalists.toFixed(1)}%</td>
                      <td>{Math.max(0, 100 - p.radicals - p.loyalists).toFixed(1)}%</td>
                      <td>{p.radicals.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
        <details>
          <summary>文化亲近度</summary>
          <div className="economy-table">
            <table>
              <thead><tr><th scope="col">文化</th><th scope="col">亲近度</th><th scope="col">接触阶段</th></tr></thead>
              <tbody>
                {Object.entries(culturalAffinityOf(society)).sort(([, left], [, right]) => right - left).map(([culture, value]) => (
                  <tr key={culture}>
                    <td>{cultureName(scenario, culture)}</td>
                    <td>{Math.floor(value)} / 100</td>
                    <td>{affinityLevel(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <details>
          <summary>地方治理 · {rule.name}</summary>
          <p>{governanceLaw(nation.laws)} · {governance.integrated ? "已整合" : "未整合"} ·
            中央税权 {rule.centralTax}% · 驻军与征兵额度 {Math.round(rule.militaryShare * 100)}%</p>
          {snapshot.localFiscal && <p>
            地方国库 {silver(local.localTreasury ?? 0)} · 周留税 {silver(snapshot.localFiscal.retainedTax)} ·
            周公共支出 {silver(snapshot.localFiscal.publicSpending)}
          </p>}
          {snapshot.office && <>
            <p>行政署 {society.bureaucracy} 级 · 治理覆盖 {Math.round(snapshot.office.coverage * 100)}% · 实付岗位 {count(snapshot.office.staff)} / {count(Math.ceil(snapshot.office.need))}</p>
            <p>周到货 纸张 {count(snapshot.office.paper)} / {count(snapshot.office.paperDemand)} · 服务 {count(snapshot.office.services)} / {count(snapshot.office.serviceDemand)}</p>
            <p>周工资 {silver(snapshot.office.wages)} · 采购支出 {silver(snapshot.office.purchases)}</p>
          </>}
          {stability && <p>地方动乱 {stability.unrest.toFixed(1)} / 100</p>}
          {incident && <>
            <p>{incidentNames[incident.cause]} · 已持续 {count(game.elapsedDays - incident.since)} 天 · 最长 {localIncidentMonths} 个月
              {incident.calmSince !== undefined && " · 诱因正在缓解"}{incident.negotiated && " · 已达成减税协议"}</p>
            <p>当地产出 {Math.round(localEffects.output * 100)}% · 中央征收效率 {Math.round(localEffects.collection * 100)}% · 运力 {Math.round(localEffects.transport * 100)}%</p>
            {isOwnState && !incident.negotiated && <button className="build" disabled={busy || occupied || negotiationAuthority < localNegotiationAuthority}
              onClick={() => send({ type: "negotiateLocalUnrest", countryId: playerId, stateId })}>
              协商减税以缓解动乱
              <small>占用 {localNegotiationAuthority} 权威力 · 可用 {negotiationAuthority}</small>
            </button>}
          </>}
          {occupied && <p>军事占领暂停中央征收和行政整合。</p>}
          {integrationActive && (
            <p>整合 {governance.integration!.months.toFixed(1)} / {integrationDuration} 月 ·
              实付行政岗位 {(snapshot.administrationStaff ?? 0).toFixed(1)} /
              {integrationStaffNeeded(local.population, game.settings.difficulty, rule.integrationCost)}
            </p>
          )}
          {isOwnState && (
            <>
              <label>
                治理方式
                <select
                  value={governance.mode}
                  disabled={busy || occupied}
                  onChange={(event) => send({
                    type: "setLocalGovernance", countryId: playerId, stateId, mode: event.target.value as GovernanceMode,
                  })}
                >
                  {governanceModes.map((mode) => (
                    <option key={mode} value={mode}
                      disabled={!governanceModeAllowed(mode, nation.laws) || (mode === "PROVINCE" && !governance.integrated)}>
                      {governanceRules[mode].name}
                      {!governanceModeAllowed(mode, nation.laws) && "（现行法律限制新设）"}
                    </option>
                  ))}
                </select>
              </label>
              {!governance.integrated && (
                <button
                  className="build"
                  disabled={busy || occupied}
                  onClick={() => send({ type: integrationActive ? "cancelIntegration" : "startIntegration", countryId: playerId, stateId })}
                >
                  {integrationActive ? "取消整合并清除进度" : "安排行政整合"}
                </button>
              )}
            </>
          )}
        </details>
        <TradePanel key={stateId} {...{ scenario, game, stateId, playerId, busy, send }} />
      </div>
    </section>
  );
}

export function EconomyPanel(
  { scenario, game, playerId, selectedId, report, busy, send, onPopulationOpen, onCommodityOpen }: Props & { onCommodityOpen: () => void },
) {
  const marketId = selectedId === null ? playerId : game.ownerByStateId[selectedId];
  const country = scenario.countries[marketId];
  const countryReport = report.countries[marketId];
  const { market, tax, wageTaxRate, upkeep, tribute, officeUpkeep, military, fleet, tradeSeaCargo } = countryReport;
  const nation = game.nations[marketId];
  const policy = taxPolicy(nation);
  const commercialLaw = tradeLaw(nation.laws);
  const { tributeReceived, balance } = weeklyBudgets(game.nations, report)[marketId];
  const countryLiving = useMemo(() => livingStandardOf(Object.entries(game.societies)
    .filter(([stateId]) => game.ownerByStateId[stateId] === marketId).flatMap(([, site]) => site.pops)),
  [game.societies, game.ownerByStateId, marketId]);
  const fiscal = game.countryEconomies[marketId].fiscal;

  return (
    <section className="economy" aria-labelledby="economy-title">
      <header className="economy-heading">
        <h2 id="economy-title">经济与人口</h2>
        <span>
          {game.lastEconomy
            ? "最近一周结算"
            : game.elapsedDays === 0
              ? "经济初始值估算"
              : "按当前州归属估算 · 下周正式结算"}
        </span>
      </header>
      <div className="economy-grid">
        <section className="panel" aria-labelledby="market-title">
          <header className="panel-header">
            <h3 id="market-title">{countryDisplayName(country, nation)}市场</h3>
          </header>
          <dl className="economy-stats">
            <div>
              <dt>关税市场</dt>
              <dd>{scenario.countries[game.nations[marketId].marketLeader ?? marketId].name}</dd>
            </div>
            <div>
              <dt>私人投资池</dt>
              <dd>{silver(game.nations[marketId].investment)}</dd>
            </div>
            <div>
              <dt>周投资注入</dt>
              <dd>{silver(report.countries[marketId].investment)}</dd>
            </div>
            {countryReport.publicIndustryIncome !== undefined && <div>
              <dt>国有收益入库</dt>
              <dd>{silver(countryReport.publicIndustryIncome)}</dd>
            </div>}
            {(countryReport.industrySubsidiesPaid ?? 0) > 0 && <div>
              <dt>产业补贴实付</dt>
              <dd>{silver(countryReport.industrySubsidiesPaid!)}</dd>
            </div>}
            <div>
              <dt>周必要公共支出</dt>
              <dd>{silver(upkeep)}</dd>
              {officeUpkeep !== undefined && <small>其中行政署 {silver(officeUpkeep)}</small>}
              {institutions.map((kind) => {
                const paid = countryReport[`${kind}Upkeep`];
                return paid ? <small key={kind}>其中{institutionNames[kind]} {silver(paid)}</small> : null;
              })}
              {military.procurement && <small>军粮 {silver(military.procurement.grain)} · 军服 {silver(military.procurement.cloth)} ·
                武器 {silver(military.procurement.arms ?? 0)} · 弹药 {silver(military.procurement.ammo ?? 0)}</small>}
              {military.payroll && <small>军饷 {military.payroll.paid === undefined ? "预估应付 " : "实付 "}
                {silver(military.payroll.paid ?? military.payroll.due)}
                {military.payroll.paid !== undefined && ` ／应付 ${silver(military.payroll.due)}`}</small>}
            </div>
            {report.countries[marketId].universityWages !== undefined && <div>
              <dt>大学实付工资</dt>
              <dd>{silver(report.countries[marketId].universityWages!)}</dd>
            </div>}
            {(report.countries[marketId].tradeTariff ?? 0) > 0 && <div>
              <dt>实收进口关税</dt>
              <dd>{silver(report.countries[marketId].tradeTariff!)}</dd>
            </div>}
            {fleet?.port && <div>
              <dt>商船可用运力</dt>
              <dd>{count(effectiveConvoyCapacity(nation))} · {count(nation.convoys)} 艘 · 船况 {nation.fleet.condition}%</dd>
              <small>商运 {count(tradeSeaCargo ?? 0)} · 军需 {count(military.seaCargoUsed ?? 0)}</small>
              <small>{scenario.states[fleet.port].name} · 到货 {count(fleet.delivered)}/{count(fleet.ordered)} · 实付 {silver(fleet.spending)} ·
                维护 {count(fleet.maintained)}/{count(fleet.maintenanceDue)} · 交付 {count(fleet.commissioned)} 艘</small>
              {fleet.motorization && <small>内燃机商船 {count(nation.fleet.motorized)} 艘 · 装油 {count(nation.fleet.fueled)} 艘 ·
                石油到货 {count(fleet.motorization.oil.delivered)}/{count(fleet.motorization.oil.ordered)} ·
                橡胶到货 {count(fleet.motorization.rubber.delivered)}/{count(fleet.motorization.rubber.ordered)} ·
                实付 {silver(fleet.motorization.oil.spending + fleet.motorization.rubber.spending)} ·
                改装 {count(fleet.motorization.converted)} 艘</small>}
            </div>}
            <div>
              <dt>贡金收入 / 上缴</dt>
              <dd>{silver(tributeReceived)} / {silver(tribute)}</dd>
            </div>
            <div>
              <dt>周经常收支（含利息）</dt>
              <dd>{silver(balance)}</dd>
            </div>
            <div>
              <dt>国库</dt>
              <dd>{silver(game.countryEconomies[marketId].treasury)}</dd>
            </div>
            <div>
              <dt>平均生活水平</dt>
              <dd>{countryLiving > 0 ? countryLiving.toFixed(1) : "—"}</dd>
            </div>
            <div>
              <dt>周税收</dt>
              <dd>{silver(tax)}</dd>
              {countryReport.taxReceipts ? <small>
                {countryReport.taxReceipts.system} · {taxBandNames[countryReport.taxReceipts.band]}档 · 所得税 {silver(countryReport.taxReceipts.income)} ·
                消费税 {silver(countryReport.taxReceipts.excise)} · 关税 {silver(countryReport.tradeTariff ?? 0)}
              </small> : <small>工资税 {wageTaxRate}%</small>}
            </div>
          </dl>
          {marketId === playerId && <details className="control-block">
            <summary>公共工资 · {publicPayNames[nation.publicPay]}档</summary>
            <label>下一周工资档位{" "}
              <select value={nation.pendingPublicPay ?? nation.publicPay} disabled={busy}
                onChange={(event) => send({ type: "setPublicPay", countryId: playerId, band: publicPayBandSchema.parse(event.target.value) })}>
                {publicPayBands.map((band) => <option key={band} value={band}>{publicPayNames[band]}档</option>)}
              </select>
            </label>
            <p>低档 80% · 标准档 100% · 高档 120%。调整在本周结账后生效。</p>
          </details>}
          {marketId === playerId && <details className="control-block">
            <summary>税收设置 · {policy.system} · {taxBandNames[nation.taxBand]}档</summary>
            <label>税率档位{" "}
              <select value={nation.taxBand} disabled={busy}
                onChange={(event) => send({ type: "setTaxBand", countryId: playerId, band: event.target.value as typeof nation.taxBand })}>
                {taxBands.map((band) => <option key={band} value={band}>{taxBandNames[band]}</option>)}
              </select>
            </label>
            {policy.system === "消费税制" && <fieldset>
              <legend>征收消费税的商品 · 名义税率 {Math.round(policy.exciseRate * 100)}%</legend>
              {exciseGoods.map((good) => <label key={good}>
                <input type="checkbox" checked={nation.exciseGoods.includes(good)} disabled={busy}
                  onChange={(event) => send({ type: "setExciseGoods", countryId: playerId, goods: event.target.checked
                    ? [...nation.exciseGoods, good] : nation.exciseGoods.filter((selected) => selected !== good) })} />
                {industries[good].goodName}
              </label>)}
            </fieldset>}
          </details>}
          {fiscal && <details className="control-block">
            <summary>财政信用 · {fiscalRiskNames[fiscal.week.risk]} · 债务 {silver(fiscal.debt)}</summary>
            <p>信用上限 {silver(fiscal.week.creditLimit)} · 年利率 {(fiscal.week.annualRate * 100).toFixed(2)}%</p>
            <p>本周借款 {silver(fiscal.week.borrowed)} · 偿还本金 {silver(fiscal.week.repaid)}</p>
            <p>支付利息 {silver(fiscal.week.interestPaid)} · 未付利息 {silver(fiscal.arrears)}</p>
            <p>必要支出实付 {silver(fiscal.week.upkeepPaid)} ／ 应付 {silver(fiscal.week.upkeepDue)}</p>
          </details>}
          {marketId === playerId && <details className="control-block">
            <summary>贸易设置 · {commercialLaw} · 现行关税 {tariffRate(nation)}%</summary>
            <label>关税档位{" "}
              <select value={nation.tariffBand} disabled={busy}
                onChange={(event) => send({ type: "setTariffBand", countryId: playerId, band: event.target.value as typeof nation.tariffBand })}>
                {tariffBands.map((band) => <option key={band} value={band}>{tariffBandNames[band]}档 · {tariffRates[band]}%</option>)}
              </select>
            </label>
            {commercialLaw === "自由贸易" && <p>自由贸易期间关税全额减免，档位在改行其他贸易法后生效。</p>}
            {commercialLaw === "许可贸易" && <fieldset>
              <legend>授予进出口许可</legend>
              <p>朝贡贸易伙伴可按既有关系通商。</p>
              <div className="group-grid">
                {Object.values(scenario.countries).filter(({ id }) => id !== playerId).map(({ id, name }) => (
                  <label key={id}>
                    <input type="checkbox" checked={nation.tradePartners.includes(id)} disabled={busy}
                      onChange={(event) => send({ type: "setTradePartner", countryId: playerId, partnerId: id, allowed: event.target.checked })} />
                    {name}
                  </label>
                ))}
              </div>
            </fieldset>}
          </details>}
          <CommodityDetails scenario={scenario} game={game} report={report} countryId={marketId}
            onInspect={() => { if (marketId === playerId) onCommodityOpen(); }} />
          <div className="economy-table">
            <table aria-label={`${country.name}商品供需`}>
              <thead>
                <tr>
                  <th scope="col">商品</th>
                  <th scope="col">周市场供给</th>
                  <th scope="col">周需求</th>
                  <th scope="col">参考价</th>
                  <th scope="col">成交</th>
                  <th scope="col">未满足</th>
                </tr>
              </thead>
              <tbody>
                {goods.map((good) => {
                  const { demand, supply, price, traded, targetPrice } = market[good];
                  const unmet = traded === undefined ? undefined : demand - traded;
                  return (
                    <tr key={good}>
                      <th scope="row">{industries[good].goodName}</th>
                      <td>{count(supply)}</td>
                      <td>{count(demand)}</td>
                      <td>
                        {silver(price)}
                        {targetPrice !== undefined && <><br /><small>目标 {silver(targetPrice)}</small></>}
                      </td>
                      <td>{traded === undefined ? "未记录" : count(traded)}</td>
                      <td className={unmet ? "shortage" : undefined}>{unmet === undefined ? "未记录" : count(unmet)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        {selectedId !== null && (
          <StateIndustry
            onPopulationOpen={onPopulationOpen}
            scenario={scenario}
            game={game}
            playerId={playerId}
            stateId={selectedId}
            report={report}
            busy={busy}
            send={send}
          />
        )}
      </div>
      <section className="panel" aria-labelledby="queue-title">
        <header className="panel-header">
          <h3 id="queue-title">建设队列</h3>
          <span>两类队列共享建造力，空余份额流向另一队列</span>
        </header>
        <div className="queue-grid">
          {(["政府", "私人"] as const).map((kind) => {
            const queue =
              kind === "政府" ? game.countryEconomies[marketId].queue : game.nations[marketId].privateQueue;
            return (
              <div className="country-queue" key={kind}>
                <h4>
                  {country.name} · {kind}
                </h4>
                {queue.length ? (
                  <ol>
                    {queue.map((job, i) => (
                      <li key={i}>
                        {scenario.states[job.stateId].name} ·{" "}
                        {projectName(job.good)}{job.levels && ` × ${job.levels}`} ·
                        余 {remainingProjectPoints(job).toFixed(2)} 点
                        {marketId === playerId && <button disabled={busy} onClick={() => send({
                          type: "cancelConstruction", countryId: playerId, index: i, stateId: job.stateId, good: job.good,
                          privateBuild: kind === "私人",
                        })}>取消</button>}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>暂无工程</p>
                )}
              </div>
            );
          })}
        </div>
        <p className="save-notice">
          本周可用建造力 {report.countries[marketId].capacity.toFixed(2)} 点 · 私人份额{" "}
          {100 * privateShareOf(game.nations[marketId])}%
        </p>
        {report.countries[marketId].construction && <dl className="economy-stats">
          {(["public", "private"] as const).map((sector) => {
            const bill = report.countries[marketId].construction![sector];
            return <div key={sector}>
              <dt>{sector === "public" ? "政府施工" : "私人施工"}</dt>
              <dd>工资 {silver(bill.wages)} · 建材 {silver(bill.materials)} · {bill.points.toFixed(2)} 点</dd>
            </div>;
          })}
        </dl>}
        {report.countries[marketId].constructionMaintenance && <p className="save-notice">
          施工维护 {count(report.countries[marketId].constructionMaintenance.workers)} 人 ·
          工资 {silver(report.countries[marketId].constructionMaintenance.wages)} ·
          工具 {count(report.countries[marketId].constructionMaintenance.tools)} 件，实付 {silver(report.countries[marketId].constructionMaintenance.materials)}
        </p>}
      </section>
    </section>
  );
}
