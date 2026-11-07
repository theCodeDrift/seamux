import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { SendHorizontal, Terminal } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  TERMINAL_KEYS,
  type TerminalResult,
  type TerminalScreen,
} from "~/lib/terminal";

const POLL_MS = 1000;
const AT_END_PX = 24;

async function post(fields: Record<string, string>): Promise<TerminalResult> {
  try {
    const res = await fetch("/terminal", {
      method: "POST",
      body: new URLSearchParams(fields),
    });
    return (await res.json()) as TerminalResult;
  } catch {
    return { ok: false, error: "Can't reach the board" };
  }
}

// The board's one shell, for when the Mac is out of reach: its text, read
// again every second, a box that types at it, and the keys a phone hasn't
// got. Closing this leaves the shell running; `exit` in it ends it.
export function TerminalDialog({ font }: { font: string }) {
  const [open, setOpen] = useState(false);
  const [screen, setScreen] = useState<TerminalScreen | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLPreElement>(null);
  const atEnd = useRef(true);
  // Keystrokes stay in the order they were pressed in, however slow the
  // connection.
  const sending = useRef<Promise<unknown>>(Promise.resolve());

  const refresh = async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/terminal", { signal });
      setScreen((await res.json()) as TerminalScreen);
    } catch {
      if (!signal?.aborted) {
        setScreen((s) => ({
          text: s?.text ?? null,
          error: "Can't reach the board",
        }));
      }
    }
  };

  const start = async () => {
    const { error } = await post({ intent: "open" });
    setFailure(error);
    await refresh();
  };

  // One read at a time, each a second after the last ended, so a connection
  // slower than that never piles them up.
  useEffect(() => {
    if (!open) return;
    atEnd.current = true;
    const stop = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.visibilityState === "visible") {
        await refresh(stop.signal);
      }
      if (!stop.signal.aborted) timer = setTimeout(poll, POLL_MS);
    };
    void start().then(() => {
      if (!stop.signal.aborted) timer = setTimeout(poll, POLL_MS);
    });
    return () => {
      stop.abort();
      clearTimeout(timer);
    };
  }, [open]);

  const text = screen?.text ?? null;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atEnd.current) el.scrollTop = el.scrollHeight;
  }, [text]);

  const send = (key: string | null) => {
    const fields = { text: draft, key: key ?? "" };
    setDraft("");
    sending.current = sending.current.then(async () => {
      const { error } = await post(fields);
      setFailure(error);
      await refresh();
    });
  };

  const trouble = failure ?? screen?.error ?? null;
  // A font this device lacks, or a glyph it lacks, falls through to the
  // board's. A value CSS can't parse is ignored, leaving font-mono.
  const fontStyle = font
    ? { fontFamily: `${font}, var(--font-mono)` }
    : undefined;
  return (
    <>
      <Button
        size="icon-xs"
        variant="ghost"
        title="Terminal"
        aria-label="Terminal"
        onClick={() => setOpen(true)}
      >
        <Terminal />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="h-[min(40rem,calc(100dvh-2rem))] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-3xl max-md:h-dvh! max-md:max-w-none! max-md:rounded-none max-md:pt-[max(1rem,env(safe-area-inset-top))] max-md:pb-[max(1rem,env(safe-area-inset-bottom))] max-md:ring-0">
          <DialogHeader>
            <DialogTitle>Terminal</DialogTitle>
            <DialogDescription>
              A shell on this Mac, in cmux. It keeps running when you close
              this; type exit to end it.
            </DialogDescription>
          </DialogHeader>
          {text === null && screen ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg bg-muted p-3 text-muted-foreground">
              <p>No shell is open.</p>
              <Button variant="outline" onClick={() => void start()}>
                Start a shell
              </Button>
            </div>
          ) : (
            <pre
              ref={scroller}
              onScroll={(e) => {
                const el = e.currentTarget;
                atEnd.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight < AT_END_PX;
              }}
              style={fontStyle}
              className="sensitive overflow-auto rounded-lg bg-muted p-3 font-mono text-xs/snug whitespace-pre"
            >
              {text}
            </pre>
          )}
          <div className="flex min-w-0 flex-col gap-2">
            {trouble && <p className="text-destructive">{trouble}</p>}
            <div className="flex flex-wrap gap-1 font-mono" style={fontStyle}>
              {TERMINAL_KEYS.map(({ key, label }) => (
                <Button
                  key={key}
                  size="sm"
                  variant="outline"
                  disabled={text === null}
                  aria-label={key}
                  // Leaves the box focused, and a phone's keyboard up.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => send(key)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                send("enter");
              }}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={text === null}
                aria-label="Type at the shell"
                placeholder="Type, then Enter"
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="send"
                style={fontStyle}
                className="sensitive min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2.5 py-1 font-mono text-base outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
              />
              <Button
                type="submit"
                size="icon"
                disabled={text === null}
                aria-label="Send"
              >
                <SendHorizontal />
              </Button>
            </form>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
