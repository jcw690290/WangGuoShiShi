import { GameRuleError } from "./rules.ts";
import type { GameState } from "./engine.ts";
import type { EconomyReport } from "./economy.ts";
import { institutionLawDetails, institutionRequiredTech, technologyName } from "./institutions.ts";
import { laborLawCategory, laborLawTechnology } from "./labor.ts";
import { isTaxLaw } from "./taxation.ts";
import { isTradeLaw } from "./trade-policy.ts";
import { civicLawCategory, civicLawOf, civicPolicy } from "./civic-policy.ts";
import { constitutionLawCategory, representationLaw, stateForm } from "./constitution.ts";
import { governanceLaw, isGovernanceLaw } from "./governance.ts";
import { economicLaw, isEconomicLaw } from "./ownership.ts";
import { isOpiumLaw, opiumLaw } from "./opium.ts";
import { isMilitaryServiceLaw, militaryServiceLaw } from "./military-service.ts";
import { groups, influence, literacyOf, reformConditions, reformConsultationDays, reformStage, reformWork, techs, unrestOf } from "./society.ts";
import type { Group, Law, Nation, SiteSocial, Tech } from "./society.ts";

export const textileResearch = { outputBonus: 25, weeks: 4 };
export const researchCategory = {
  纺织工艺: "生产",
  野战后勤: "军事",
  公共教育: "社会",
  机械织造: "生产",
  运输调度: "军事",
  高等教育: "社会",
  蒸汽动力: "生产",
  铁路: "生产",
  规模化钢铁: "生产",
  电气化: "生产",
  内燃机: "生产",
  公共卫生: "社会",
  劳工保障: "社会",
  社会保障: "社会",
  大众政治: "社会",
  现代税制: "社会",
  常备军组织: "军事",
  线列训练: "军事",
  后膛装备: "军事",
  参谋组织: "军事",
  连发装备: "军事",
  现代火炮: "军事",
  装甲舰艇: "军事",
  机械化组织: "军事",
  农业改良: "生产",
  机械工具: "生产",
  先进材料: "生产",
  官僚改良: "社会",
} as const;
const categories = ["生产", "军事", "社会"] as const;
const prerequisite: Partial<Record<Tech, Tech>> = {
  机械织造: "纺织工艺",
  运输调度: "野战后勤",
  高等教育: "公共教育",
  蒸汽动力: "机械织造",
  铁路: "蒸汽动力",
  规模化钢铁: "铁路",
  电气化: "规模化钢铁",
  内燃机: "电气化",
  公共卫生: "高等教育",
  劳工保障: "高等教育",
  社会保障: "劳工保障",
  大众政治: "劳工保障",
  现代税制: "公共教育",
  线列训练: "常备军组织",
  后膛装备: "线列训练",
  参谋组织: "常备军组织",
  连发装备: "后膛装备",
  现代火炮: "后膛装备",
  装甲舰艇: "规模化钢铁",
  机械化组织: "连发装备",
  机械工具: "机械织造",
  先进材料: "电气化",
};
const technologyEras: Partial<Record<Tech, 0 | 1 | 2 | 3>> = {
  常备军组织: 0, 线列训练: 0, 后膛装备: 1, 参谋组织: 1, 连发装备: 2, 现代火炮: 2,
  装甲舰艇: 2, 机械化组织: 3, 农业改良: 0, 机械工具: 1, 先进材料: 3, 官僚改良: 0,
};
const eraCosts = [4000, 10000, 22000, 45000];
const eraYears = [1820, 1850, 1880, 1910];
export function availableTech(n: Nation, t: Tech) {
  const prior = prerequisite[t];
  return n.knowledge[t] < 100 && (!prior || n.knowledge[prior] === 100) &&
    (t !== "机械化组织" || n.knowledge["内燃机"] === 100);
}
export function researchCost(tech: Tech, year: number) {
  const era = technologyEras[tech];
  if (era !== undefined)
    return Math.round(eraCosts[era] * (1 + 0.02 * Math.max(0, eraYears[era] - year)));
  const advanced = prerequisite[tech] !== undefined;
  const late = tech === "规模化钢铁" || tech === "电气化" || tech === "公共卫生" || tech === "劳工保障" || tech === "大众政治";
  const modern = tech === "内燃机" || tech === "社会保障";
  const referenceYear = modern ? 1910 : late ? 1880 : advanced ? 1850 : 1820;
  const base = modern ? 45_000 : late ? 22_000 : advanced ? 10_000 : 4_000;
  return Math.round(base * (1 + 0.02 * Math.max(0, referenceYear - year)));
}
export function researchCapacity(staff: number, literacy: number) {
  return { innovation: staff / 10, cap: 30 + 1.7 * literacy };
}
export const techEffect: Record<Tech, string> = {
  纺织工艺: "布匹产出 +25%",
  机械织造: "布匹产出再增加 15%",
  野战后勤: "有效战力 +25%",
  运输调度: "前线运输容量 +30%",
  公共教育: "解锁《公共学校》；由实际师资、教具和服务支持识字与职业培养",
  高等教育: "解锁《普及教育》；大学的实付教学岗位支持研究和专业培养",
  蒸汽动力: "研究铁路的前置技术",
  铁路: "允许建设铁路，改善市场接入和陆运",
  规模化钢铁: "研究电气化的前置技术",
  电气化: "允许发电设施及工具厂、钢铁厂的电动改造",
  内燃机: "允许开采石油，商船装设辅助内燃机",
  公共卫生: "解锁《公共诊疗》和《普及医疗》",
  劳工保障: "解锁《公共救济》",
  社会保障: "解锁《社会保险》",
  大众政治: "解锁《妇女平等权》",
  现代税制: "解锁比例、累进所得税和消费税制",
  常备军组织: "陆军改编与新兵营训练缩短为 10 周，允许提出义务兵役法",
  线列训练: "解锁步兵与骑兵的线列训练方案",
  后膛装备: "解锁步兵与骑兵的后膛装备",
  参谋组织: "每级将领指挥上限由 300 提至 400 人",
  连发装备: "解锁步兵与骑兵的连发装备",
  现代火炮: "解锁炮兵的现代火炮",
  装甲舰艇: "解锁使用更多船材建造和维护的装甲舰",
  机械化组织: "需要内燃机与连发装备，解锁使用石油和橡胶的机械化步兵",
  农业改良: "解锁粮食、副食品、纤维和经济作物的机械化工序",
  机械工具: "解锁其他商业产业的机械化工序",
  先进材料: "解锁各产业的先进工序，通常需要州内发电",
  官僚改良: "解锁行政档案室改造，每级行政办事处可多容纳 50 个实际行政岗位",
};
export const lawEffect: Record<Law, string> = {
  工资税改革: "沿用 14% 工资税与 5% 经营所得税",
  干预主义: "私人建造份额 50%，基础再投资比例 25%",
  自由放任: "私人建造份额 75%，基础再投资比例 40%",
  国家主导: "投资池建造份额 20%，私人和土地所有收益基础再投资 10%",
  合作经济: "投资池建造份额 50%，其新项目为合作所有，合作收益再投资 15%",
  平等公民权: "接纳所有文化",
  信仰自由: "接纳所有信仰",
  普选制: "上、中、下层政治权重为 1.5、1.2、1，权威力减少 20",
  出版自由: "科技扩散按 100% 计算，政治运动组织力提高 20%",
  地主租佃: "自给农业出售余粮和木材所得的 20% 归土地所有者",
  小农自耕: "自给农业出售余粮和木材所得全部归农户",
  地方教育: "允许各州设置最高 1 级学校",
  公共学校: "允许各州设置最高 2 级学校",
  普及教育: "允许各州设置最高 3 级学校",
  地方诊疗: "允许各州设置最高 1 级医疗机构",
  公共诊疗: "允许各州设置最高 2 级医疗机构",
  普及医疗: "允许各州设置最高 3 级医疗机构",
  地方救济: "允许各州设置最高 1 级福利机构",
  公共救济: "允许各州设置最高 2 级福利机构",
  社会保险: "允许各州设置最高 3 级福利机构",
  自由劳动: "解除农村劳力的转职与征用限制",
  奴隶制: "限制 22% 农村人口对应劳力的职业流动，降低其政治参与",
  农奴制: "限制 45% 农村人口对应劳力的职业流动，降低其政治参与",
  身份劳役: "限制 25% 农村人口对应劳力的职业流动，降低其政治参与",
  普通雇佣: "产业普通岗位周薪为 100 银",
  工时与工伤保障: "产业普通岗位周薪为 115 银，减轻有工作的劳工不满",
  集体劳动保障: "产业普通岗位周薪为 125 银，进一步减轻有工作的劳工不满",
  传统性别分工: "州劳动力参与率逐步趋向 40%",
  妇女就业权: "州劳动力参与率逐步趋向 46%",
  妇女平等权: "州劳动力参与率逐步趋向 52%，提高中下层政治参与权重",
  传统土地身份税: "农民和劳工 8%，土地所有者 18%，其他 10%",
  比例所得税: "各职业按实际所得统一征收 15%",
  累进所得税: "下、中、上层分别按实际所得征收 10%、18%、28%",
  消费税制: "按实际所得征收 5%，另对选定的可选消费品征收 10%",
  贸易保护: "按进口国关税档位对实际进口计征",
  自由贸易: "进口关税全额减免",
  许可贸易: "普通进出口限已获通商许可的对象或朝贡贸易伙伴",
  本族公民权: "本国文化享有完整公民待遇",
  有限公民权: "本国及州亲近度达到 50 的文化享有完整待遇，其他文化享有限待遇",
  国教优先: "国教信徒享有完整宗教待遇",
  宗教宽容: "国教信徒享有完整待遇，其他信仰享有限待遇",
  出版审查: "科技扩散按 65% 计算，政治运动没有额外组织增益",
  有限出版: "科技扩散按 85% 计算，政治运动组织力提高 10%",
  君主制: "世袭继承的合法性来自地主、教会和武装部队，基础权威力 100",
  共和制: "非选举任命的合法性来自小市民、实业家和知识分子，基础权威力 75",
  教权政体: "非选举继任的合法性来自教会和地主，基础权威力 110",
  专制统治: "上、中、下层政治权重为 6、2、0.2，权威力增加 20",
  有限选举: "上、中、下层政治权重为 4、2、0.6，合法性参考选举授权",
  复合辖区制: "依辖区类型分配税权、军役和行政费用",
  中央集权: "边疆中央税收份额提至 90%，行政与整合岗位需求增加 15%，限制新设间接辖区",
  地方自治: "中央税收份额最高 80%，中央征用额度降至原来的 80%，行政与整合岗位需求降低 15%，限制新设殖民辖区",
  殖民特许: "殖民辖区中央税收份额提高至 75%，征用份额降至 65%，提高当地行政与整合成本",
  鸦片许可经营: "允许医疗采购和家庭购买，国内产业与对外贸易照常",
  鸦片限医疗: "仅开放医疗机构采购，允许合法生产与贸易",
  鸦片禁令: "暂停合法生产、建设、贸易与采购，地方依赖继续按周恢复",
  地方民兵: "每级兵营 70 名常备军，每级征兵中心最多 400 名预备役，基础动员 42 天",
  职业常备军: "每级兵营 100 名常备军，每级征兵中心最多 500 名预备役，基础动员 28 天",
  义务兵役: "每级兵营 100 名常备军，每级征兵中心最多 750 名预备役，基础动员 21 天",
};

function exclusiveLawCategory(law: Law) {
  return institutionLawDetails(law)?.kind ?? laborLawCategory(law) ?? civicLawCategory(law) ?? constitutionLawCategory(law) ??
    (isTaxLaw(law) ? "tax" : isTradeLaw(law) ? "trade" : isGovernanceLaw(law) ? "governance" :
      isEconomicLaw(law) ? "economy" : isOpiumLaw(law) ? "opium" : isMilitaryServiceLaw(law) ? "militaryService" :
      law === "小农自耕" || law === "地主租佃" ? "land" : undefined);
}
export type PoliticsCommand =
  | { type: "setGovernment"; countryId: string; government: Group[] }
  | { type: "proposeLaw"; countryId: string; law: Law }
  | { type: "compromiseReform"; countryId: string }
  | { type: "withdrawReform"; countryId: string }
  | { type: "startResearch"; countryId: string; tech: Tech };
export function ownedSocieties(state: GameState, id: string) {
  return Object.keys(state.societies)
    .filter((s) => state.ownerByStateId[s] === id)
    .map((s) => state.societies[s]);
}
export function politicsError(state: GameState, command: PoliticsCommand) {
  const id = command.countryId,
    nation = state.nations[id];
  if (!nation || state.playerCountryId === null) return "请先选择剧本内国家";
  if (command.type === "compromiseReform" || command.type === "withdrawReform") {
    if (nation.reform === null) return "当前没有改革议案";
    if (command.type === "withdrawReform") return;
    if (nation.reformConsultation) return "该议案已安排过协商";
    if (reformStage(nation.reformProgress) !== "debate") return "只能在争论修正阶段协商";
    const sites = ownedSocieties(state, id);
    const conditions = reformConditions(nation, influence(sites, id, nation), nation.reform,
      unrestOf(sites.flatMap((site) => site.pops)), state.elapsedDays);
    if (!conditions.disputed) return "当前立法阻力较低";
    return;
  }
  if (command.type === "setGovernment") {
    if (
      !command.government.length ||
      new Set(command.government).size !== command.government.length ||
      !command.government.every((g) => groups.includes(g))
    )
      return "政府需要不重复的利益集团";
  } else if (command.type === "startResearch") {
    if (nation.research !== null || !availableTech(nation, command.tech))
      return "已有研究、缺少前置技术或已经掌握该技术";
  } else {
    const civicCategory = civicLawCategory(command.law);
    const constitution = constitutionLawCategory(command.law);
    const currentConstitution = constitution === "stateForm" ? stateForm(nation) :
      constitution === "representation" ? representationLaw(nation) : undefined;
    if (nation.reform !== null || nation.laws.includes(command.law) ||
        currentConstitution === command.law ||
        (isGovernanceLaw(command.law) && governanceLaw(nation.laws) === command.law) ||
        (isEconomicLaw(command.law) && economicLaw(nation.laws) === command.law) ||
        (isOpiumLaw(command.law) && opiumLaw(nation.laws) === command.law) ||
        (isMilitaryServiceLaw(command.law) && militaryServiceLaw(nation.laws) === command.law) ||
        (civicCategory && civicLawOf(nation.laws, civicCategory) === command.law)) return "已有议案或该法已生效";
    const institution = institutionLawDetails(command.law);
    const modernTax = isTaxLaw(command.law) && command.law !== "传统土地身份税" && command.law !== "工资税改革";
    const technology = command.law === "义务兵役" ? "常备军组织" : modernTax ? "现代税制" :
      institution ? institutionRequiredTech(institution.kind, institution.level) : laborLawTechnology[command.law];
    if (technology && nation.knowledge[technology] !== 100) return `立项需要掌握${technologyName(technology)}技术`;
    const sites = ownedSocieties(state, id);
    const power = influence(sites, id, nation);
    if (!reformConditions(nation, power, command.law, unrestOf(sites.flatMap((site) => site.pops))).speed)
      return "需要政府集团或政治运动支持，并达到 25 合法性";
  }
}
export function applyPolitics(state: GameState, command: PoliticsCommand): GameState {
  const error = politicsError(state, command);
  if (error) throw new GameRuleError(error);
  const nation = state.nations[command.countryId];
  let change: Partial<Nation>;
  switch (command.type) {
    case "setGovernment": change = { government: command.government }; break;
    case "startResearch": change = { research: command.tech }; break;
    case "proposeLaw": change = { reform: command.law, reformProgress: 0 }; break;
    case "withdrawReform": change = { reform: null, reformProgress: 0, reformConsultation: undefined }; break;
    case "compromiseReform": change = { reformConsultation: {
      law: nation.reform!, endsDay: state.elapsedDays + reformConsultationDays,
    } }; break;
  }
  return {
    ...state,
    nations: { ...state.nations, [command.countryId]: { ...nation, ...change } },
  };
}
export function advancePolitics(state: GameState, report: EconomyReport, year: number, yearFraction: number): GameState {
  const known = techs.filter((t) => Object.values(state.nations).some((n) => n.knowledge[t] === 100));
  const nations: Record<string, Nation> = {};
  const locals: Record<string, SiteSocial[]> = Object.fromEntries(
    Object.keys(state.nations).map((id) => [id, []]),
  );
  const staff = Object.fromEntries(Object.keys(state.nations).map((id) => [id, 0]));
  for (const [id, site] of Object.entries(state.societies)) {
    const owner = state.ownerByStateId[id];
    locals[owner].push(site);
    staff[owner] += report.states[id].universityStaff!;
  }
  for (const [id, previous] of Object.entries(state.nations)) {
    const nation = {
      ...previous,
      knowledge: { ...previous.knowledge },
      diffusion: { ...previous.diffusion },
    };
    if (nation.pendingPublicPay) {
      nation.publicPay = nation.pendingPublicPay;
      delete nation.pendingPublicPay;
    }
    const sites = locals[id],
      people = sites.flatMap((s) => s.pops);
    if (people.length) {
      const literacy = literacyOf(people);
      const { innovation, cap } = researchCapacity(staff[id], literacy);
      const spreading = categories.map((category) => known.find((tech) =>
        researchCategory[tech] === category && availableTech(previous, tech),
      )).filter((tech) => tech !== undefined);
      const spillover = spreading.length > 0 ? Math.max(0, innovation - cap) * 0.5 / spreading.length : 0;
      const publication = civicPolicy(nation.laws);
      for (const tech of techs) {
        const cost = researchCost(tech, year);
        const diffusion = spreading.includes(tech)
          ? (5 + 0.15 * literacy + spillover) * publication.diffusion : 0;
        const active = nation.research === tech ? Math.min(innovation, cap) : 0;
        nation.diffusion[tech] = Math.min(100 - nation.knowledge[tech], 100 * diffusion / cost);
        nation.knowledge[tech] = Math.min(100, nation.knowledge[tech] + nation.diffusion[tech] + 100 * active / cost);
        if (nation.research === tech && nation.knowledge[tech] === 100) nation.research = null;
      }
      if (nation.reform) {
        nation.reformProgress += reformConditions(nation, influence(sites, id, nation), nation.reform,
          unrestOf(people), state.elapsedDays).speed;
        if (nation.reformProgress >= reformWork - 1e-9) {
          const reform = nation.reform;
          const category = exclusiveLawCategory(reform);
          const retained = category === undefined ? nation.laws :
            nation.laws.filter((law) => exclusiveLawCategory(law) !== category);
          nation.laws = [...retained, reform];
          nation.reform = null;
          nation.reformProgress = 0;
          delete nation.reformConsultation;
        }
      }
    }
    nation.infamy = Math.max(0, nation.infamy - 2 * yearFraction);
    nations[id] = nation;
  }
  return { ...state, nations };
}
export function getEconomicRules(nation: Nation) {
  return {
    wageTaxRate: nation.laws.includes("工资税改革") ? 14 : 10,
    clothOutputBonus:
      (nation.knowledge["纺织工艺"] === 100 ? 25 : 0) + (nation.knowledge["机械织造"] === 100 ? 15 : 0),
  };
}
