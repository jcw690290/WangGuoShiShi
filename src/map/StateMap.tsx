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
import { capitals } from "./capitals.ts";
import { stateLabelBox } from "./stateLabels.ts";
import { hitState } from "./hitTest.ts";
import {
  fitView,
  focusAt,
  MapGesture,
  pan,
  resizeView,
  scaleOf,
  worldPoint,
  MAP_WIDTH,
  MAP_HEIGHT,
  wrapX,
  zoomAt,
} from "./viewport.ts";
import type { Point } from "./viewport.ts";

interface Props {
  scenario: Scenario;
  geometry: StateGeometry;
  game: GameState;
  owners: GameState["ownerByStateId"];
  selectedId: string | null;
  preview: string | null;
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
  const selection = new Graphics(),
    borders = new Graphics(),
    names = new Container(),
    occupationHighlight = new Graphics();
  const edges = mapEdges(geometry);
  map.addChild(selection, borders, names, occupationHighlight);
  const provinceLabels = Object.entries(geometry).map(([id, polygons]) => {
    const text = new Text({
      text: atlas[id].name,
      resolution: Math.min(2, window.devicePixelRatio),
      style: { fontFamily: "Microsoft YaHei, sans-serif", fontSize: 14,
        fill: "#302d24", stroke: { color: "#f8f0da", width: 2 } },
    });
    text.anchor.set(0.5);
    const height = text.height + 2;
    const box = stateLabelBox(polygons, (text.width + 2) / height);
    text.position.set(box.x, box.y);
    text.visible = false;
    map.addChild(text);
    return { text, box, height };
  });
  const capitalMarkers = Object.keys(scenario.countries).map((id) => {
    const { x, y } = capitals[id];
    const marker = new Graphics()
      .circle(0, 0, 7).fill("#56351f").stroke({ color: "#fff4cd", width: 1.5 })
      .star(0, 0, 5, 5, 2.2).fill("#ffda81");
    marker.position.set(x, y);
    map.addChild(marker);
    return { id, marker };
  });
  const gesture = new MapGesture(fitView(host.clientWidth, host.clientHeight));
  const nationTexts: { text: Text; size: number }[] = [];
  let focus: string | null = null;
  let previewCountry: string | null = null;
  function centerCapital(country: string) {
    const point = capitals[country];
    const view = gesture.view;
    const baseScale = scaleOf({ ...view, zoom: 1 });
    // Keep the capital centered even near a pole or on a tall phone screen.
    const verticalRoom = Math.min(point.y, MAP_HEIGHT - point.y);
    const zoom = Math.max(4, view.height / (2 * verticalRoom * baseScale));
    gesture.setView(focusAt(view, point, zoom));
  }
  const place = () => {
    const v = gesture.view,
      scale = scaleOf(v);
    map.scale.set(scale);
    map.position.set(v.x, v.y);

    for (const { id, marker } of capitalMarkers) {
      const emphasized = id === previewCountry;
      marker.scale.set((emphasized ? 1.2 : v.zoom < 3 ? 0.68 : 0.85) / scale);
      marker.alpha = previewCountry && !emphasized ? 0.65 : 1;
    }
    for (const { text, size } of nationTexts) {
      const screenSize = size * scale;
      text.visible = v.zoom < 3 && (screenSize >= 9 || size >= 14);
      text.scale.set(
        Math.max(size >= 14 ? 12 : 0, Math.min(66, screenSize)) / (64 * scale),
      );
    }
    host.dataset.zoom = v.zoom.toFixed(3);
    host.dataset.offset = `${v.x.toFixed(2)},${v.y.toFixed(2)}`;
    canvas.style.cursor = gesture.pointers.size ? "grabbing" : "grab";
    const period = MAP_WIDTH * scale;
    const first = Math.floor(-v.x / period);
    const last = Math.ceil((v.width - v.x) / period) - 1;
    for (let tile = first; tile <= last; tile++) {
      map.x = v.x + tile * period;
      for (const { text, box, height } of provinceLabels) {
        const x = map.x + box.x * scale, y = v.y + box.y * scale;
        text.visible = v.zoom >= 3 && box.height * scale >= height &&
          x >= -80 && x <= v.width + 80 && y >= -12 && y <= v.height + 12;
        if (text.visible) text.scale.set(1 / scale);
      }
      app.renderer.render({ container: app.stage, clear: tile === first });
    }
  };
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
      const locate = (p: Point) => {
        const { x, y } = worldPoint(gesture.view, p);
        return hitState(geometry, { x: wrapX(x), y });
      };
      const start = locate(tap.start), end = locate(tap.end);
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
    if (previewCountry) centerCapital(previewCountry);
    place();
  });
  app.renderer.resize(host.clientWidth, host.clientHeight);
  observer.observe(host);
  let previousOwners: GameState["ownerByStateId"] | null = null,
    previousOccupation: string | null = null;
  return {
    draw(game: GameState, owners: GameState["ownerByStateId"], selectedId: string | null, preview: string | null) {
      const occupation = game.occupation?.stateId ?? null;
      if (
        previousOwners === owners &&
        focus === selectedId && preview === previewCountry &&
        previousOccupation === occupation
      )
        return;
      if (preview !== previewCountry && preview) {
        centerCapital(preview);
      }
      if (previousOwners !== owners || preview !== previewCountry) {
        for (const [id, shape] of shapes) {
          shape.tint = preview && owners[id] !== preview ? 0x676b70 : 0xffffff;
        }
      }
      previewCountry = preview;
      if (previousOwners !== owners) {
        for (const [id, shape] of shapes) {
          const owner = owners[id];
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
                owners[id] !== owners[states[0]],
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
          owners,
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
      selection.clear();
      occupationHighlight.clear();
      for (const id of new Set([occupation, selectedId]))
        if (id !== null) {
          const selected = id === selectedId;
          const highlight = selected ? selection : occupationHighlight;
          for (const [shell, ...holes] of geometry[id]) {
            highlight.poly(shell.flat()).fill({
              color: selected ? "#fff3cc" : "#dd982e",
              alpha: selected ? 0.36 : 0.24,
            });
            for (const hole of holes) highlight.poly(hole.flat()).cut();
            if (!selected)
              highlight.poly(shell.flat()).stroke({ color: "#a96714", width: 1.3 });
          }
        }
      focus = selectedId;
      previousOwners = owners;
      previousOccupation = occupation;
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

      app.destroy({ removeView: true }, { children: true });
    },
  };
}
export function StateMap({
  scenario,
  geometry,
  game,
  owners,
  selectedId,
  preview,
  onSelect,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<Awaited<ReturnType<typeof mountMap>>>(null);
  const frame = useRef({ game, owners, selectedId, preview });
  const [error, setError] = useState<string>();
  useEffect(() => {
    frame.current = { game, owners, selectedId, preview };
    map.current?.draw(game, owners, selectedId, preview);
  }, [game, owners, selectedId, preview]);
  useEffect(() => {
    let disposed = false;
    void mountMap(host.current!, scenario, geometry, onSelect).then(
      (instance) => {
        if (disposed) {
          instance.destroy();
          return;
        }
        map.current = instance;
        instance.draw(frame.current.game, frame.current.owners, frame.current.selectedId, frame.current.preview);
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
      <span className="sr-only" id="map-help">星标表示首都。拖动平移，滚轮或双指缩放。键盘使用方向键、加减号和 Home。</span>
    </div>
  );
}
