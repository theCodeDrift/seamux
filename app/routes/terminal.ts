import type { Route } from "./+types/terminal";
import { assertFromBoard, assertLocalRead } from "~/lib/guard.server";
import {
  isTerminalKey,
  type TerminalResult,
  type TerminalScreen,
} from "~/lib/terminal";
import {
  openTerminal,
  readTerminal,
  sendToTerminal,
} from "~/lib/terminal.server";

export async function loader({
  request,
}: Route.LoaderArgs): Promise<TerminalScreen> {
  assertLocalRead(request);
  try {
    return { text: await readTerminal(), error: null };
  } catch (err) {
    return { text: null, error: (err as Error).message };
  }
}

// The browser never names a surface: this reaches the board's one terminal
// and nothing else.
export async function action({
  request,
}: Route.ActionArgs): Promise<TerminalResult> {
  assertFromBoard(request);
  const form = await request.formData();
  try {
    if (form.get("intent") === "open") {
      await openTerminal();
    } else {
      const key = String(form.get("key") ?? "") || null;
      if (key && !isTerminalKey(key)) throw new Error("Unknown key");
      await sendToTerminal(String(form.get("text") ?? ""), key);
    }
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
