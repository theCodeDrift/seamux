// seamux's own settings, set from the board's config dialog. Safe to import
// from client and server, and from scripts Node runs directly.

// System macros: text the dispatcher sends into a session as a user prompt,
// at a fixed point in its life.
export const MACRO_NAMES = [
  "sessionInformation",
  "newSession",
  "howToWorktree",
  "closeSession",
] as const;
export type MacroName = (typeof MACRO_NAMES)[number];

export interface MacroInfo {
  label: string;
  // When the dispatcher sends it.
  when: string;
  variables: { name: string; meaning: string }[];
  // A variable the macro must contain, if any.
  required: string | null;
}

export const MACROS: Record<MacroName, MacroInfo> = {
  sessionInformation: {
    label: "Session information",
    when: "Filled into the new session's {{session_information}} for every session seamux dispatches, and sent again, with How to worktree when the chat is in one, after you clear a chat from the board. Leave it empty to say nothing.",
    variables: [
      { name: "name", meaning: "the session's name" },
      { name: "cwd", meaning: "the directory it runs in" },
    ],
    required: null,
  },
  newSession: {
    label: "New session",
    when: "The first prompt of every session seamux dispatches, from the board or a fan-out.",
    variables: [
      { name: "prompt", meaning: "what you typed into the dispatch bar" },
      { name: "cwd", meaning: "the directory the session starts in" },
      {
        name: "session_information",
        meaning:
          "the Session information macro; added at the start if left out",
      },
      {
        name: "how_to_worktree",
        meaning:
          "the How to worktree macro, when it applies; added at the end if left out",
      },
    ],
    required: "prompt",
  },
  howToWorktree: {
    label: "How to worktree",
    when: "Filled into the new session's {{how_to_worktree}} whenever seamux starts it in a new worktree. The default has the session follow the repo's own worktree convention, or propose one and record it in the repo's agent instructions when there is none. Leave it empty to say nothing.",
    variables: [
      { name: "worktree", meaning: "the new worktree's directory" },
      { name: "branch", meaning: "its branch" },
      { name: "repo", meaning: "the repo's main checkout, which holds it" },
      {
        name: "worktrees",
        meaning:
          "where seamux puts the repo's worktrees, relative to the main checkout: .claude/worktrees/ or worktrees/",
      },
    ],
    required: null,
  },
  closeSession: {
    label: "Close session",
    when: "Sent when you close an idle chat. The chat exits once that turn ends, unless it leaves uncommitted changes or its worktree behind. Leave it empty to exit straight away.",
    variables: [
      { name: "cwd", meaning: "the session's directory" },
      { name: "repo", meaning: "the repo it belongs to, worktrees included" },
      {
        name: "siblings",
        meaning: "a sentence naming the other live sessions under that repo",
      },
    ],
    required: null,
  },
};

export const DEFAULT_MACROS: Record<MacroName, string> = {
  sessionInformation: `# Session information

This session runs inside seamux, a board over agent sessions powered by the cmux terminal on macOS. Its chat is "{{name}}", in {{cwd}}. Messages may arrive from the board while you work, and seamux will do its best to use your established hooks and servers for querying about subagent and fan-out work. If you and the user encounter issues, you can offer to help the user submit feedback or a bug to the seamux repository at https://github.com/thecodedrift/seamux`,
  newSession:
    "{{session_information}}\n\n{{how_to_worktree}}\n\n# User prompt\n\n{{prompt}}",
  howToWorktree: `## How to worktree

You are working in a new git worktree, {{worktree}}, on branch {{branch}}, made from the repo's main checkout, {{repo}}.

If the repo already has a convention for working in worktrees, in its CLAUDE.md, AGENTS.md or other agent instructions, follow that and ignore the rest of this.

If it doesn't, propose this convention to the user before you start the work. Once they have agreed to it, or to their own version of it, record it in the repo's agent instructions (CLAUDE.md, AGENTS.md, or whichever it has), so later sessions follow it without asking, and follow it in this worktree:

1. Worktrees go under {{worktrees}} in the main checkout, never inside other worktrees, and git ignores that directory: \`git -C {{repo}} check-ignore -q {{worktrees}}\` succeeds when it does. If it doesn't, add it to .gitignore.
2. A new worktree starts from the latest main, unless the work was asked to start from a particular branch or commit: fetch, then rebase onto whichever of the local main branch and the remote's is ahead.
3. Install the project's dependencies in the worktree before running any of its scripts. Package managers hoist dependencies inconsistently, so what is installed in the main checkout may not resolve from a worktree.
4. Do all the work in the worktree, never in the main checkout.`,
  closeSession: `Clean up after yourself: if you are working in a worktree, remove it and its branch.

{{siblings}} Do not touch anything outside your own worktree, and do not run a bare \`git worktree prune\` or anything else that operates on the whole repo.

If you have uncommitted work, say so and stop rather than discarding it.`,
};

export const MAX_MACRO = 20_000;

// The agents seamux can launch and drive, each through its cmux wrapper.
// cmux integrates more (`cmux hooks setup` lists them), but only these have
// been measured end to end; knowledge/ has what each one does.
export const ENGINES = ["claude", "codex"] as const;
export type Engine = (typeof ENGINES)[number];

export const ENGINE_LABELS: Record<Engine, string> = {
  claude: "Claude Code",
  codex: "Codex",
};

// Each service's own color, for what the board shows about it: Anthropic's
// clay for Claude Code, OpenAI's teal for Codex.
export const ENGINE_COLORS: Record<Engine, string> = {
  claude: "var(--engine-claude)",
  codex: "var(--engine-codex)",
};

// What each agent can do that the board offers, readable in the browser as
// well as on the server. What only the server needs is on its Harness
// (harness.server.ts). A new agent fills in every field, so nothing it
// lacks falls through to another agent's behaviour.
export interface EngineFeatures {
  // Its slash commands are listed (commands.server.ts) and suggested as
  // they're typed.
  slashCommands: boolean;
  // It starts a new chat from a copy of another's conversation.
  fork: boolean;
  // A card names it, which every agent but the one most chats run gets.
  badge: boolean;
}

export const ENGINE_FEATURES: Record<Engine, EngineFeatures> = {
  claude: { slashCommands: true, fork: true, badge: false },
  codex: { slashCommands: false, fork: false, badge: true },
};

export function isEngine(name: string): name is Engine {
  return (ENGINES as readonly string[]).includes(name);
}

export interface Config {
  // What the dispatch bar's directory picker offers. Empty means every
  // directory seamux can find.
  directories: string[];
  // The dispatch bar's "new worktree" switch starts on.
  worktreeByDefault: boolean;
  // What the dispatch bar launches unless it is switched for one dispatch.
  defaultEngine: Engine;
  macros: Record<MacroName, { text: string; custom: boolean }>;
  // Colour slots picked for projects, by project path
  // (app/lib/project-colors.ts). A project not here gets a hashed slot.
  projectColors: Record<string, number>;
}

export const DEFAULT_CONFIG: Config = {
  directories: [],
  projectColors: {},
  worktreeByDefault: false,
  defaultEngine: "claude",
  macros: Object.fromEntries(
    MACRO_NAMES.map((name) => [
      name,
      { text: DEFAULT_MACROS[name], custom: false },
    ]),
  ) as Config["macros"],
};

// Fills `{{name}}` from `vars` in one pass, so a value that itself contains
// braces is left alone. An unknown name is kept as written.
export function renderMacro(
  text: string,
  vars: Record<string, string>,
): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, name: string) =>
    Object.hasOwn(vars, name) ? vars[name] : whole,
  );
}

export function usesVariable(text: string, name: string): boolean {
  return new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`).test(text);
}

// The New session macro as dispatch fills it: Session information at the
// start and How to worktree at the end when it leaves either out.
export function newSessionTemplate(text: string): string {
  if (!usesVariable(text, "session_information"))
    text = `{{session_information}}\n\n${text}`;
  if (!usesVariable(text, "how_to_worktree")) text += "\n\n{{how_to_worktree}}";
  return text;
}

// `text` without `{{name}}` and the blank lines after it, for a variable
// with nothing to fill in.
export function dropVariable(text: string, name: string): string {
  return text.replace(new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}\\s*`, "g"), "");
}
