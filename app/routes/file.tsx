import { useEffect } from "react";
import {
  data,
  Link,
  useFetcher,
  useRevalidator,
  useSearchParams,
  type ShouldRevalidateFunctionArgs,
} from "react-router";
import { File, Folder, ListOrdered } from "lucide-react";

import type { Route } from "./+types/file";
import { Code } from "~/components/code";
import { Markdown } from "~/components/markdown";
import { SeamuxMark } from "~/components/seamux-mark";
import { ThemeToggle } from "~/components/theme-toggle";
import { Button } from "~/components/ui/button";
import { NativeSelect } from "~/components/ui/native-select";
import {
  dirnameOf,
  fileDownloadUrl,
  fileRawUrl,
  fileViewerUrl,
  type FileView,
} from "~/lib/files";
import { loadFile, SANDBOX_BASE } from "~/lib/files.server";
import { assertLocalRead } from "~/lib/guard.server";
import { useLocalStorage } from "~/lib/use-session-storage";
import { cn } from "~/lib/utils";

export function meta({ data }: Route.MetaArgs) {
  const name = data?.file.path.split("/").pop() || data?.file.path;
  return [{ title: name ? `${name} · seamux` : "seamux" }];
}

// A file a reply linked to: `/file?path=/abs/path&view=raw|rendered`.
export async function loader({ request }: Route.LoaderArgs) {
  assertLocalRead(request);
  const path = new URL(request.url).searchParams.get("path");
  if (!path) throw data("No path", { status: 400 });
  const file = await loadFile(path);
  if (!file) throw data(`Not found: ${path}`, { status: 404 });
  return { file, sandboxBase: SANDBOX_BASE };
}

// Switching between raw and rendered changes only `view`; the loader
// already sent everything either needs.
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (
    currentUrl.search !== nextUrl.search &&
    currentUrl.searchParams.get("path") === nextUrl.searchParams.get("path")
  ) {
    return false;
  }
  return defaultShouldRevalidate;
}

const WATCH_MS = 1000;

// Reload the file whenever it changes on disk, so a file a session is
// still writing stays current while it's open.
function useWatch(path: string, mtime: number) {
  const stat = useFetcher<{ mtime: number | null }>();
  const revalidator = useRevalidator();
  const { load } = stat;
  useEffect(() => {
    const url = `/file/stat?${new URLSearchParams({ path })}`;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load(url);
    }, WATCH_MS);
    return () => clearInterval(id);
  }, [path, load]);
  const changed = stat.data?.mtime != null && stat.data.mtime !== mtime;
  useEffect(() => {
    if (changed && revalidator.state === "idle") revalidator.revalidate();
  }, [changed, revalidator]);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function FileViewer({ loaderData }: Route.ComponentProps) {
  const { file, sandboxBase } = loaderData;
  useWatch(file.path, file.mtime);
  const [params, setParams] = useSearchParams();
  const renderable =
    file.type === "file" && (file.kind === "markdown" || file.kind === "html");
  // A link to `a.ts:12` opens a.ts at line 12: the loader found the file
  // without the line, so the line is what the request has and it lacks.
  const cited = /:(\d+)(?::\d+)?$/.exec(params.get("path") ?? "");
  const line =
    file.type === "file" && cited && !file.path.endsWith(cited[0])
      ? Number(cited[1])
      : undefined;
  // A line is in the file's text, so a cited one opens it raw.
  const asked = params.get("view") ?? (line ? "raw" : "rendered");
  const view: FileView = renderable && asked !== "raw" ? "rendered" : "raw";
  const [lineNumbers, setLineNumbers] = useLocalStorage(
    "seamux:line-numbers",
    false,
  );
  const numbered =
    file.type === "file" &&
    view === "raw" &&
    file.kind !== "image" &&
    file.text !== null;

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-2 text-sm text-muted-foreground">
        <Link to="/" className="flex shrink-0 items-center gap-2" title="Board">
          <SeamuxMark size={24} />
          <span className="font-bold tracking-tight text-foreground">
            seamux
          </span>
        </Link>
        <span
          className="sensitive min-w-0 flex-1 truncate font-mono text-xs"
          title={file.path}
        >
          {file.path}
        </span>
        {file.type === "file" && (
          <span className="shrink-0 text-xs">{formatSize(file.size)}</span>
        )}
        {file.type === "file" && (
          <NativeSelect
            aria-label="Display"
            value={view}
            onChange={(e) => {
              // Download saves the file and leaves the view as it was.
              if (e.target.value === "download") {
                window.location.assign(fileDownloadUrl(file.path));
                return;
              }
              setParams(
                (p) => {
                  p.set("view", e.target.value);
                  return p;
                },
                { replace: true, preventScrollReset: true },
              );
            }}
            className="shrink-0"
            selectClassName="h-7 rounded-md py-0 pr-7 pl-2 text-xs text-foreground"
          >
            <option value="raw">Raw</option>
            {renderable && <option value="rendered">Rendered</option>}
            <option value="download">Download</option>
          </NativeSelect>
        )}
        {numbered && (
          <Button
            size="icon-xs"
            variant={lineNumbers ? "secondary" : "ghost"}
            title={lineNumbers ? "Hide line numbers" : "Show line numbers"}
            aria-label="Line numbers"
            aria-pressed={lineNumbers}
            onClick={() => setLineNumbers((on) => !on)}
          >
            <ListOrdered />
          </Button>
        )}
        <ThemeToggle />
      </header>
      {file.type === "file" && file.truncated && (
        <p className="border-b bg-muted px-4 py-1 text-xs text-muted-foreground">
          Showing the first 2 MB.
        </p>
      )}
      <main className="sensitive min-h-0 flex-1 overflow-auto">
        {file.type === "directory" ? (
          <ul className="mx-auto max-w-3xl p-4 text-sm">
            {file.path !== "/" && (
              <li>
                <Link
                  to={fileViewerUrl(dirnameOf(file.path))}
                  className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted"
                >
                  <Folder className="size-4 text-muted-foreground" />
                  ..
                </Link>
              </li>
            )}
            {file.entries.map((e) => (
              <li key={e.name}>
                <Link
                  to={fileViewerUrl(
                    `${file.path.replace(/\/$/, "")}/${e.name}`,
                  )}
                  className="flex items-center gap-2 rounded px-2 py-1 font-mono text-xs hover:bg-muted"
                >
                  {e.directory ? (
                    <Folder className="size-4 text-muted-foreground" />
                  ) : (
                    <File className="size-4 text-muted-foreground" />
                  )}
                  {e.name}
                </Link>
              </li>
            ))}
          </ul>
        ) : view === "rendered" && file.kind === "markdown" ? (
          <article
            className={cn(
              "prose prose-sm mx-auto max-w-3xl break-words p-6 dark:prose-invert",
              "prose-pre:bg-muted prose-pre:text-foreground prose-code:before:content-none prose-code:after:content-none",
            )}
          >
            <Markdown base={dirnameOf(file.path)}>{file.text ?? ""}</Markdown>
          </article>
        ) : view === "rendered" && file.kind === "html" ? (
          // Scripts run, but in an opaque origin: the page can't read the
          // board, call its actions, or reach this window. Its links may
          // still download, such as a report's exported CSV.
          <iframe
            key={file.mtime}
            title={file.path}
            src={fileRawUrl(file.path, sandboxBase)}
            sandbox="allow-scripts allow-popups allow-downloads"
            className="block size-full bg-white"
          />
        ) : file.kind === "image" ? (
          <div className="flex min-h-full items-center justify-center p-6">
            <img
              src={`${fileRawUrl(file.path)}?v=${file.mtime}`}
              alt={file.path}
              className="max-h-full max-w-full"
            />
          </div>
        ) : file.text !== null ? (
          <Code
            text={file.text}
            path={file.path}
            lineNumbers={lineNumbers}
            line={line}
            className="p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-foreground"
          />
        ) : (
          <p className="p-6 text-sm text-muted-foreground">
            A binary file, not shown here.{" "}
            <a href={fileRawUrl(file.path)} className="underline">
              Open it as is
            </a>
            .
          </p>
        )}
      </main>
    </div>
  );
}
