import { data } from "react-router";

import type { Route } from "./+types/file-raw";
import { fileResponse, resolveFile, SANDBOX_BASE } from "~/lib/files.server";
import { assertLocalHost, assertLocalRead } from "~/lib/guard.server";

// A file's bytes, for the viewer's images, players and rendered-HTML frame. The
// path is the URL's own, `/file/raw/Users/…`, so relative links inside an
// HTML file resolve beside it. The same file under SANDBOX_BASE is for that
// frame, whose requests arrive cross-site, and whose own navigations, such
// as to a linked PDF, arrive as `Sec-Fetch-Dest: iframe`.
export async function loader({ request }: Route.LoaderArgs) {
  const { pathname } = new URL(request.url);
  let prefix = "/file/raw";
  let framed = false;
  if (pathname.startsWith(`${SANDBOX_BASE}/`)) {
    assertLocalHost(request);
    prefix = SANDBOX_BASE;
    framed = request.headers.get("sec-fetch-dest") === "iframe";
  } else if (pathname.startsWith("/file/raw/")) {
    assertLocalRead(request);
  } else {
    throw data("Forbidden", { status: 403 });
  }
  let path: string;
  try {
    path = decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    throw data("Bad path", { status: 400 });
  }
  const found = await resolveFile(path);
  if (!found || !found.stats.isFile()) {
    throw data("Not found", { status: 404 });
  }
  return fileResponse(found, {
    framed,
    range: request.headers.get("range"),
  });
}
