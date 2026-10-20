// A card's colour follows its project, and a worktree's project is the repo
// that holds it, wherever in it the worktree lives.

import { describe, expect, it } from "vitest";

import { projectOf } from "~/lib/project-colors";

describe("projectOf", () => {
  it.each([
    "/work/repo/.agents/.worktrees/fix-it/app",
    "/work/repo/.claude/worktrees/fix-it",
    "/work/repo/worktrees/fix-it",
    "/work/repo",
  ])("puts %s in /work/repo", (cwd) => {
    expect(projectOf(cwd)).toBe("/work/repo");
  });
});
