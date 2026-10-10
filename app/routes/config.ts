import { data } from "react-router";

import type { Route } from "./+types/config";
import {
  addDirectory,
  importProjectColors,
  isMacroName,
  removeDirectory,
  setDefaultEngine,
  setMacro,
  setProjectColor,
  setWorktreeByDefault,
} from "~/lib/config.server";
import { forgetCommands } from "~/lib/commands.server";
import { checkDirectory } from "~/lib/drive.server";
import { assertFromBoard, isLocalRequest } from "~/lib/guard.server";
import { readCredentials } from "~/lib/credentials";
import { SEAMUX_HOME } from "~/lib/paths.server";
import {
  readRemoteSettings,
  setRemoteSwitch,
  type RemoteSwitch,
} from "~/lib/remote.server";
import { parseThemeInput } from "~/lib/theme";
import {
  clearThemes,
  removeTheme,
  saveTheme,
  setActiveTheme,
  setThemeSwap,
} from "~/lib/theme.server";

const INTENTS = new Set([
  "add-directory",
  "remove-directory",
  "worktree-default",
  "default-engine",
  "save-macro",
  "reset-macro",
  "remote",
  "tunnel",
  "mdns",
  "clear-commands",
  "save-theme",
  "remove-theme",
  "activate-theme",
  "theme-set",
  "clear-themes",
  "project-color",
  "import-project-colors",
]);

export interface ConfigResult {
  ok: boolean;
  error: string | null;
}

async function perform(intent: string, form: FormData, request: Request) {
  const field = (name: string) => String(form.get(name) ?? "");
  if (intent === "add-directory") {
    addDirectory(await checkDirectory(field("path").trim()));
  } else if (intent === "remove-directory") {
    removeDirectory(field("path"));
  } else if (intent === "worktree-default") {
    setWorktreeByDefault(field("on") === "true");
  } else if (intent === "default-engine") {
    setDefaultEngine(field("engine"));
  } else if (intent === "save-macro" || intent === "reset-macro") {
    const name = field("name");
    if (!isMacroName(name)) throw new Error("Unknown macro");
    setMacro(name, intent === "save-macro" ? field("text") : null);
  } else if (intent === "remote" || intent === "tunnel" || intent === "mdns") {
    setRemote(intent, field("on") === "true", request);
  } else if (intent === "project-color") {
    const slot = field("slot");
    setProjectColor(field("project"), slot ? Number(slot) : null);
  } else if (intent === "import-project-colors") {
    importProjectColors(JSON.parse(field("colors") || "{}"));
  } else if (intent === "clear-commands") {
    forgetCommands();
  } else if (intent === "save-theme") {
    const parsed = parseThemeInput({
      label: field("label"),
      light: field("light"),
      dark: field("dark"),
    });
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    saveTheme(field("name"), parsed.theme);
  } else if (intent === "clear-themes") {
    clearThemes();
  } else if (intent === "remove-theme") {
    removeTheme(field("name"));
  } else if (intent === "activate-theme") {
    setActiveTheme(field("name"));
  } else if (intent === "theme-set") {
    // Like remote access: on only from this Mac, off from anywhere.
    const on = field("on") === "true";
    if (on && !isLocalRequest(request)) {
      throw new Error("Setting the theme from a script can only be turned on from this Mac");
    }
    setThemeSwap(on);
  }
}

// Remote access turns on only from this Mac, so a lost phone can't reopen
// it once it's off. It turns off from anywhere.
function setRemote(which: RemoteSwitch, on: boolean, request: Request) {
  if (on) {
    if (!isLocalRequest(request)) {
      throw new Error("Remote access can only be turned on from this Mac");
    }
    if (which === "tunnel") {
      const { missing } = readRemoteSettings(SEAMUX_HOME);
      if (missing.length > 0) {
        throw new Error(`Set ${missing.join(", ")} first`);
      }
    }
    if (which === "mdns" && !readCredentials(SEAMUX_HOME)) {
      throw new Error("Set SEAMUX_USER and SEAMUX_PASS first");
    }
  }
  setRemoteSwitch(SEAMUX_HOME, which, on);
}

export async function action({
  request,
}: Route.ActionArgs): Promise<ConfigResult> {
  assertFromBoard(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (!INTENTS.has(intent)) throw data("Unknown intent", { status: 400 });
  try {
    await perform(intent, form, request);
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
