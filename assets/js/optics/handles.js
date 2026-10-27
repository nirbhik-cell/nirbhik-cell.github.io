// Accessible manipulation layer: one focusable <button> per optic, laid over a canvas.
// Pointer: drag to move (or rotate when `movable` is false), wheel to rotate.
// Keyboard: arrows move (or rotate), [ and ] rotate, Delete removes when `removable`.
const deg = (degrees) => (degrees * Math.PI) / 180;

const TAU = Math.PI * 2;
const normalizeAngle = (a) => {
  const r = ((a % TAU) + TAU) % TAU;
  return r > Math.PI ? r - TAU : r;
};

const NAMES = { mirror: "Mirror", splitter: "Beam splitter" };

/**
 * @param {object} cfg
 * @param {HTMLElement} cfg.host        positioned element that wraps the canvas
 * @param {{width:number,height:number}} cfg.world  logical coordinate space of the optics
 * @param {() => Array} cfg.getOptics
 * @param {(optic) => void} cfg.onChange   called after any change
 * @param {(text:string) => void} [cfg.announce]
 * @param {boolean} [cfg.movable=true]  arrows/drag move optics; otherwise they rotate
 * @param {boolean} [cfg.removable=false]
 * @param {(optic) => void} [cfg.onRemove]
 * @param {number} [cfg.rotateStep=5]   degrees per key press / wheel notch
 * @param {(optic) => boolean} [cfg.isLocked]  locked optics cannot be changed
 */
export function createHandles(cfg) {
  const { host, world, getOptics, onChange } = cfg;
  const view = cfg.view || { x: 0, y: 0, width: world.width, height: world.height };
  const movable = cfg.movable !== false;
  const rotatable = cfg.rotatable !== false;
  const rotateStep = deg(cfg.rotateStep ?? 5);
  const moveStep = 10;
  const layer = document.createElement("div");
  layer.className = "handles";
  host.appendChild(layer);
  const buttons = new Map();
  let selectedId = null;

  const say = (text) => cfg.announce && cfg.announce(text);
  const nameOf = (optic, index) => `${optic.label || NAMES[optic.type] || "Optic"} ${index + 1}`;

  function describe(optic, index) {
    if (cfg.describe) return cfg.describe(optic, index);
    const angle = Math.round((normalizeAngle(optic.angle) * 180) / Math.PI);
    const how = movable
      ? "Arrow keys move, left bracket and right bracket rotate"
      : "Left and right arrow keys rotate";
    return `${nameOf(optic, index)}, angle ${angle} degrees. ${how}.${cfg.removable ? " Delete removes it." : ""}`;
  }

  function place(button, optic) {
    button.style.left = `${((optic.x - view.x) / view.width) * 100}%`;
    button.style.top = `${((optic.y - view.y) / view.height) * 100}%`;
  }

  function rotate(optic, delta) {
    if (!rotatable) return;
    optic.angle = normalizeAngle(optic.angle + delta);
  }

  function move(optic, dx, dy) {
    optic.x = Math.min(world.width, Math.max(0, optic.x + dx));
    optic.y = Math.min(world.height, Math.max(0, optic.y + dy));
  }

  function changed(optic, index, message) {
    const button = buttons.get(optic.id);
    if (button) {
      place(button, optic);
      button.setAttribute("aria-label", describe(optic, index));
    }
    onChange(optic);
    if (message) say(message);
  }

  function build() {
    layer.textContent = "";
    buttons.clear();
    getOptics().forEach((optic, index) => {
      if (cfg.isLocked && cfg.isLocked(optic)) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "handle";
      button.dataset.id = optic.id;
      button.setAttribute("aria-label", describe(optic, index));
      place(button, optic);
      attach(button, optic);
      layer.appendChild(button);
      buttons.set(optic.id, button);
      if (optic.id === selectedId) button.focus({ preventScroll: true });
    });
  }

  function indexOf(optic) {
    return getOptics().indexOf(optic);
  }

  function attach(button, optic) {
    button.addEventListener("focus", () => (selectedId = optic.id));

    button.addEventListener("keydown", (event) => {
      const index = indexOf(optic);
      const angleText = () => `${nameOf(optic, index)} at ${Math.round((optic.angle * 180) / Math.PI)} degrees`;
      let handled = true;
      switch (event.key) {
        case "[":
        case ",":
          rotate(optic, -rotateStep);
          changed(optic, index, angleText());
          break;
        case "]":
        case ".":
          rotate(optic, rotateStep);
          changed(optic, index, angleText());
          break;
        case "ArrowLeft":
        case "ArrowRight": {
          const sign = event.key === "ArrowLeft" ? -1 : 1;
          if (!movable || event.shiftKey) {
            rotate(optic, sign * rotateStep);
            changed(optic, index, angleText());
          } else {
            move(optic, sign * moveStep, 0);
            changed(optic, index);
          }
          break;
        }
        case "ArrowUp":
        case "ArrowDown":
          if (movable) {
            move(optic, 0, event.key === "ArrowUp" ? -moveStep : moveStep);
            changed(optic, index);
          } else {
            rotate(optic, (event.key === "ArrowUp" ? 1 : -1) * rotateStep);
            changed(optic, index, angleText());
          }
          break;
        case "Delete":
        case "Backspace":
          if (cfg.removable && cfg.onRemove) {
            cfg.onRemove(optic);
            say(`${nameOf(optic, index)} removed`);
          } else handled = false;
          break;
        default:
          handled = false;
      }
      if (handled) event.preventDefault();
    });

    button.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const index = indexOf(optic);
        rotate(optic, (event.deltaY > 0 ? 1 : -1) * rotateStep);
        changed(optic, index);
      },
      { passive: false },
    );

    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      button.focus({ preventScroll: true });
      button.setPointerCapture(event.pointerId);
      const rect = host.getBoundingClientRect();
      const toWorldX = view.width / rect.width;
      const toWorldY = view.height / rect.height;
      const start = { x: event.clientX, y: event.clientY, ox: optic.x, oy: optic.y };
      const rotating = !movable || event.shiftKey;

      const onMove = (e) => {
        const index = indexOf(optic);
        if (rotating) {
          const cx = rect.left + ((optic.x - view.x) / view.width) * rect.width;
          const cy = rect.top + ((optic.y - view.y) / view.height) * rect.height;
          const raw = Math.atan2(e.clientY - cy, e.clientX - cx);
          const snap = rotateStep;
          optic.angle = normalizeAngle(Math.round(raw / snap) * snap);
        } else {
          optic.x = Math.min(world.width, Math.max(0, start.ox + (e.clientX - start.x) * toWorldX));
          optic.y = Math.min(world.height, Math.max(0, start.oy + (e.clientY - start.y) * toWorldY));
        }
        changed(optic, index);
      };
      const onUp = () => {
        button.removeEventListener("pointermove", onMove);
        button.removeEventListener("pointerup", onUp);
        button.removeEventListener("pointercancel", onUp);
      };
      button.addEventListener("pointermove", onMove);
      button.addEventListener("pointerup", onUp);
      button.addEventListener("pointercancel", onUp);
    });
  }

  build();
  return {
    /** Rebuild the buttons after optics were added, removed or replaced. */
    sync(focusId) {
      if (focusId !== undefined) selectedId = focusId;
      build();
    },
    /** Update button positions and labels without rebuilding. */
    refresh() {
      getOptics().forEach((optic, index) => {
        const button = buttons.get(optic.id);
        if (button) {
          place(button, optic);
          button.setAttribute("aria-label", describe(optic, index));
        }
      });
    },
    selected: () => selectedId,
    destroy: () => layer.remove(),
  };
}
