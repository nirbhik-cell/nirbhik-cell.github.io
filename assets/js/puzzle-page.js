// 404 page: the NG beam has lost the Home detector because two mirrors were knocked out of
// line. Rotate them back (drag, wheel, or arrow keys) and the visitor is sent home.
import { VIEW, WORLD, buildScene, traceScene, litDetectors } from "./optics/ng.js";
import { canvasPainter, paintScene } from "./optics/ng-draw.js";
import { createHandles } from "./optics/handles.js";

const KNOCKED = { n1: 16, gr: -8 }; // degrees away from alignment
const TOLERANCE = 0.045; // rad: close enough counts as aligned
const STEP = 4; // degrees per key press

const root = document.querySelector("[data-puzzle]");
if (root) {
  const stage = root.querySelector("[data-stage]");
  const canvas = root.querySelector("canvas");
  const status = root.querySelector("[data-status]");
  const home = document.querySelector("link[rel=icon]").getAttribute("href").replace(/assets\/images\/favicon\.svg.*/, "") || "/";
  const LABELS = { n1: "Mirror on the N diagonal", n2: "Mirror at the top of the N", gr: "Mirror at the top of the G" };
  let scene;
  let palette = colours();
  let size = null;
  let solved = false;
  let handles;

  function colours() {
    const css = getComputedStyle(document.documentElement);
    const get = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    return { beam: get("--beam", "#3dff8a"), text: get("--text", "#e7ecea"), red: "#ff6b6b", blue: "#6aa8ff", focus: "#ffffff" };
  }

  function reset() {
    scene = buildScene();
    for (const e of scene.elements) {
      e.label = LABELS[e.id];
      e.locked = !(e.id in LABELS);
      if (e.id in KNOCKED) e.angle = e.rest + (KNOCKED[e.id] * Math.PI) / 180;
    }
    solved = false;
  }

  function fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const k = (rect.width / VIEW.width) * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(k, 0, 0, k, -VIEW.x * k, -VIEW.y * k);
    size = { ctx };
  }

  function draw() {
    if (!size) fit();
    if (!size) return;
    const { ctx } = size;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    const segments = traceScene(scene);
    const lit = litDetectors(scene, segments);
    paintScene(canvasPainter(ctx, palette), scene, segments, lit);
    const det = scene.detectors.find((d) => d.id === "det1");
    ctx.save();
    ctx.fillStyle = palette.beam;
    ctx.font = "600 10px 'JetBrains Mono', monospace";
    ctx.fillText("HOME", det.x + 11, det.y + 4);
    ctx.restore();
    if (lit.det1 && !solved) win();
  }

  function win() {
    solved = true;
    status.textContent = "Signal acquired. Heading home…";
    setTimeout(() => (location.href = home), matchMedia("(prefers-reduced-motion: reduce)").matches ? 900 : 1300);
  }

  function onChange(optic) {
    // Close enough snaps to perfect alignment, so the beam really lands on the detector.
    const TAU = Math.PI * 2;
    const diff = ((((optic.angle - optic.rest) % TAU) + TAU + Math.PI) % TAU) - Math.PI;
    if (Math.abs(diff) < TOLERANCE) optic.angle = optic.rest;
    draw();
  }

  reset();
  handles = createHandles({
    host: stage,
    world: WORLD,
    view: VIEW,
    getOptics: () => scene.elements,
    isLocked: (e) => e.locked,
    movable: false,
    rotateStep: STEP,
    onChange,
    announce: (text) => !solved && (status.textContent = text),
    describe: (e) => `${e.label}. Left and right arrow keys rotate it. Tab moves to the next mirror.`,
  });

  root.querySelector("[data-reset]").addEventListener("click", () => {
    reset();
    status.textContent = "Mirrors knocked out of line again.";
    handles.sync();
    draw();
  });
  new ResizeObserver(() => {
    fit();
    draw();
  }).observe(canvas);
  window.addEventListener("themechange", () => {
    palette = colours();
    draw();
  });
  fit();
  draw();
}
