import { data } from "react-router";

import type { Route } from "./+types/session-messages";
import { MESSAGES_SHOWN } from "~/lib/board";
import { loadMessages } from "~/lib/board.server";
import { SESSION_ID } from "~/lib/guard.server";

export async function loader({ params, request }: Route.LoaderArgs) {
  if (!SESSION_ID.test(params.sessionId)) {
    throw data("Bad session id", { status: 400 });
  }
  // How many of the last messages to send, more each time the chat is
  // scrolled back for earlier ones.
  const asked = Number(new URL(request.url).searchParams.get("limit"));
  const limit = Number.isInteger(asked) && asked > 0 ? asked : MESSAGES_SHOWN;
  // A chat writes no transcript until its first prompt: no messages yet,
  // not an error, which would take the whole board down with it.
  return (
    (await loadMessages(params.sessionId, limit)) ?? {
      messages: [],
      total: 0,
    }
  );
}
