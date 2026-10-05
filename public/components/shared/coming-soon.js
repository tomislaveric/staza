import { getAppLocale, translateAppText } from "../../app-locales.js";

const DEFAULT_MESSAGE = "Coming soon";
const TOOLTIP_ID = "coming-soon-tooltip";

let initialized = false;
let tooltip;
let activeTarget;

const findTarget = (node) => (node instanceof Element ? node.closest("[data-coming-soon]") : null);

const ensureTooltip = () => {
  if (tooltip) return tooltip;
  tooltip = document.createElement("div");
  tooltip.id = TOOLTIP_ID;
  tooltip.className = "coming-soon-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  document.body.appendChild(tooltip);
  return tooltip;
};

const messageFor = (target) => {
  const raw = target.dataset.comingSoon?.trim();
  const text = raw && raw !== "" ? raw : DEFAULT_MESSAGE;
  return translateAppText(text, getAppLocale());
};

const positionTooltip = (target) => {
  const rect = target.getBoundingClientRect();
  const bubble = tooltip.getBoundingClientRect();
  const gap = 8;
  let top = rect.top - bubble.height - gap;
  if (top < gap) top = rect.bottom + gap;
  let left = rect.left + rect.width / 2 - bubble.width / 2;
  left = Math.max(gap, Math.min(left, window.innerWidth - bubble.width - gap));
  tooltip.style.top = `${Math.round(top)}px`;
  tooltip.style.left = `${Math.round(left)}px`;
};

const show = (target) => {
  ensureTooltip();
  tooltip.textContent = messageFor(target);
  tooltip.hidden = false;
  activeTarget = target;
  target.setAttribute("aria-describedby", TOOLTIP_ID);
  positionTooltip(target);
};

const hide = () => {
  if (!tooltip || tooltip.hidden) return;
  tooltip.hidden = true;
  if (activeTarget) activeTarget.removeAttribute("aria-describedby");
  activeTarget = undefined;
};

export const initComingSoon = () => {
  if (initialized) return;
  initialized = true;

  document.addEventListener("click", (event) => {
    const target = findTarget(event.target);
    if (!target) {
      if (activeTarget) hide();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    show(target);
  });

  document.addEventListener("mouseover", (event) => {
    const target = findTarget(event.target);
    if (target) show(target);
  });

  document.addEventListener("mouseout", (event) => {
    const target = findTarget(event.target);
    if (target && target === activeTarget && !target.contains(event.relatedTarget)) hide();
  });

  document.addEventListener("focusin", (event) => {
    const target = findTarget(event.target);
    if (target) show(target);
  });

  document.addEventListener("focusout", (event) => {
    const target = findTarget(event.target);
    if (target && target === activeTarget) hide();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hide();
  });

  window.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
};
