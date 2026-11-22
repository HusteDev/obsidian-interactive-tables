/*
 * Table model and the text format stored inside an ```rtable fence.
 *
 * The body of the fence is an ordinary GFM pipe table, optionally preceded by
 * `key: value` option lines. Extensions on top of GFM:
 *   - A cell containing only `<` belongs to the cell on its left (column span).
 *   - A cell containing only `^` belongs to the cell above (row span).
 *   - `<br>` inside a cell is a line break, so a cell can hold block markdown
 *     (lists, quotes, several paragraphs). `\|` is a literal pipe.
 *   - `\<` and `\^` are a literal `<` or `^` as the whole cell.
 *   - `widths: 120, auto, 200` sets column widths in pixels.
 *   - `valign: top, middle, bottom` sets each column's vertical alignment.
 *   - `heights: auto, 60, auto` sets row heights in pixels (a minimum; content can grow it).
 *   - `row-align: 2=center` / `row-valign: 3=middle` set a row's alignment (rows count from 1, header included).
 *   - `cell-align: 2:3=right` / `cell-valign: 2:3=bottom` set one cell's alignment (row:column, from 1).
 *   - `col-style: 1=bg:gray;bold`, `row-style: 2=color:#ff0000`, `cell-style: 2:3=italic;size:large`
 *     set background, text color, bold/italic/strike, size and font (see parseStyle).
 * Alignment precedence: cell, then row, then column. Style precedence is the same, property by property.
 * Row 0 is always the header row.
 */

export type Align = "" | "left" | "center" | "right";
export type VAlign = "" | "top" | "middle" | "bottom";

export type FontSize = "small" | "large" | "x-large";

/** Theme colors that follow light/dark mode; anything else must be a hex color. */
export const PALETTE = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink", "gray"] as const;

export interface CellStyle {
  bg?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  size?: FontSize;
  /** `sans`, `serif`, `mono`, or a single font family name. */
  font?: string;
}

export interface Cell {
  r: number;
  c: number;
  rs: number;
  cs: number;
  text: string;
  align?: Align;
  valign?: VAlign;
  style?: CellStyle;
}

export interface TableModel {
  rows: number;
  cols: number;
  cells: Cell[];
  aligns: Align[];
  valigns: VAlign[];
  widths: (number | null)[];
  rowAligns: Align[];
  rowValigns: VAlign[];
  heights: (number | null)[];
  rowStyles: CellStyle[];
  colStyles: CellStyle[];
}

const SEP_CELL = /^\s*:?-+:?\s*$/;

function asAlign(s: string | undefined): Align {
  const v = (s ?? "").trim().toLowerCase();
  return v === "left" || v === "center" || v === "right" ? v : "";
}

function asVAlign(s: string | undefined): VAlign {
  const v = (s ?? "").trim().toLowerCase();
  return v === "top" || v === "middle" || v === "bottom" ? v : "";
}

export function emptyModel(rows = 3, cols = 3): TableModel {
  const m: TableModel = {
    rows, cols, cells: [], aligns: [], valigns: [], widths: [], rowAligns: [], rowValigns: [], heights: [],
    rowStyles: [], colStyles: [],
  };
  for (let c = 0; c < cols; c++) {
    m.aligns.push("");
    m.valigns.push("");
    m.widths.push(null);
    m.colStyles.push({});
  }
  for (let r = 0; r < rows; r++) {
    m.rowAligns.push("");
    m.rowValigns.push("");
    m.heights.push(null);
    m.rowStyles.push({});
  }
  fillEmpty(m);
  return m;
}

export function cloneModel(m: TableModel): TableModel {
  return {
    rows: m.rows,
    cols: m.cols,
    cells: m.cells.map((c) => (c.style ? { ...c, style: { ...c.style } } : { ...c })),
    aligns: [...m.aligns],
    valigns: [...m.valigns],
    widths: [...m.widths],
    rowAligns: [...m.rowAligns],
    rowValigns: [...m.rowValigns],
    heights: [...m.heights],
    rowStyles: m.rowStyles.map((x) => ({ ...x })),
    colStyles: m.colStyles.map((x) => ({ ...x })),
  };
}

/** Alignment actually shown for a cell: cell beats row beats column. */
export function effectiveAlign(m: TableModel, cell: Cell): { h: Align; v: VAlign } {
  return {
    h: cell.align || m.rowAligns[cell.r] || m.aligns[cell.c] || "",
    v: cell.valign || m.rowValigns[cell.r] || m.valigns[cell.c] || "",
  };
}

/** Style actually shown for a cell: for each property, cell beats row beats column. */
export function effectiveStyle(m: TableModel, cell: Cell): CellStyle {
  return { ...m.colStyles[cell.c], ...m.rowStyles[cell.r], ...cell.style };
}

export function hasStyle(s: CellStyle | undefined): boolean {
  return !!s && Object.keys(s).length > 0;
}

/** Drop unset properties so an empty style serialises to nothing. */
export function cleanStyle(s: CellStyle): CellStyle {
  const out: CellStyle = {};
  for (const [k, v] of Object.entries(s)) if (v) (out as Record<string, unknown>)[k] = v;
  return out;
}

/** What a format or alignment change applies to: cells by their anchor [row, col], or whole rows/columns. */
export type Target =
  | { scope: "cell"; cells: [number, number][] }
  | { scope: "row" | "col"; indices: number[] };

/** Merge `patch` into each target's own style; `null` clears it. */
export function setStyle(m: TableModel, t: Target, patch: Partial<CellStyle> | null): void {
  const edit = (s: CellStyle | undefined): CellStyle => (patch ? cleanStyle({ ...s, ...patch }) : {});
  if (t.scope === "cell") {
    for (const [r, c] of t.cells) {
      const x = m.cells.find((y) => y.r === r && y.c === c);
      if (!x) continue;
      const n = edit(x.style);
      if (hasStyle(n)) x.style = n;
      else delete x.style;
    }
  } else {
    const arr = t.scope === "row" ? m.rowStyles : m.colStyles;
    for (const i of t.indices) if (i < arr.length) arr[i] = edit(arr[i]);
  }
}

export function setAlign(m: TableModel, t: Target, h: Align, v: VAlign): void {
  if (t.scope === "cell") {
    for (const [r, c] of t.cells) {
      const x = m.cells.find((y) => y.r === r && y.c === c);
      if (!x) continue;
      if (h) x.align = h; else delete x.align;
      if (v) x.valign = v; else delete x.valign;
    }
  } else if (t.scope === "row") {
    for (const r of t.indices) if (r < m.rows) { m.rowAligns[r] = h; m.rowValigns[r] = v; }
  } else {
    for (const c of t.indices) if (c < m.cols) { m.aligns[c] = h; m.valigns[c] = v; }
  }
}

/** How a cell looks: its combined style and alignment. What the format painter copies. */
export interface Look {
  style: CellStyle;
  align: Align;
  valign: VAlign;
}

export function lookOf(m: TableModel, cell: Cell): Look {
  const { h, v } = effectiveAlign(m, cell);
  return { style: effectiveStyle(m, cell), align: h, valign: v };
}

/** Replace each target's own style and alignment with `look`. */
export function applyLook(m: TableModel, t: Target, look: Look): void {
  setStyle(m, t, null);
  setStyle(m, t, look.style);
  setAlign(m, t, look.align, look.valign);
}

const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
const FONT_NAME = /^[A-Za-z0-9 _.-]+$/;

export function isColor(v: string): boolean {
  return HEX.test(v) || (PALETTE as readonly string[]).includes(v);
}

export function isFontName(v: string): boolean {
  return FONT_NAME.test(v.trim());
}

/** Parse `bg:yellow;color:#c00;bold;italic;strike;size:large;font:mono`. Unknown or invalid parts are dropped. */
export function parseStyle(s: string | undefined): CellStyle {
  const out: CellStyle = {};
  for (const part of (s ?? "").split(";")) {
    const i = part.indexOf(":");
    const k = (i < 0 ? part : part.slice(0, i)).trim().toLowerCase();
    const v = i < 0 ? "" : part.slice(i + 1).trim();
    const lv = v.toLowerCase();
    if (k === "bg" && isColor(lv)) out.bg = lv;
    else if (k === "color" && isColor(lv)) out.color = lv;
    else if (k === "bold") out.bold = true;
    else if (k === "italic") out.italic = true;
    else if (k === "strike") out.strike = true;
    else if (k === "size" && (lv === "small" || lv === "large" || lv === "x-large")) out.size = lv;
    else if (k === "font" && isFontName(v)) out.font = ["sans", "serif", "mono"].includes(lv) ? lv : v;
  }
  return out;
}

export function formatStyle(s: CellStyle): string {
  const out: string[] = [];
  if (s.bg) out.push("bg:" + s.bg);
  if (s.color) out.push("color:" + s.color);
  if (s.bold) out.push("bold");
  if (s.italic) out.push("italic");
  if (s.strike) out.push("strike");
  if (s.size) out.push("size:" + s.size);
  if (s.font) out.push("font:" + s.font);
  return out.join(";");
}

/** Parse `key=value, key=value` into a map. */
function sparse(s: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (s ?? "").split(",")) {
    const [k, v] = part.split("=").map((x) => x?.trim());
    if (k && v) out.set(k, v);
  }
  return out;
}

/* ---------- parsing ---------- */

export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") {
      cur += "\\|";
      i++;
    } else if (ch === "|") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

function decodeCell(raw: string): string {
  if (raw === "\\<") return "<";
  if (raw === "\\^") return "^";
  return raw.replace(/<br\s*\/?>/gi, "\n").replace(/\\\|/g, "|");
}

function encodeCell(text: string): string {
  const t = text.replace(/\r/g, "").trim();
  if (t === "<" || t === "^") return "\\" + t;
  return t.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function parseAlign(sep: string): Align {
  const s = sep.trim();
  const l = s.startsWith(":");
  const r = s.endsWith(":");
  if (l && r) return "center";
  if (r) return "right";
  if (l) return "left";
  return "";
}

export function isSeparatorRow(line: string): boolean {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => SEP_CELL.test(c));
}

export function parse(source: string): TableModel {
  const lines = source.split(/\r?\n/);
  const options: Record<string, string> = {};
  const tableLines: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("|")) {
      tableLines.push(t);
    } else if (tableLines.length === 0) {
      const m = /^([\w-]+)\s*:\s*(.*)$/.exec(t);
      if (m) options[m[1].toLowerCase()] = m[2];
    }
  }
  if (tableLines.length === 0) return emptyModel();

  let aligns: Align[] = [];
  const raw: string[][] = [];
  tableLines.forEach((line, i) => {
    if (i === 1 && isSeparatorRow(line)) {
      aligns = splitRow(line).map(parseAlign);
    } else {
      raw.push(splitRow(line));
    }
  });

  const rows = raw.length;
  const cols = Math.max(1, aligns.length, ...raw.map((r) => r.length));
  while (aligns.length < cols) aligns.push("");
  aligns = aligns.slice(0, cols);

  const widths: (number | null)[] = [];
  const w = (options["widths"] ?? "").split(",").map((x) => x.trim());
  for (let c = 0; c < cols; c++) {
    const n = parseInt(w[c] ?? "", 10);
    widths.push(Number.isFinite(n) && n > 0 ? n : null);
  }

  const valigns: VAlign[] = [];
  const v = (options["valign"] ?? "").split(",");
  const colS = sparse(options["col-style"]);
  const colStyles: CellStyle[] = [];
  for (let c = 0; c < cols; c++) {
    valigns.push(asVAlign(v[c]));
    colStyles.push(parseStyle(colS.get(String(c + 1))));
  }

  const heights: (number | null)[] = [];
  const hs = (options["heights"] ?? "").split(",").map((x) => x.trim());
  const rowA = sparse(options["row-align"]);
  const rowV = sparse(options["row-valign"]);
  const rowAligns: Align[] = [];
  const rowValigns: VAlign[] = [];
  const rowS = sparse(options["row-style"]);
  const rowStyles: CellStyle[] = [];
  for (let r = 0; r < rows; r++) {
    const n = parseInt(hs[r] ?? "", 10);
    heights.push(Number.isFinite(n) && n > 0 ? n : null);
    rowAligns.push(asAlign(rowA.get(String(r + 1))));
    rowValigns.push(asVAlign(rowV.get(String(r + 1))));
    rowStyles.push(parseStyle(rowS.get(String(r + 1))));
  }

  // Resolve every grid position to the position of the cell that owns it.
  const owner: number[][] = [];
  for (let r = 0; r < rows; r++) {
    owner.push([]);
    for (let c = 0; c < cols; c++) {
      const v = raw[r][c] ?? "";
      let o = r * cols + c;
      if (v === "<" && c > 0) o = owner[r][c - 1];
      else if (v === "^" && r > 0) o = owner[r - 1][c];
      owner[r].push(o);
    }
  }

  const boxes = new Map<number, { r0: number; c0: number; r1: number; c1: number }>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const o = owner[r][c];
      const b = boxes.get(o);
      if (!b) boxes.set(o, { r0: r, c0: c, r1: r, c1: c });
      else {
        b.r0 = Math.min(b.r0, r);
        b.c0 = Math.min(b.c0, c);
        b.r1 = Math.max(b.r1, r);
        b.c1 = Math.max(b.c1, c);
      }
    }
  }

  const m: TableModel = { rows, cols, cells: [], aligns, valigns, widths, rowAligns, rowValigns, heights, rowStyles, colStyles };
  for (const [o, b] of boxes) {
    const ar = Math.floor(o / cols);
    const ac = o % cols;
    let rect = true;
    for (let r = b.r0; r <= b.r1 && rect; r++)
      for (let c = b.c0; c <= b.c1; c++) if (owner[r][c] !== o) rect = false;
    const text = decodeCell(raw[ar][ac] ?? "");
    if (rect && b.r0 === ar && b.c0 === ac) {
      m.cells.push({ r: ar, c: ac, rs: b.r1 - b.r0 + 1, cs: b.c1 - b.c0 + 1, text });
    } else {
      // Malformed span: keep the anchor and let fillEmpty cover the rest.
      m.cells.push({ r: ar, c: ac, rs: 1, cs: 1, text });
    }
  }
  fillEmpty(m);

  const cellA = sparse(options["cell-align"]);
  const cellV = sparse(options["cell-valign"]);
  for (const key of new Set([...cellA.keys(), ...cellV.keys()])) {
    const [r, c] = key.split(":").map((x) => parseInt(x, 10) - 1);
    const cell = cellAt(m, r, c);
    if (!cell) continue;
    const h = asAlign(cellA.get(key));
    const vv = asVAlign(cellV.get(key));
    if (h) cell.align = h;
    if (vv) cell.valign = vv;
  }

  for (const [key, val] of sparse(options["cell-style"])) {
    const [r, c] = key.split(":").map((x) => parseInt(x, 10) - 1);
    const cell = cellAt(m, r, c);
    const st = parseStyle(val);
    if (cell && hasStyle(st)) cell.style = st;
  }
  return m;
}

/* ---------- serialising ---------- */

function alignSep(a: Align, width: number): string {
  const n = Math.max(3, width);
  if (a === "center") return ":" + "-".repeat(n - 2) + ":";
  if (a === "right") return "-".repeat(n - 1) + ":";
  if (a === "left") return ":" + "-".repeat(n - 1);
  return "-".repeat(n);
}

export function toGrid(m: TableModel, markers = true): string[][] {
  const grid: string[][] = [];
  for (let r = 0; r < m.rows; r++) grid.push(new Array(m.cols).fill(""));
  for (const cell of m.cells) {
    for (let r = cell.r; r < cell.r + cell.rs; r++) {
      for (let c = cell.c; c < cell.c + cell.cs; c++) {
        if (r >= m.rows || c >= m.cols) continue;
        if (r === cell.r && c === cell.c) grid[r][c] = encodeCell(cell.text);
        else if (markers) grid[r][c] = r === cell.r ? "<" : "^";
      }
    }
  }
  return grid;
}

export function pipeTable(m: TableModel, markers = true): string[] {
  const grid = toGrid(m, markers);
  const w: number[] = [];
  for (let c = 0; c < m.cols; c++) {
    w.push(Math.max(3, ...grid.map((row) => row[c].length)));
  }
  const line = (cells: string[]) =>
    "| " + cells.map((x, c) => x.padEnd(w[c])).join(" | ") + " |";
  const out: string[] = [];
  out.push(line(grid[0] ?? new Array(m.cols).fill("")));
  out.push("| " + m.aligns.map((a, c) => alignSep(a, w[c])).join(" | ") + " |");
  for (let r = 1; r < m.rows; r++) out.push(line(grid[r]));
  return out;
}

export function serialize(m: TableModel): string {
  const out: string[] = [];
  if (m.widths.some((x) => x != null)) {
    out.push("widths: " + m.widths.map((x) => (x == null ? "auto" : String(Math.round(x)))).join(", "));
  }
  if (m.valigns.some((x) => x)) {
    out.push("valign: " + m.valigns.map((x) => x || "auto").join(", "));
  }
  if (m.heights.some((x) => x != null)) {
    out.push("heights: " + m.heights.map((x) => (x == null ? "auto" : String(Math.round(x)))).join(", "));
  }
  const list = (pairs: [string, string][]) => pairs.map(([k, v]) => `${k}=${v}`).join(", ");
  const rowA = m.rowAligns.map((a, r): [string, string] => [String(r + 1), a]).filter(([, a]) => a);
  const rowV = m.rowValigns.map((a, r): [string, string] => [String(r + 1), a]).filter(([, a]) => a);
  if (rowA.length) out.push("row-align: " + list(rowA));
  if (rowV.length) out.push("row-valign: " + list(rowV));
  const cells = [...m.cells].sort((a, b) => a.r - b.r || a.c - b.c);
  const cellA = cells.filter((x) => x.align).map((x): [string, string] => [`${x.r + 1}:${x.c + 1}`, x.align!]);
  const cellV = cells.filter((x) => x.valign).map((x): [string, string] => [`${x.r + 1}:${x.c + 1}`, x.valign!]);
  if (cellA.length) out.push("cell-align: " + list(cellA));
  if (cellV.length) out.push("cell-valign: " + list(cellV));
  const colS = m.colStyles.map((s, c): [string, string] => [String(c + 1), formatStyle(s)]).filter(([, s]) => s);
  const rowS = m.rowStyles.map((s, r): [string, string] => [String(r + 1), formatStyle(s)]).filter(([, s]) => s);
  const cellS = cells.filter((x) => hasStyle(x.style)).map((x): [string, string] => [`${x.r + 1}:${x.c + 1}`, formatStyle(x.style!)]);
  if (colS.length) out.push("col-style: " + list(colS));
  if (rowS.length) out.push("row-style: " + list(rowS));
  if (cellS.length) out.push("cell-style: " + list(cellS));
  out.push(...pipeTable(m, true));
  return out.join("\n");
}

/* ---------- queries ---------- */

export function cellAt(m: TableModel, r: number, c: number): Cell | undefined {
  return m.cells.find((x) => r >= x.r && r < x.r + x.rs && c >= x.c && c < x.c + x.cs);
}

export type Dir = "up" | "down" | "left" | "right";

/** The cell one step from `from` in a direction, stepping over its span; undefined at the table's edge. */
export function stepFrom(m: TableModel, from: Cell, dir: Dir): Cell | undefined {
  const r = dir === "up" ? from.r - 1 : dir === "down" ? from.r + from.rs : from.r;
  const c = dir === "left" ? from.c - 1 : dir === "right" ? from.c + from.cs : from.c;
  if (r < 0 || c < 0 || r >= m.rows || c >= m.cols) return undefined;
  return cellAt(m, r, c);
}

/* ---------- clipboard ---------- */

/** Cell texts in a block, one entry per grid position. A merged cell's text appears once, at its first position in the block. */
export function copyGrid(m: TableModel, r0: number, c0: number, r1: number, c1: number): string[][] {
  const seen = new Set<Cell>();
  const out: string[][] = [];
  for (let r = r0; r <= r1; r++) {
    const row: string[] = [];
    for (let c = c0; c <= c1; c++) {
      const x = cellAt(m, r, c);
      row.push(x && !seen.has(x) ? x.text : "");
      if (x) seen.add(x);
    }
    out.push(row);
  }
  return out;
}

/** Tab-separated, one line per row. In-cell line breaks become `<br>`, as in the stored table. */
export function gridToTsv(g: string[][]): string {
  return g.map((row) => row.map((t) => t.replace(/\t/g, " ").replace(/\r?\n/g, "<br>")).join("\t")).join("\n");
}

export function tsvToGrid(s: string): string[][] {
  const lines = s.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
  return lines.map((l) => l.split("\t").map((t) => t.replace(/<br\s*\/?>/gi, "\n")));
}

/**
 * Write `grid` into the table with its top-left at (r, c). Positions past the table's
 * edge, and positions inside a merged cell other than its anchor, are skipped.
 * Returns how many cells were written.
 */
export function pasteGrid(m: TableModel, r: number, c: number, grid: string[][]): number {
  let n = 0;
  grid.forEach((row, i) => row.forEach((text, j) => {
    const x = cellAt(m, r + i, c + j);
    if (!x || x.r !== r + i || x.c !== c + j) return;
    x.text = text;
    n++;
  }));
  return n;
}

export function fillEmpty(m: TableModel): void {
  m.cells = m.cells.filter((x) => x.r < m.rows && x.c < m.cols && x.rs > 0 && x.cs > 0);
  for (const x of m.cells) {
    x.rs = Math.min(x.rs, m.rows - x.r);
    x.cs = Math.min(x.cs, m.cols - x.c);
  }
  const covered: boolean[][] = [];
  for (let r = 0; r < m.rows; r++) covered.push(new Array(m.cols).fill(false));
  for (const x of m.cells)
    for (let r = x.r; r < x.r + x.rs; r++)
      for (let c = x.c; c < x.c + x.cs; c++) covered[r][c] = true;
  for (let r = 0; r < m.rows; r++)
    for (let c = 0; c < m.cols; c++)
      if (!covered[r][c]) m.cells.push({ r, c, rs: 1, cs: 1, text: "" });
  m.cells.sort((a, b) => a.r - b.r || a.c - b.c);
}

/* ---------- edits (all mutate the model) ---------- */

export function insertRow(m: TableModel, at: number): void {
  for (const x of m.cells) {
    if (x.r >= at) x.r++;
    else if (x.r + x.rs > at) x.rs++;
  }
  m.rows++;
  m.rowAligns.splice(at, 0, "");
  m.rowValigns.splice(at, 0, "");
  m.heights.splice(at, 0, null);
  m.rowStyles.splice(at, 0, {});
  fillEmpty(m);
}

export function insertCol(m: TableModel, at: number): void {
  for (const x of m.cells) {
    if (x.c >= at) x.c++;
    else if (x.c + x.cs > at) x.cs++;
  }
  m.cols++;
  m.aligns.splice(at, 0, "");
  m.valigns.splice(at, 0, "");
  m.widths.splice(at, 0, m.widths.some((w) => w != null) ? 120 : null);
  m.colStyles.splice(at, 0, {});
  fillEmpty(m);
}

export function deleteRow(m: TableModel, i: number): boolean {
  if (m.rows <= 1) return false;
  m.cells = m.cells.filter((x) => !(x.r === i && x.rs === 1));
  for (const x of m.cells) {
    if (x.r > i) x.r--;
    else if (x.r + x.rs > i) x.rs--;
  }
  m.rows--;
  m.rowAligns.splice(i, 1);
  m.rowValigns.splice(i, 1);
  m.heights.splice(i, 1);
  m.rowStyles.splice(i, 1);
  fillEmpty(m);
  return true;
}

export function deleteCol(m: TableModel, i: number): boolean {
  if (m.cols <= 1) return false;
  m.cells = m.cells.filter((x) => !(x.c === i && x.cs === 1));
  for (const x of m.cells) {
    if (x.c > i) x.c--;
    else if (x.c + x.cs > i) x.cs--;
  }
  m.cols--;
  m.aligns.splice(i, 1);
  m.valigns.splice(i, 1);
  m.widths.splice(i, 1);
  m.colStyles.splice(i, 1);
  fillEmpty(m);
  return true;
}

function permutation(n: number, from: number, to: number): number[] {
  const order = [...Array(n).keys()];
  const [v] = order.splice(from, 1);
  order.splice(to, 0, v);
  const newIndex = new Array(n);
  order.forEach((old, pos) => (newIndex[old] = pos));
  return newIndex;
}

function permute<T>(arr: T[], newIndex: number[]): T[] {
  const out = [...arr];
  newIndex.forEach((pos, old) => (out[pos] = arr[old]));
  return out;
}

/** Move row `from` so it ends up at index `to`. Fails if it would tear a merged cell. */
export function moveRow(m: TableModel, from: number, to: number): boolean {
  if (from === to || to < 0 || to >= m.rows) return false;
  const ni = permutation(m.rows, from, to);
  for (const x of m.cells)
    for (let k = 1; k < x.rs; k++) if (ni[x.r + k] !== ni[x.r] + k) return false;
  for (const x of m.cells) x.r = ni[x.r];
  m.rowAligns = permute(m.rowAligns, ni);
  m.rowValigns = permute(m.rowValigns, ni);
  m.heights = permute(m.heights, ni);
  m.rowStyles = permute(m.rowStyles, ni);
  fillEmpty(m);
  return true;
}

export function moveCol(m: TableModel, from: number, to: number): boolean {
  if (from === to || to < 0 || to >= m.cols) return false;
  const ni = permutation(m.cols, from, to);
  for (const x of m.cells)
    for (let k = 1; k < x.cs; k++) if (ni[x.c + k] !== ni[x.c] + k) return false;
  for (const x of m.cells) x.c = ni[x.c];
  m.aligns = permute(m.aligns, ni);
  m.valigns = permute(m.valigns, ni);
  m.widths = permute(m.widths, ni);
  m.colStyles = permute(m.colStyles, ni);
  fillEmpty(m);
  return true;
}

/** Merge every cell touching the rectangle (grown until no cell sticks out). */
export function mergeRange(m: TableModel, r0: number, c0: number, r1: number, c1: number): Cell | null {
  let changed = true;
  while (changed) {
    changed = false;
    for (const x of m.cells) {
      const hit = x.r <= r1 && x.r + x.rs - 1 >= r0 && x.c <= c1 && x.c + x.cs - 1 >= c0;
      if (!hit) continue;
      const nr0 = Math.min(r0, x.r), nc0 = Math.min(c0, x.c);
      const nr1 = Math.max(r1, x.r + x.rs - 1), nc1 = Math.max(c1, x.c + x.cs - 1);
      if (nr0 !== r0 || nc0 !== c0 || nr1 !== r1 || nc1 !== c1) {
        r0 = nr0; c0 = nc0; r1 = nr1; c1 = nc1;
        changed = true;
      }
    }
  }
  const inside = m.cells.filter((x) => x.r >= r0 && x.r <= r1 && x.c >= c0 && x.c <= c1);
  if (inside.length < 2) return null;
  const text = inside.map((x) => x.text.trim()).filter((t) => t).join("\n");
  const first = inside.find((x) => x.r === r0 && x.c === c0);
  m.cells = m.cells.filter((x) => !inside.includes(x));
  const merged: Cell = { r: r0, c: c0, rs: r1 - r0 + 1, cs: c1 - c0 + 1, text };
  if (first?.align) merged.align = first.align;
  if (first?.valign) merged.valign = first.valign;
  if (hasStyle(first?.style)) merged.style = { ...first!.style };
  m.cells.push(merged);
  fillEmpty(m);
  return merged;
}

export function splitCell(m: TableModel, cell: Cell): void {
  const x = m.cells.find((y) => y.r === cell.r && y.c === cell.c);
  if (!x) return;
  x.rs = 1;
  x.cs = 1;
  fillEmpty(m);
}
