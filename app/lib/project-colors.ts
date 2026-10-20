// Each card's path carries a colour for the project it belongs to, so cards
// from one repo can be spotted at a glance. A worktree
// (`.agents/.worktrees/<name>`, `.claude/worktrees/<name>` or
// `worktrees/<name>`) belongs to its repo.
export function projectOf(cwd: string): string {
  return cwd.replace(
    /\/(?:\.claude\/|\.agents\/\.)?worktrees\/[^/]+(?:\/.*)?$/,
    "",
  );
}

// The picker's colours are slots, 1 to PROJECT_COLOR_COUNT, each painted by
// its --project-color-<n> token in app.css, so a theme can repaint them. A
// project keeps its slot.
export const PROJECT_COLOR_COUNT = 12;

export const PROJECT_COLOR_SLOTS = Array.from(
  { length: PROJECT_COLOR_COUNT },
  (_, i) => i + 1,
);

export function projectColor(slot: number): string {
  return `var(--project-color-${slot})`;
}

// A project with no picked colour gets a slot hashed from its path, the same
// on every poll and every reload. FNV-1a picks it.
export function hashedSlot(project: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < project.length; i++) {
    h ^= project.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % PROJECT_COLOR_COUNT) + 1;
}

// The colours this browser kept before they were slots, in slot order, so a
// colour picked then still reads as its slot.
const LEGACY_COLORS = [
  "oklch(0.64 0.24 25)",
  "oklch(0.71 0.21 48)",
  "oklch(0.77 0.19 70)",
  "oklch(0.85 0.2 92)",
  "oklch(0.84 0.24 129)",
  "oklch(0.72 0.22 150)",
  "oklch(0.78 0.15 182)",
  "oklch(0.79 0.15 212)",
  "oklch(0.62 0.21 260)",
  "oklch(0.61 0.25 293)",
  "oklch(0.67 0.29 322)",
  "oklch(0.66 0.24 354)",
];

// The slot a kept choice names, or undefined for none, or one no longer in
// the palette.
export function storedSlot(kept: unknown): number | undefined {
  if (typeof kept === "number") {
    return Number.isInteger(kept) && kept >= 1 && kept <= PROJECT_COLOR_COUNT
      ? kept
      : undefined;
  }
  const i = LEGACY_COLORS.indexOf(kept as string);
  return i >= 0 ? i + 1 : undefined;
}
