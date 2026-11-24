import { Editor, MarkdownView, Menu, Notice, Plugin } from "obsidian";
import { hasStyle, isSeparatorRow, parse, pipeTable } from "./model";
import { prefixOf, stripPrefix } from "./fence";
import { RichTableView } from "./view";
import { DEFAULT_SETTINGS, InteractiveTablesSettingTab, Settings, sanitize } from "./settings";

export const FENCE = "rtable";

function template(cols: number, rows: number): string {
  const row = (cell: (i: number) => string) => "| " + Array.from({ length: cols }, (_, i) => cell(i)).join(" | ") + " |";
  return [
    "```" + FENCE,
    row((i) => `Column ${i + 1}`),
    row(() => "--------"),
    ...Array.from({ length: rows }, () => row(() => "        ")),
    "```",
    "",
  ].join("\n");
}

export default class RichTablesPlugin extends Plugin {
  private lastContextTarget: Element | null = null;
  settings: Settings = { ...DEFAULT_SETTINGS };

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async onload(): Promise<void> {
    this.settings = sanitize((await this.loadData()) as Partial<Settings> | null);
    this.addSettingTab(new InteractiveTablesSettingTab(this.app, this));

    this.registerMarkdownCodeBlockProcessor(FENCE, (source, el, ctx) => {
      ctx.addChild(new RichTableView(this.app, el, source, ctx, () => this.settings));
    });

    this.addCommand({
      id: "insert",
      name: "Insert interactive table",
      editorCallback: (editor) => this.insert(editor),
    });
    this.addCommand({
      id: "convert-to-rich",
      name: "Convert markdown table at cursor to interactive table",
      editorCheckCallback: (checking, editor) => {
        const found = this.locateTable(editor, activeDocument.activeElement);
        if (checking) return !!found;
        if (found) this.toRich(found.editor, found.range);
        return true;
      },
    });
    this.addCommand({
      id: "convert-all-to-rich",
      name: "Convert all markdown tables in this note to interactive tables",
      editorCallback: (editor) => {
        const tables = this.findAllPipeTables(editor);
        // Bottom-up so earlier line numbers stay valid.
        for (const r of tables.reverse()) this.toRich(editor, r);
        new Notice(tables.length ? `Converted ${tables.length} table${tables.length > 1 ? "s" : ""}.` : "No markdown tables found.");
      },
    });
    this.addCommand({
      id: "convert-to-plain",
      name: "Convert interactive table at cursor to plain markdown table",
      editorCheckCallback: (checking, editor) => {
        const range = this.findFence(editor);
        if (checking) return !!range;
        if (range) this.toPlain(editor, range);
        return true;
      },
    });

    // Live Preview draws a pipe table as a widget, so the editor cursor isn't on its lines.
    // Remember what was right-clicked (this runs before the menu event) to find the table that way.
    const watch = (doc: Document) =>
      this.registerDomEvent(
        doc,
        "contextmenu",
        (e) => {
          this.lastContextTarget = e.target instanceof Element ? e.target : null;
        },
        true
      );
    watch(activeDocument);
    this.registerEvent(this.app.workspace.on("window-open", (_w, win) => watch(win.document)));

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor) => {
        menu.addItem((i) => i.setTitle("Insert interactive table").setIcon("table").onClick(() => this.insert(editor)));
        const target = this.lastContextTarget;
        if (this.locateTable(editor, target)) {
          menu.addItem((i) =>
            i.setTitle("Convert to interactive table").setIcon("table").onClick(() => {
              // Re-find at click time: the note may have shifted while the menu was open.
              const found = this.locateTable(editor, target);
              if (found) this.toRich(found.editor, found.range);
            })
          );
        }
      })
    );
  }

  private insert(editor: Editor): void {
    const cur = editor.getCursor();
    const prefix = editor.getLine(cur.line).trim() ? "\n\n" : "";
    editor.replaceSelection(prefix + template(this.settings.cols, this.settings.rows));
  }

  /**
   * The note's editor and the pipe table in question. Clicking into a rendered table can hand us
   * the table cell's own mini-editor, so the note's active editor is used for the lines.
   */
  private locateTable(editor: Editor, el: Element | null): { editor: Editor; range: { from: number; to: number } } | null {
    const ed = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor ?? editor;
    const range = this.tableFromElement(ed, el) ?? this.findPipeTable(ed);
    return range ? { editor: ed, range } : null;
  }

  /** The pipe table whose rendered widget contains `target`, found through the editor's DOM mapping. */
  private tableFromElement(editor: Editor, target: Element | null): { from: number; to: number } | null {
    const el = target?.closest("table");
    if (!el || el.closest(".rt-root") || !el.closest(".cm-editor")) return null;
    const cm = (editor as unknown as { cm?: { posAtDOM(node: Node): number } }).cm;
    if (!cm) return null;
    try {
      const line = editor.offsetToPos(cm.posAtDOM(el)).line;
      // The widget's position can land on the table's first row or a line next to it.
      for (const n of [line, line + 1, line - 1]) {
        const r = this.findPipeTable(editor, n);
        if (r) return r;
      }
    } catch {
      // Not a position we can map; fall back to the cursor line.
    }
    return null;
  }

  private findPipeTable(editor: Editor, at?: number): { from: number; to: number } | null {
    const isRow = (n: number) => n >= 0 && n < editor.lineCount() && stripPrefix(editor.getLine(n)).startsWith("|");
    const line = at ?? editor.getCursor().line;
    if (!isRow(line) || (at === undefined && this.findFence(editor))) return null;
    let from = line;
    let to = line;
    while (isRow(from - 1)) from--;
    while (isRow(to + 1)) to++;
    if (to - from < 1 || !isSeparatorRow(stripPrefix(editor.getLine(from + 1)))) return null;
    return { from, to };
  }

  /** Every pipe table outside code fences, top to bottom. */
  private findAllPipeTables(editor: Editor): { from: number; to: number }[] {
    const out: { from: number; to: number }[] = [];
    const isRow = (n: number) => stripPrefix(editor.getLine(n)).startsWith("|");
    let fence: string | null = null;
    for (let n = 0; n < editor.lineCount(); n++) {
      const t = stripPrefix(editor.getLine(n)).trim();
      const f = /^(`{3,}|~{3,})/.exec(t);
      if (f) {
        if (!fence) fence = f[1];
        else if (t.startsWith(fence)) fence = null;
        continue;
      }
      if (fence || !isRow(n)) continue;
      const from = n;
      while (n + 1 < editor.lineCount() && isRow(n + 1)) n++;
      if (n > from && isSeparatorRow(stripPrefix(editor.getLine(from + 1)))) out.push({ from, to: n });
    }
    return out;
  }

  private findFence(editor: Editor): { from: number; to: number } | null {
    const line = editor.getCursor().line;
    let from = -1;
    for (let n = line; n >= 0; n--) {
      const t = stripPrefix(editor.getLine(n)).trim();
      if (t.startsWith("```" + FENCE)) {
        from = n;
        break;
      }
      if (t.startsWith("```") && n !== line) return null;
    }
    if (from < 0) return null;
    for (let n = from + 1; n < editor.lineCount(); n++) {
      if (stripPrefix(editor.getLine(n)).startsWith("```")) return n >= line ? { from, to: n } : null;
    }
    return null;
  }

  private toRich(editor: Editor, r: { from: number; to: number }): void {
    const pre = prefixOf(editor.getLine(r.from));
    editor.replaceRange("\n" + pre + "```", { line: r.to, ch: editor.getLine(r.to).length });
    editor.replaceRange("```" + FENCE + "\n" + pre, { line: r.from, ch: pre.length });
  }

  private toPlain(editor: Editor, r: { from: number; to: number }): void {
    const body: string[] = [];
    const pre = prefixOf(editor.getLine(r.from));
    for (let n = r.from + 1; n < r.to; n++) body.push(stripPrefix(editor.getLine(n)));
    const model = parse(body.join("\n"));
    const merged = model.cells.some((c) => c.rs > 1 || c.cs > 1);
    editor.replaceRange(
      pipeTable(model, false).map((l) => pre + l).join("\n"),
      { line: r.from, ch: 0 },
      { line: r.to, ch: editor.getLine(r.to).length }
    );
    if (merged) new Notice("Merged cells were split, since plain markdown tables can't merge cells.");
    const styled = [...model.rowStyles, ...model.colStyles, ...model.cells.map((c) => c.style)].some(hasStyle);
    if (styled) new Notice("Cell colors and fonts were dropped, since plain markdown tables can't hold them.");
  }
}
