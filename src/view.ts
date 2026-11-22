import {
  App,
  Keymap,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  MarkdownRenderer,
  MarkdownView,
  Menu,
  Notice,
  TFile,
} from "obsidian";
import {
  Align,
  VAlign,
  Cell,
  CellStyle,
  Look,
  TableModel,
  Target,
  applyLook,
  cellAt,
  cloneModel,
  deleteCol,
  deleteRow,
  effectiveAlign,
  effectiveStyle,
  insertCol,
  insertRow,
  lookOf,
  mergeRange,
  moveCol,
  moveRow,
  parse,
  serialize,
  setAlign,
  setStyle,
  splitCell,
  copyGrid,
  gridToTsv,
  tsvToGrid,
  pasteGrid,
  stepFrom,
} from "./model";
import { alignGrid, applyStyle } from "./format";
import type { Dir } from "./model";
import { fencePrefix, isFenceLine, stripPrefix } from "./fence";
import type { Settings } from "./settings";
import { TableToolbar, ToolbarHost, ToolbarState } from "./toolbar";

/** Clipboard type carrying an exact grid between rich tables, alongside the plain text. */
const CLIP_TYPE = "application/x-interactive-tables-grid";

const DEFAULT_WIDTH = 120;
const MIN_WIDTH = 40;
const MIN_HEIGHT = 20;

type Scope = "cell" | "row" | "col";

/** Cells, or whole rows/columns picked with their grips. */
interface Selection {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
  scope: Scope;
}

type DragKind = "row" | "col";
type AlignScope = Scope;

export class RichTableView extends MarkdownRenderChild {
  private model: TableModel;
  private tableEl!: HTMLTableElement;
  private colEls: HTMLTableColElement[] = [];
  private handleThs: HTMLTableCellElement[] = [];
  private rowEls: HTMLTableRowElement[] = [];
  private cellEls = new Map<Cell, HTMLTableCellElement>();
  private indicator!: HTMLDivElement;
  private wrap!: HTMLDivElement;
  private selection: Selection | null = null;
  private drag: { kind: DragKind; index: number } | null = null;
  private editing: { cell: Cell; area: HTMLTextAreaElement } | null = null;
  private switching = false;
  private popover: HTMLElement | null = null;
  private popoverDone: (() => void) | null = null;
  private toolbar: TableToolbar | null = null;
  private toolbarOff: (() => void) | null = null;
  private painter: Look | null = null;

  /**
   * Saving rewrites the fence, and Obsidian then rebuilds the table as a new view.
   * The selection and painter ride along to that view, matched by the saved text.
   */
  private static carry: { path: string; body: string; selection: Selection | null; painter: Look | null; at: number } | null = null;

  constructor(
    private app: App,
    containerEl: HTMLElement,
    private source: string,
    private ctx: MarkdownPostProcessorContext,
    private settings: () => Settings
  ) {
    super(containerEl);
    this.model = parse(source);
    const k = RichTableView.carry;
    if (k && k.path === ctx.sourcePath && k.body === source.trim() && Date.now() - k.at < 5000) {
      RichTableView.carry = null;
      this.selection = k.selection;
      this.painter = k.painter;
    }
  }

  private get doc(): Document {
    return this.containerEl.ownerDocument;
  }

  private get win(): Window {
    return this.containerEl.ownerDocument.defaultView ?? window;
  }

  onload(): void {
    this.render();
  }

  onunload(): void {
    this.closePopover();
    this.hideToolbar();
  }

  /* ---------- rendering ---------- */

  private sized(): boolean {
    return this.model.widths.some((w) => w != null);
  }

  private render(): void {
    const m = this.model;
    const root = this.containerEl;
    const sel = this.selection;
    if (sel && Math.max(sel.r0, sel.r1) >= m.rows) this.selection = null;
    if (sel && Math.max(sel.c0, sel.c1) >= m.cols) this.selection = null;
    root.empty();
    root.addClass("rt-root");
    this.cellEls.clear();
    this.rowEls = [];
    this.colEls = [];
    this.handleThs = [];

    this.wrap = root.createDiv({ cls: "rt-wrap" });
    // Keep Live Preview from moving the cursor into the block when the table is used.
    this.wrap.addEventListener("mousedown", (e) => e.stopPropagation());
    this.wrap.addEventListener("click", (e) => this.onLinkClick(e));

    this.tableEl = this.wrap.createEl("table", { cls: "rt-table" });
    const colgroup = this.tableEl.createEl("colgroup");
    colgroup.createEl("col", { cls: "rt-gutter-col" });
    for (let c = 0; c < m.cols; c++) this.colEls.push(colgroup.createEl("col"));
    this.applyWidths();

    const thead = this.tableEl.createEl("thead");
    const hr = thead.createEl("tr", { cls: "rt-col-handles" });
    hr.createEl("th", { cls: "rt-corner" });
    for (let c = 0; c < m.cols; c++) {
      const th = hr.createEl("th", { cls: "rt-col-handle" });
      this.handleThs.push(th);
      const grip = th.createDiv({ cls: "rt-grip rt-grip-col", attr: { draggable: "true", "aria-label": "Drag to move column, click for options" } });
      grip.setText("⋯");
      this.bindGrip(grip, "col", c);
      const resizer = th.createDiv({ cls: "rt-resizer" });
      this.bindResizer(resizer, c);
    }

    const tbody = this.tableEl.createEl("tbody");
    for (let r = 0; r < m.rows; r++) {
      const tr = tbody.createEl("tr", { cls: r === 0 ? "rt-header-row" : "" });
      this.rowEls.push(tr);
      const height = m.heights[r];
      if (height != null) tr.style.height = height + "px";
      const gutter = tr.createEl("td", { cls: "rt-row-handle" });
      const grip = gutter.createDiv({ cls: "rt-grip rt-grip-row", attr: { draggable: "true", "aria-label": "Drag to move row, click for options" } });
      grip.setText("⋮");
      this.bindGrip(grip, "row", r);
      this.bindRowResizer(gutter.createDiv({ cls: "rt-row-resizer" }), r);
      for (const cell of m.cells.filter((x) => x.r === r).sort((a, b) => a.c - b.c)) {
        const td = tr.createEl(r === 0 ? "th" : "td", { cls: "rt-cell" });
        if (cell.rs > 1) td.rowSpan = cell.rs;
        if (cell.cs > 1) td.colSpan = cell.cs;
        const { h, v } = effectiveAlign(m, cell);
        if (h) td.style.textAlign = h;
        if (v) td.style.verticalAlign = v;
        applyStyle(td, effectiveStyle(m, cell));
        this.cellEls.set(cell, td);
        this.renderCell(cell);
        this.bindCell(td, cell);
      }
    }

    // Stretch the resize handles across the whole table so any row or column edge can be dragged.
    this.wrap.addEventListener("mouseenter", () => {
      const h = this.tableEl.offsetHeight + "px";
      const w = this.tableEl.offsetWidth + "px";
      this.wrap.querySelectorAll<HTMLElement>(".rt-resizer").forEach((el) => (el.style.height = h));
      this.wrap.querySelectorAll<HTMLElement>(".rt-row-resizer").forEach((el) => (el.style.width = w));
    });

    this.indicator = this.wrap.createDiv({ cls: "rt-drop-indicator" });
    this.bindDropZone();
    this.paintSelection();
  }

  private applyWidths(): void {
    const m = this.model;
    if (!this.sized()) {
      this.tableEl.removeClass("rt-fixed");
      this.tableEl.style.width = "";
      this.colEls.forEach((col) => (col.style.width = ""));
      return;
    }
    this.tableEl.addClass("rt-fixed");
    let total = 24;
    m.widths.forEach((w, c) => {
      const px = w ?? DEFAULT_WIDTH;
      total += px;
      if (this.colEls[c]) this.colEls[c].style.width = px + "px";
    });
    this.tableEl.style.width = total + "px";
  }

  private renderCell(cell: Cell): void {
    const td = this.cellEls.get(cell);
    if (!td) return;
    td.empty();
    const content = td.createDiv({ cls: "rt-cell-content" });
    if (cell.text.trim()) {
      MarkdownRenderer.render(this.app, cell.text, content, this.ctx.sourcePath, this);
    }
  }

  private onLinkClick(e: MouseEvent): void {
    const a = (e.target as HTMLElement).closest("a.internal-link") as HTMLAnchorElement | null;
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("data-href") ?? a.getAttribute("href") ?? "";
    this.app.workspace.openLinkText(href, this.ctx.sourcePath, Keymap.isModEvent(e));
  }

  /* ---------- cells ---------- */

  private bindCell(td: HTMLTableCellElement, cell: Cell): void {
    td.addEventListener("dblclick", (e) => {
      if ((e.target as HTMLElement).closest("a")) return;
      e.preventDefault();
      this.startEdit(cell);
    });
    td.addEventListener("click", (e) => {
      if (this.editing?.cell === cell) return;
      if ((e.target as HTMLElement).closest("a, input")) return;
      if (this.painter) {
        this.selection = { r0: cell.r, c0: cell.c, r1: cell.r + cell.rs - 1, c1: cell.c + cell.cs - 1, scope: "cell" };
        this.paste({ scope: "cell", cells: [[cell.r, cell.c]] });
        return;
      }
      if (e.shiftKey && this.selection) {
        this.selection = { ...this.selection, r1: cell.r + cell.rs - 1, c1: cell.c + cell.cs - 1, scope: "cell" };
      } else {
        this.selection = { r0: cell.r, c0: cell.c, r1: cell.r + cell.rs - 1, c1: cell.c + cell.cs - 1, scope: "cell" };
      }
      this.paintSelection();
    });
    td.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.cellMenu(cell, e).showAtMouseEvent(e);
    });
  }

  private selRect(): Selection | null {
    const s = this.selection;
    if (!s) return null;
    return {
      r0: Math.min(s.r0, s.r1),
      c0: Math.min(s.c0, s.c1),
      r1: Math.max(s.r0, s.r1),
      c1: Math.max(s.c0, s.c1),
      scope: s.scope,
    };
  }

  private paintSelection(): void {
    const s = this.selRect();
    for (const [cell, td] of this.cellEls) {
      const hit =
        !!s &&
        cell.r <= s.r1 &&
        cell.r + cell.rs - 1 >= s.r0 &&
        cell.c <= s.c1 &&
        cell.c + cell.cs - 1 >= s.c0;
      td.toggleClass("rt-selected", hit);
    }
    this.wrap.toggleClass("rt-painting", !!this.painter);
    if (s && !this.editing) this.showToolbar();
    else this.hideToolbar();
  }

  private selectionIsMulti(): boolean {
    const s = this.selRect();
    if (!s) return false;
    return this.model.cells.filter(
      (x) => x.r <= s.r1 && x.r + x.rs - 1 >= s.r0 && x.c <= s.c1 && x.c + x.cs - 1 >= s.c0
    ).length > 1;
  }

  private startEdit(cell: Cell, initial?: string): void {
    if (this.editing) this.commitEdit(false);
    this.selection = { r0: cell.r, c0: cell.c, r1: cell.r + cell.rs - 1, c1: cell.c + cell.cs - 1, scope: "cell" };
    this.hideToolbar();
    const td = this.cellEls.get(cell);
    if (!td) return;
    td.empty();
    td.addClass("rt-editing");
    const area = td.createEl("textarea", { cls: "rt-editor" });
    area.value = initial ?? cell.text;
    const fit = () => {
      area.style.height = "auto";
      area.style.height = area.scrollHeight + "px";
    };
    for (const ev of ["keyup", "keypress", "input", "paste", "cut", "copy", "beforeinput"]) {
      area.addEventListener(ev, (e) => e.stopPropagation());
    }
    area.addEventListener("input", fit);
    area.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        this.editing = null;
        td.removeClass("rt-editing");
        this.renderCell(cell);
        this.paintSelection();
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        // Like a spreadsheet: Enter moves down, Shift+Enter is a line break (handled by the textarea).
        const below = (this.settings().enterMovesDown && stepFrom(this.model, cell, "down")) || cell;
        this.selection = { r0: below.r, c0: below.c, r1: below.r + below.rs - 1, c1: below.c + below.cs - 1, scope: "cell" };
        this.commitEdit(true);
        this.paintSelection();
      } else if (e.key === "Tab") {
        e.preventDefault();
        const next = this.neighbourCell(cell, e.shiftKey ? -1 : 1);
        this.switching = true;
        this.commitEdit(false);
        this.switching = false;
        if (next) this.startEdit(next);
        else void this.save();
      }
    });
    area.addEventListener("blur", () => {
      if (this.switching) return;
      if (this.editing?.area === area) this.commitEdit(true);
    });
    this.editing = { cell, area };
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
    fit();
  }

  private commitEdit(save: boolean): void {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    ed.cell.text = ed.area.value;
    this.cellEls.get(ed.cell)?.removeClass("rt-editing");
    this.renderCell(ed.cell);
    if (save) void this.save();
  }

  private neighbourCell(cell: Cell, dir: 1 | -1): Cell | undefined {
    const order = [...this.model.cells].sort((a, b) => a.r - b.r || a.c - b.c);
    return order[order.indexOf(cell) + dir];
  }

  /** Spreadsheet-style keys for the selected cell: arrows, Tab, Enter/F2, Delete, or just start typing. */
  private onNavKey(e: KeyboardEvent): void {
    const s = this.selRect();
    if (!s || s.scope !== "cell" || this.editing || this.popover || e.isComposing) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const focus = this.doc.activeElement;
    if (focus instanceof HTMLInputElement || focus instanceof HTMLTextAreaElement || focus instanceof HTMLSelectElement) return;
    // The active end of the selection, which is where arrows move from and Shift+arrows extend.
    const end = this.selection!;
    const active = cellAt(this.model, end.r1, end.c1);
    if (!active) return;
    const eat = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    const go = (to: Cell | undefined, extend: boolean) => {
      eat();
      if (!to) return;
      const cur = this.selection!;
      this.selection = extend
        ? { ...cur, r1: to.r + to.rs - 1 > cur.r0 ? to.r + to.rs - 1 : to.r, c1: to.c + to.cs - 1 > cur.c0 ? to.c + to.cs - 1 : to.c, scope: "cell" }
        : { r0: to.r, c0: to.c, r1: to.r + to.rs - 1, c1: to.c + to.cs - 1, scope: "cell" };
      this.paintSelection();
      this.cellEls.get(to)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    const arrows: Record<string, Dir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
    if (e.key in arrows) {
      go(stepFrom(this.model, active, arrows[e.key]), e.shiftKey);
    } else if (e.key === "Tab") {
      go(this.neighbourCell(active, e.shiftKey ? -1 : 1), false);
    } else if (e.key === "Enter" || e.key === "F2") {
      eat();
      this.startEdit(active);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      eat();
      this.apply((m) => {
        for (const c of this.cellsIn(s)) {
          const mc = cellAt(m, c.r, c.c);
          if (mc) mc.text = "";
        }
      });
    } else if (e.key.length === 1) {
      eat();
      this.startEdit(active, e.key);
    }
  }

  /* ---------- menus ---------- */

  private cellMenu(cell: Cell, evt: MouseEvent): Menu {
    const menu = new Menu();
    const top = cell.r;
    const bottom = cell.r + cell.rs;
    const left = cell.c;
    const right = cell.c + cell.cs;
    menu.addItem((i) => i.setTitle("Edit cell").setIcon("pencil").onClick(() => this.startEdit(cell)));
    const s = this.selRect();
    const inSel = (x: Cell) =>
      !!s && x.r <= s.r1 && x.r + x.rs - 1 >= s.r0 && x.c <= s.c1 && x.c + x.cs - 1 >= s.c0;
    const clearMany = inSel(cell) && this.selectionIsMulti();
    const toClear = (clearMany ? this.model.cells.filter(inSel) : [cell]).map((x) => [x.r, x.c]);
    menu.addItem((i) =>
      i.setTitle(clearMany ? "Clear selected cells" : "Clear cell").setIcon("eraser").onClick(() =>
        this.apply((m) => {
          for (const [r, c] of toClear) {
            const x = m.cells.find((y) => y.r === r && y.c === c);
            if (x) x.text = "";
          }
        })
      )
    );
    menu.addSeparator();
    menu.addItem((i) => i.setTitle("Insert row above").setIcon("arrow-up").onClick(() => this.apply((m) => insertRow(m, top))));
    menu.addItem((i) => i.setTitle("Insert row below").setIcon("arrow-down").onClick(() => this.apply((m) => insertRow(m, bottom))));
    menu.addItem((i) => i.setTitle("Insert column left").setIcon("arrow-left").onClick(() => this.apply((m) => insertCol(m, left))));
    menu.addItem((i) => i.setTitle("Insert column right").setIcon("arrow-right").onClick(() => this.apply((m) => insertCol(m, right))));
    menu.addSeparator();
    if (this.selectionIsMulti()) {
      menu.addItem((i) =>
        i.setTitle("Merge selected cells").setIcon("combine").onClick(() => {
          const s = this.selRect()!;
          this.selection = null;
          this.apply((m) => mergeRange(m, s.r0, s.c0, s.r1, s.c1) != null);
        })
      );
    }
    if (right < this.model.cols)
      menu.addItem((i) => i.setTitle("Merge with cell right").setIcon("merge").onClick(() => this.apply((m) => mergeRange(m, top, left, bottom - 1, right) != null)));
    if (bottom < this.model.rows)
      menu.addItem((i) => i.setTitle("Merge with cell below").setIcon("merge").onClick(() => this.apply((m) => mergeRange(m, top, left, bottom, right - 1) != null)));
    if (cell.rs > 1 || cell.cs > 1)
      menu.addItem((i) => i.setTitle("Split cell").setIcon("split").onClick(() => this.apply((m) => splitCell(m, cell))));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle("Alignment…").setIcon("align-center").onClick(() => this.alignPopover(evt, "cell", cell)));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle("Delete row").setIcon("trash").onClick(() => this.apply((m) => deleteRow(m, top))));
    menu.addItem((i) => i.setTitle("Delete column").setIcon("trash").onClick(() => this.apply((m) => deleteCol(m, left))));
    return menu;
  }

  private rowMenu(r: number, evt: MouseEvent): Menu {
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("Insert row above").setIcon("arrow-up").onClick(() => this.apply((m) => insertRow(m, r))));
    menu.addItem((i) => i.setTitle("Insert row below").setIcon("arrow-down").onClick(() => this.apply((m) => insertRow(m, r + 1))));
    menu.addSeparator();
    if (r > 0) menu.addItem((i) => i.setTitle("Move row up").setIcon("chevron-up").onClick(() => this.applyMove("row", r, r - 1)));
    if (r < this.model.rows - 1) menu.addItem((i) => i.setTitle("Move row down").setIcon("chevron-down").onClick(() => this.applyMove("row", r, r + 1)));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle("Align row…").setIcon("align-center").onClick(() => this.alignPopover(evt, "row", undefined, r)));
    if (this.model.heights[r] != null)
      menu.addItem((i) => i.setTitle("Reset row height").setIcon("rotate-ccw").onClick(() => this.apply((m) => { m.heights[r] = null; })));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle("Delete row").setIcon("trash").onClick(() => this.apply((m) => deleteRow(m, r))));
    return menu;
  }

  private colMenu(c: number, evt: MouseEvent): Menu {
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("Insert column left").setIcon("arrow-left").onClick(() => this.apply((m) => insertCol(m, c))));
    menu.addItem((i) => i.setTitle("Insert column right").setIcon("arrow-right").onClick(() => this.apply((m) => insertCol(m, c + 1))));
    menu.addSeparator();
    if (c > 0) menu.addItem((i) => i.setTitle("Move column left").setIcon("chevron-left").onClick(() => this.applyMove("col", c, c - 1)));
    if (c < this.model.cols - 1) menu.addItem((i) => i.setTitle("Move column right").setIcon("chevron-right").onClick(() => this.applyMove("col", c, c + 1)));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle("Align column…").setIcon("align-center").onClick(() => this.alignPopover(evt, "col", undefined, undefined, c)));
    if (this.sized())
      menu.addItem((i) => i.setTitle("Reset all column widths").setIcon("rotate-ccw").onClick(() => this.apply((m) => { m.widths = m.widths.map(() => null); })));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle("Delete column").setIcon("trash").onClick(() => this.apply((m) => deleteCol(m, c))));
    return menu;
  }

  /* ---------- drag and drop ---------- */

  private bindGrip(grip: HTMLElement, kind: DragKind, index: number): void {
    grip.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.selectLine(kind, index, e.shiftKey);
    });
    grip.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      (kind === "row" ? this.rowMenu(index, e) : this.colMenu(index, e)).showAtMouseEvent(e);
    });
    grip.addEventListener("dragstart", (e) => {
      e.stopPropagation();
      this.drag = { kind, index };
      e.dataTransfer?.setData("text/plain", "");
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      const el = kind === "row" ? this.rowEls[index] : null;
      if (el && e.dataTransfer) e.dataTransfer.setDragImage(el, 10, 10);
      this.wrap.addClass("rt-dragging");
    });
    grip.addEventListener("dragend", () => this.endDrag());
  }

  private endDrag(): void {
    this.drag = null;
    this.indicator.removeClass("is-visible");
    this.wrap.removeClass("rt-dragging");
  }

  /** Boundary index (0..n) nearest the pointer, plus its pixel offset in the wrapper. */
  private boundary(kind: DragKind, e: DragEvent): { index: number; pos: number } {
    const wrapRect = this.wrap.getBoundingClientRect();
    const els: HTMLElement[] = kind === "row" ? this.rowEls : this.handleThs;
    let best = { index: 0, pos: 0, dist: Infinity };
    els.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const edges: [number, number][] =
        kind === "row" ? [[i, r.top], [i + 1, r.bottom]] : [[i, r.left], [i + 1, r.right]];
      for (const [idx, px] of edges) {
        const d = Math.abs((kind === "row" ? e.clientY : e.clientX) - px);
        if (d < best.dist) best = { index: idx, pos: px, dist: d };
      }
    });
    const offset = kind === "row" ? wrapRect.top - this.wrap.scrollTop : wrapRect.left - this.wrap.scrollLeft;
    return { index: best.index, pos: best.pos - offset };
  }

  private bindDropZone(): void {
    this.tableEl.addEventListener("dragover", (e) => {
      if (!this.drag) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      const b = this.boundary(this.drag.kind, e);
      const tableRect = this.tableEl.getBoundingClientRect();
      const wrapRect = this.wrap.getBoundingClientRect();
      const ind = this.indicator;
      ind.addClass("is-visible");
      if (this.drag.kind === "row") {
        ind.removeClass("is-col");
        ind.style.top = b.pos - 1 + "px";
        ind.style.left = tableRect.left - wrapRect.left + this.wrap.scrollLeft + "px";
        ind.style.width = tableRect.width + "px";
        ind.style.height = "";
      } else {
        ind.addClass("is-col");
        ind.style.left = b.pos - 1 + "px";
        ind.style.top = tableRect.top - wrapRect.top + this.wrap.scrollTop + "px";
        ind.style.height = tableRect.height + "px";
        ind.style.width = "";
      }
    });
    this.tableEl.addEventListener("dragleave", (e) => {
      if (!this.tableEl.contains(e.relatedTarget as Node)) this.indicator.removeClass("is-visible");
    });
    this.tableEl.addEventListener("drop", (e) => {
      if (!this.drag) return;
      e.preventDefault();
      e.stopPropagation();
      const { kind, index } = this.drag;
      const b = this.boundary(kind, e);
      this.endDrag();
      const to = b.index > index ? b.index - 1 : b.index;
      if (to !== index) this.applyMove(kind, index, to);
    });
  }

  private applyMove(kind: DragKind, from: number, to: number): void {
    const ok = this.apply((m) => (kind === "row" ? moveRow(m, from, to) : moveCol(m, from, to)));
    if (!ok) new Notice("Can't move it there without splitting a merged cell. Split the cell first.");
  }

  /* ---------- column resizing ---------- */

  private bindResizer(handle: HTMLElement, c: number): void {
    handle.addEventListener("click", (e) => e.stopPropagation());
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.sized()) {
        // First resize: freeze every column at its current rendered width.
        this.model.widths = this.handleThs.map((th) => Math.round(th.getBoundingClientRect().width));
        this.applyWidths();
      }
      const startX = e.clientX;
      const startW = this.model.widths[c] ?? DEFAULT_WIDTH;
      handle.setPointerCapture(e.pointerId);
      this.wrap.addClass("rt-resizing");
      const move = (ev: PointerEvent) => {
        this.model.widths[c] = Math.max(MIN_WIDTH, Math.round(startW + ev.clientX - startX));
        this.applyWidths();
      };
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        this.wrap.removeClass("rt-resizing");
        void this.save();
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
    handle.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      this.apply((m) => {
        m.widths[c] = null;
        if (m.widths.every((w) => w == null)) return;
        m.widths[c] = DEFAULT_WIDTH;
      });
    });
  }

  /* ---------- popovers ---------- */

  private closePopover(): void {
    const done = this.popoverDone;
    this.popoverDone = null;
    this.popover?.remove();
    this.popover = null;
    done?.();
  }

  /** Place `pop` beside the pointer, kept on screen. Esc or a click outside closes it, then `onClose` runs. */
  private showPopover(evt: MouseEvent, pop: HTMLElement, onClose?: () => void): void {
    const rect = pop.getBoundingClientRect();
    const x = Math.min(evt.clientX, this.win.innerWidth - rect.width - 8);
    const y = Math.min(evt.clientY, this.win.innerHeight - rect.height - 8);
    pop.style.left = Math.max(8, x) + "px";
    pop.style.top = Math.max(8, y) + "px";

    const outside = (e: MouseEvent) => {
      if (!pop.contains(e.target as Node)) this.closePopover();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") this.closePopover();
    };
    this.popoverDone = () => {
      this.doc.removeEventListener("mousedown", outside, true);
      this.doc.removeEventListener("keydown", key, true);
      onClose?.();
    };
    // Defer so the click that opened the popover doesn't close it.
    this.win.setTimeout(() => {
      if (this.popover !== pop) return;
      this.doc.addEventListener("mousedown", outside, true);
      this.doc.addEventListener("keydown", key, true);
    });
  }

  /* ---------- alignment picker ---------- */

  /**
   * The 3x3 alignment grid for a cell (with Cell/Row/Column tabs) or a row or column.
   * With a multi-cell selection, "cell" covers every selected cell and "row"/"column"
   * cover every selected row/column.
   */
  private alignPopover(evt: MouseEvent, scope: AlignScope, cell?: Cell, row?: number, col?: number): void {
    this.closePopover();
    const pop = this.doc.body.createDiv({ cls: "rt-align-pop" });
    this.popover = pop;

    const s = this.selRect();
    const useSel = !!cell && !!s && s.scope === "cell" && this.cellsIn(s).includes(cell) && this.selectionIsMulti();
    const cells: [number, number][] = (useSel ? this.cellsIn(s!) : cell ? [cell] : []).map((x) => [x.r, x.c]);
    const rows = useSel ? range(s!.r0, s!.r1) : cell ? range(cell.r, cell.r + cell.rs - 1) : row != null ? [row] : [];
    const cols = useSel ? range(s!.c0, s!.c1) : cell ? range(cell.c, cell.c + cell.cs - 1) : col != null ? [col] : [];
    const target = (sc: AlignScope): Target =>
      sc === "cell" ? { scope: "cell", cells } : { scope: sc, indices: sc === "row" ? rows : cols };

    const current = (sc: AlignScope): { h: Align; v: VAlign } => {
      const m = this.model;
      if (sc === "cell") {
        const c0 = cellAt(m, cells[0]?.[0] ?? -1, cells[0]?.[1] ?? -1);
        return { h: c0?.align ?? "", v: c0?.valign ?? "" };
      }
      if (sc === "row") return { h: m.rowAligns[rows[0]] ?? "", v: m.rowValigns[rows[0]] ?? "" };
      return { h: m.aligns[cols[0]] ?? "", v: m.valigns[cols[0]] ?? "" };
    };

    const set = (sc: AlignScope, h: Align, v: VAlign) => {
      this.closePopover();
      this.apply((m) => setAlign(m, target(sc), h, v));
    };

    let active: AlignScope = scope;
    const labels: Record<AlignScope, string> = {
      cell: useSel ? "Cells" : "Cell",
      row: rows.length > 1 ? "Rows" : "Row",
      col: cols.length > 1 ? "Columns" : "Column",
    };
    const tabs = pop.createDiv({ cls: "rt-align-tabs" });
    const body = pop.createDiv();
    const footer = pop.createDiv({ cls: "rt-align-footer" });

    const draw = () => {
      tabs.empty();
      const scopes: AlignScope[] = cell ? ["cell", "row", "col"] : [scope];
      for (const sc of scopes) {
        const b = tabs.createEl("button", { text: labels[sc], cls: sc === active ? "is-active" : "" });
        b.addEventListener("click", () => { active = sc; draw(); });
      }
      body.empty();
      alignGrid(body, current(active), (h, v) => set(active, h, v));
      footer.empty();
      const clear = footer.createEl("button", { text: "Clear" });
      clear.setAttr("aria-label", active === "cell" ? "Use the row or column alignment" : "Back to default");
      clear.addEventListener("click", () => set(active, "", ""));
    };
    draw();
    this.showPopover(evt, pop);
  }

  /* ---------- selection toolbar ---------- */

  private cellsIn(s: Selection): Cell[] {
    return this.model.cells.filter(
      (x) => x.r <= s.r1 && x.r + x.rs - 1 >= s.r0 && x.c <= s.c1 && x.c + x.cs - 1 >= s.c0
    );
  }

  /** What the toolbar acts on: the selected cells, or the rows/columns picked by grip. */
  private target(): Target | null {
    const s = this.selRect();
    if (!s) return null;
    if (s.scope === "row") return { scope: "row", indices: range(s.r0, s.r1) };
    if (s.scope === "col") return { scope: "col", indices: range(s.c0, s.c1) };
    return { scope: "cell", cells: this.cellsIn(s).map((x): [number, number] => [x.r, x.c]) };
  }

  /** Grip click: select the row/column (shift extends), or paste the painter onto it. */
  private selectLine(kind: DragKind, index: number, extend: boolean): void {
    const m = this.model;
    const prev = this.selection;
    const line = (a: number, b: number): Selection =>
      kind === "row"
        ? { r0: a, r1: b, c0: 0, c1: m.cols - 1, scope: "row" }
        : { r0: 0, r1: m.rows - 1, c0: a, c1: b, scope: "col" };
    if (this.painter) {
      this.selection = line(index, index);
      this.paste({ scope: kind, indices: [index] });
      return;
    }
    const from = extend && prev?.scope === kind ? (kind === "row" ? prev.r0 : prev.c0) : index;
    this.selection = line(from, index);
    this.paintSelection();
  }

  private paste(t: Target): void {
    const look = this.painter!;
    this.painter = null;
    this.apply((m) => applyLook(m, t, look));
  }

  private toolbarHost(): ToolbarHost {
    const edit = (fn: (m: TableModel, t: Target) => void) => {
      const t = this.target();
      if (t) this.apply((m) => fn(m, t));
    };
    return {
      state: () => this.toolbarState(),
      anchor: () => {
        if (!this.containerEl.isConnected) return null;
        // The whole table, column grips included, so docking never covers them.
        const table = this.tableEl.getBoundingClientRect();
        return table.width ? table : null;
      },
      bounds: () => {
        const pane = this.containerEl.closest(".cm-scroller, .markdown-preview-view");
        return pane ? pane.getBoundingClientRect() : null;
      },
      setStyle: (patch) => edit((m, t) => setStyle(m, t, patch)),
      setAlign: (h, v) => edit((m, t) => setAlign(m, t, h, v)),
      merge: () => {
        const s = this.selRect();
        if (!s) return;
        this.apply((m) => {
          const x = mergeRange(m, s.r0, s.c0, s.r1, s.c1);
          if (!x) return false;
          this.selection = { r0: x.r, c0: x.c, r1: x.r + x.rs - 1, c1: x.c + x.cs - 1, scope: "cell" };
        });
      },
      split: () => {
        const s = this.selRect();
        const x = s ? this.cellsIn(s)[0] : undefined;
        if (x) this.apply((m) => splitCell(m, x));
      },
      togglePainter: () => {
        const s = this.selRect();
        const from = s ? cellAt(this.model, s.r0, s.c0) : undefined;
        this.painter = this.painter || !from ? null : lookOf(this.model, from);
        this.paintSelection();
      },
    };
  }

  private toolbarState(): ToolbarState {
    const m = this.model;
    const s = this.selRect()!;
    const cells = this.cellsIn(s);
    const span = (a: number, b: number, one: string, many: string) =>
      a === b ? `${one} ${a + 1}` : `${many} ${a + 1}–${b + 1}`;
    let label: string;
    let style: CellStyle;
    let align: { h: Align; v: VAlign };
    if (s.scope === "row") {
      label = span(s.r0, s.r1, "Row", "Rows");
      style = m.rowStyles[s.r0] ?? {};
      align = { h: m.rowAligns[s.r0] ?? "", v: m.rowValigns[s.r0] ?? "" };
    } else if (s.scope === "col") {
      label = span(s.c0, s.c1, "Column", "Columns");
      style = m.colStyles[s.c0] ?? {};
      align = { h: m.aligns[s.c0] ?? "", v: m.valigns[s.c0] ?? "" };
    } else {
      const first = cellAt(m, s.r0, s.c0) ?? cells[0];
      label = cells.length === 1 ? "Cell" : `${cells.length} cells`;
      style = first?.style ?? {};
      align = { h: first?.align ?? "", v: first?.valign ?? "" };
    }
    const one = s.scope === "cell" && cells.length === 1 ? cells[0] : undefined;
    return {
      label,
      style,
      align,
      canMerge: s.scope === "cell" && cells.length > 1,
      canSplit: !!one && (one.rs > 1 || one.cs > 1),
      painting: !!this.painter,
    };
  }

  private showToolbar(): void {
    if (!this.toolbar) {
      const tb = new TableToolbar(this.toolbarHost(), this.doc, this.app);
      this.toolbar = tb;
      const outside = (e: MouseEvent) => {
        const t = e.target as HTMLElement;
        if (this.containerEl.contains(t) || tb.el.contains(t) || this.popover?.contains(t)) return;
        if (t.closest?.(".menu, .modal-container")) return;
        this.selection = null;
        this.painter = null;
        this.paintSelection();
      };
      const key = (e: KeyboardEvent) => {
        if (e.key !== "Escape") {
          this.onNavKey(e);
          return;
        }
        if (this.editing || this.popover) return;
        if (tb.closePanel()) return;
        if (this.painter) this.painter = null;
        else this.selection = null;
        this.paintSelection();
      };
      let queued = false;
      const follow = () => {
        if (queued) return;
        queued = true;
        this.win.requestAnimationFrame(() => {
          queued = false;
          this.toolbar?.place();
        });
      };
      const clip = (e: ClipboardEvent) => this.onClipboard(e);
      this.doc.addEventListener("mousedown", outside, true);
      this.doc.addEventListener("keydown", key, true);
      this.doc.addEventListener("scroll", follow, true);
      this.win.addEventListener("resize", follow);
      for (const ev of ["copy", "cut", "paste"] as const) this.doc.addEventListener(ev, clip, true);
      this.toolbarOff = () => {
        this.doc.removeEventListener("mousedown", outside, true);
        this.doc.removeEventListener("keydown", key, true);
        this.doc.removeEventListener("scroll", follow, true);
        this.win.removeEventListener("resize", follow);
        for (const ev of ["copy", "cut", "paste"] as const) this.doc.removeEventListener(ev, clip, true);
      };
    }
    this.toolbar.refresh();
    this.toolbar.place();
    // A freshly rebuilt table may not be laid out yet.
    this.win.requestAnimationFrame(() => this.toolbar?.place());
    this.win.setTimeout(() => this.toolbar?.place(), 150);
  }

  private hideToolbar(): void {
    this.toolbarOff?.();
    this.toolbarOff = null;
    this.toolbar?.destroy();
    this.toolbar = null;
  }

  /* ---------- clipboard ---------- */

  /**
   * Copy, cut and paste for the selected cells. Left to the browser while a cell is
   * being edited, a text box has focus, or text is highlighted.
   */
  private onClipboard(e: ClipboardEvent): void {
    const s = this.selRect();
    if (!s || this.editing || !e.clipboardData) return;
    const focus = this.doc.activeElement;
    if (focus instanceof HTMLInputElement || focus instanceof HTMLTextAreaElement) return;
    const sel = this.win.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim()) return;
    e.preventDefault();
    e.stopPropagation();

    const cells = this.cellsIn(s);
    const plural = (n: number) => (n === 1 ? "1 cell" : `${n} cells`);
    if (e.type === "copy" || e.type === "cut") {
      const grid = copyGrid(this.model, s.r0, s.c0, s.r1, s.c1);
      const single = cells.length === 1;
      e.clipboardData.setData("text/plain", single ? cells[0].text : gridToTsv(grid));
      e.clipboardData.setData(CLIP_TYPE, JSON.stringify(single ? [[cells[0].text]] : grid));
      if (e.type === "cut") {
        const keys = cells.map((x) => [x.r, x.c]);
        this.apply((m) => {
          for (const [r, c] of keys) {
            const x = m.cells.find((y) => y.r === r && y.c === c);
            if (x) x.text = "";
          }
        });
      }
      new Notice(`${e.type === "cut" ? "Cut" : "Copied"} ${plural(cells.length)}`);
      return;
    }

    let grid: string[][] | null = null;
    try {
      const own = JSON.parse(e.clipboardData.getData(CLIP_TYPE) || "null");
      if (Array.isArray(own) && own.every((row) => Array.isArray(row))) grid = own.map((row: unknown[]) => row.map(String));
    } catch {
      grid = null;
    }
    const text = e.clipboardData.getData("text/plain");
    if (!grid) grid = text.includes("\t") ? tsvToGrid(text) : [[text.replace(/\r\n?/g, "\n").replace(/\n+$/, "")]];
    const g = grid;
    let n = 0;
    if (g.length === 1 && g[0].length === 1) {
      // One value fills every selected cell.
      const keys = cells.map((x) => [x.r, x.c]);
      this.apply((m) => {
        for (const [r, c] of keys) {
          const x = m.cells.find((y) => y.r === r && y.c === c);
          if (x) { x.text = g[0][0]; n++; }
        }
      });
    } else {
      this.apply((m) => { n = pasteGrid(m, s.r0, s.c0, g); });
    }
    new Notice(`Pasted ${plural(n)}`);
  }

  /* ---------- row resizing ---------- */

  private bindRowResizer(handle: HTMLElement, r: number): void {
    handle.addEventListener("click", (e) => e.stopPropagation());
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const tr = this.rowEls[r];
      const startY = e.clientY;
      const startH = this.model.heights[r] ?? Math.round(tr.getBoundingClientRect().height);
      handle.setPointerCapture(e.pointerId);
      this.wrap.addClass("rt-row-resizing");
      const move = (ev: PointerEvent) => {
        const px = Math.max(MIN_HEIGHT, Math.round(startH + ev.clientY - startY));
        this.model.heights[r] = px;
        tr.style.height = px + "px";
      };
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        this.wrap.removeClass("rt-row-resizing");
        void this.save();
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
    handle.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      this.apply((m) => { m.heights[r] = null; });
    });
  }

  /* ---------- persistence ---------- */

  /** Run an edit on a copy of the model; if it succeeds, re-render and save. */
  private apply(fn: (m: TableModel) => boolean | void | null): boolean {
    if (this.editing) this.commitEdit(false);
    const copy = cloneModel(this.model);
    const res = fn(copy);
    if (res === false) return false;
    this.model = copy;
    this.render();
    void this.save();
    return true;
  }

  private async save(): Promise<void> {
    const body = serialize(this.model);
    if (body === this.source.trim()) return;
    const info = this.ctx.getSectionInfo(this.containerEl);
    const file = this.app.vault.getAbstractFileByPath(this.ctx.sourcePath);
    if (!info || !(file instanceof TFile)) {
      new Notice("Interactive Tables: couldn't locate this table in the note, so the change wasn't saved.");
      return;
    }
    const { lineStart, lineEnd } = info;
    if (body.split("\n").some((l) => /^\s*(```|~~~)/.test(l))) {
      new Notice("Interactive Tables: a cell would close the table's code fence, so the change wasn't saved.");
      return;
    }
    // The text we believe is in the note; refuse to write over anything else.
    const expected = this.source.replace(/\r/g, "").trim();
    const matches = (lines: string[], at: number, end: number) =>
      isFenceLine(lines[at] ?? "") &&
      lines.slice(at + 1, end).map(stripPrefix).join("\n").replace(/\r/g, "").trim() === expected;
    const stale = () => new Notice("Interactive Tables: the note changed underneath the table; change not saved.");
    this.source = body;
    RichTableView.carry = { path: this.ctx.sourcePath, body, selection: this.selection, painter: this.painter, at: Date.now() };

    // Prefer the open editor so the change lands in its undo history.
    const view = this.app.workspace
      .getLeavesOfType("markdown")
      .map((l) => l.view)
      .find((v): v is MarkdownView => v instanceof MarkdownView && v.file?.path === file.path && v.getMode() === "source");
    if (view) {
      const editor = view.editor;
      const lines: string[] = [];
      for (let n = 0; n <= Math.min(lineEnd, editor.lineCount() - 1); n++) lines.push(editor.getLine(n));
      if (!matches(lines, lineStart, lineEnd)) {
        RichTableView.carry = null;
        stale();
        return;
      }
      const pre = fencePrefix(lines[lineStart]) ?? "";
      editor.replaceRange(withPrefix(body, pre) + "\n", { line: lineStart + 1, ch: 0 }, { line: lineEnd, ch: 0 });
      return;
    }
    await this.app.vault.process(file, (data) => {
      const lines = data.split("\n");
      if (!matches(lines, lineStart, lineEnd)) {
        RichTableView.carry = null;
        stale();
        return data;
      }
      const pre = fencePrefix(lines[lineStart]) ?? "";
      lines.splice(lineStart + 1, lineEnd - lineStart - 1, ...withPrefix(body, pre).split("\n"));
      return lines.join("\n");
    });
  }
}

/** Each line of a body, behind the quote or indent prefix of its fence. */
function withPrefix(body: string, prefix: string): string {
  return prefix ? body.split("\n").map((l) => prefix + l).join("\n") : body;
}

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}
