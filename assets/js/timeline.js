// Timeline beam. The page is a complete semantic list without this script. With it, one laser
// enters from the left, forks at beam splitters into one lane per track, runs down the page as
// you scroll, lights milestones as it reaches them, and rejoins at "Now" through mirrors.
// Narrow screens get a single lane. Reduced motion: everything is drawn at once.

const SVG_NS = "http://www.w3.org/2000/svg";

function init(root) {
  const svg = root.querySelector("[data-svg]");
  const grid = root.querySelector("[data-grid]");
  const now = root.querySelector("[data-now]");
  const labels = Array.from(grid.querySelectorAll("[data-label]"));
  const milestones = Array.from(grid.querySelectorAll(".milestone"));
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const narrowQuery = matchMedia("(max-width: 70rem)");
  const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

  root.classList.add("js-beam");
  let geometry = null;
  let parts = null;
  let rafScroll = 0;
  let rafMeasure = 0;

  function el(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    svg.appendChild(node);
    return node;
  }

  function measure() {
    rafMeasure = 0;
    const base = root.getBoundingClientRect();
    const unit = rem();
    const narrow = narrowQuery.matches;
    const offsetX = 0.85 * unit;
    const nodeY = 1.4 * unit;
    const endY = now.getBoundingClientRect().top - base.top + 0.55 * unit;

    let lanes;
    let topY;
    if (narrow) {
      lanes = [{ x: grid.getBoundingClientRect().left - base.left + offsetX }];
      topY = 0;
    } else {
      lanes = labels.map((label) => ({ x: label.getBoundingClientRect().left - base.left + offsetX }));
      topY = labels[0].getBoundingClientRect().top - base.top + 0.7 * unit;
    }
    const nodes = milestones.map((m) => ({ el: m, y: m.getBoundingClientRect().top - base.top + nodeY }));
    geometry = { width: base.width, height: base.height, lanes, topY, endY, narrow, nodes };
    draw();
    update();
  }

  const scheduleMeasure = () => {
    if (!rafMeasure) rafMeasure = requestAnimationFrame(measure);
  };

  function beam(x1, y1, x2, y2) {
    const length = Math.hypot(x2 - x1, y2 - y1);
    const glow = el("line", { x1, y1, x2, y2, class: "beam-glow" });
    const core = el("line", { x1, y1, x2, y2, class: "beam-core" });
    for (const node of [glow, core]) node.style.strokeDasharray = String(length);
    return { glow, core, length };
  }

  function bar(x, y, slash, dashed, y0) {
    const s = 9;
    const d = slash ? [-s, s, s, -s] : [-s, -s, s, s];
    const node = el("line", { x1: x + d[0], y1: y + d[1], x2: x + d[2], y2: y + d[3], class: "beam-optic" + (dashed ? " beam-optic--splitter" : "") });
    node.dataset.y = String(y0);
    return node;
  }

  function draw() {
    svg.textContent = "";
    svg.setAttribute("viewBox", `0 0 ${geometry.width} ${geometry.height}`);
    const { lanes, topY, endY, narrow } = geometry;
    parts = { top: null, lanes: [], bottoms: [], heads: [], optics: [], tail: null };
    if (!lanes.length) return;
    const first = lanes[0];
    const last = lanes[lanes.length - 1];

    // Faint ghost of the whole path so unlit parts stay legible.
    const ghost = (x1, y1, x2, y2) => el("line", { x1, y1, x2, y2, class: "beam-path" });
    if (!narrow) {
      ghost(0, topY, last.x, topY);
      for (const lane of lanes.slice(1)) ghost(first.x, endY, lane.x, endY);
    }
    for (const lane of lanes) ghost(lane.x, topY, lane.x, endY);

    if (!narrow) {
      parts.top = beam(0, topY, last.x, topY);
      el("rect", { x: -2, y: topY - 7, width: 18, height: 14, class: "beam-source" });
    }
    lanes.forEach((lane) => {
      parts.lanes.push({ ...beam(lane.x, topY, lane.x, endY), x: lane.x });
      if (!narrow) {
        // Beam splitters fork the path; the last lane gets a plain mirror.
        parts.optics.push(bar(lane.x, topY, false, lane !== last, topY));
        parts.optics.push(lane === first ? bar(lane.x, endY, false, true, endY) : bar(lane.x, endY, true, false, endY));
      }
      parts.heads.push(el("circle", { cx: lane.x, cy: topY, r: 4, class: "beam-head" }));
    });
    if (!narrow) {
      for (const lane of lanes.slice(1)) parts.bottoms.push({ ...beam(lane.x, endY, first.x, endY), x: lane.x });
    }
    parts.tail = beam(first.x, endY, first.x, endY + 0.9 * rem());
  }

  function reveal(part, visible) {
    const hide = Math.max(0, part.length - visible);
    for (const node of [part.glow, part.core]) {
      node.style.strokeDashoffset = String(hide);
      node.style.visibility = visible <= 0.5 ? "hidden" : "visible";
    }
  }

  function update() {
    rafScroll = 0;
    if (!geometry || !parts || !parts.tail) return;
    const { topY, endY, narrow, nodes } = geometry;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const head = reduced.matches ? Infinity : window.innerHeight * 0.62 - root.getBoundingClientRect().top;

    if (parts.top) reveal(parts.top, clamp(head / Math.max(topY, 1), 0, 1) * parts.top.length);
    const run = clamp(head - topY, 0, endY - topY);
    parts.lanes.forEach((lane, i) => {
      reveal(lane, run);
      const dot = parts.heads[i];
      dot.style.visibility = run > 0 && run < endY - topY && head !== Infinity ? "visible" : "hidden";
      dot.setAttribute("cy", String(topY + run));
    });
    const back = clamp((head - endY) / (window.innerHeight * 0.18), 0, 1);
    parts.bottoms.forEach((b) => reveal(b, back * b.length));
    reveal(parts.tail, back * parts.tail.length);

    parts.optics.forEach((o) => o.classList.toggle("is-lit", head >= Number(o.dataset.y)));
    for (const node of nodes) node.el.classList.toggle("is-lit", head >= node.y);
    if (narrow) now.classList.toggle("is-lit", head >= endY);
  }

  const onScroll = () => {
    if (!rafScroll) rafScroll = requestAnimationFrame(update);
  };

  grid.addEventListener("toggle", scheduleMeasure, true);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", scheduleMeasure);
  new ResizeObserver(scheduleMeasure).observe(root);
  reduced.addEventListener("change", update);
  narrowQuery.addEventListener("change", scheduleMeasure);
  window.addEventListener("themechange", update);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleMeasure);
  measure();
}

const root = document.querySelector("[data-timeline]");
if (root) init(root);
