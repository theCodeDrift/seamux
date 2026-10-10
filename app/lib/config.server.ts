// Reads and writes the config table. Imported by drive.server.ts, which
// scripts/seamux.ts runs under plain Node: relative imports with extensions.

import {
  DEFAULT_CONFIG,
  isEngine,
  DEFAULT_MACROS,
  MACRO_NAMES,
  MACROS,
  MAX_MACRO,
  usesVariable,
  type Config,
  type MacroName,
} from "./config.ts";
import { storedSlot } from "./project-colors.ts";
import { readValue, updateValue, writeValue } from "./store.server.ts";

function get<T>(key: string, fallback: T): T {
  const value = readValue(key);
  return value === undefined ? fallback : (value as T);
}

// `undefined` removes the key, putting the setting back to its default.
const put = writeValue;

export function readConfig(): Config {
  const macros = { ...DEFAULT_CONFIG.macros };
  for (const name of MACRO_NAMES) {
    const text = get<string | null>(`macro:${name}`, null);
    if (typeof text === "string") macros[name] = { text, custom: true };
  }
  return {
    directories: get("directories", DEFAULT_CONFIG.directories),
    worktreeByDefault: get(
      "worktreeByDefault",
      DEFAULT_CONFIG.worktreeByDefault,
    ),
    defaultEngine: (() => {
      const engine = get<string>("defaultEngine", DEFAULT_CONFIG.defaultEngine);
      return isEngine(engine) ? engine : DEFAULT_CONFIG.defaultEngine;
    })(),
    macros,
    projectColors: readProjectColors(get("projectColors", null)),
  };
}

// The config, or the defaults when the store can't be read, so a broken
// store never stops a dispatch or the board.
export function configOrDefaults(): Config {
  try {
    return readConfig();
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function addDirectory(path: string) {
  const dirs = new Set(readConfig().directories);
  dirs.add(path);
  put("directories", [...dirs].sort());
}

export function removeDirectory(path: string) {
  const dirs = readConfig().directories.filter((d) => d !== path);
  put("directories", dirs.length > 0 ? dirs : undefined);
}

export function setWorktreeByDefault(on: boolean) {
  put(
    "worktreeByDefault",
    on === DEFAULT_CONFIG.worktreeByDefault ? undefined : on,
  );
}

export function setDefaultEngine(engine: string) {
  if (!isEngine(engine)) throw new Error("Unknown engine");
  put(
    "defaultEngine",
    engine === DEFAULT_CONFIG.defaultEngine ? undefined : engine,
  );
}

export function isMacroName(name: string): name is MacroName {
  return (MACRO_NAMES as readonly string[]).includes(name);
}

// `null` puts the macro back to its default.
export function setMacro(name: MacroName, text: string | null) {
  if (text === null || text === DEFAULT_MACROS[name]) {
    put(`macro:${name}`, undefined);
    return;
  }
  if (text.length > MAX_MACRO) throw new Error("That macro is too long");
  const required = MACROS[name].required;
  if (required && !usesVariable(text, required)) {
    throw new Error(`The ${MACROS[name].label} macro needs {{${required}}}`);
  }
  put(`macro:${name}`, text);
}

// The slots kept for projects, leaving out any no longer in the palette.
function readProjectColors(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object") return {};
  const colors: Record<string, number> = {};
  for (const [project, kept] of Object.entries(raw)) {
    const slot = storedSlot(kept);
    if (slot !== undefined) colors[project] = slot;
  }
  return colors;
}

// `null` puts the project back on its hashed slot.
export function setProjectColor(project: string, slot: number | null) {
  if (!project) throw new Error("No project");
  const picked = slot === null ? undefined : storedSlot(slot);
  if (slot !== null && picked === undefined) throw new Error("Unknown colour");
  updateValue("projectColors", readProjectColors, (colors) => {
    const { [project]: _, ...rest } = colors;
    return picked === undefined ? rest : { ...rest, [project]: picked };
  });
}

// Colours a browser kept before they moved here. A project that already
// has one here keeps it.
export function importProjectColors(kept: unknown) {
  const incoming = readProjectColors(kept);
  updateValue("projectColors", readProjectColors, (colors) => {
    const added = Object.keys(incoming).filter((p) => !(p in colors));
    if (added.length === 0) return colors;
    return {
      ...Object.fromEntries(added.map((p) => [p, incoming[p]])),
      ...colors,
    };
  });
}
