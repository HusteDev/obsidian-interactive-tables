import { App, PluginSettingTab, Setting } from "obsidian";
import type RichTablesPlugin from "./main";

export interface Settings {
  /** Columns in a newly inserted table. */
  cols: number;
  /** Body rows (below the header) in a newly inserted table. */
  rows: number;
  /** Enter finishes editing a cell and moves to the cell below, like a spreadsheet. */
  enterMovesDown: boolean;
}

export const DEFAULT_SETTINGS: Settings = { cols: 3, rows: 2, enterMovesDown: true };

const clampInt = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
};

export function sanitize(raw: Partial<Settings> | null | undefined): Settings {
  return {
    cols: clampInt(raw?.cols, 1, 12, DEFAULT_SETTINGS.cols),
    rows: clampInt(raw?.rows, 1, 50, DEFAULT_SETTINGS.rows),
    enterMovesDown: typeof raw?.enterMovesDown === "boolean" ? raw.enterMovesDown : DEFAULT_SETTINGS.enterMovesDown,
  };
}

export class InteractiveTablesSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: RichTablesPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("New table columns")
      .setDesc("Columns in a table made with the insert command.")
      .addText((t) =>
        t.setValue(String(this.plugin.settings.cols)).onChange(async (v) => {
          this.plugin.settings.cols = sanitize({ cols: v as unknown as number }).cols;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("New table rows")
      .setDesc("Rows below the header in a table made with the insert command.")
      .addText((t) =>
        t.setValue(String(this.plugin.settings.rows)).onChange(async (v) => {
          this.plugin.settings.rows = sanitize({ rows: v as unknown as number }).rows;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Enter moves down")
      .setDesc("When editing a cell, Enter saves it and selects the cell below. Turn off to stay on the same cell.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.enterMovesDown).onChange(async (v) => {
          this.plugin.settings.enterMovesDown = v;
          await this.plugin.saveSettings();
        })
      );
  }
}
