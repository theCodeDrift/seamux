import { data } from "react-router";

import type { Route } from "./+types/file-download";
import { fileResponse, resolveFile } from "~/lib/files.server";
import { assertLocalRead } from "~/lib/guard.server";

// A file to save rather than show: `/file/download?path=/abs/path`. Nothing
// resolves against a download, so the path can sit in the query, as it
// does for the viewer, unlike /file/raw.
export async function loader({ request }: Route.LoaderArgs) {
  assertLocalRead(request);
  const path = new URL(request.url).searchParams.get("path");
  if (!path) throw data("No path", { status: 400 });
  const found = await resolveFile(path);
  if (!found || !found.stats.isFile()) {
    throw data("Not found", { status: 404 });
  }
  return fileResponse(found, {
    download: true,
    range: request.headers.get("range"),
  });
}
