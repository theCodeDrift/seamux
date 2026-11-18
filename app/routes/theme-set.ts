import { data } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/theme-set";
import { isLocalRequest } from "~/lib/guard.server";
import { SEAMUX_HOME } from "~/lib/paths.server";
import { isLanHost } from "~/lib/remote.server";
import { DEFAULT_THEME } from "~/lib/theme";
import { readThemes, readThemeSwap, setActiveTheme } from "~/lib/theme.server";

// Sets the board's theme from a script, once the Themes tab allows it: the
// theme, and light or dark if asked, from curl or a Shortcut, as JSON:
// `{"name": "duck", "color": "dark"}`. The one action that skips
// assertFromBoard, since a script sends no Origin. remoteGate and the HTTP
// Basic check have already run, and it can only choose among saved themes,
// never make or change one.

// Never a GET, which any page the user visits could fire with an <img>.
export function loader() {
  throw data(null, { status: 405, headers: { Allow: "POST" } });
}

const swapSchema = z.strictObject({
  name: z.string(),
  color: z.enum(["light", "dark"]).optional(),
});

export async function action({ request }: Route.ActionArgs) {
  // On this Mac, or a LAN name while LAN access is on; never through the
  // tunnel.
  const host = request.headers.get("host");
  if (!isLocalRequest(request) && !isLanHost(SEAMUX_HOME, host)) {
    throw data(null, { status: 403 });
  }
  // A browser sends an Origin with every cross-site POST, and React Router
  // doesn't check it on a route without a page (knowledge/
  // vite-and-react-router.md), so another site's form would get here. A
  // script sends none; the board itself sends its own.
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== `http://${host}`) {
    throw data(null, { status: 403 });
  }
  if (!readThemeSwap().on) throw data(null, { status: 403 });
  // JSON only, which another site's page can't send without a CORS
  // preflight, which the board never answers.
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(type)) throw data(null, { status: 415 });
  const body = swapSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) throw data(null, { status: 400 });
  const { name, color } = body.data;
  if (name !== DEFAULT_THEME && !Object.hasOwn(readThemes(), name)) {
    throw data(null, { status: 404 });
  }
  setActiveTheme(name, color);
  return new Response(null, { status: 204 });
}
