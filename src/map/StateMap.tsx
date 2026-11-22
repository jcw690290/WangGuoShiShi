import { Application, Container, Graphics, Text } from "pixi.js";
import { useEffect, useRef, useState } from "react";
import type { GameState } from "../game/engine.ts";
import { atlas } from "../scenario/scenario.ts";
import type { Scenario } from "../scenario/scenario.ts";
import type { StateGeometry } from "./geometry.ts";
import {
  countryLabels,
  mapEdges,
  countryColor,
  UNCLAIMED_COLOR,
} from "./cartography.ts";
import { hitState } from "./hitTest.ts";
import {
  fitView,
  focusAt,
  MapGesture,
  pan,
  resizeView,
  scaleOf,
  worldPoint,
  zoomAt,
} from "./viewport.ts";
import type { Point } from "./viewport.ts";

interface Props {
  scenario: Scenario;
  geometry: StateGeometry;
  game: GameState;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

async function mountMap(
  host: HTMLDivElement,
  scenario: Scenario,
  geometry: StateGeometry,
  onSelect: Props["onSelect"],
) {
  const app = new Application();
  await app.init({
    antialias: true,
    autoDensity: true,
    resolution: Math.min(2, window.devicePixelRatio),
    backgroundAlpha: 0,
    autoStart: false,
  });
  const canvas = app.canvas;
  canvas.setAttribute("aria-hidden", "true");
  host.appendChild(canvas);
  const map = new Container({ eventMode: "none" });
  app.stage.addChild(map);
  const grid = new Graphics();
  for (let x = 0; x <= 1200; x += 100) grid.moveTo(x, 0).lineTo(x, 575);
  for (let y = 0; y <= 575; y += 100) grid.moveTo(0, y).lineTo(1200, y);
  grid.stroke({ color: "#8d7546", width: 0.5, alpha: 0.24 });
  map.addChild(grid);
  const shapes = new Map(
    Object.keys(geometry).map((id) => {
      const shape = new Graphics();
      map.addChild(shape);
      return [id, shape];
    }),
  );
  const borders = new Graphics(),
    names = new Container(),
    highlight = new Graphics();
  const edges = mapEdges(geometry);
  map.addChild(borders, names, highlight);
  const label = new Text({
    text: "",
    style: {
      fontFamily: "serif",
      fontSize: 15,
      fontWeight: "bold",
      fill: "#352817",
      stroke: { color: "#fff3d3", width: 4 },
    },
  });
  label.anchor.set(0.5, 1.3);
  map.addChild(label);
  const gesture = new MapGesture(fitView(host.clientWidth, host.clientHeight));
  const nationTexts: { text: Text; size: number }[] = [];
  let focus: string | null = null;
  const place = () => {
    const v = gesture.view,
      scale = scaleOf(v);
    map.scale.set(scale);
    map.position.set(v.x, v.y);
    label.scale.set(1 / scale);
    for (const { text, size } of nationTexts) {
      const screenSize = size * scale;
      text.visible = screenSize >= 9 || size >= 14;
      text.scale.set(
        Math.max(size >= 14 ? 12 : 0, Math.min(66, screenSize)) / (64 * scale),
      );
    }
    host.dataset.zoom = v.zoom.toFixed(3);
    host.dataset.offset = `${v.x.toFixed(2)},${v.y.toFixed(2)}`;
    canvas.style.cursor = gesture.pointers.size ? "grabbing" : "grab";
    app.render();
  };
  const controls = document.createElement("div");
  controls.className = "map-navigation";
  for (const [name, action] of [
    [
      "定位选中州",
      () => {
        if (focus) {
          const [x, y] = atlas[focus].label;
          gesture.setView(focusAt(gesture.view, { x, y }));
          place();
        }
      },
    ],
    [
      "全图",
      () => {
        gesture.setView(fitView(host.clientWidth, host.clientHeight));
        place();
      },
    ],
  ] as const) {
    const button = document.createElement("button");
    button.textContent = name;
    button.onclick = action;
    controls.appendChild(button);
  }
  host.appendChild(controls);
  const point = (e: PointerEvent | WheelEvent): Point => {
    const box = canvas.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  };
  const down = (e: PointerEvent) => {
    if (e.button !== 0) return;
    host.focus({ preventScroll: true });
    gesture.down(e.pointerId, point(e));
    canvas.setPointerCapture(e.pointerId);
    place();
  };
  const move = (e: PointerEvent) => {
    if (!gesture.pointers.has(e.pointerId)) return;
    gesture.move(e.pointerId, point(e));
    place();
  };
  const up = (e: PointerEvent) => {
    const tap = gesture.up(e.pointerId, point(e));
    if (canvas.hasPointerCapture(e.pointerId))
      canvas.releasePointerCapture(e.pointerId);
    place();
    if (tap) {
      const start = hitState(geometry, worldPoint(gesture.view, tap.start));
      const end = hitState(geometry, worldPoint(gesture.view, tap.end));
      if (start !== null && start === end) onSelect(start);
    }
  };
  const cancel = (e: PointerEvent) => {
    gesture.cancel(e.pointerId);
    place();
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    const delta =
      e.deltaY *
      (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? host.clientHeight : 1);
    gesture.setView(
      zoomAt(
        gesture.view,
        Math.exp(-Math.max(-240, Math.min(240, delta)) * 0.002),
        point(e),
      ),
    );
    place();
  };
  const keyboard = (e: KeyboardEvent) => {
    if (e.target !== host) return;
    const v = gesture.view,
      center = { x: v.width / 2, y: v.height / 2 };
    const actions: Record<string, () => void> = {
      ArrowLeft: () => gesture.setView(pan(v, 48, 0)),
      ArrowRight: () => gesture.setView(pan(v, -48, 0)),
      ArrowUp: () => gesture.setView(pan(v, 0, 48)),
      ArrowDown: () => gesture.setView(pan(v, 0, -48)),
      "+": () => gesture.setView(zoomAt(v, 1.25, center)),
      "=": () => gesture.setView(zoomAt(v, 1.25, center)),
      "-": () => gesture.setView(zoomAt(v, 0.8, center)),
      Home: () => gesture.setView(fitView(v.width, v.height)),
    };
    if (!Object.hasOwn(actions, e.key)) return;
    e.preventDefault();
    actions[e.key]();
    place();
  };
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", cancel);
  canvas.addEventListener("lostpointercapture", cancel);
  canvas.addEventListener("wheel", wheel, { passive: false });
  host.addEventListener("keydown", keyboard);
  const observer = new ResizeObserver(() => {
    const width = host.clientWidth,
      height = host.clientHeight;
    app.renderer.resize(width, height);
    gesture.setView(resizeView(gesture.view, width, height));
    place();
  });
  app.renderer.resize(host.clientWidth, host.clientHeight);
  observer.observe(host);
  let previousOwners: GameState["ownerByStateId"] | null = null,
    previousOccupation: string | null = null;
  return {
    draw(game: GameState, selectedId: string | null) {
      const d = game.borderDispute,
        occupation =
          d?.phase === "war" && d.progress >= 50 ? d.targetStateId : null;
      if (
        previousOwners === game.ownerByStateId &&
        focus === selectedId &&
        previousOccupation === occupation
      )
        return;
      if (previousOwners !== game.ownerByStateId) {
        for (const [id, shape] of shapes) {
          const owner = game.ownerByStateId[id];
          shape.clear();
          for (const [shell, ...holes] of geometry[id]) {
            shape
              .poly(shell.flat())
              .fill(
                owner
                  ? countryColor(scenario.countries[owner])
                  : UNCLAIMED_COLOR,
              );
            for (const hole of holes) shape.poly(hole.flat()).cut();
            shape
              .poly(shell.flat())
              .stroke({ color: "#65563a", width: 0.22, alpha: 0.45 });
          }
        }
        borders.clear();
        for (const { a, b, states } of edges)
          if (
            states.length === 1 ||
            states.some(
              (id) =>
                game.ownerByStateId[id] !== game.ownerByStateId[states[0]],
            )
          )
            borders.moveTo(a[0], a[1]).lineTo(b[0], b[1]);
        borders.stroke({
          color: "#665235",
          width: 1,
          pixelLine: true,
          alpha: 0.56,
        });
        for (const { text } of nationTexts) text.destroy();
        nationTexts.length = 0;
        for (const info of countryLabels(
          scenario,
          game.ownerByStateId,
          geometry,
        )) {
          const text = new Text({
            text: scenario.countries[info.owner].name,
            resolution: Math.min(2, window.devicePixelRatio),
            style: {
              fontFamily: "Noto Serif CJK SC, Songti SC, SimSun, serif",
              fontWeight: "bold",
              // Rasterize at screen-ready size, then scale down: zoomed labels stay sharp.
              fontSize: 64,
              letterSpacing: 3.2,
              fill: "#35351f",
              stroke: { color: "#f0e3bc", width: 2 },
            },
            alpha: 0.84,
          });
          text.anchor.set(0.5);
          text.position.set(...info.position);
          names.addChild(text);
          nationTexts.push({ text, size: info.size });
        }
      }
      highlight.clear();
      for (const id of new Set([occupation, selectedId]))
        if (id !== null) {
          for (const [shell, ...holes] of geometry[id]) {
            highlight.poly(shell.flat()).fill({
              color: id === selectedId ? "#fff3cc" : "#dd982e",
              alpha: 0.24,
            });
            for (const hole of holes) highlight.poly(hole.flat()).cut();
            highlight.poly(shell.flat()).stroke({
              color: id === selectedId ? "#fff7dc" : "#a96714",
              width: 1.3,
            });
          }
        }
      focus = selectedId;
      previousOwners = game.ownerByStateId;
      previousOccupation = occupation;
      label.visible = selectedId !== null;
      if (selectedId) {
        label.text = atlas[selectedId].name;
        label.position.set(...atlas[selectedId].label);
      }
      place();
    },
    destroy() {
      observer.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", cancel);
      canvas.removeEventListener("lostpointercapture", cancel);
      canvas.removeEventListener("wheel", wheel);
      host.removeEventListener("keydown", keyboard);
      for (const id of gesture.pointers.keys())
        if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
      gesture.pointers.clear();
      controls.remove();
      app.destroy({ removeView: true }, { children: true });
    },
  };
}
export function StateMap({
  scenario,
  geometry,
  game,
  selectedId,
  onSelect,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<Awaited<ReturnType<typeof mountMap>>>(null);
  const frame = useRef({ game, selectedId });
  const [error, setError] = useState<string>();
  useEffect(() => {
    frame.current = { game, selectedId };
    map.current?.draw(game, selectedId);
  }, [game, selectedId]);
  useEffect(() => {
    let disposed = false;
    void mountMap(host.current!, scenario, geometry, onSelect).then(
      (instance) => {
        if (disposed) {
          instance.destroy();
          return;
        }
        map.current = instance;
        instance.draw(frame.current.game, frame.current.selectedId);
      },
      (error: unknown) => {
        if (!disposed)
          setError(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      disposed = true;
      map.current?.destroy();
      map.current = null;
    };
  }, [scenario, geometry, onSelect]);
  return (
    <div className="map-frame">
      {error && (
        <p role="alert" className="map-error">
          无法显示地图。{error}
        </p>
      )}
      <div
        className="map-host"
        ref={host}
        tabIndex={0}
        role="group"
        aria-label="世界政区地图"
        aria-describedby="map-help"
      />
      <div className="map-cartouche" aria-hidden="true">
        <span>王国史诗</span>
        <strong>世界政区全图</strong>
        <small>一八二〇年 · 政区舆图</small>
      </div>
      <div className="map-compass" aria-hidden="true">
        北<br />
        <b>✧</b>
      </div>
      <p className="map-help" id="map-help">
        单指拖动 · 双指缩放 · 轻触选州
        <span>鼠标滚轮 / 方向键 / ＋－ / Home</span>
      </p>
    </div>
  );
}
