// Drawing for the NG hero. The scene is described once with a tiny "painter" interface and
// rendered either to a canvas (live) or to SVG markup (the no-JS / reduced-motion frame, made
// as _includes/ng.svg). Waist and prism fan are drawn effects, not refracted rays.

const ROLES = {
  // role: [colour key, line width, dash]
  under: ["beam", 9, null],
  beam: ["beam", 3, null],
  waist: ["beam", 1.2, null],
  mirror: ["text", 4, null],
  splitter: ["text", 4, [5, 3]],
  glass: ["text", 1.5, null],
  detector: ["text", 1.5, null],
  lit: ["beam", 1.5, null],
  red: ["red", 1.2, null],
  blue: ["blue", 1.2, null],
  focus: ["focus", 1, null],
};

const SPREAD = 3.5; // how far the prism fan opens (px)
const WAIST_OPEN = 3; // half-width of the beam at a lens (px)
const WAIST_PINCH = 0.6; // half-width at the focus

/** Canvas implementation of the painter interface. colours: { beam, text, red, blue, focus }. */
export function canvasPainter(ctx, colours) {
  const stroke = (role, alpha, path) => {
    const [key, width, dash] = ROLES[role];
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = colours[key];
    ctx.lineWidth = width;
    ctx.lineCap = role === "under" || role === "beam" ? "round" : "butt";
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    path();
    ctx.stroke();
    ctx.restore();
  };
  return {
    line: (x1, y1, x2, y2, role, alpha = 1) => stroke(role, alpha, () => (ctx.moveTo(x1, y1), ctx.lineTo(x2, y2))),
    ellipse: (x, y, rx, ry, rotation, role, alpha = 1) =>
      stroke(role, alpha, () => ctx.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2)),
    circle: (x, y, r, role, alpha = 1, fill = false) => {
      if (!fill) return stroke(role, alpha, () => ctx.arc(x, y, r, 0, Math.PI * 2));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = colours[ROLES[role][0]];
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
    polygon: (points, role, alpha = 1, fill = false) => {
      const path = () => {
        points.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        ctx.closePath();
      };
      if (!fill) return stroke(role, alpha, path);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = colours[ROLES[role][0]];
      ctx.beginPath();
      path();
      ctx.fill();
      ctx.restore();
    },
    rect: (x, y, w, h, role, alpha = 1) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = colours[ROLES[role][0]];
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    },
  };
}

/** SVG implementation: collects markup in .out. Colours come from CSS classes (.ng-<role>). */
export function svgPainter() {
  const out = [];
  const f = (n) => Number(n.toFixed(2));
  const style = (role, alpha) => ` class="ng-${role}"${alpha !== 1 ? ` opacity="${f(alpha)}"` : ""}`;
  return {
    out,
    line: (x1, y1, x2, y2, role, alpha = 1) => out.push(`<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"${style(role, alpha)}/>`),
    ellipse: (x, y, rx, ry, rotation, role, alpha = 1) =>
      out.push(`<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx)}" ry="${f(ry)}" transform="rotate(${f((rotation * 180) / Math.PI)} ${f(x)} ${f(y)})"${style(role, alpha)}/>`),
    circle: (x, y, r, role, alpha = 1, fill = false) =>
      out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}"${style(role, alpha)}${fill ? ' data-fill="1"' : ""}/>`),
    polygon: (points, role, alpha = 1, fill = false) =>
      out.push(`<polygon points="${points.map(([x, y]) => `${f(x)},${f(y)}`).join(" ")}"${style(role, alpha)}${fill ? ' data-fill="1"' : ""}/>`),
    rect: (x, y, w, h, role, alpha = 1) =>
      out.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"${style(role, alpha)} data-fill="1"/>`),
  };
}

function drawElement(p, e) {
  const ux = Math.cos(e.angle);
  const uy = Math.sin(e.angle);
  switch (e.type) {
    case "mirror":
    case "absorber":
      if (e.type === "mirror") p.line(e.x - ux * e.half, e.y - uy * e.half, e.x + ux * e.half, e.y + uy * e.half, "mirror");
      break;
    case "splitter":
      p.line(e.x - ux * e.half, e.y - uy * e.half, e.x + ux * e.half, e.y + uy * e.half, "splitter");
      break;
    case "lens":
      p.ellipse(e.x, e.y, e.half, 3.2, e.angle, "glass");
      break;
    case "prism": {
      const nx = -uy;
      const ny = ux;
      const b = 6;
      p.polygon(
        [
          [e.x - ux * b - nx * 4, e.y - uy * b - ny * 4],
          [e.x + ux * b - nx * 4, e.y + uy * b - ny * 4],
          [e.x + nx * 6, e.y + ny * 6],
        ],
        "glass",
      );
      break;
    }
    default:
  }
}

/** Waist between a lens pair; fan between a prism pair. Both centred on the beam segment. */
function drawEffects(p, segment) {
  const hits = [...segment.hits].sort((a, b) => a.d - b.d);
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  for (let i = 0; i + 1 < hits.length; i += 2) {
    const a = hits[i];
    const b = hits[i + 1];
    if (a.element.group !== b.element.group) continue;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    if (a.element.type === "lens") {
      p.polygon(
        [
          [a.x + nx * WAIST_OPEN, a.y + ny * WAIST_OPEN],
          [mx + nx * WAIST_PINCH, my + ny * WAIST_PINCH],
          [b.x + nx * WAIST_OPEN, b.y + ny * WAIST_OPEN],
          [b.x - nx * WAIST_OPEN, b.y - ny * WAIST_OPEN],
          [mx - nx * WAIST_PINCH, my - ny * WAIST_PINCH],
          [a.x - nx * WAIST_OPEN, a.y - ny * WAIST_OPEN],
        ],
        "waist",
        0.35 * segment.intensity,
        true,
      );
      p.circle(mx, my, 1.8, "focus", 0.95, true);
    } else {
      for (const [role, sign] of [["red", 1], ["blue", -1]]) {
        p.line(a.x, a.y, mx + nx * SPREAD * sign, my + ny * SPREAD * sign, role, 0.7);
        p.line(mx + nx * SPREAD * sign, my + ny * SPREAD * sign, b.x, b.y, role, 0.7);
      }
    }
  }
}

/**
 * Paint the whole scene: optics, then the beam on top.
 * @param lit  { det1: bool, det2: bool } from litDetectors()
 */
export function paintScene(p, scene, segments, lit) {
  for (const e of scene.elements) drawElement(p, e);
  p.rect(scene.source.x - 5, scene.source.y + 1, 10, 8, "mirror");
  for (const s of segments) {
    p.line(s.x1, s.y1, s.x2, s.y2, "under", 0.2 * s.intensity);
  }
  for (const s of segments) {
    p.line(s.x1, s.y1, s.x2, s.y2, "beam", Math.min(1, 0.25 + s.intensity));
    drawEffects(p, s);
  }
  for (const d of scene.detectors) {
    const on = lit[d.id];
    p.circle(d.x, d.y, 6, on ? "lit" : "detector", on ? 1 : 0.35);
    p.circle(d.x, d.y, 2.5, on ? "lit" : "detector", on ? 1 : 0.35, true);
  }
}

/** Complete inline SVG for the final frame (used when JS is off or motion is reduced). */
export function sceneToSvg(scene, segments, lit, view) {
  const p = svgPainter();
  paintScene(p, scene, segments, lit);
  return (
    `<svg class="ng-svg" viewBox="${view.x} ${view.y} ${view.width} ${view.height}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">` +
    p.out.join("") +
    "</svg>"
  );
}
