# AGENTS.md

## 项目目标

- 王国史诗是一个从 1820 年开局的浏览器大战略游戏，核心是人口与经济模拟，以及政治、科技、外交和战争之间的相互影响。
- 本地单机 Demo 已完成。默认使用 1820 世界剧本，可从 29 个国家中选国，在包含 660 个州的地图上游玩。玩家控制一个国家，其余国家由规则 AI 操作。通过 `localhost` 试玩，模拟和存档在浏览器中运行。
- 当前目标是在现有 Demo 上逐步改进功能。根据试玩发现的问题和反馈，分批完善机制、平衡数值、改进 AI 决策和界面交互。用现有世界剧本检验改动及其对相关系统的影响。

## 技术约定

- 使用 React、Vite 和 TypeScript，地图用 PixiJS，浏览器存档用 IndexedDB。优先保持本地启动流程简单。
- 模拟引擎是独立的 TypeScript 模块。React 和 PixiJS 读取游戏状态并发送指令。玩家和 AI 通过同一个指令接口更新状态，使用相同的规则校验。
- 游戏开局暂停，支持按天、周、半年推进。所有推进跨度共用同一套日步进。经过周结算点时执行经济、人口和建设结算，并保持结算顺序明确。使用可复现的随机种子，存档带版本，读档后能继续推进。
- 静态剧本数据、运行中的游戏状态和地图几何分别读取和维护。地图着色以游戏状态里的州归属为准，据此反映和约及领土变化。

## 地图和剧本数据

- `resources/victoria3_1820_states.geojson` 包含 660 个州的几何和初始归属。坐标使用原图的 `1200 × 575` 平面坐标，读取时支持 `Polygon` 和 `MultiPolygon`。
- `resources/1820_game_data.json` 提供 1820 年的国家列表和 544 个州的初始归属。其余 116 个地图要素按未分配处理。用 GeoJSON 的 `properties.id` 关联州数据，保留既有州和国家 ID。可将地图的初始 `countryId` 映射为游戏状态中的 `ownerId`。
- `resources/victoria3_1820_colored.svg` 用于核对边界和初始着色。保留原始地图文件。剧本通过稳定 ID 引用州。人口、资源和产业初始值作为剧本数据维护，注明历史依据或平衡假设。

## 迭代与验收

- 每次迭代明确要解决的问题、预期的可试玩结果和验收步骤。改动涉及多个系统时，核对相关结算、玩家操作和 AI 行为。
- 以现有 Demo 为回归基线。根据改动范围，核对受影响的选国、地图交互、日期推进、周结算及存档续玩流程。已有机制和试玩步骤见 [MECHANICS.md](MECHANICS.md)。
- 交付时说明启动方式、验证结果和仍需人工确认的步骤。

## GitHub 协作

- 共用 [jcw690290/WangGuoShiShi](https://github.com/jcw690290/WangGuoShiShi)，默认分支为 `main`。保持 `main` 可运行。各自从最新的 `main` 创建功能分支，例如 `feature/map-interaction` 或 `feature/construction`。
- 当前由项目发起人在本地用 Codex 逐项实现并试玩。朋友参与时，可按功能分工，地图和界面、模拟和 AI 可以并行。涉及州或国家 ID、公共指令、结算顺序或存档格式时，先对齐接口和验收方法。
- 用 GitHub Issue 或 PR 描述记录目标和验收步骤。功能验证后开 PR，由另一人检查或试玩再合并。PR 写清改动、验证命令和需要联动的接口变化。

## Coding Style: Fail Fast, No Defensive Bloat

Follow a strict **Fail-Fast** and **Validate-at-Boundaries** philosophy. Do NOT write defensive code that masks bugs or duplicates type-system guarantees.

### 1. Trust Internal Contracts & Types
- **Do not re-validate** arguments, object shapes, or non-null invariants inside internal functions when they are already guaranteed by the type system or validated at the entry point.
- **No speculative null checks**: Do not add `if (!x) return`, optional chaining (`?.`), or fallback defaults (`?? []`, `|| ""`) for values that *must* exist by design. If an invariant is violated, let it throw immediately.

### 2. Validate Strictly at System Boundaries
- Perform schema/input validation **only** at I/O boundaries: HTTP/RPC handlers, CLI args, environment variables, database/file reads, and third-party API responses.
- Once data crosses the boundary into core business logic, treat it as trusted and valid.

### 3. Never Swallow Errors
- **No broad `try/catch` blocks** around business logic.
- **Never catch an error just to log it and return `null`, `false`, `[]`, or `{}`.**
- Only catch an exception when you have a concrete recovery strategy (e.g., retry a transient network error, translate to a domain/HTTP error at the boundary). Otherwise, let the exception propagate.

### 4. No Unrequested Fallbacks or Shims
- Do not add backward-compatibility fallbacks, dual-path parsing, or silent retries unless explicitly requested in the prompt.
- One clear code path is preferred over multiple speculative fallbacks.

### Examples

**BAD (Defensive — hides bugs and adds noise):**
```ts
function calculateTotal(order: Order): number {
  try {
    if (!order || !Array.isArray(order.items)) {
      return 0; // Silently masks a broken caller or invalid state
    }
    return order.items.reduce((sum, item) => sum + (item?.price ?? 0), 0);
  } catch (e) {
    console.error("Failed to calculate total", e);
    return 0;
  }
}
```

**GOOD (Fail-Fast — trusts types and surfaces bugs immediately):**
```ts
function calculateTotal(order: Order): number {
  return order.items.reduce((sum, item) => sum + item.price, 0);
}
```
