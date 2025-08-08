import {
  Calendar,
  Check,
  CircleAlert,
  Copy,
  Info,
  LayoutGrid,
  Lock,
  Monitor,
  Moon,
  RefreshCw,
  Sun,
  createElement,
  type IconNode,
} from 'lucide';

const ICONS: Record<string, IconNode> = {
  calendar: Calendar,
  check: Check,
  'circle-alert': CircleAlert,
  copy: Copy,
  info: Info,
  'layout-grid': LayoutGrid,
  lock: Lock,
  monitor: Monitor,
  moon: Moon,
  'refresh-cw': RefreshCw,
  sun: Sun,
};

export function icon(name: string, strokeWidth = 2): SVGElement | null {
  const node = ICONS[name];
  return node ? createElement(node, { 'aria-hidden': 'true', focusable: 'false', 'stroke-width': strokeWidth }) : null;
}

/** Replaces each `<span data-icon="name" data-stroke="2">` placeholder with its Lucide SVG. */
export function renderIcons(root: ParentNode = document): void {
  for (const slot of root.querySelectorAll<HTMLElement>('[data-icon]')) {
    const svg = icon(slot.dataset.icon ?? '', Number(slot.dataset.stroke ?? 2));
    if (svg) slot.replaceChildren(svg);
  }
}
