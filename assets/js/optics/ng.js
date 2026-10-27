// The NG hero scene: one laser, mirrors at every corner, a beam splitter at the top of the G,
// and lenses / prisms mounted on the strokes. Framework-agnostic: no DOM access.
//
// Ported from the original ng_scene2.js reference scene. Logical coordinates, y grows downward. An element is
//   { id, type, x, y, angle, half, group? }
//   type  "mirror" | "splitter" | "lens" | "prism" | "absorber"
// where `angle` is the direction of the segment (same convention as tracer.js).

export const WORLD = { width: 680, height: 220 };

/** The region of the logical canvas that is shown (the letters plus a little air). */
export const VIEW = { x: 150, y: 10, width: 380, height: 190 };

export const NUDGE_ANGLE = 0.28;
export const SPLIT_RATIO = 0.85;
export const MAX_DEPTH = 80;
const MIN_INTENSITY = 0.1;
const STEP = 0.01;

const P = {
  S: [240, 174],
  N0: [240, 40], N1: [300, 160], N2: [300, 40],
  T: [360, 40],
  GR: [430, 40], GT: [455, 65],
  GL1: [335, 65], GL2: [335, 135], GB1: [360, 160], GB2: [430, 160],
  GR1: [455, 135], GR2: [455, 100], J: [415, 100],
};

const unit = (a, b) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  return [dx / len, dy / len];
};

/** Angle of a mirror at corner v so it turns the beam from prev->v into v->next. */
function bisector(prev, v, next) {
  const din = unit(prev, v);
  const dout = unit(v, next);
  const nx = dout[0] - din[0];
  const ny = dout[1] - din[1];
  const len = Math.hypot(nx, ny);
  if (len < 1e-6) return null;
  return Math.atan2(nx / len, -(ny / len));
}

export function buildScene() {
  const elements = [];
  const detectors = [];
  const corner = (id, prev, v, next, type, half) =>
    elements.push({ id, type, x: v[0], y: v[1], angle: bisector(prev, v, next), half });
  const absorber = (id, p, from) => {
    const u = unit(from, p);
    elements.push({ id, type: "absorber", x: p[0], y: p[1], angle: Math.atan2(u[1], u[0]) + Math.PI / 2, half: 9 });
    detectors.push({ id, x: p[0], y: p[1] });
  };
  const mount = (type, group, a, b, fraction) => {
    const u = unit(a, b);
    elements.push({
      id: `${group}${elements.filter((e) => e.group === group).length + 1}`,
      type,
      group,
      x: a[0] + (b[0] - a[0]) * fraction,
      y: a[1] + (b[1] - a[1]) * fraction,
      angle: Math.atan2(u[1], u[0]) + Math.PI / 2,
      half: 11,
    });
  };

  corner("n0", P.S, P.N0, P.N1, "mirror", 9);
  corner("n1", P.N0, P.N1, P.N2, "mirror", 9);
  corner("n2", P.N1, P.N2, P.T, "mirror", 9);
  corner("split", P.N2, P.T, P.GL1, "splitter", 14);
  corner("gr", P.T, P.GR, P.GT, "mirror", 9);
  corner("gl1", P.T, P.GL1, P.GL2, "mirror", 9);
  corner("gl2", P.GL1, P.GL2, P.GB1, "mirror", 9);
  corner("gb1", P.GL2, P.GB1, P.GB2, "mirror", 9);
  corner("gb2", P.GB1, P.GB2, P.GR1, "mirror", 9);
  corner("gr1", P.GB2, P.GR1, P.GR2, "mirror", 9);
  corner("gr2", P.GR1, P.GR2, P.J, "mirror", 9);
  absorber("det1", P.GT, P.GR);
  absorber("det2", P.J, P.GR2);

  mount("lens", "a", P.S, P.N0, 0.28); mount("lens", "a", P.S, P.N0, 0.72);
  mount("prism", "b", P.N0, P.N1, 0.3); mount("prism", "b", P.N0, P.N1, 0.7);
  mount("lens", "c", P.N1, P.N2, 0.34); mount("lens", "c", P.N1, P.N2, 0.66);
  mount("lens", "d", P.T, P.GR, 0.28); mount("lens", "d", P.T, P.GR, 0.72);
  mount("prism", "e", P.GL1, P.GL2, 0.28); mount("prism", "e", P.GL1, P.GL2, 0.72);
  mount("lens", "f", P.GB1, P.GB2, 0.28); mount("lens", "f", P.GB1, P.GB2, 0.72);

  for (const e of elements) e.rest = e.angle; // where it snaps back to
  return { elements, detectors, source: { x: P.S[0], y: P.S[1], dx: 0, dy: -1 } };
}

/** Elements that reflect (the ones that can be nudged out of alignment). */
export const isReflective = (e) => e.type === "mirror" || e.type === "splitter";

/** Distance along a ray to a segment, or -1. 2D cross products, t > 1e-3, 0 <= s <= 1. */
function hitDistance(px, py, dx, dy, e) {
  const ux = Math.cos(e.angle);
  const uy = Math.sin(e.angle);
  const ex = 2 * e.half * ux;
  const ey = 2 * e.half * uy;
  const ax = e.x - e.half * ux;
  const ay = e.y - e.half * uy;
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-9) return -1;
  const wx = ax - px;
  const wy = ay - py;
  const t = (wx * ey - wy * ex) / den;
  const s = (wx * dy - wy * dx) / den;
  return t > 1e-3 && s >= 0 && s <= 1 ? t : -1;
}

function exitDistance(px, py, dx, dy) {
  let t = 1e9;
  if (dx > 1e-9) t = Math.min(t, (WORLD.width - px) / dx);
  else if (dx < -1e-9) t = Math.min(t, -px / dx);
  if (dy > 1e-9) t = Math.min(t, (WORLD.height - py) / dy);
  else if (dy < -1e-9) t = Math.min(t, -py / dy);
  return Math.max(t, 0);
}

/**
 * Trace the beam through the scene.
 * @param scene   from buildScene()
 * @param limit   stop after this much path length (draw-in); Infinity for the full beam
 * @returns segments { x1, y1, x2, y2, intensity, d0, d1, hits: [{ element, x, y, d }] }
 *          `hits` are the pass-through lenses/prisms crossed on that segment (d is the
 *          distance from the segment start); d0/d1 are path lengths from the source.
 */
export function traceScene(scene, limit = Infinity) {
  const out = [];
  const { elements } = scene;

  function follow(px, py, dx, dy, depth, dist, intensity) {
    if (depth > MAX_DEPTH || dist >= limit || intensity < MIN_INTENSITY) return;
    const sx = px;
    const sy = py;
    let cx = px;
    let cy = py;
    const hits = [];
    let blocker = null;
    let reach = 0;
    for (let guard = 0; guard < 40; guard++) {
      let nearest = null;
      reach = 1e9;
      for (const e of elements) {
        const t = hitDistance(cx, cy, dx, dy, e);
        if (t > 0 && t < reach) {
          reach = t;
          nearest = e;
        }
      }
      const wall = exitDistance(cx, cy, dx, dy);
      if (!nearest || reach >= wall) {
        blocker = null;
        reach = wall;
        break;
      }
      blocker = nearest;
      if (nearest.type === "lens" || nearest.type === "prism") {
        const hx = cx + dx * reach;
        const hy = cy + dy * reach;
        hits.push({ element: nearest, x: hx, y: hy, d: Math.hypot(hx - sx, hy - sy) });
        cx = hx + dx * STEP;
        cy = hy + dy * STEP;
        blocker = null;
        continue;
      }
      break;
    }
    const ex = cx + dx * reach;
    const ey = cy + dy * reach;
    const length = Math.hypot(ex - sx, ey - sy);
    const take = Math.min(length, limit - dist);
    out.push({
      x1: sx, y1: sy, x2: sx + dx * take, y2: sy + dy * take,
      intensity, d0: dist, d1: dist + take,
      hits: hits.filter((h) => h.d <= take),
    });
    if (!blocker || take < length || blocker.type === "absorber") return;

    const ux = Math.cos(blocker.angle);
    const uy = Math.sin(blocker.angle);
    const nx = -uy;
    const ny = ux;
    const dn = dx * nx + dy * ny;
    const rx = dx - 2 * dn * nx;
    const ry = dy - 2 * dn * ny;
    if (blocker.type === "splitter") {
      follow(ex + dx * STEP, ey + dy * STEP, dx, dy, depth + 1, dist + length, intensity * SPLIT_RATIO);
      follow(ex + rx * STEP, ey + ry * STEP, rx, ry, depth + 1, dist + length, intensity * SPLIT_RATIO);
    } else {
      follow(ex + rx * STEP, ey + ry * STEP, rx, ry, depth + 1, dist + length, intensity);
    }
  }

  follow(scene.source.x, scene.source.y, scene.source.dx, scene.source.dy, 0, 0, 1);
  return out;
}

/** Distance from a point to a segment. */
export function distanceToSegment(px, py, s) {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / len2)) : 0;
  return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
}

/** Which detectors does the beam reach (passes within `tolerance` px)? */
export function litDetectors(scene, segments, tolerance = 2.5) {
  const lit = {};
  for (const d of scene.detectors) {
    lit[d.id] = segments.some((s) => distanceToSegment(d.x, d.y, s) <= tolerance);
  }
  return lit;
}

/** Longest path length reached by any segment. */
export const maxPath = (segments) => segments.reduce((m, s) => Math.max(m, s.d1), 0);
