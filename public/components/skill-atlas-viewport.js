// Controlled pan/zoom viewport for the Skill Atlas. Dependency-free: owns a
// fixed-size SVG whose inner `.atlas-world` group is transformed (translate +
// scale). Supports drag-pan, pointer-centered wheel zoom, two-pointer pinch,
// clamped zoom, reset/fit/focus controls, and reduced-motion handling. Page
// scrolling stays separate from atlas panning.

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;
const DRAG_THRESHOLD = 5; // px of movement before a gesture counts as a pan

const prefersReducedMotion = () =>
  globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

const clampZoom = (value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

const CONTROLS = [
  { action: "zoom-in", label: "Zoom in", glyph: "+" },
  { action: "zoom-out", label: "Zoom out", glyph: "\u2212" },
  { action: "fit", label: "Fit atlas", glyph: "\u26F6" },
  { action: "reset", label: "Center on root", glyph: "\u25C9" }
];

export const createAtlasViewport = (host) => {
  host.innerHTML = `
    <div class="atlas-viewport">
      <svg class="skill-atlas-svg" role="application" aria-label="Skill atlas. Drag to pan, scroll to zoom.">
        <g class="atlas-world"></g>
      </svg>
      <div class="atlas-controls" role="group" aria-label="Atlas view controls">
        ${CONTROLS.map((control) =>
          `<button type="button" class="atlas-control" data-atlas-action="${control.action}" aria-label="${control.label}" title="${control.label}">${control.glyph}</button>`
        ).join("")}
      </div>
    </div>
  `;

  const viewport = host.querySelector(".atlas-viewport");
  const svg = host.querySelector(".skill-atlas-svg");
  const world = host.querySelector(".atlas-world");

  const state = { tx: 0, ty: 0, k: 1 };
  let bounds = { minX: -400, minY: -400, maxX: 400, maxY: 400 };
  let width = 1;
  let height = 1;
  let animation = null;
  let suppressClick = false;

  const size = () => {
    const rect = svg.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  };

  const apply = () => {
    world.setAttribute(
      "transform",
      `translate(${state.tx.toFixed(2)} ${state.ty.toFixed(2)}) scale(${state.k.toFixed(4)})`
    );
  };

  const setView = (tx, ty, k) => {
    state.tx = tx;
    state.ty = ty;
    state.k = clampZoom(k);
    apply();
  };

  const animateTo = (target) => {
    if (animation) cancelAnimationFrame(animation);
    if (prefersReducedMotion()) {
      setView(target.tx, target.ty, target.k);
      return;
    }
    const start = { ...state };
    const clampedK = clampZoom(target.k);
    const duration = 320;
    const begin = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const step = (now) => {
      const progress = Math.min(1, (now - begin) / duration);
      const e = ease(progress);
      state.tx = start.tx + (target.tx - start.tx) * e;
      state.ty = start.ty + (target.ty - start.ty) * e;
      state.k = start.k + (clampedK - start.k) * e;
      apply();
      if (progress < 1) animation = requestAnimationFrame(step);
    };
    animation = requestAnimationFrame(step);
  };

  const pointerToWorld = (px, py) => ({
    x: (px - state.tx) / state.k,
    y: (py - state.ty) / state.k
  });

  const localPoint = (event) => {
    const rect = svg.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const zoomAt = (px, py, nextK, animate = false) => {
    const clamped = clampZoom(nextK);
    const worldPoint = pointerToWorld(px, py);
    const tx = px - worldPoint.x * clamped;
    const ty = py - worldPoint.y * clamped;
    if (animate) animateTo({ tx, ty, k: clamped });
    else setView(tx, ty, clamped);
  };

  const fit = (animate = false) => {
    size();
    const contentW = Math.max(1, bounds.maxX - bounds.minX);
    const contentH = Math.max(1, bounds.maxY - bounds.minY);
    const padding = 0.88;
    const k = clampZoom(Math.min(width / contentW, height / contentH) * padding);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const target = { tx: width / 2 - centerX * k, ty: height / 2 - centerY * k, k };
    if (animate) animateTo(target);
    else setView(target.tx, target.ty, target.k);
  };

  const reset = (animate = true) => {
    size();
    const k = clampZoom(Math.min(width, height) / 900);
    animate
      ? animateTo({ tx: width / 2, ty: height / 2, k })
      : setView(width / 2, height / 2, k);
  };

  const focusNode = (worldX, worldY, animate = true) => {
    const target = { tx: width / 2 - worldX * state.k, ty: height / 2 - worldY * state.k, k: state.k };
    animate ? animateTo(target) : setView(target.tx, target.ty, target.k);
  };

  // Map a world-space point to pixel coordinates within the viewport element.
  const worldToScreen = (worldX, worldY) => ({
    x: state.tx + worldX * state.k,
    y: state.ty + worldY * state.k
  });

  // --- Pointer / gesture handling --------------------------------------
  const pointers = new Map();
  let panStart = null;
  let pinchStart = null;
  let moved = 0;
  const captured = new Set();

  const capture = (pointerId) => {
    if (captured.has(pointerId)) return;
    svg.setPointerCapture?.(pointerId);
    captured.add(pointerId);
  };
  const release = (pointerId) => {
    if (!captured.has(pointerId)) return;
    svg.releasePointerCapture?.(pointerId);
    captured.delete(pointerId);
  };

  const onPointerDown = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    pointers.set(event.pointerId, localPoint(event));
    moved = 0;
    if (pointers.size === 1) {
      const point = pointers.get(event.pointerId);
      panStart = { x: point.x, y: point.y, tx: state.tx, ty: state.ty };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
        k: state.k
      };
      panStart = null;
      // A second pointer always means a pinch gesture, never a click.
      for (const id of pointers.keys()) capture(id);
    }
  };

  const onPointerMove = (event) => {
    if (!pointers.has(event.pointerId)) return;
    const point = localPoint(event);
    pointers.set(event.pointerId, point);

    if (pointers.size >= 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const ratio = dist / Math.max(1, pinchStart.dist);
      zoomAt(midX, midY, pinchStart.k * ratio);
      moved += DRAG_THRESHOLD + 1;
      return;
    }

    if (panStart) {
      const dx = point.x - panStart.x;
      const dy = point.y - panStart.y;
      moved = Math.max(moved, Math.hypot(dx, dy));
      if (moved > DRAG_THRESHOLD) {
        // Capture only once a real drag begins so plain clicks keep their
        // original target and can reach the node selection handler.
        capture(event.pointerId);
        viewport.classList.add("is-panning");
        setView(panStart.tx + dx, panStart.ty + dy, state.k);
      }
    }
  };

  const endPointer = (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    release(event.pointerId);
    if (moved > DRAG_THRESHOLD) suppressClick = true;
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 1) {
      const [point] = [...pointers.values()];
      panStart = { x: point.x, y: point.y, tx: state.tx, ty: state.ty };
    } else if (pointers.size === 0) {
      panStart = null;
      viewport.classList.remove("is-panning");
    }
  };

  const onWheel = (event) => {
    event.preventDefault();
    const point = localPoint(event);
    const factor = Math.exp(-event.deltaY * 0.0015);
    zoomAt(point.x, point.y, state.k * factor);
  };

  const onClickCapture = (event) => {
    if (suppressClick) {
      event.stopPropagation();
      event.preventDefault();
      suppressClick = false;
    }
  };

  const onControl = (event) => {
    const button = event.target.closest("[data-atlas-action]");
    if (!button) return;
    const action = button.dataset.atlasAction;
    const center = { x: width / 2, y: height / 2 };
    if (action === "zoom-in") zoomAt(center.x, center.y, state.k * 1.25, true);
    else if (action === "zoom-out") zoomAt(center.x, center.y, state.k / 1.25, true);
    else if (action === "fit") fit(true);
    else if (action === "reset") reset(true);
  };

  svg.addEventListener("pointerdown", onPointerDown);
  svg.addEventListener("pointermove", onPointerMove);
  svg.addEventListener("pointerup", endPointer);
  svg.addEventListener("pointercancel", endPointer);
  svg.addEventListener("wheel", onWheel, { passive: false });
  svg.addEventListener("click", onClickCapture, true);
  host.querySelector(".atlas-controls").addEventListener("click", onControl);

  const resizeObserver = new ResizeObserver(() => {
    size();
    apply();
  });
  resizeObserver.observe(svg);

  const setScene = (sceneMarkup, nextBounds, { keepView = false } = {}) => {
    world.innerHTML = sceneMarkup;
    if (nextBounds) bounds = nextBounds;
    size();
    if (keepView) apply();
    else fit(false);
  };

  const destroy = () => {
    if (animation) cancelAnimationFrame(animation);
    resizeObserver.disconnect();
    svg.removeEventListener("pointerdown", onPointerDown);
    svg.removeEventListener("pointermove", onPointerMove);
    svg.removeEventListener("pointerup", endPointer);
    svg.removeEventListener("pointercancel", endPointer);
    svg.removeEventListener("wheel", onWheel);
    svg.removeEventListener("click", onClickCapture, true);
  };

  size();

  return { svg, world, element: viewport, setScene, fit, reset, focusNode, worldToScreen, zoomAt, destroy, state };
};
