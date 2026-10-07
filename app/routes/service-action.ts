import { data } from "react-router";

import type { Route } from "./+types/service-action";
import { loadBoard } from "~/lib/board.server";
import { isEngine, type Engine } from "~/lib/config";
import { assertFromBoard } from "~/lib/guard.server";
import {
  cancelLogin,
  resumeStopped,
  startLogin,
  submitLoginCode,
} from "~/lib/service.server";

const INTENTS = new Set(["login", "login-code", "login-cancel", "resume"]);
// A sign-in code is a few dozen characters; anything longer is a mistake.
const MAX_CODE = 500;

export interface ServiceActionResult {
  ok: boolean;
  error: string | null;
}

async function perform(service: Engine, intent: string, form: FormData) {
  if (intent === "login") {
    startLogin(service);
  } else if (intent === "login-code") {
    const code = String(form.get("code") ?? "").trim();
    if (!code) throw new Error("Paste the code first");
    // One line: a line break would submit it early.
    if (code.length > MAX_CODE || /[\u0000-\u001f\u007f]/.test(code)) {
      throw new Error("That doesn't look like a sign-in code");
    }
    submitLoginCode(service, code);
  } else if (intent === "login-cancel") {
    cancelLogin(service);
  } else if (intent === "resume") {
    const failed = await resumeStopped((await loadBoard()).cards, service);
    if (failed.length > 0) {
      throw new Error(`Couldn't reach ${failed.join(", ")}`);
    }
  }
}

export async function action({
  request,
  params,
}: Route.ActionArgs): Promise<ServiceActionResult> {
  assertFromBoard(request);
  if (!isEngine(params.service)) throw data("Unknown service", { status: 400 });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (!INTENTS.has(intent)) throw data("Unknown intent", { status: 400 });

  try {
    await perform(params.service, intent, form);
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
