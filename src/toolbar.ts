/*
 * Floating formatting toolbar shown above a table's selection. It knows nothing
 * about tables: the view supplies the current state and carries out each action.
 */
import { App, setIcon } from "obsidian";
import { Align, CellStyle, FontSize, VAlign, isFontName } from "./model";
import { FONT_OPTIONS, FONTS, SIZE_OPTIONS, alignGrid, colorCss, fontCss, optionList, swatchStrip } from "./format";

export interface ToolbarState {
  /** "Cell", "3 cells", "Row 2", "Columns 1–3". */
  label: string;
  /** The first target's own style and alignment (not inherited ones). */
  style: CellStyle;
  align: { h: Align; v: VAlign };
  canMerge: boolean;
  canSplit: boolean;
  painting: boolean;
}

export interface ToolbarHost {
  state(): ToolbarState;
  /** Screen rectangle of the table, or null when it isn't laid out. */
  anchor(): DOMRect | null;
  /** Screen rectangle of the scrolling note pane the table is in. */
  bounds(): DOMRect | null;
  setStyle(patch: Partial<CellStyle> | null): void;
  setAlign(h: Align, v: VAlign): void;
  merge(): void;
  split(): void;
  togglePainter(): void;
}

type Panel = "bg" | "color" | "size" | "font" | "align";

/** Where the user dragged the toolbar, shared by every table; absent means docked above the table. */
const POS_KEY = "interactive-tables:toolbar-pos";

function loadPos(app: App): { x: number; y: number } | null {
  try {
    const v = app.loadLocalStorage(POS_KEY) as { x: number; y: number } | null;
    return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? v : null;
  } catch {
    return null;
  }
}

function savePos(app: App, v: { x: number; y: number } | null): void {
  try {
    app.saveLocalStorage(POS_KEY, v);
  } catch {
    // Storage unavailable: the position just isn't remembered.
  }
}

export class TableToolbar {
  readonly el: HTMLElement;
  private open: Panel | null = null;

  constructor(private host: ToolbarHost, private doc: Document, private app: App) {
    this.el = doc.body.createDiv({ cls: "rt-toolbar" });
    // Keep focus where it is when a button is pressed; inputs still take focus.
    this.el.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).closest("button")) e.preventDefault();
    });
  }

  private get win(): Window {
    return this.doc.defaultView ?? window;
  }

  destroy(): void {
    this.el.remove();
  }

  /** Close an open dropdown. Returns whether one was open. */
  closePanel(): boolean {
    if (!this.open) return false;
    this.open = null;
    this.refresh();
    return true;
  }

  refresh(): void {
    const s = this.host.state();
    this.el.empty();
    const bar = this.el.createDiv({ cls: "rt-tb-bar" });
    this.bindHandle(bar.createDiv({
      cls: "rt-tb-handle",
      attr: { "aria-label": "Drag to move the toolbar. Double-click to dock it above the table." },
    }));
    bar.createSpan({ cls: "rt-tb-label", text: s.label });
    const sep = () => bar.createDiv({ cls: "rt-tb-sep" });
    const button = (icon: string, label: string, onClick: () => void, opts: { active?: boolean; disabled?: boolean } = {}) => {
      const b = bar.createEl("button", {
        cls: "clickable-icon rt-tb-btn" + (opts.active ? " is-active" : ""),
        attr: { "aria-label": label },
      });
      setIcon(b, icon);
      if (opts.disabled) b.disabled = true;
      else b.addEventListener("click", onClick);
      return b;
    };
    const dropdown = (panel: Panel, icon: string, label: string) => {
      const b = button(icon, label, () => {
        this.open = this.open === panel ? null : panel;
        this.refresh();
      }, { active: this.open === panel });
      b.addClass("rt-tb-dropdown");
      return b;
    };
    const run = (fn: () => void) => () => {
      this.open = null;
      fn();
    };

    sep();
    const bg = dropdown("bg", "paint-bucket", "Fill color");
    bg.createDiv({ cls: "rt-tb-colorbar" }).style.background = s.style.bg ? colorCss(s.style.bg, false) : "transparent";
    const fg = dropdown("color", "baseline", "Text color");
    fg.createDiv({ cls: "rt-tb-colorbar" }).style.background = s.style.color ? colorCss(s.style.color, false) : "transparent";
    sep();
    for (const [key, icon, label] of [["bold", "bold", "Bold"], ["italic", "italic", "Italic"], ["strike", "strikethrough", "Strikethrough"]] as const) {
      button(icon, label, run(() => this.host.setStyle({ [key]: !s.style[key] })), { active: !!s.style[key] });
    }
    sep();
    dropdown("size", "a-large-small", "Text size");
    dropdown("font", "type", "Font");
    sep();
    dropdown("align", s.align.h === "center" ? "align-center" : s.align.h === "right" ? "align-right" : "align-left", "Alignment");
    sep();
    button("combine", "Merge selected cells", run(() => this.host.merge()), { disabled: !s.canMerge });
    button("split", "Split cell", run(() => this.host.split()), { disabled: !s.canSplit });
    sep();
    button(
      "paintbrush",
      s.painting ? "Click a cell, or a row or column grip, to paste. Esc cancels." : "Format painter: copy this look",
      run(() => this.host.togglePainter()),
      { active: s.painting }
    );
    button("eraser", "Clear formatting", run(() => this.host.setStyle(null)));

    if (this.open) {
      const anchor = bar.querySelector<HTMLElement>(".rt-tb-dropdown.is-active");
      const panel = this.el.createDiv({ cls: "rt-tb-panel" });
      if (anchor) panel.style.left = anchor.offsetLeft + "px";
      this.drawPanel(panel, this.open, s, run);
    }
    this.place();
  }

  private drawPanel(panel: HTMLElement, which: Panel, s: ToolbarState, run: (fn: () => void) => () => void): void {
    if (which === "bg" || which === "color") {
      swatchStrip(panel, s.style[which], which === "bg", (v) => run(() => this.host.setStyle({ [which]: v }))());
    } else if (which === "size") {
      optionList<FontSize | "">(panel, SIZE_OPTIONS, s.style.size ?? "", (v) => run(() => this.host.setStyle({ size: v || undefined }))());
    } else if (which === "font") {
      const custom = !!s.style.font && !(s.style.font in FONTS);
      optionList(
        panel,
        FONT_OPTIONS,
        custom ? "" : s.style.font ?? "",
        (v) => run(() => this.host.setStyle({ font: v || undefined }))(),
        (b, v) => { if (v) b.style.fontFamily = fontCss(v); }
      );
      const name = panel.createEl("input", {
        cls: "rt-font-name",
        attr: { type: "text", placeholder: "Custom font name, Enter to apply", "aria-label": "Custom font name" },
      });
      if (custom) name.value = s.style.font!;
      name.addEventListener("input", () => name.removeClass("is-invalid"));
      name.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const v = name.value.trim();
        if (!v) return;
        if (!isFontName(v)) name.addClass("is-invalid");
        else run(() => this.host.setStyle({ font: v }))();
      });
    } else {
      alignGrid(panel, s.align, (h, v) => run(() => this.host.setAlign(h, v))());
      const clear = panel.createEl("button", { cls: "rt-panel-clear", text: "Clear alignment" });
      clear.addEventListener("click", run(() => this.host.setAlign("", "")));
    }
  }

  /** Drag the handle to float the toolbar anywhere; double-click it to dock again. */
  private bindHandle(handle: HTMLElement): void {
    setIcon(handle, "grip-vertical");
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const start = this.el.getBoundingClientRect();
      const dx = e.clientX - start.left;
      const dy = e.clientY - start.top;
      handle.setPointerCapture(e.pointerId);
      this.el.addClass("is-dragging");
      const move = (ev: PointerEvent) => {
        this.el.style.left = ev.clientX - dx + "px";
        this.el.style.top = ev.clientY - dy + "px";
      };
      const up = (ev: PointerEvent) => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        this.el.removeClass("is-dragging");
        // A click without movement leaves a docked toolbar docked.
        if (Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - e.clientY) < 4) return;
        savePos(this.app, { x: ev.clientX - dx, y: ev.clientY - dy });
        this.place();
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
    handle.addEventListener("dblclick", () => {
      savePos(this.app, null);
      this.place();
    });
  }

  /**
   * Docked: just above the table's cells, held at the top of the note pane while
   * the table scrolls under it, hidden once the table is out of view. Floating:
   * wherever it was dragged, pulled back on screen if the window shrank.
   */
  place(): void {
    const r = this.host.anchor();
    const bar = this.el.querySelector<HTMLElement>(".rt-tb-bar");
    const w = bar?.offsetWidth ?? 0;
    const h = bar?.offsetHeight ?? 0;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
    const pos = loadPos(this.app);
    this.el.toggleClass("is-floating", !!pos);
    let top: number;
    let left: number;
    if (pos) {
      if (!r) return this.hidden(true);
      top = clamp(pos.y, 8, this.win.innerHeight - h - 8);
      left = clamp(pos.x, 8, this.win.innerWidth - w - 8);
    } else {
      const pane = this.host.bounds() ?? new DOMRect(0, 0, this.win.innerWidth, this.win.innerHeight);
      if (!r || r.bottom < pane.top + h || r.top > pane.bottom) return this.hidden(true);
      top = Math.min(Math.max(r.top - h - 4, pane.top + 4), r.bottom - h);
      left = clamp(r.left, Math.max(8, pane.left), this.win.innerWidth - w - 8);
    }
    this.hidden(false);
    this.el.style.top = top + "px";
    this.el.style.left = left + "px";
    // Open dropdowns upward when there isn't room below.
    const panel = this.el.querySelector<HTMLElement>(".rt-tb-panel");
    panel?.toggleClass("is-up", top + h + panel.offsetHeight + 12 > this.win.innerHeight);
  }

  private hidden(on: boolean): void {
    this.el.style.visibility = on ? "hidden" : "";
  }
}
