// NG hero: the letters N and G drawn by one laser. Static after a one-off ~3 s draw-in.
// Hover a mirror (mouse) or press and hold it (touch) to nudge it out of line; release to snap back.
// The page works without this script: the same final frame ships as inline SVG.
import { VIEW, NUDGE_ANGLE, buildScene, traceScene, litDetectors, maxPath, isReflective } from "./optics/ng.js";
import { canvasPainter, paintScene } from "./optics/ng-draw.js";

const DRAW_MS = 3000;
const HOVER_RADIUS = 14; // logical px
const TOUCH_RADIUS = 24;
const HOLD_MS = 220;
const reduced = matchMedia("(prefers-reduced-motion: reduce)");

function colours() {
  const css = getComputedStyle(document.documentElement);
  const get = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  return { beam: get("--beam", "#3dff8a"), text: get("--text", "#e7ecea"), red: "#ff6b6b", blue: "#6aa8ff", focus: "#ffffff" };
}

function init(root) {
  const canvas = root.querySelector("canvas");
  const scene = buildScene();
  const total = maxPath(traceScene(scene));
  const reflective = scene.elements.filter(isReflective);
  const amounts = Object.fromEntries(reflective.map((e) => [e.id, 0]));
  let active = null; // id of the element being nudged
  let limit = 0;
  let drawStart = null;
  let drawing = false;
  let visible = true;
  let frame = 0;
  let last = 0;
  let palette = colours();
  let size = null;

  function fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const k = (rect.width / VIEW.width) * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(k, 0, 0, k, -VIEW.x * k, -VIEW.y * k);
    size = { ctx, rect };
  }

  function render() {
    if (!size) fit();
    if (!size) return;
    const { ctx } = size;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    const segments = traceScene(scene, limit);
    paintScene(canvasPainter(ctx, palette), scene, segments, litDetectors(scene, segments));
  }

  function settle(dt) {
    let moving = false;
    const rate = 1 - Math.exp(-dt / 70);
    for (const e of reflective) {
      const target = e.id === active ? 1 : 0;
      const next = amounts[e.id] + (target - amounts[e.id]) * rate;
      amounts[e.id] = Math.abs(target - next) < 0.003 ? target : next;
      e.angle = e.rest + amounts[e.id] * NUDGE_ANGLE;
      if (amounts[e.id] !== target) moving = true;
    }
    return moving;
  }

  function tick(now) {
    frame = 0;
    const dt = Math.min(64, now - (last || now));
    last = now;
    let again = false;
    if (drawing) {
      drawStart ??= now;
      const t = Math.min(1, (now - drawStart) / DRAW_MS);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      limit = eased * (total + 1);
      if (t >= 1) {
        drawing = false;
        limit = Infinity;
      } else again = true;
    }
    if (settle(dt)) again = true;
    render();
    if (again && visible && !document.hidden) schedule();
    else last = 0;
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(tick);
  }

  // Which reflective element is near a pointer position?
  function pick(event, radius) {
    const rect = canvas.getBoundingClientRect();
    const x = VIEW.x + ((event.clientX - rect.left) / rect.width) * VIEW.width;
    const y = VIEW.y + ((event.clientY - rect.top) / rect.height) * VIEW.height;
    let best = null;
    let bestD = radius;
    for (const e of reflective) {
      const d = Math.hypot(e.x - x, e.y - y);
      if (d <= bestD) {
        best = e.id;
        bestD = d;
      }
    }
    return best;
  }

  function setActive(id) {
    if (id === active) return;
    active = id;
    schedule();
  }

  let holdTimer = 0;
  let holdOrigin = null;
  canvas.addEventListener("pointermove", (event) => {
    if (drawing) return;
    if (event.pointerType === "mouse") setActive(pick(event, HOVER_RADIUS));
    else if (holdOrigin && Math.hypot(event.clientX - holdOrigin.x, event.clientY - holdOrigin.y) > 8) cancelHold();
  });
  canvas.addEventListener("pointerleave", (event) => event.pointerType === "mouse" && setActive(null));
  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" || drawing) return;
    const id = pick(event, TOUCH_RADIUS);
    if (!id) return;
    holdOrigin = { x: event.clientX, y: event.clientY };
    holdTimer = setTimeout(() => setActive(id), HOLD_MS);
  });
  function cancelHold() {
    clearTimeout(holdTimer);
    holdOrigin = null;
    setActive(null);
  }
  for (const type of ["pointerup", "pointercancel"]) canvas.addEventListener(type, (e) => e.pointerType !== "mouse" && cancelHold());
  window.addEventListener("scroll", () => holdOrigin && cancelHold(), { passive: true });

  new ResizeObserver(() => {
    fit();
    render();
  }).observe(canvas);
  window.addEventListener("themechange", () => {
    palette = colours();
    render();
  });
  new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    if (visible && (drawing || settle(0))) schedule();
  }).observe(root);
  document.addEventListener("visibilitychange", () => !document.hidden && (drawing || active) && schedule());

  // Go live: swap the static SVG for the canvas and draw the beam in once.
  root.classList.add("is-live");
  fit();
  drawing = true;
  limit = 0;
  render();
  schedule();
}

const root = document.querySelector("[data-ng]");
if (root && !reduced.matches) init(root);
