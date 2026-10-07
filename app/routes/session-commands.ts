import { data } from "react-router";

import type { Route } from "./+types/session-commands";
import { sessionInfo } from "~/lib/board.server";
import { slashCommands } from "~/lib/commands.server";
import { ENGINE_FEATURES } from "~/lib/config";
import { listLive } from "~/lib/drive.server";
import { SESSION_ID } from "~/lib/guard.server";

// The slash commands a chat's inputs suggest, for an agent that lists them.
export async function loader({ params }: Route.LoaderArgs) {
  if (!SESSION_ID.test(params.sessionId)) {
    throw data("Bad session id", { status: 400 });
  }
  // A chat writes no transcript until its first prompt; until then cmux
  // knows its folder. An error here would take the whole board down.
  const info =
    (await sessionInfo(params.sessionId)) ??
    (await listLive().catch(() => null))?.get(params.sessionId);
  if (!info?.cwd || !ENGINE_FEATURES[info.engine].slashCommands)
    return { commands: [] };
  try {
    return { commands: await slashCommands(info.cwd) };
  } catch (err) {
    console.error("seamux commands:", (err as Error).message);
    return { commands: [] };
  }
}
