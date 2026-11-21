/*
 * How cell styles look on screen, plus the small pickers shared by the toolbar
 * and the alignment popover.
 */
import { Align, CellStyle, FontSize, PALETTE, VAlign } from "./model";

export const FONT_SIZES: Record<FontSize, string> = { small: "0.85em", large: "1.2em", "x-large": "1.5em" };
export const SIZE_OPTIONS: [FontSize | "", string][] = [["", "Normal"], ["small", "Small"], ["large", "Large"], ["x-large", "X-large"]];

export const FONTS: Record<string, string> = {
  sans: "var(--font-interface)",
  serif: 'Georgia, "Times New Roman", serif',
  mono: "var(--font-monospace)",
};
export const FONT_OPTIONS: [string, string][] = [["", "Default"], ["sans", "Sans"], ["serif", "Serif"], ["mono", "Monospace"]];

/** Theme colors become a soft tint as a background and the full color as text. */
export function colorCss(v: string, bg: boolean): string {
  if (v.startsWith("#")) return v;
  if (v === "gray") return bg ? "rgba(var(--mono-rgb-100), 0.12)" : "var(--text-muted)";
  return bg ? `rgba(var(--color-${v}-rgb), 0.2)` : `var(--color-${v})`;
}

export function fontCss(font: string): string {
  return FONTS[font] ?? `"${font}", var(--font-text)`;
}

export function applyStyle(td: HTMLElement, s: CellStyle): void {
  if (s.bg) td.style.backgroundColor = colorCss(s.bg, true);
  if (s.color) td.style.color = colorCss(s.color, false);
  if (s.bold) td.style.fontWeight = "bold";
  if (s.italic) td.style.fontStyle = "italic";
  if (s.strike) td.style.textDecoration = "line-through";
  if (s.size) td.style.fontSize = FONT_SIZES[s.size];
  if (s.font) td.style.fontFamily = fontCss(s.font);
}

/** `#abc` → `#aabbcc`, the only form a color input accepts. */
function expandHex(v: string): string {
  return v.length === 4 ? "#" + v.slice(1).split("").map((ch) => ch + ch).join("") : v;
}

/** "None", the theme colors and a custom color input. `pick(undefined)` means none. */
export function swatchStrip(parent: HTMLElement, cur: string | undefined, bg: boolean, pick: (v: string | undefined) => void): void {
  const strip = parent.createDiv({ cls: "rt-swatches" });
  const none = strip.createEl("button", {
    cls: "rt-swatch rt-swatch-none" + (!cur ? " is-active" : ""),
    attr: { "aria-label": "None" },
  });
  none.addEventListener("click", () => pick(undefined));
  for (const name of PALETTE) {
    const b = strip.createEl("button", {
      cls: "rt-swatch" + (cur === name ? " is-active" : ""),
      attr: { "aria-label": name },
    });
    b.style.background = colorCss(name, bg);
    if (bg) b.style.boxShadow = `inset 0 0 0 2px ${colorCss(name, false)}`;
    b.addEventListener("click", () => pick(name));
  }
  const custom = !!cur?.startsWith("#");
  const input = strip.createEl("input", {
    cls: "rt-swatch rt-swatch-custom" + (custom ? " is-active" : ""),
    attr: { type: "color", "aria-label": "Custom color" },
  });
  input.value = custom ? expandHex(cur!) : "#888888";
  input.addEventListener("change", () => pick(input.value.toLowerCase()));
}

/** A 3x3 grid, left/center/right by top/middle/bottom. An unset axis shows as left/top. */
export function alignGrid(parent: HTMLElement, cur: { h: Align; v: VAlign }, pick: (h: Align, v: VAlign) => void): void {
  const grid = parent.createDiv({ cls: "rt-align-grid" });
  const set = !!(cur.h || cur.v);
  const vs: VAlign[] = ["top", "middle", "bottom"];
  const hs: Align[] = ["left", "center", "right"];
  for (const v of vs) {
    for (const h of hs) {
      const on = set && (cur.h || "left") === h && (cur.v || "top") === v;
      const b = grid.createEl("button", {
        cls: "rt-align-btn" + (on ? " is-active" : ""),
        attr: { "aria-label": v + " " + h },
      });
      b.style.justifyContent = h === "left" ? "flex-start" : h === "right" ? "flex-end" : "center";
      b.style.alignItems = v === "top" ? "flex-start" : v === "bottom" ? "flex-end" : "center";
      b.createDiv({ cls: "rt-align-lines" });
      b.addEventListener("click", () => pick(h, v));
    }
  }
}

/** A vertical list of choices with the current one marked. */
export function optionList<T extends string>(
  parent: HTMLElement,
  options: [T, string][],
  cur: string,
  pick: (v: T) => void,
  preview?: (b: HTMLElement, v: T) => void
): void {
  const list = parent.createDiv({ cls: "rt-options" });
  for (const [v, text] of options) {
    const b = list.createEl("button", { cls: "rt-option" + (v === cur ? " is-active" : ""), text });
    preview?.(b, v);
    b.addEventListener("click", () => pick(v));
  }
}
