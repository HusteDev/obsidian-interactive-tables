import assert from "node:assert/strict";
import {
  applyLook, deleteCol, deleteRow, effectiveAlign, effectiveStyle, insertCol, insertRow, lookOf, mergeRange, moveCol, moveRow,
  parse, parseStyle, serialize, setAlign, setStyle, splitCell, copyGrid, gridToTsv, tsvToGrid, pasteGrid, stepFrom,
} from "../src/model.ts";

const src = [
  "widths: 100, auto, 200",
  "| A | B | C |",
  "| :-- | :-: | --: |",
  "| wide | < | x |",
  "| tall | y | z |",
  "| ^ | - a<br>- b | [[Note\\|alias]] |",
].join("\n");

const m = parse(src);
assert.equal(m.rows, 4);
assert.equal(m.cols, 3);
assert.deepEqual(m.aligns, ["left", "center", "right"]);
assert.deepEqual(m.widths, [100, null, 200]);
const wide = m.cells.find((c) => c.text === "wide")!;
assert.equal(wide.cs, 2);
const tall = m.cells.find((c) => c.text === "tall")!;
assert.equal(tall.rs, 2);
assert.ok(m.cells.some((c) => c.text === "- a\n- b"));
assert.ok(m.cells.some((c) => c.text === "[[Note|alias]]"));

// Round trip is stable.
assert.equal(serialize(parse(serialize(m))), serialize(m));

// Insert a row inside the tall span extends it.
const a = parse(src);
insertRow(a, 3);
assert.equal(a.cells.find((c) => c.text === "tall")!.rs, 3);
assert.equal(a.rows, 5);

// Insert a column inside the wide span extends it.
const b = parse(src);
insertCol(b, 1);
assert.equal(b.cells.find((c) => c.text === "wide")!.cs, 3);
assert.equal(b.widths.length, 4);

// Delete shrinks spans.
const d = parse(src);
deleteRow(d, 3);
assert.equal(d.cells.find((c) => c.text === "tall")!.rs, 1);
deleteCol(d, 0);
assert.equal(d.cells.find((c) => c.text === "wide")!.cs, 1);

// Moving a row through a span is refused, a clean move works.
const e = parse(src);
assert.equal(moveRow(e, 2, 0), false);
assert.equal(moveRow(e, 1, 0), true);
assert.equal(e.cells.find((c) => c.text === "wide")!.r, 0);
assert.equal(moveCol(e, 2, 0), true);
assert.deepEqual(e.aligns, ["right", "left", "center"]);

// Merge and split.
const f = parse("| a | b |\n|---|---|\n| c | d |");
const merged = mergeRange(f, 1, 0, 1, 1)!;
assert.equal(merged.cs, 2);
assert.equal(merged.text, "c\nd");
assert.match(serialize(f), /\| c<br>d \| <\s+\|/);
splitCell(f, merged);
assert.equal(f.cells.length, 4);

// A literal "<" cell survives.
const g = parse("| x | y |\n|---|---|\n| \\< | z |");
assert.equal(g.cells.find((c) => c.r === 1 && c.c === 0)!.text, "<");
assert.match(serialize(g), /\\</);

// Vertical alignment follows columns.
const h = parse("valign: auto, middle\n| a | b |\n|---|---|\n| c | d |");
assert.deepEqual(h.valigns, ["", "middle"]);
moveCol(h, 1, 0);
assert.match(serialize(h), /^valign: middle, auto/);
insertCol(h, 0);
deleteCol(h, 1);
assert.deepEqual(h.valigns, ["", ""]);
assert.doesNotMatch(serialize(h), /valign/);

console.log("model tests passed");
console.log(serialize(m));

// Row heights, row alignment and cell alignment survive edits.
const k = parse([
  "heights: auto, 60, auto",
  "row-align: 2=center",
  "row-valign: 3=bottom",
  "cell-align: 3:2=right",
  "cell-valign: 3:2=middle",
  "| a | b |",
  "|---|---|",
  "| c | d |",
  "| e | f |",
].join("\n"));
assert.deepEqual(k.heights, [null, 60, null]);
assert.deepEqual(k.rowAligns, ["", "center", ""]);
assert.deepEqual(k.rowValigns, ["", "", "bottom"]);
const f2 = k.cells.find((c) => c.text === "f")!;
assert.equal(f2.align, "right");
assert.equal(f2.valign, "middle");
assert.equal(serialize(parse(serialize(k))), serialize(k));
moveRow(k, 2, 1);
assert.deepEqual(k.heights, [null, null, 60]);
assert.match(serialize(k), /cell-align: 2:2=right/);
insertRow(k, 0);
assert.match(serialize(k), /row-align: 4=center/);
deleteRow(k, 3);
assert.doesNotMatch(serialize(k), /row-align/);
console.log("alignment tests passed");

// Styles: parsing drops anything invalid, precedence is per property.
assert.deepEqual(parseStyle("bg:Yellow; color:#C00;bold;size:huge;font:Fira Code;bg2:x"), {
  bg: "yellow", color: "#c00", bold: true, font: "Fira Code",
});
assert.deepEqual(parseStyle("bg:url(x);color:red;font:a\"b"), { color: "red" });
const st = parse([
  "col-style: 1=bg:gray;bold, 2=font:mono",
  "row-style: 2=bg:blue;italic",
  "cell-style: 2:1=bg:#ffeeaa;size:large, 3:2=strike",
  "| a | b |",
  "|---|---|",
  "| c | d |",
  "| e | f |",
].join("\n"));
const cellOf = (t: string) => st.cells.find((x) => x.text === t)!;
assert.deepEqual(effectiveStyle(st, cellOf("a")), { bg: "gray", bold: true });
assert.deepEqual(effectiveStyle(st, cellOf("c")), { bg: "#ffeeaa", bold: true, italic: true, size: "large" });
assert.deepEqual(effectiveStyle(st, cellOf("d")), { bg: "blue", italic: true, font: "mono" });
assert.deepEqual(effectiveStyle(st, cellOf("f")), { font: "mono", strike: true });
assert.equal(serialize(parse(serialize(st))), serialize(st));
moveRow(st, 2, 1);
assert.match(serialize(st), /row-style: 3=bg:blue;italic/);
assert.match(serialize(st), /cell-style: 2:2=strike, 3:1=bg:#ffeeaa;size:large/);
moveCol(st, 1, 0);
assert.match(serialize(st), /col-style: 1=font:mono, 2=bg:gray;bold/);
insertCol(st, 0);
insertRow(st, 0);
assert.match(serialize(st), /col-style: 2=font:mono, 3=bg:gray;bold/);
assert.match(serialize(st), /cell-style: 3:2=strike, 4:3=bg:#ffeeaa;size:large/);
deleteCol(st, 1);
assert.doesNotMatch(serialize(st), /font:mono|strike/);
insertCol(st, 2);
const merged2 = mergeRange(st, 3, 1, 3, 2)!;
assert.deepEqual(merged2.style, { bg: "#ffeeaa", size: "large" });
console.log("style tests passed");

// setStyle merges, unsets and clears; setAlign and applyLook act on cells, rows and columns.
const p = parse(["col-style: 2=bg:green", "| a | b |", "|---|---|", "| c | d |"].join("\n"));
setStyle(p, { scope: "cell", cells: [[1, 0]] }, { bold: true, color: "red" });
setStyle(p, { scope: "cell", cells: [[1, 0]] }, { bold: undefined });
assert.deepEqual(p.cells.find((x) => x.text === "c")!.style, { color: "red" });
setStyle(p, { scope: "cell", cells: [[1, 0]] }, null);
assert.equal(p.cells.find((x) => x.text === "c")!.style, undefined);
setStyle(p, { scope: "row", indices: [0] }, { italic: true });
setStyle(p, { scope: "col", indices: [1, 9] }, { size: "small" });
assert.deepEqual(p.colStyles, [{}, { bg: "green", size: "small" }]);
setAlign(p, { scope: "col", indices: [1] }, "right", "middle");
assert.deepEqual(effectiveAlign(p, p.cells.find((x) => x.text === "d")!), { h: "right", v: "middle" });
applyLook(p, { scope: "cell", cells: [[1, 0]] }, lookOf(p, p.cells.find((x) => x.text === "b")!));
const c2 = p.cells.find((x) => x.text === "c")!;
assert.deepEqual(c2.style, { bg: "green", size: "small", italic: true });
assert.deepEqual([c2.align, c2.valign], ["right", "middle"]);
applyLook(p, { scope: "row", indices: [1] }, lookOf(p, c2));
assert.match(serialize(p), /row-style: 1=italic, 2=bg:green;italic;size:small/);
console.log("toolbar model tests passed");

// Clipboard: merged cells copy once, TSV round-trips line breaks, paste skips covered and off-table positions.
const cb = parse([
  "| h1 | h2 | h3 |",
  "|----|----|----|",
  "| wide | < | x |",
  "| a<br>b | y | z |",
].join("\n"));
assert.deepEqual(copyGrid(cb, 1, 0, 2, 2), [["wide", "", "x"], ["a\nb", "y", "z"]]);
assert.deepEqual(copyGrid(cb, 1, 1, 1, 2), [["wide", "x"]]);
const tsv = gridToTsv(copyGrid(cb, 1, 0, 2, 2));
assert.equal(tsv, "wide\t\tx\na<br>b\ty\tz");
assert.deepEqual(tsvToGrid(tsv + "\r\n"), [["wide", "", "x"], ["a\nb", "y", "z"]]);
assert.equal(pasteGrid(cb, 1, 0, [["W", "skip", "X"], ["A", "Y", "Z", "off"]]), 5);
assert.deepEqual(copyGrid(cb, 1, 0, 2, 2), [["W", "", "X"], ["A", "Y", "Z"]]);
assert.equal(pasteGrid(cb, 2, 2, [["1", "2"], ["3"]]), 1);
console.log("clipboard tests passed");

// A cell holding a code fence is stored on one line, so it can never close the surrounding rtable fence.
const fenced = parse("| a | b |\n|---|---|\n| x<br>```<br>code<br>``` | y |");
assert.equal(serialize(fenced).split("\n").some((l) => /^\s*(```|~~~)/.test(l)), false);
console.log("fence tests passed");

// Keyboard stepping skips over spans and stops at the edges.
const nav = parse(["| h1 | h2 | h3 |", "|----|----|----|", "| wide | < | x |", "| tall | y | z |", "| ^ | q | r |"].join("\n"));
const navWide = nav.cells.find((x) => x.text === "wide")!;
assert.equal(stepFrom(nav, navWide, "right")!.text, "x");
assert.equal(stepFrom(nav, nav.cells.find((x) => x.text === "x")!, "left")!.text, "wide");
const navTall = nav.cells.find((x) => x.text === "tall")!;
assert.equal(stepFrom(nav, navTall, "down"), undefined);
assert.equal(stepFrom(nav, navTall, "up")!.text, "wide");
assert.equal(stepFrom(nav, nav.cells.find((x) => x.text === "h1")!, "up"), undefined);
console.log("navigation tests passed");
