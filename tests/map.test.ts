import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createGame } from "../src/game/engine.ts";
import {
  constrain,
  fitView,
  focusAt,
  MapGesture,
  pan,
  resizeView,
  scaleOf,
  worldPoint,
  zoomAt,
} from "../src/map/viewport.ts";
import { hitState } from "../src/map/hitTest.ts";
import { countryLabels, mapEdges, paperColor } from "../src/map/cartography.ts";
import type { StateGeometry } from "../src/map/geometry.ts";
import { scenario } from "../src/scenario/scenario.ts";

const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const square = (x: number, y: number, size: number): [number, number][] => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
  [x, y],
];
const geometry: StateGeometry = {
  a: [[square(0, 0, 10), square(2, 2, 2)]],
  b: [[square(10, 0, 10)], [square(30, 0, 4)]],
};

test("视野夹紧、全图居中、缩放限值、定位与窗口变化", () => {
  const v = fitView(600, 400);
  close(v.x, 0);
  close(v.y, 56.25);
  assert.equal(zoomAt(v, 1000, { x: 300, y: 200 }).zoom, 16);
  assert.deepEqual(zoomAt(v, 0.001, { x: 17, y: 68 }), v);
  const z = focusAt(v, { x: 600, y: 287.5 }, 4);
  assert.equal(pan(z, 10000, 10000).x, 0);
  const edge = pan(z, -10000, -10000);
  close(edge.x, z.width - 1200 * scaleOf(z));
  close(edge.y, z.height - 575 * scaleOf(z));
  assert.deepEqual(constrain(constrain(edge)), edge);
  const resized = resizeView(z, 800, 500),
    center = worldPoint(resized, { x: 400, y: 250 });
  close(center.x, 600);
  close(center.y, 287.5);
});

test("捏合以移动中点为锚，夹紧前保持同一世界点", () => {
  const initial = focusAt(fitView(600, 400), { x: 600, y: 287.5 }, 3);
  const g = new MapGesture(initial);
  const anchor = worldPoint(initial, { x: 300, y: 200 });
  g.down(7, { x: 250, y: 200 });
  g.down(12, { x: 350, y: 200 });
  g.move(7, { x: 240, y: 220 });
  g.move(12, { x: 400, y: 220 });
  close(g.view.zoom, 4.8);
  const after = worldPoint(g.view, { x: 320, y: 220 });
  close(after.x, anchor.x);
  close(after.y, anchor.y);
  assert.equal(g.up(7, { x: 240, y: 220 }), null);
  const before = g.view;
  g.move(12, { x: 410, y: 230 });
  close(g.view.x, before.x + 10);
  close(g.view.y, before.y + 10);
  assert.equal(g.up(12, { x: 410, y: 230 }), null);
});

test("拖出又回原地、多指切换、取消与丢失捕获不能误选", () => {
  const g = new MapGesture(focusAt(fitView(600, 400), { x: 600, y: 287.5 }, 4));
  g.down(1, { x: 100, y: 100 });
  g.move(1, { x: 140, y: 130 });
  g.move(1, { x: 100, y: 100 });
  assert.equal(g.up(1, { x: 100, y: 100 }), null);
  g.down(1, { x: 100, y: 100 });
  g.down(2, { x: 200, y: 100 });
  g.down(3, { x: 300, y: 100 });
  const before = g.view;
  g.move(3, { x: 320, y: 120 });
  assert.deepEqual(g.view, before);
  assert.equal(g.up(1, { x: 100, y: 100 }), null);
  const replaced = g.view;
  g.move(2, { x: 200, y: 100 });
  assert.deepEqual(g.view, replaced);
  g.cancel(3);
  g.cancel(2);
  g.cancel(99);
  g.down(10, { x: 50, y: 60 });
  assert.deepEqual(g.up(10, { x: 52, y: 61 }), {
    start: { x: 50, y: 60 },
    end: { x: 52, y: 61 },
  });
  g.cancel(10); // Normal lostpointercapture after up is harmless.
  g.down(11, { x: 50, y: 60 });
  g.cancel(11);
  assert.equal(g.up(11, { x: 50, y: 60 }), null);
});

test("两指重合、非活动指针及滚轮中断不会产生无穷视野或点击", () => {
  const g = new MapGesture(fitView(600, 400));
  g.down(1, { x: 100, y: 100 });
  g.down(2, { x: 100, y: 100 });
  g.move(2, { x: 120, y: 100 });
  g.move(2, { x: 140, y: 100 });
  assert.ok(Object.values(g.view).every(Number.isFinite));
  const before = g.view;
  g.move(999, { x: 0, y: 0 });
  assert.deepEqual(g.view, before);
  g.cancel(2);
  g.setView(zoomAt(g.view, 1.25, { x: 300, y: 200 }));
  assert.equal(g.up(1, { x: 100, y: 100 }), null);
});

test("夹紧边界后反向拖动立即跟手，不需走回越界距离", () => {
  const g = new MapGesture(focusAt(fitView(600, 400), { x: 600, y: 287.5 }, 4));
  g.down(1, { x: 100, y: 100 });
  g.move(1, { x: 10000, y: 10000 });
  close(g.view.x, 0);
  close(g.view.y, 0);
  g.move(1, { x: 9990, y: 9980 });
  close(g.view.x, -10);
  close(g.view.y, -20);
  assert.equal(g.up(1, { x: 9990, y: 9980 }), null);
});

test("真实 660 州几何中的所有国家标签锚点均在本国领土内", () => {
  const features = JSON.parse(
    readFileSync(
      new URL("../resources/victoria3_1820_states.geojson", import.meta.url),
      "utf8",
    ),
  ).features as {
    properties: { id: string };
    geometry: { type: string; coordinates: unknown };
  }[];
  const geo = Object.fromEntries(
    features.map((f) => [
      f.properties.id,
      f.geometry.type === "Polygon"
        ? [f.geometry.coordinates]
        : f.geometry.coordinates,
    ]),
  ) as StateGeometry;
  const owners = createGame(scenario).ownerByStateId;
  const labels = countryLabels(scenario, owners, geo);
  assert.equal(labels.length, 29);
  for (const label of labels) {
    const state = hitState(geo, { x: label.position[0], y: label.position[1] });
    assert.notEqual(state, null);
    assert.equal(owners[state!], label.owner);
  }
});

test("命中测试遵守 Polygon 洞与 MultiPolygon，洞边缘不可选", () => {
  assert.equal(hitState(geometry, { x: 1, y: 1 }), "a");
  assert.equal(hitState(geometry, { x: 3, y: 3 }), null);
  assert.equal(hitState(geometry, { x: 2, y: 3 }), null);
  assert.equal(hitState(geometry, { x: 0, y: 0 }), "a");
  assert.equal(hitState(geometry, { x: 32, y: 2 }), "b");
  assert.equal(hitState(geometry, { x: 50, y: 50 }), null);
  const shared = mapEdges(geometry).filter((e) => e.states.length === 2);
  assert.equal(shared.length, 1);
  assert.deepEqual(shared[0].states, ["a", "b"]);
});

test("复古配色合法，国名只出现在现有归属最大连通领土上", () => {
  assert.match(paperColor("#00ff33"), /^#[0-9a-f]{6}$/);
  const ids = ["Guangxi", "Yunnan", "Tonkin"],
    geo = Object.fromEntries(
      ids.map((id, i) => [id, [[square(i * 10, 0, 10)]]]),
    ) as StateGeometry;
  const owners = {
    Guangxi: "country_01",
    Yunnan: "country_01",
    Tonkin: "country_26",
  };
  const labels = countryLabels(scenario, owners, geo);
  assert.equal(labels.length, 2);
  for (const label of labels) {
    const id = hitState(geo, { x: label.position[0], y: label.position[1] })!;
    assert.equal(owners[id as keyof typeof owners], label.owner);
  }
  assert.deepEqual(
    countryLabels(
      scenario,
      { Guangxi: "country_26", Yunnan: "country_26", Tonkin: "country_26" },
      geo,
    ).map((l) => l.owner),
    ["country_26"],
  );
});
