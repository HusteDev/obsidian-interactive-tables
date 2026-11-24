# Interactive Tables

Interactive tables for Obsidian that work in Live Preview and Reading view.

**Desktop only for now.** The interaction model (hover grips, mouse drag, right-click menus) does not work on touch devices yet.

- Drag rows and columns by their grips (`⋮` left of each row, `⋯` above each column).
- Click a grip to select that row or column (shift-click another grip to select several). Right-click a grip, or a cell, for insert row above/below, insert column left/right, move, align, delete.
- Drag any column edge to resize. Double-click an edge to reset that column; "Reset all column widths" is in the column menu.
- Drag any row's bottom edge to set its height. Double-click the edge, or use "Reset row height" in the row menu, to undo.
- Alignment: right-click a cell → "Alignment…" opens a 3×3 picker (left/center/right × top/middle/bottom) with Cell, Row and Column tabs. With several cells selected (click, then shift-click) it applies to all of them. "Clear" removes the setting. A cell's own alignment wins over its row's, and a row's wins over its column's.
- Formatting toolbar: select a cell (click), several cells (click, then shift-click), a row or a column (click its grip) and a toolbar appears docked just above the table (it stays at the top of the note while you scroll through a tall table): fill color, text color, bold, italic, strikethrough, text size, font, alignment, merge, split, format painter and clear formatting. What it changes follows the selection: cells get their own formatting, a grip-selected row or column gets row or column formatting. The label at its left says which ("Cell", "3 cells", "Row 2", "Columns 1–3"). The named colors follow your theme in light and dark mode; the rainbow swatch picks any color. Each change is saved at once and undoes on its own with Ctrl+Z. Precedence is per property: a cell's own setting wins over its row's, and a row's over its column's, so a bold column and a yellow cell give a bold yellow cell. Esc closes an open dropdown, then the toolbar; clicking outside the table also closes it. To move the toolbar, drag its `⠿` handle; it then stays at that spot on screen for every table (remembered on this device) until you double-click the handle to dock it again.
- Keyboard: click a cell, then arrows move, Shift+arrows extend, Tab/Shift+Tab step through cells, Enter or F2 edits, typing replaces the cell, Delete clears. While editing, Enter saves and moves down, Shift+Enter adds a line, Tab moves on, Esc cancels.
- Tables work inside callouts and indented list items. Changes keep the surrounding `>` or indentation.
- Sort and filter: click a column's `⋯` grip, then "Sort rows A to Z" or "Z to A" (the header stays put, numbers sort as numbers, empty cells go last; not available while a merged cell spans several rows). "Filter rows…" opens a search box that hides rows without every word you type. The filter is a view only: it is never saved to the note, and sorting does rewrite the row order.
- Resize several at once: select rows or columns by their grips, then drag the edge of any selected one and they all take that size. Double-click an edge to reset every selected row or column.
- Right-click any cell or grip and choose "Convert to plain markdown table" to turn the block back into an ordinary pipe table.
- Copy, cut and paste: with cells, a row or a column selected, Ctrl+C copies. One cell copies its markdown source exactly; several cells copy as tab-separated rows, so they paste into Excel or another table as a grid. Ctrl+X copies and then empties the cells (their formatting stays). Ctrl+V fills a grid starting at the selection's top-left cell, dropping anything past the table's edge (no rows or columns are added); a single value goes into every selected cell. Copies between interactive tables are exact, including cells with several lines. While you're editing a cell or have text highlighted, these keys work as usual. Excel cells that contain line breaks arrive split, since their quoting isn't parsed.
- Format painter: select the cell whose look you want, click the brush, then click a cell (or a row or column grip). It copies everything you see on that cell, including formatting inherited from its row and column, and its alignment. Esc cancels. "Clear formatting" removes formatting but leaves alignment alone.
- Text wraps only between whole words.
- Cells render full Obsidian markdown: links, embeds, bold, code, lists, callouts, multiple paragraphs.
- Merged cells: right-click → "Merge with cell right/below", or click a cell, shift-click another, and choose "Merge selected cells". "Split cell" undoes a merge.

Editing a cell: double-click it (or "Edit cell" in the menu). Enter saves, Shift+Enter adds a line, Tab / Shift+Tab moves to the next / previous cell, Esc cancels. In Live Preview, Ctrl+Z undoes table changes like any other edit.

## Storage format

A table is a fenced code block with the language `rtable`. Inside is an ordinary GFM pipe table plus a few conventions, so the note stays readable in any markdown tool and still looks like a table as plain text:

````markdown
```rtable
widths: 140, auto, 220
| Item     | Owner       | Notes                         |
| :------- | :---------: | ----------------------------- |
| Q3 plan  | <           | Spans two columns             |
| Rollout  | [[Dana]]    | - step one<br>- step two      |
| ^        | Ops         | `Rollout` spans two rows      |
```
````

| Syntax | Meaning |
| --- | --- |
| `widths: 140, auto, 220` | Optional first line. Column widths in pixels; `auto` lets the column size itself. Written for you when you drag a column edge. |
| `valign: auto, middle, bottom` | Optional. Vertical alignment per column (`top`/`auto`, `middle`, `bottom`). |
| `heights: auto, 60, auto` | Optional. Row heights in pixels, written when you drag a row's bottom edge. A row still grows if its content needs more room. |
| `row-align: 2=center` / `row-valign: 2=middle` | Optional. Alignment for whole rows. Rows count from 1, header included. |
| `cell-align: 3:2=right` / `cell-valign: 3:2=bottom` | Optional. Alignment for single cells, as `row:column` counting from 1. |
| `col-style: 1=bg:gray;bold` / `row-style: 1=bg:blue;color:#ffffff` | Optional. Formatting for whole columns or rows, counting from 1. Properties are separated by `;`. |
| `cell-style: 3:2=bg:yellow;italic;size:large, 4:1=strike;font:Fira Code` | Optional. Formatting for single cells, as `row:column`. |
| `<` as the whole cell | This cell is merged into the cell on its left (column span). |
| `^` as the whole cell | This cell is merged into the cell above (row span). |
| `<br>` | Line break inside a cell, so a cell can hold lists, quotes and several paragraphs. |
| `\|` | A literal pipe (also needed for `[[Note\|alias]]` links). |
| `\<`, `\^` | A literal `<` or `^` as a cell's whole content. |

Style properties: `bg:` and `color:` take a theme color (`red`, `orange`, `yellow`, `green`, `cyan`, `blue`, `purple`, `pink`, `gray`) or a hex color like `#c00` or `#ffeeaa`; `bold`, `italic` and `strike` are flags; `size:` is `small`, `large` or `x-large`; `font:` is `sans`, `serif`, `mono` or one font family name (letters, digits, spaces, `.`, `_`, `-`; no commas). Anything else is ignored.

The first row is always the header row, and the `:--` / `:-:` / `--:` separator sets column alignment as usual.

Without the plugin, the block shows as a code block containing a pipe table. To turn a interactive table back into a normal table, use the command "Convert interactive table at cursor to plain markdown table" (merged cells are split and widths dropped, since GFM can't express them). "Convert markdown table at cursor to interactive table" goes the other way.

## Commands

- Insert interactive table (also in the editor right-click menu)
- Convert markdown table at cursor to interactive table (also "Convert to interactive table" in the right-click menu on a table)
- Convert all markdown tables in this note to interactive tables
- Convert interactive table at cursor to plain markdown table

## Building

```
npm install
npm run build   # writes main.js
npm test        # table model tests
```

Only `main.js`, `manifest.json` and `styles.css` are needed at runtime; `node_modules`, `src` and `test` can be deleted if you don't plan to rebuild.

## Settings

Settings, Community plugins, Interactive Tables: the size of a newly inserted table, and whether Enter moves to the cell below while editing.
