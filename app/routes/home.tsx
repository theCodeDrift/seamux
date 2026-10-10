import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useFetcher, useRevalidator } from "react-router";
import { toast } from "sonner";
import {
  GitBranch,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleCheck,
  Ellipsis,
  Globe,
  Layers,
  LoaderCircle,
  Maximize2,
  MessageSquare,
  MessageSquareWarning,
  Pencil,
  Eye,
  EyeOff,
  Pin,
  PinOff,
  Play,
  Plus,
  SendHorizontal,
  Square,
  Trash2,
  Wifi,
  X,
} from "lucide-react";

import type { Route } from "./+types/home";
import type { ActionResult } from "./session-action";
import {
  ATTENTION_ACCENT,
  AttentionCards,
  attentionCount,
  useServiceAlerts,
} from "~/components/attention";
import {
  CARD_OUTLINE,
  EDGE,
  EDGE_FRAME,
  ENGINE_CORNER,
} from "~/components/card-edge";
import { ChatModal } from "~/components/chat-modal";
import { CmuxProblem } from "~/components/cmux-problem";
import {
  attachmentLabel,
  kindOf,
  shortenAttachments,
  type Attachment,
} from "~/lib/attachments";
import { useSlashMenu } from "~/components/slash-menu";
import { ConfigDialog } from "~/components/config-dialog";
import { ContextBar } from "~/components/context-bar";
import { DispatchBar } from "~/components/dispatch-bar";
import { workerCount } from "~/components/worker-list";
import { Markdown } from "~/components/markdown";
import { SeamuxMark } from "~/components/seamux-mark";
import { ThemeToggle } from "~/components/theme-toggle";
import {
  titleWithCount,
  useWaitingNotifications,
  waitingCards,
} from "~/components/waiting-alerts";
import { WaitingPanel } from "~/components/waiting-panel";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  closable,
  COLUMN_LABELS,
  COLUMNS,
  showsCard,
  SUBAGENT_VISIBLE_MS,
  type Board,
  type Card as BoardCard,
  type Column,
  type SendFailure,
  type Subagent,
} from "~/lib/board";
import { loadBoard } from "~/lib/board.server";
import { ENGINE_FEATURES, ENGINE_LABELS, type Engine } from "~/lib/config";
import { configOrDefaults } from "~/lib/config.server";
import { installedEngines } from "~/lib/drive.server";
import { startQueue } from "~/lib/queue.server";
import { startReconnect } from "~/lib/reconnect.server";
import { SEAMUX_HOME } from "~/lib/paths.server";
import { remoteStatus, type RemoteStatus } from "~/lib/remote.server";
import { themeStatus } from "~/lib/theme.server";
import { useThemeSync } from "~/lib/use-theme";
import { releaseFocus, useFocusRestore } from "~/lib/use-focus-restore";
import { useCoarsePointer } from "~/lib/use-pointer";
import { useBlur } from "~/lib/use-blur";
import { useDiagnostics } from "~/lib/use-diagnostics";
import { useSessionAction } from "~/lib/use-session-action";
import {
  OptimisticContext,
  useOptimistic,
  useOptimisticBoard,
  type Spawning,
} from "~/lib/optimistic";
import {
  hashedSlot,
  PROJECT_COLOR_SLOTS,
  projectColor,
  projectOf,
  storedSlot,
} from "~/lib/project-colors";
import {
  chatOpenKey,
  forgetStored,
  minimizedKey,
  storedSessionIds,
  tallyMissing,
} from "~/lib/sweep";
import { useLocalStorage, useSessionStorage } from "~/lib/use-session-storage";
import { useDebounce } from "~/lib/use-debounce";
import { cn } from "~/lib/utils";

const POLL_MS = 3000;

export function meta({ loaderData }: Route.MetaArgs) {
  // Chats waiting, and services that need the user, such as a sign-in.
  const waiting = loaderData
    ? waitingCards(loaderData.board.cards).length +
      attentionCount(loaderData.board.attention)
    : 0;
  return [{ title: titleWithCount("seamux", waiting) }];
}

export async function loader({ request }: Route.LoaderArgs) {
  startQueue();
  startReconnect();
  return {
    board: await loadBoard(),
    config: configOrDefaults(),
    engines: installedEngines(),
    remote: remoteStatus(SEAMUX_HOME, request.headers.get("host")),
    theme: themeStatus(),
  };
}

// A hidden tab still polls, more slowly, so the title's count and the
// notifications keep up while the user is elsewhere.
const HIDDEN_POLL_MS = 15000;

// Re-run the loader on an interval.
function usePoll(ms: number) {
  const revalidator = useRevalidator();
  const last = useRef(0);
  useEffect(() => {
    const id = setInterval(() => {
      const wait = document.visibilityState === "visible" ? ms : HIDDEN_POLL_MS;
      if (revalidator.state === "idle" && Date.now() - last.current >= wait) {
        last.current = Date.now();
        revalidator.revalidate();
      }
    }, ms);
    return () => clearInterval(id);
  }, [ms, revalidator]);
}

// A neutral toast for each chat that moves to Done, whether it was closed
// from the board or ended on its own. null until the first board is seen,
// so opening the tab doesn't announce everything already done.
function useDoneToasts(cards: BoardCard[]) {
  const seen = useRef<Map<string, BoardCard["column"]> | null>(null);
  useEffect(() => {
    const before = seen.current;
    seen.current = new Map(cards.map((c) => [c.sessionId, c.column]));
    if (!before) return;
    for (const card of cards) {
      const was = before.get(card.sessionId);
      if (card.column !== "done" || was === undefined || was === "done")
        continue;
      toast(`${card.name} is done`, { id: `done:${card.sessionId}` });
    }
  }, [cards]);
}

// An error toast for each message the board fails to send, from a card or
// seamux's queue, as its card first shows the failure. null until the first
// board is seen, so opening the tab doesn't announce old failures.
function useSendFailureToasts(cards: BoardCard[]) {
  const seen = useRef<Map<string, number> | null>(null);
  useEffect(() => {
    const before = seen.current;
    seen.current = new Map(
      cards.flatMap((c) =>
        c.sendFailure ? [[c.sessionId, c.sendFailure.at] as const] : [],
      ),
    );
    if (!before) return;
    for (const card of cards) {
      const failure = card.sendFailure;
      if (!failure || before.get(card.sessionId) === failure.at) continue;
      toast.error(`A message to ${card.name} didn't send`, {
        id: `send-failed:${card.sessionId}`,
        description: failure.error,
      });
    }
  }, [cards]);
}

const COLUMN_ACCENT: Record<Column, string> = {
  idle: "bg-column-idle",
  waiting: "bg-column-waiting",
  working: "bg-column-working",
  done: "bg-column-done",
};

function ago(ms: number | null, now: number): string {
  if (ms == null) return "";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function firstWords(text: string, count: number): string {
  const words = text.split(/\s+/);
  return words.length > count ? `${words.slice(0, count).join(" ")}…` : text;
}

function shortPath(cwd: string): string {
  return cwd.replace(/^\/Users\/[^/]+/, "~");
}

// Colour slots picked for projects, keyed by project path, from the config.
const ProjectColorsContext = createContext<Record<string, number>>({});

// Where the board kept project colours before they moved into the config.
const LEGACY_COLORS_KEY = "seamux:project-colors";

// Hands the colours this browser kept to the config, once, and forgets them.
// A project that has a colour there already keeps it.
function useImportLegacyColors() {
  const fetcher = useFetcher();
  useEffect(() => {
    let kept: string | null = null;
    try {
      kept = localStorage.getItem(LEGACY_COLORS_KEY);
      localStorage.removeItem(LEGACY_COLORS_KEY);
    } catch {}
    if (!kept) return;
    fetcher.submit(
      { intent: "import-project-colors", colors: kept },
      { method: "post", action: "/config" },
    );
    // Once, on mount.
  }, []);
}

// The project's colour, and a picker for it on click.
function PathSwatch({ cwd }: { cwd: string }) {
  const colors = useContext(ProjectColorsContext);
  const fetcher = useFetcher();
  const project = projectOf(cwd);
  // The pick being saved shows at once.
  const sent = fetcher.formData?.get("slot");
  const picked =
    sent === undefined || sent === null
      ? colors[project]
      : storedSlot(Number(sent) || null);
  const current = picked ?? hashedSlot(project);
  const [open, setOpen] = useState(false);
  const pick = (slot: number | null) => {
    fetcher.submit(
      { intent: "project-color", project, slot: slot === null ? "" : slot },
      { method: "post", action: "/config" },
    );
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`Colour for ${shortPath(project)}`}
        // Hovering shows where the session was launched, which may be a
        // worktree of the project the colour belongs to.
        title={shortPath(cwd)}
        // A 10px square is too small to tap; the hit area reaches past it.
        className="relative size-2.5 shrink-0 cursor-pointer rounded-[2px] outline-offset-2 after:absolute after:-inset-2"
        style={{ backgroundColor: projectColor(current) }}
      />
      <PopoverContent align="start" className="w-auto gap-2">
        <div className="grid grid-cols-6 gap-1.5">
          {PROJECT_COLOR_SLOTS.map((slot) => (
            <button
              type="button"
              key={slot}
              aria-label={`Colour ${slot}`}
              onClick={() => pick(slot)}
              className={cn(
                "size-6 cursor-pointer rounded-sm outline-offset-2",
                slot === current &&
                  "ring-2 ring-foreground ring-offset-2 ring-offset-popover",
              )}
              style={{ backgroundColor: projectColor(slot) }}
            />
          ))}
        </div>
        {picked !== undefined && (
          <button
            type="button"
            onClick={() => pick(null)}
            className="cursor-pointer text-left text-xs text-muted-foreground hover:text-foreground"
          >
            Reset to automatic
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

// Unsent drafts by session, held above the columns so a draft survives its
// card moving between them, with the files each holds. Files can't go into
// session storage, so after a reload a draft's labels are only text.
const DRAFT_SYNC_MS = 500;
const NO_ATTACHMENTS: Attachment[] = [];
const DraftsContext = createContext<{
  drafts: Record<string, string>;
  setDraft: (sessionId: string, draft: string) => void;
  attachments: Record<string, Attachment[]>;
  updateAttachments: (
    sessionId: string,
    update: (list: Attachment[]) => Attachment[],
  ) => void;
}>({
  drafts: {},
  setDraft: () => {},
  attachments: {},
  updateAttachments: () => {},
});

// The card's next chat line, with a popout into the full-size modal for
// longer messages. Both send through cmux into the session's surface, or,
// while the chat works or already has messages waiting, into seamux's queue.
function ChatInput({
  card,
  open,
  setOpen,
}: {
  card: BoardCard;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  // What's typed stays here, and reaches the board's drafts, and session
  // storage, once typing pauses for DRAFT_SYNC_MS: a keystroke re-renders
  // this card, not every card on the board.
  const { drafts, setDraft } = useContext(DraftsContext);
  const stored = drafts[card.sessionId] ?? "";
  const [draft, setLocalDraft] = useState(stored);
  const synced = useRef(stored);
  const sync = useDebounce((d: string) => {
    synced.current = d;
    setDraft(card.sessionId, d);
  }, DRAFT_SYNC_MS);
  // A draft read back from storage after a reload arrives once mounted.
  useEffect(() => {
    if (stored === synced.current) return;
    synced.current = stored;
    setLocalDraft(stored);
  }, [stored]);
  const onDraftChange = (d: string) => {
    setLocalDraft(d);
    sync.call(d);
  };
  // Set at once, without waiting for a pause.
  const { cancel: cancelSync } = sync;
  const putDraft = useCallback(
    (d: string) => {
      cancelSync();
      setLocalDraft(d);
      synced.current = d;
      setDraft(card.sessionId, d);
    },
    [cancelSync, setDraft, card.sessionId],
  );
  // A draft is cleared, from state and storage, as it is sent, so a reload
  // mid-send can't bring it back; a failure puts it back.
  const sent = useRef("");
  const takeDraft = () => {
    sent.current = draft;
    putDraft("");
    return draft;
  };
  const released = useCallback(() => {
    releaseFocus(`reply:${card.sessionId}`);
    releaseFocus(`chat:${card.sessionId}`);
  }, [card.sessionId]);
  const current = useRef(draft);
  current.current = draft;

  // Only the attachments whose label is still in the draft go with it.
  const { attachments: held, updateAttachments } = useContext(DraftsContext);
  const mine = held[card.sessionId] ?? NO_ATTACHMENTS;
  const attachments = mine.filter((a) => draft.includes(a.label));
  const attach = (files: File[]) => {
    let n = mine.reduce((max, a) => Math.max(max, a.n), 0);
    const added = files.map((file) => {
      const kind = kindOf(file.type);
      n += 1;
      const label = attachmentLabel(kind, n);
      return { label, n, kind, file, url: URL.createObjectURL(file) };
    });
    updateAttachments(card.sessionId, (list) => [...list, ...added]);
    return added.map((a) => a.label);
  };
  const detach = (label: string) => {
    onDraftChange(draft.replace(`${label} `, "").replace(label, ""));
    updateAttachments(card.sessionId, (list) =>
      list.filter((a) => {
        if (a.label !== label) return true;
        URL.revokeObjectURL(a.url);
        return false;
      }),
    );
  };
  // Once sent, keep only what the draft written since still holds.
  const sentOk = useCallback(() => {
    released();
    updateAttachments(card.sessionId, (list) =>
      list.filter((a) => {
        if (current.current.includes(a.label)) return true;
        URL.revokeObjectURL(a.url);
        return false;
      }),
    );
  }, [released, updateAttachments, card.sessionId]);
  const restore = useCallback(
    () => putDraft(current.current || sent.current),
    [putDraft],
  );
  const { submit, pending, error } = useSessionAction(
    card.sessionId,
    sentOk,
    restore,
  );
  // A fork shows in Working as it is sent, until the board lists it.
  const { spawn, started } = useOptimistic();
  const forking = useRef("");
  const forked = useCallback(
    (result: ActionResult) => {
      started(forking.current, result.sessionId ?? null);
      released();
    },
    [started, released],
  );
  const forkFailed = useCallback(() => {
    started(forking.current, null);
    restore();
  }, [started, restore]);
  const forker = useSessionAction(card.sessionId, forked, forkFailed);
  const fork = () => {
    if (!draft.trim()) return;
    const text = takeDraft();
    forking.current = spawn({
      name: text,
      cwd: card.cwd,
      intent: text,
      engine: card.engine,
      forked: true,
    });
    forker.submit("fork", { text });
  };
  const canSend = card.drivable && !pending && draft.trim().length > 0;
  const queueing = card.column === "working" || card.boardQueue.length > 0;
  const asking = card.waiting?.ask != null;
  const send = () =>
    canSend &&
    submit(
      queueing ? "queue" : "send",
      { text: takeDraft() },
      attachments.map(({ label, file }) => ({ label, file })),
    );

  // A single-line input would flatten a multiline draft, and editing it there
  // would drop the line breaks for good. So a multiline draft is shown, read
  // only, across the card's full width, and opens the full view instead of
  // sending: a long message waiting to go is visible at a glance.
  const lines = draft.split("\n").length;
  const multiline = lines > 1;
  const form = useRef<HTMLFormElement>(null);
  const slash = useSlashMenu({
    sessionId: card.sessionId,
    // The modal has its own menu.
    enabled:
      card.drivable &&
      ENGINE_FEATURES[card.engine].slashCommands &&
      !multiline &&
      !open,
    draft,
    setDraft: onDraftChange,
    anchor: form,
    portal: true,
  });
  const expand = (
    <Button
      type="button"
      size={multiline ? "icon-xs" : "icon-sm"}
      variant={multiline ? "default" : "ghost"}
      title="Open full view"
      onClick={() => setOpen(true)}
    >
      <Maximize2 />
    </Button>
  );

  // A message stuck in the chat's own prompt box, moved here to edit: after
  // whatever this input already holds.
  const moveIn = useCallback(
    (text: string) => {
      const before = current.current.trimEnd();
      putDraft(before ? `${before}\n${text}` : text);
    },
    [putDraft],
  );

  return (
    <div className="flex flex-col gap-1">
      <StuckMessage card={card} onTake={moveIn} />
      {/* A phone's card has no room to write in, so it opens the chat,
          with the context bar hung under it as it is under the input. */}
      <div className="flex flex-col md:hidden">
        <Button
          variant="secondary"
          size="lg"
          className="w-full rounded-b-none border-b-0"
          onClick={() => setOpen(true)}
        >
          <MessageSquare />
          Open chat
          {draft.trim() && (
            <span className="font-normal text-muted-foreground">· draft</span>
          )}
        </Button>
        <ContextBar context={card.context} className="border-transparent" />
      </div>
      {/* An open question is answered in its own form, above: the reply
          box would only be a second place to type. */}
      {asking ? (
        <div className="flex justify-end max-md:hidden">{expand}</div>
      ) : (
        <div className="flex items-center gap-1 max-md:hidden">
          <div className="min-w-0 flex-1">
            <form
              ref={form}
              data-input-image
              className="flex items-center gap-1 rounded-t-lg border bg-background p-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (multiline) setOpen(true);
                else send();
              }}
            >
              <input
                data-focus-key={`reply:${card.sessionId}`}
                value={multiline ? draft.split("\n")[0] : draft}
                onChange={(e) => onDraftChange(e.target.value)}
                onKeyDown={slash.onKeyDown}
                onClick={multiline ? () => setOpen(true) : undefined}
                readOnly={multiline}
                placeholder={
                  !card.drivable
                    ? "Not in a cmux surface"
                    : queueing
                      ? "Queue a reply"
                      : "Reply"
                }
                disabled={!card.drivable}
                className={cn(
                  "sensitive min-w-0 flex-1 bg-transparent px-2 py-1 text-xs outline-none placeholder:text-muted-foreground",
                  multiline && "cursor-pointer",
                )}
              />
              {multiline ? (
                <>
                  <button
                    type="button"
                    title="Open full view"
                    onClick={() => setOpen(true)}
                    className="shrink-0 cursor-pointer text-[10px] tabular-nums text-muted-foreground hover:text-foreground"
                  >
                    {lines} lines
                  </button>
                  {expand}
                </>
              ) : (
                <Button
                  type="submit"
                  size="icon-xs"
                  disabled={!canSend}
                  title={
                    queueing ? "Queue, to send once this turn ends" : "Send"
                  }
                >
                  <SendHorizontal />
                </Button>
              )}
            </form>
            {slash.menu}
            <ContextBar context={card.context} />
          </div>
          {!multiline && expand}
        </div>
      )}
      {/* A failed send shows above, with its message. */}
      {error && error !== card.sendFailure?.error && (
        <ActionError error={error} />
      )}
      <ChatModal
        card={card}
        open={open}
        onOpenChange={setOpen}
        draft={draft}
        onDraftChange={onDraftChange}
        attachments={attachments}
        onAttach={attach}
        onDetach={detach}
        onSend={send}
        canSend={canSend}
        queueing={queueing}
        pending={pending}
        error={error ?? forker.error}
        onFork={ENGINE_FEATURES[card.engine].fork ? fork : null}
        forking={forker.pending}
        title={<SessionName card={card} inModal />}
      />
    </div>
  );
}

function ActionError({ error }: { error: string }) {
  return <p className="text-destructive">{error}</p>;
}

// A message that didn't reach the chat: one the board failed to send, with
// why, or one left in the chat's prompt box and never sent, such as one the
// chat didn't take or one typed in the terminal. Often both are one, when
// the failed message sits in the box. One in the box is sent from here as
// it stands, or moved into the card's input to edit, emptying the chat's
// box; one that never reached the box can only be moved into the input.
function StuckMessage({
  card,
  onTake,
}: {
  card: BoardCard;
  onTake: (text: string) => void;
}) {
  const failure = card.sendFailure;
  const draft = card.drivable ? card.unsentDraft : null;
  const taking = useRef("");
  const took = useCallback(() => onTake(taking.current), [onTake]);
  const sender = useSessionAction(card.sessionId);
  const taker = useSessionAction(card.sessionId, took);
  const dismisser = useSessionAction(card.sessionId);
  useReportError("draft-send", sender.error);
  useReportError("draft-take", taker.error);
  useReportError("send-failure-dismiss", dismisser.error);
  const pending = sender.pending || taker.pending || dismisser.pending;
  // The failed message and the one in the box are one, as the box wraps it.
  const same =
    failure !== null &&
    draft !== null &&
    squash(failure.text) === squash(draft);
  const dismiss = () => dismisser.submit("send-failure-dismiss");
  const inBox = draft && (
    <Stuck
      failed={same ? failure : null}
      text={draft}
      pending={pending}
      onDismiss={dismiss}
      onSend={() => sender.submit("draft-send", { text: draft })}
      onTake={() => {
        taking.current = draft;
        taker.submit("draft-take", { text: draft });
      }}
    />
  );
  return (
    <>
      {failure && !same && (
        <Stuck
          failed={failure}
          text={failure.text}
          pending={pending}
          onDismiss={dismiss}
          onTake={() => {
            onTake(failure.text);
            dismiss();
          }}
        />
      )}
      {inBox}
    </>
  );
}

function Stuck({
  failed,
  text,
  pending,
  onDismiss,
  onSend,
  onTake,
}: {
  failed: SendFailure | null;
  text: string;
  pending: boolean;
  onDismiss: () => void;
  // Only for a message in the chat's prompt box.
  onSend?: () => void;
  onTake: () => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-md px-2 py-1",
        failed
          ? "bg-destructive/10 text-destructive"
          : "bg-warning/10 text-warning-text",
      )}
    >
      <span className="flex items-center gap-1 font-medium">
        <MessageSquareWarning className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1">
          {failed ? "Didn't send" : "Unsent in the chat"}
        </span>
        {failed && (
          <Button
            size="icon-xs"
            variant="ghost"
            title="Dismiss"
            disabled={pending}
            onClick={onDismiss}
          >
            <X />
          </Button>
        )}
      </span>
      {failed && <span className="break-words">{failed.error}</span>}
      <Faded
        from="start"
        className="sensitive max-h-12 whitespace-pre-wrap text-foreground"
      >
        {text}
      </Faded>
      <div className="flex gap-1">
        {onSend && (
          <Button size="xs" disabled={pending} onClick={onSend}>
            <SendHorizontal />
            Send
          </Button>
        )}
        <Button
          size="xs"
          variant="outline"
          disabled={pending}
          title={
            onSend
              ? "Move it into this card's input, and empty the chat's prompt box"
              : "Move it into this card's input"
          }
          onClick={onTake}
        >
          <Pencil />
          Edit
        </Button>
      </div>
    </div>
  );
}

// Text as a comparison sees it, whatever the box did to its spacing.
const squash = (text: string) => text.replace(/\s/g, "");

// Errors from a card's own controls: its pin, stop, close or resume, and
// its rename. Their titles carry them too, but a title only shows on hover,
// which a phone doesn't have, so the card lists them.
const CardErrorsContext = createContext<
  (source: string, error: string | null) => void
>(() => {});

function useReportError(source: string, error: string | null | undefined) {
  const report = useContext(CardErrorsContext);
  useEffect(() => report(source, error ?? null), [report, source, error]);
  useEffect(() => () => report(source, null), [report, source]);
}

function useCardErrors() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const report = useCallback(
    (source: string, error: string | null) =>
      setErrors((e) => {
        if ((e[source] ?? null) === error) return e;
        const { [source]: _, ...rest } = e;
        return error ? { ...rest, [source]: error } : rest;
      }),
    [],
  );
  return { errors: [...new Set(Object.values(errors))], report };
}

// Why a WORKING card's stop is disabled, or null when it can be pressed.
function stopBlocked(card: BoardCard): string | null {
  if (!card.turnRunning) {
    return "Only its subagents are running; the chat's own turn has ended, so there is no turn to stop";
  }
  if (!card.drivable) {
    return "Not in a cmux surface, so the board can't press Esc in it";
  }
  return null;
}

// Stop on a WORKING card (Esc into the session), resume on a DONE one.
function CardControl({ card }: { card: BoardCard }) {
  const { submit, pending, error } = useSessionAction(card.sessionId);
  const { expected } = useOptimistic();
  useReportError("control", error);
  if (card.column === "working") {
    const blocked = stopBlocked(card);
    // A disabled button takes no pointer events, so the span carries the
    // reason for hover.
    return (
      <span title={error ?? blocked ?? "Stop this turn (Esc)"}>
        <Button
          size="icon-xs"
          variant="outline"
          disabled={blocked != null || pending}
          onClick={() => submit("interrupt")}
        >
          <Square />
        </Button>
      </span>
    );
  }
  if (closable(card)) {
    // A close held after the macro's turn never started sends it again.
    const held = card.closing?.state === "held" && !card.closing.retry;
    return (
      <Button
        size="icon-xs"
        variant="outline"
        disabled={
          !card.drivable || pending || card.closing?.state === "cleaning"
        }
        title={
          error ??
          (held
            ? "Close now, without the close-session macro"
            : "Close this chat: the close-session macro runs first, if set, then it moves to Done and can be resumed")
        }
        // No confirmation: a closed chat is resumable from Done.
        onClick={() => submit("close")}
      >
        <X />
      </Button>
    );
  }
  if (card.column === "done") {
    // Not while the board still expects a close it just asked for: the chat
    // may be live yet.
    const closing = expected(card.sessionId);
    return (
      <Button
        size="icon-xs"
        variant="outline"
        disabled={pending || closing}
        title={
          error ?? (closing ? "Closing" : "Resume in a new cmux workspace")
        }
        onClick={() => submit("resume")}
      >
        <Play />
      </Button>
    );
  }
  return null;
}

// A background session no open chat owns. The pill opens a dialog that
// resumes it with `claude attach`, or deletes it by dispatching a chat that
// runs `claude rm`, since seamux never deletes.
function OrphanBadge({ orphan }: { orphan: Board["orphans"][number] }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const { submit, pending, error } = useSessionAction(orphan.sessionId, close);
  return (
    <>
      <Badge
        variant="outline"
        className="h-6 cursor-pointer hover:bg-muted"
        title={orphan.needs ?? "Resume or delete"}
        render={<button type="button" onClick={() => setOpen(true)} />}
      >
        <PathSwatch cwd={orphan.cwd} />
        <span className="sensitive">{orphan.name}</span> · {orphan.state} ·{" "}
        <span className="sensitive">{shortPath(orphan.cwd)}</span>
      </Badge>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="sensitive">{orphan.name}</DialogTitle>
            <DialogDescription>
              A background session, {orphan.state}, in{" "}
              <span className="sensitive">{shortPath(orphan.cwd)}</span>. No
              open chat owns it.
            </DialogDescription>
          </DialogHeader>
          <pre className="rounded-md bg-muted px-3 py-2 font-mono text-sm select-all">
            claude rm {orphan.id}
          </pre>
          <p className="text-sm text-muted-foreground">
            Resume brings it back in a new cmux workspace with its conversation.
            Delete starts a chat that runs this command, which removes the
            session and its worktree, and stops to ask before discarding
            unpushed work. seamux never deletes on its own.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => submit("delete")}
            >
              <Trash2 />
              Delete this session
            </Button>
            <Button disabled={pending} onClick={() => submit("attach")}>
              <Play />
              Resume this session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// The card's name, renamed in place by double-clicking it, or in the chat's
// full view with its pencil. A pinned card's name is also its drag handle,
// where there is a mouse to drag with. The new name shows at once, and
// stays until the board reports it or the rename fails.
function SessionName({
  card,
  inModal = false,
}: {
  card: BoardCard;
  inModal?: boolean;
}) {
  const coarse = useCoarsePointer();
  const draggable = card.pinned && !inModal && !coarse;
  const [editing, setEditing] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const forget = useCallback(() => setSent(null), []);
  const { submit, pending, error } = useSessionAction(
    card.sessionId,
    undefined,
    forget,
  );
  useReportError(inModal ? "name:modal" : "name", error);
  useEffect(() => {
    if (sent === null) return;
    if (card.name === sent) return setSent(null);
    // Claude Code has had long enough to report it; show what it says.
    const timer = setTimeout(forget, 10_000);
    return () => clearTimeout(timer);
  }, [card.name, sent, forget]);

  // Enter ends the edit, and the input's blur as it goes must not end it
  // again.
  const finished = useRef(false);
  const name = sent ?? card.name;
  if (editing) {
    const finish = (value: string | null) => {
      if (finished.current) return;
      finished.current = true;
      setEditing(false);
      const next = value?.trim();
      if (!next || next === name) return;
      setSent(next);
      submit("rename", { name: next });
    };
    return (
      <input
        autoFocus
        defaultValue={name}
        maxLength={100}
        aria-label="Session name"
        className="sensitive min-w-0 flex-1 rounded-sm bg-muted px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => finish(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(e.currentTarget.value);
          else if (e.key === "Escape") {
            // Esc here cancels the edit, not whatever dialog holds the card.
            e.stopPropagation();
            finish(null);
          }
        }}
      />
    );
  }
  const edit = () => {
    finished.current = false;
    setEditing(true);
  };
  const title =
    error ??
    (draggable
      ? "Drag to reorder Pinned, double-click to rename"
      : "Double-click to rename");
  return (
    <>
      <span
        draggable={draggable}
        onDragStart={
          draggable ? (e) => startPinDrag(e, card.sessionId) : undefined
        }
        onDoubleClick={edit}
        className={cn(
          "sensitive truncate",
          draggable && "cursor-grab active:cursor-grabbing",
          pending && "opacity-60",
          error && "text-destructive",
        )}
        title={title}
      >
        {name}
      </span>
      {inModal && (
        <Button
          size="icon-xs"
          variant="ghost"
          title="Rename"
          aria-label="Rename"
          onClick={edit}
        >
          <Pencil />
        </Button>
      )}
    </>
  );
}

// Pins a long-running chat into its own column, or takes it back out. A
// closed chat can't be pinned, and closing one unpins it.
function PinToggle({ card }: { card: BoardCard }) {
  const { submit, pending, error } = useSessionAction(card.sessionId);
  useReportError("pin", error);
  if (card.column === "done") return null;
  return (
    <Button
      size="icon-xs"
      variant="ghost"
      disabled={pending}
      title={
        error ??
        (card.pinned
          ? "Unpin: back to its column, and off the board 30m after it closes"
          : "Pin: keep it in Pinned, whatever its state, until it closes")
      }
      onClick={() => submit(card.pinned ? "unpin" : "pin")}
    >
      {card.pinned ? <PinOff /> : <Pin />}
    </Button>
  );
}

// Folds a card to its title, for a chat worth keeping in view but not now,
// or opens it back up. Kept in this browser only, like the board's other
// view preferences.
function MinimizeToggle({
  minimized,
  setMinimized,
}: {
  minimized: boolean;
  setMinimized: (minimized: boolean) => void;
}) {
  return (
    <Button
      size="icon-xs"
      variant="ghost"
      title={
        minimized
          ? "Restore: show the whole card"
          : "Minimize: fold the card to its title"
      }
      aria-label={minimized ? "Restore" : "Minimize"}
      aria-expanded={!minimized}
      onClick={() => setMinimized(!minimized)}
    >
      {minimized ? <ChevronsUpDown /> : <ChevronsDownUp />}
    </Button>
  );
}

// Clipped to its box, and faded on the side where there is more. `from`
// says which end stays in view: a prompt reads from its start, a reply from
// its end, so the two fade toward each other.
function Faded({
  from,
  className,
  children,
}: {
  from: "start" | "end";
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      setClipped(el.scrollHeight > el.clientHeight + 1);
      if (from === "end") el.scrollTop = el.scrollHeight;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [from, children]);
  return (
    <div
      ref={ref}
      className={cn(
        "overflow-hidden",
        clipped &&
          (from === "start"
            ? "[mask-image:linear-gradient(to_bottom,black_60%,transparent)]"
            : "[mask-image:linear-gradient(to_top,black_70%,transparent)]"),
        className,
      )}
    >
      {children}
    </div>
  );
}

// The end of the card's last reply, as markdown: what was done, or what it
// asks. The chat shows it in full.
function ReplyExcerpt({ text, cwd }: { text: string; cwd: string }) {
  return (
    <Faded
      from="end"
      className={cn(
        "sensitive prose prose-sm max-h-40 max-w-none break-words text-xs dark:prose-invert max-md:max-h-52 max-md:text-sm",
        "prose-headings:my-1 prose-headings:text-xs max-md:prose-headings:text-sm prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-hr:my-2",
        "prose-pre:my-1 prose-pre:bg-muted prose-pre:p-2 prose-pre:text-foreground prose-code:before:content-none prose-code:after:content-none",
        "prose-table:my-1 [&>:first-child]:mt-0 [&>:last-child]:mb-0",
      )}
    >
      <Markdown base={cwd}>{text}</Markdown>
    </Faded>
  );
}

// Names the chat whose open full view a `/clear` carried to another card.
const CHAT_CARRIED = "seamux:chat-carried";

function SessionCard({ card, now }: { card: BoardCard; now: number }) {
  // Kept across a reload, like the draft, so an open chat stays open.
  const [chatOpen, setChatOpen] = useSessionStorage(
    chatOpenKey(card.sessionId),
    false,
  );
  // A chat `/clear` carried on under this session opens here, in place of
  // the old one, if it was open in this tab.
  useEffect(() => {
    if (!card.clearedFrom) return;
    const key = chatOpenKey(card.clearedFrom);
    try {
      if (sessionStorage.getItem(key) !== "true") return;
      sessionStorage.removeItem(key);
    } catch {
      return;
    }
    window.dispatchEvent(
      new CustomEvent(CHAT_CARRIED, { detail: card.clearedFrom }),
    );
    setChatOpen(true);
  }, [card.clearedFrom, setChatOpen]);
  useEffect(() => {
    const onCarried = (e: Event) => {
      if ((e as CustomEvent<string>).detail === card.sessionId) {
        setChatOpen(false);
      }
    };
    window.addEventListener(CHAT_CARRIED, onCarried);
    return () => window.removeEventListener(CHAT_CARRIED, onCarried);
  }, [card.sessionId, setChatOpen]);
  const [minimized, setMinimized] = useLocalStorage(
    minimizedKey(card.sessionId),
    false,
  );
  const { errors, report } = useCardErrors();
  return (
    <CardErrorsContext.Provider value={report}>
      <Card
        size="sm"
        className={cn(
          EDGE_FRAME,
          CARD_OUTLINE,
          "relative",
          EDGE[card.column],
          ENGINE_CORNER[card.engine],
          card.column === "done" && "opacity-70",
        )}
      >
        {/* A bounded column, so a long path truncates rather than widening the
            header and pushing the title's buttons off the card. */}
        <CardHeader className="grid-cols-[minmax(0,1fr)]">
          <CardTitle className="flex items-center justify-between gap-2 max-md:text-base">
            <span className="flex min-w-0 items-center gap-2">
              {card.pinned && (
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    COLUMN_ACCENT[card.column],
                  )}
                  title={COLUMN_LABELS[card.column]}
                />
              )}
              {minimized && <PathSwatch cwd={card.cwd} />}
              <SessionName card={card} />
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <PinToggle card={card} />
              <MinimizeToggle
                minimized={minimized}
                setMinimized={setMinimized}
              />
              <CardControl card={card} />
            </span>
          </CardTitle>
          {!minimized && (
            <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs max-md:text-sm">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <PathSwatch cwd={card.cwd} />
                <span className="sensitive truncate font-mono">
                  {shortPath(card.cwd)}
                </span>
              </span>
              {card.branch && (
                <span className="sensitive inline-flex items-center gap-1 font-mono">
                  <GitBranch className="size-3" />
                  {card.branch}
                </span>
              )}
              <span className="sensitive">{ago(card.lastActivityAt, now)}</span>
              {ENGINE_FEATURES[card.engine].badge && (
                <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                  {ENGINE_LABELS[card.engine]}
                </Badge>
              )}
            </CardDescription>
          )}
        </CardHeader>
        {minimized ? (
          errors.length > 0 && (
            <CardContent className="flex flex-col gap-2 text-xs max-md:text-sm">
              {errors.map((e) => (
                <ActionError key={e} error={e} />
              ))}
            </CardContent>
          )
        ) : (
          <CardContent className="flex flex-col gap-2 text-xs max-md:text-sm">
            {errors.map((e) => (
              <ActionError key={e} error={e} />
            ))}
            {card.intent && (
              <p className="sensitive line-clamp-2 rounded-md bg-muted px-2 py-1">
                <span className="font-medium">
                  {card.forkedFrom ? "Tangent: " : "Goal: "}
                </span>
                {card.intent}
              </p>
            )}
            {card.lastPrompt && card.lastPrompt !== card.intent && (
              <Faded
                from="start"
                className="sensitive max-h-12 text-muted-foreground"
              >
                <span className="font-medium text-foreground">You: </span>
                {shortenAttachments(card.lastPrompt)}
              </Faded>
            )}
            {card.lastReply &&
              (card.apiError ? (
                // Claude Code's words for a failed request, not a reply.
                <p className="sensitive text-xs break-words text-muted-foreground italic">
                  {card.lastReply}
                </p>
              ) : (
                <ReplyExcerpt text={card.lastReply} cwd={card.cwd} />
              ))}
            {card.closing && (
              <p
                className={cn(
                  "sensitive rounded-md px-2 py-1",
                  card.closing.state === "held"
                    ? "bg-warning/10 text-warning-text"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {card.closing.state === "cleaning"
                  ? "Closing: running the close-session macro, then it exits."
                  : card.closing.note}
              </p>
            )}
            <WaitingPanel card={card} />
            {card.background.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {card.background.map((b) => (
                  <Badge
                    key={b.id}
                    variant={
                      b.state === "blocked" || b.state === "failed"
                        ? "destructive"
                        : "secondary"
                    }
                    title={b.needs ?? undefined}
                  >
                    <Layers />
                    <span className="sensitive">{b.name}</span> · {b.state}
                  </Badge>
                ))}
              </div>
            )}
            <CardState
              column={card.column}
              queued={card.terminalQueue.length + card.boardQueue.length}
              workers={workerCount(card.fanouts)}
              subagents={card.subagents}
              onOpen={() => setChatOpen(true)}
            />
            <ChatInput card={card} open={chatOpen} setOpen={setChatOpen} />
          </CardContent>
        )}
      </Card>
    </CardErrorsContext.Provider>
  );
}

// A chat being dispatched or forked, in Working until the board lists it.
function StartingCard({ spawn }: { spawn: Spawning }) {
  return (
    <Card
      size="sm"
      className={cn(
        EDGE_FRAME,
        CARD_OUTLINE,
        "relative opacity-80",
        EDGE.working,
        ENGINE_CORNER[spawn.engine],
      )}
    >
      <CardHeader className="grid-cols-[minmax(0,1fr)]">
        <CardTitle className="sensitive truncate max-md:text-base">
          {firstWords(spawn.name.split("\n")[0], 8)}
        </CardTitle>
        <CardDescription className="flex items-center gap-1.5 text-xs max-md:text-sm">
          <PathSwatch cwd={spawn.cwd} />
          <span className="sensitive truncate font-mono">
            {shortPath(spawn.cwd)}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-xs max-md:text-sm">
        <p className="sensitive line-clamp-2 rounded-md bg-muted px-2 py-1">
          <span className="font-medium">
            {spawn.forked ? "Tangent: " : "Goal: "}
          </span>
          {spawn.intent}
        </p>
        <span className="flex items-center gap-1.5 text-brand-primary">
          <LoaderCircle className="size-3.5 animate-spin" />
          starting
        </span>
      </CardContent>
    </Card>
  );
}

// Waiting shows no state here: the card already carries the prompt or tool
// that is waiting, and done cards are over. Anything queued shows as +N, and
// the line then opens the chat, where the queue is listed. A chat that fanned
// out says how many workers it has, which opens the chat too: its side rail
// lists them, and so does one running subagents.
function CardState({
  column,
  queued,
  workers,
  subagents,
  onOpen,
}: {
  column: Column;
  queued: number;
  workers: number;
  subagents: Subagent[];
  onOpen: () => void;
}) {
  const state =
    column === "idle" ? (
      <>
        <CircleCheck className="size-3.5" />
        ready
      </>
    ) : column === "working" ? (
      <>
        <LoaderCircle className="size-3.5 animate-spin" />
        working
      </>
    ) : null;
  const tone =
    column === "working" ? "text-brand-primary" : "text-muted-foreground";
  const fanout = workers > 0 && (
    <button
      type="button"
      onClick={onOpen}
      title="Open the chat to see its workers"
      className="cursor-pointer text-muted-foreground hover:underline"
    >
      ({workers} worker{workers === 1 ? "" : "s"})
    </button>
  );
  const running = subagents.filter((s) => s.running).length;
  const finished = subagents.length - running;
  const subagentCount = subagents.length > 0 && (
    <button
      type="button"
      onClick={onOpen}
      title={`${[
        running > 0 && `${running} running`,
        finished > 0 &&
          `${finished} finished in the last ${SUBAGENT_VISIBLE_MS / 60000}m`,
      ]
        .filter(Boolean)
        .join(", ")}. Open the chat to see them`}
      className="cursor-pointer text-muted-foreground hover:underline"
    >
      ({subagents.length} subagent{subagents.length === 1 ? "" : "s"})
    </button>
  );
  let main: ReactNode = state && (
    <span className={cn("flex items-center gap-1.5", tone)}>{state}</span>
  );
  if (queued > 0 && column !== "done") {
    const when =
      column === "idle"
        ? "seamux sends it on its next check"
        : column === "working"
          ? "sent once this turn ends"
          : "sent once the chat is ready again";
    main = (
      <button
        type="button"
        onClick={onOpen}
        title={`${queued} queued, ${when}. Open the chat to see or edit it`}
        className={cn("flex w-fit items-center gap-1.5 hover:underline", tone)}
      >
        {state}
        <span>{state ? `+${queued}` : `+${queued} queued`}</span>
      </button>
    );
  }
  if (!main && !fanout && !subagentCount) return null;
  return (
    <span className="flex w-fit items-center gap-1.5">
      {main}
      {subagentCount}
      {fanout}
    </span>
  );
}

// A pinned card is dragged by its name, carrying its session id. The whole
// card follows the pointer, held where it was picked up.
const PIN_DRAG = "application/x-seamux-pin";

function startPinDrag(e: React.DragEvent<HTMLElement>, sessionId: string) {
  e.dataTransfer.setData(PIN_DRAG, sessionId);
  e.dataTransfer.effectAllowed = "move";
  const card = e.currentTarget.closest<HTMLElement>("[data-pin-card]");
  if (card) {
    const box = card.getBoundingClientRect();
    e.dataTransfer.setDragImage(
      card,
      e.clientX - box.left,
      e.clientY - box.top,
    );
  }
}

// `ids` with `id` moved to just before `before`, or to the end.
function movedBefore(ids: string[], id: string, before: string): string[] {
  const rest = ids.filter((x) => x !== id);
  const at = before ? rest.indexOf(before) : -1;
  rest.splice(at === -1 ? rest.length : at, 0, id);
  return rest;
}

// Pinned cards in the user's order, which they change by dragging a card's
// name.
// A line marks where it will land; the move shows at once, ahead of the
// board that confirms it.
function PinnedCards({ cards, now }: { cards: BoardCard[]; now: number }) {
  const fetcher = useFetcher<ActionResult>();
  const [dropAt, setDropAt] = useState<number | null>(null);
  const ids = cards.map((c) => c.sessionId);
  const moving = fetcher.formData;
  const order = moving
    ? movedBefore(
        ids,
        String(moving.get("moved")),
        String(moving.get("before")),
      )
    : ids;
  const shown = order.flatMap(
    (id) => cards.find((c) => c.sessionId === id) ?? [],
  );
  const isPinDrag = (e: React.DragEvent) =>
    e.dataTransfer.types.includes(PIN_DRAG);

  return (
    <div
      className="flex flex-col gap-3"
      onDragOver={(e) => {
        if (!isPinDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setDropAt(null);
        }
      }}
      onDragEnd={() => setDropAt(null)}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(PIN_DRAG);
        const at = dropAt;
        setDropAt(null);
        if (!id || at === null || !order.includes(id)) return;
        e.preventDefault();
        const rest = order.filter((x) => x !== id);
        const before =
          rest[order.slice(0, at).filter((x) => x !== id).length] ?? "";
        if (movedBefore(order, id, before).join() === order.join()) return;
        fetcher.submit(
          { intent: "pin-move", moved: id, before },
          { method: "post", action: `/sessions/${id}/action` },
        );
      }}
    >
      {shown.map((card, i) => (
        <div
          key={card.sessionId}
          data-pin-card
          className="relative"
          onDragOver={(e) => {
            if (!isPinDrag(e)) return;
            const box = e.currentTarget.getBoundingClientRect();
            setDropAt(e.clientY > box.top + box.height / 2 ? i + 1 : i);
          }}
        >
          {dropAt === i && <DropLine edge="top" />}
          {dropAt === i + 1 && i === shown.length - 1 && (
            <DropLine edge="bottom" />
          )}
          <SessionCard card={card} now={now} />
        </div>
      ))}
      {fetcher.data?.error && (
        <p className="text-xs text-destructive">{fetcher.data.error}</p>
      )}
    </div>
  );
}

// Centred in the gap between two cards.
function DropLine({ edge }: { edge: "top" | "bottom" }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded-full",
        PINNED_ACCENT,
        edge === "top" ? "-top-[7px]" : "-bottom-[7px]",
      )}
    />
  );
}

// Pinned sits left of the state columns; its cards show their state as a dot.
// Attention sits left of Pinned, while a service needs looking at.
type BoardColumnKey = Column | "pinned" | "attention";

const PINNED_ACCENT = "bg-column-pinned";

// Spelled out so Tailwind sees each class.
const XL_GRID_COLS: Record<number, string> = {
  3: "xl:grid-cols-3",
  4: "xl:grid-cols-4",
  5: "xl:grid-cols-5",
  6: "xl:grid-cols-6",
};

function columnLabel(column: BoardColumnKey): string {
  if (column === "attention") return "Attention";
  return column === "pinned" ? "Pinned" : COLUMN_LABELS[column];
}

function columnAccent(column: BoardColumnKey): string {
  if (column === "attention") return "bg-column-attention";
  return column === "pinned" ? PINNED_ACCENT : COLUMN_ACCENT[column];
}

function BoardColumn({
  column,
  cards,
  starting = [],
  notices = [],
  now,
  className,
}: {
  column: BoardColumnKey;
  cards: BoardCard[];
  starting?: Spawning[];
  notices?: Board["attention"];
  now: number;
  className?: string;
}) {
  const label = columnLabel(column);
  const count =
    column === "attention" ? notices.length : cards.length + starting.length;
  return (
    <section
      data-column={column}
      className={cn(
        "flex min-w-0 flex-col gap-3",
        // One slide of the carousel below md, the full width of the screen;
        // the tab strip above shows there is more.
        // Its cards keep their height and the column scrolls, rather than
        // squeezing them and clipping what's at their foot.
        // Its foot is a spacer, not padding, which a scrolling flex column can
        // leave off its end in Safari: with the gap above it, 20px past the last card,
        // plus the home indicator, so the list visibly ends and its last card
        // sits clear of the swipe to dismiss.
        "max-md:h-full max-md:w-full max-md:shrink-0 max-md:*:shrink-0 max-md:snap-start max-md:snap-always max-md:overflow-y-auto max-md:after:h-[calc(0.5rem+env(safe-area-inset-bottom))] max-md:after:shrink-0",
        className,
      )}
    >
      <h2 className="flex items-center gap-2 border-b pb-2 max-md:hidden text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <span
          className={cn(
            "size-2 rounded-full",
            columnAccent(column),
            column === "working" && cards.length > 0 && "animate-pulse",
          )}
        />
        <span className="text-foreground">{label}</span>
        <span className="rounded-full bg-muted px-1.5 py-px text-[0.7rem] tabular-nums">
          {count}
        </span>
        {column === "done" && (
          <span className="font-normal normal-case tracking-normal">
            last 30m
          </span>
        )}
      </h2>
      {column === "attention" ? (
        <AttentionCards notices={notices} />
      ) : column === "pinned" ? (
        <PinnedCards cards={cards} now={now} />
      ) : (
        <>
          {starting.map((s) => (
            <StartingCard key={s.key} spawn={s} />
          ))}
          {cards.map((card) => (
            <SessionCard key={card.sessionId} card={card} now={now} />
          ))}
        </>
      )}
      {count === 0 && (
        <p className="rounded-xl border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
          Nothing {label.toLowerCase()}
        </p>
      )}
    </section>
  );
}

const ORPHANS_NOTE =
  "`claude agents` names no parent, so a background session belongs to an open chat in its directory that started before it. These match none: their chat has closed, or runs in another directory.";

// The header's overflow below md: the links, version and time that line the
// header's right on a wide screen, and the background sessions listed under
// the board there.
function BoardMenu({
  remote,
  orphans,
  version,
  now,
}: {
  remote: RemoteStatus;
  orphans: Board["orphans"];
  version: Board["version"];
  now: number;
}) {
  const [open, setOpen] = useState(false);
  const [background, setBackground] = useState(false);
  const row =
    "flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-foreground hover:bg-muted";
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label="More"
          render={<Button size="icon-sm" variant="ghost" />}
        >
          <Ellipsis />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 gap-0.5 p-1.5">
          {remote.enabled && remote.mdns.listening && (
            <a href={remote.mdns.url} className={row}>
              <Wifi className="size-4" />
              On the LAN at {remote.mdns.url.replace(/^https?:\/\//, "")}
            </a>
          )}
          {remote.pid && remote.domain && (
            <a
              href={`https://${remote.domain}`}
              target="_blank"
              rel="noreferrer"
              className={row}
            >
              <Globe className="size-4" />
              <span className="truncate">Remote at {remote.domain}</span>
            </a>
          )}
          {orphans.length > 0 && (
            <button
              type="button"
              className={row}
              onClick={() => {
                setOpen(false);
                setBackground(true);
              }}
            >
              <Layers className="size-4" />
              Background sessions
              <span className="ml-auto rounded-full bg-muted px-1.5 py-px text-[0.7rem] tabular-nums">
                {orphans.length}
              </span>
            </button>
          )}
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            {version && <span className="font-mono">{version.hash} · </span>}
            updated {new Date(now).toLocaleTimeString()}
          </p>
        </PopoverContent>
      </Popover>
      <Dialog open={background} onOpenChange={setBackground}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Background sessions</DialogTitle>
            <DialogDescription>
              Not matched to an open chat. {ORPHANS_NOTE.replace(/`/g, "")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-1">
            {orphans.map((b) => (
              <OrphanBadge key={b.id} orphan={b} />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// The board's warnings. Below md they fold into one line that opens them,
// so they don't push the columns down.
function Warnings({ warnings }: { warnings: string[] }) {
  const [open, setOpen] = useState(false);
  if (warnings.length === 0) return null;
  const tone = "text-sm text-warning-text";
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={cn("cursor-pointer text-left md:hidden", tone)}
      >
        {warnings.length === 1 ? "1 warning" : `${warnings.length} warnings`}
        {open ? " ▾" : " ▸"}
      </button>
      {warnings.map((w) => (
        <p key={w} className={cn(tone, !open && "max-md:hidden")}>
          {w}
        </p>
      ))}
    </div>
  );
}

// Below md the columns are a carousel, and this strip of tabs sits above it:
// each tab names a column and its count, follows the swipe, and scrolls to
// its column when tapped. Waiting's count turns amber, and Attention's red
// while a service needs the user, to be seen from any column.
function ColumnTabs({
  columns,
  counts,
  actions,
  active,
  onPick,
}: {
  columns: BoardColumnKey[];
  counts: Record<BoardColumnKey, number>;
  actions: number;
  active: BoardColumnKey | null;
  onPick: (column: BoardColumnKey) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  // Keep the active tab in view as the columns are swiped.
  useEffect(() => {
    const root = strip.current;
    const tab = root?.querySelector<HTMLElement>(`[data-tab="${active}"]`);
    if (!root || !tab) return;
    const left = tab.offsetLeft;
    const right = left + tab.offsetWidth;
    if (left < root.scrollLeft || right > root.scrollLeft + root.clientWidth) {
      root.scrollTo({ left: left - 16, behavior: "smooth" });
    }
  }, [active]);
  return (
    <div
      ref={strip}
      role="tablist"
      className="sticky top-[calc(env(safe-area-inset-top)+3.5rem)] z-10 -mx-4 flex h-12 items-center gap-1.5 overflow-x-auto bg-background px-4 [scrollbar-width:none] md:hidden"
    >
      {columns.map((column) => {
        const count = counts[column];
        const alert =
          column === "attention"
            ? actions > 0
            : column === "waiting" && count > 0;
        return (
          <button
            key={column}
            type="button"
            role="tab"
            data-tab={column}
            aria-selected={column === active}
            onClick={() => onPick(column)}
            className={cn(
              "flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs text-muted-foreground",
              column === active &&
                "border-foreground/30 bg-muted text-foreground",
            )}
          >
            <span className={cn("size-2 rounded-full", columnAccent(column))} />
            {columnLabel(column)}
            <span
              className={cn(
                "rounded-full px-1.5 py-px text-[0.7rem] tabular-nums",
                alert
                  ? cn(
                      "font-medium",
                      column === "attention"
                        ? cn(ATTENTION_ACCENT, "text-attention-foreground")
                        : "bg-warning text-warning-foreground",
                    )
                  : "bg-muted",
              )}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const MOBILE_COLUMN_KEY = "seamux:mobile-column";

// The carousel's current column: the one most in view, remembered for the
// tab. A fresh tab opens on Attention when a service needs the user, else on
// Waiting when anything waits, else on Working.
function useCarousel(
  columns: BoardColumnKey[],
  waiting: number,
  attention: number,
) {
  const carousel = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<BoardColumnKey | null>(null);
  const scrollTo = useCallback(
    (column: BoardColumnKey, behavior: ScrollBehavior) => {
      const root = carousel.current;
      const el = root?.querySelector<HTMLElement>(`[data-column="${column}"]`);
      if (!root || !el) return;
      const pad = parseFloat(getComputedStyle(root).scrollPaddingLeft) || 0;
      root.scrollTo({ left: el.offsetLeft - pad, behavior });
    },
    [],
  );

  const key = columns.join();
  useEffect(() => {
    const root = carousel.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // From md the columns are a grid, all in view: nothing to follow.
        if (root.scrollWidth <= root.clientWidth) return;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const column = (entry.target as HTMLElement).dataset
            .column as BoardColumnKey;
          setActive(column);
          try {
            sessionStorage.setItem(MOBILE_COLUMN_KEY, column);
          } catch {}
        }
      },
      { root, threshold: 0.6 },
    );
    root
      .querySelectorAll("[data-column]")
      .forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [key]);

  // Once, on load.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem(MOBILE_COLUMN_KEY);
    } catch {}
    const start =
      (attention > 0 ? "attention" : null) ??
      columns.find((c) => c === stored) ??
      (waiting > 0 ? "waiting" : "working");
    scrollTo(start, "instant");
  }, [columns, waiting, attention, scrollTo]);

  return {
    carousel,
    active,
    pick: (column: BoardColumnKey) => scrollTo(column, "smooth"),
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  usePoll(POLL_MS);
  useFocusRestore();
  const board: Board = loaderData.board;
  const { config, engines, remote, theme } = loaderData;
  useThemeSync(theme.active, theme.hash);
  const now = board.generatedAt;
  const diagnostics = useDiagnostics(board.version?.hash);
  const blur = useBlur();
  const notifications = useWaitingNotifications(board.cards);
  // Cards moved ahead of the poll by what was just sent, and chats still
  // starting.
  const optimistic = useOptimisticBoard(board.cards);
  const { cards, starting } = optimistic;
  useDoneToasts(cards);
  useSendFailureToasts(cards);
  useServiceAlerts(board.attention, notifications.enabled);
  // Attention only takes a column while a service needs looking at, and
  // Pinned only while something is pinned.
  const attention = board.attention.filter(showsCard);
  const pinned = cards.filter((c) => c.pinned);
  // Done is hidden until asked for, and the choice outlives the tab.
  const [showDone, setShowDone] = useLocalStorage("seamux:show-done", false);
  const columns = COLUMNS.filter((c) => showDone || c !== "done");
  const columnCount =
    columns.length +
    (pinned.length > 0 ? 1 : 0) +
    (attention.length > 0 ? 1 : 0);
  const byColumn = (column: Column) =>
    cards.filter((c) => !c.pinned && c.column === column);
  // Below md every column shows, Done included: each has a screen of its own.
  const mobileColumns: BoardColumnKey[] = [
    ...(attention.length > 0 ? (["attention"] as const) : []),
    ...(pinned.length > 0 ? (["pinned"] as const) : []),
    ...COLUMNS,
  ];
  const counts = {
    attention: attention.length,
    pinned: pinned.length,
    ...Object.fromEntries(COLUMNS.map((c) => [c, byColumn(c).length])),
    working: byColumn("working").length + starting.length,
  } as Record<BoardColumnKey, number>;
  // Only what asks something of the user.
  const actions = attentionCount(attention);
  const { carousel, active, pick } = useCarousel(
    mobileColumns,
    counts.waiting,
    actions,
  );
  // Below md the dispatch bar is a sheet over the board, opened from the
  // header; Esc closes it, as does a dispatch that starts, and the board
  // under it stays put.
  const [dispatchOpen, setDispatchOpen] = useState(false);
  useEffect(() => {
    if (!dispatchOpen) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDispatchOpen(false);
    };
    window.addEventListener("keydown", close);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", close);
      document.body.style.overflow = overflow;
    };
  }, [dispatchOpen]);
  const [drafts, setDrafts] = useSessionStorage<Record<string, string>>(
    "seamux:drafts",
    {},
  );
  const setDraft = useCallback(
    (sessionId: string, draft: string) =>
      setDrafts((d) => {
        const { [sessionId]: _, ...rest } = d;
        return draft ? { ...rest, [sessionId]: draft } : rest;
      }),
    [setDrafts],
  );
  const [attachments, setAttachments] = useState<Record<string, Attachment[]>>(
    {},
  );
  const updateAttachments = useCallback(
    (sessionId: string, update: (list: Attachment[]) => Attachment[]) =>
      setAttachments((all) => {
        const { [sessionId]: list = [], ...rest } = all;
        const next = update(list);
        return next.length > 0 ? { ...rest, [sessionId]: next } : rest;
      }),
    [],
  );
  const draftsContext = useMemo(
    () => ({ drafts, setDraft, attachments, updateAttachments }),
    [drafts, setDraft, attachments, updateAttachments],
  );
  // What this browser keeps for a chat, its draft, files, and stored view,
  // goes once the chat has been gone from the board for long enough.
  const kept = useRef({ drafts, attachments });
  kept.current = { drafts, attachments };
  const missing = useRef(new Map<string, number>());
  useEffect(() => {
    const present = new Set(
      board.cards.flatMap((c) =>
        c.clearedFrom ? [c.sessionId, c.clearedFrom] : [c.sessionId],
      ),
    );
    const known = [
      ...Object.keys(kept.current.drafts),
      ...Object.keys(kept.current.attachments),
      ...storedSessionIds(),
    ];
    const gone = tallyMissing(
      missing.current,
      known,
      present,
      board.sessionsKnown,
    );
    if (gone.length === 0) return;
    gone.forEach(forgetStored);
    const omit = <T,>(all: Record<string, T>) =>
      Object.fromEntries(
        Object.entries(all).filter(([id]) => !gone.includes(id)),
      );
    setDrafts(omit);
    setAttachments((all) => {
      for (const id of gone) {
        for (const a of all[id] ?? []) URL.revokeObjectURL(a.url);
      }
      return omit(all);
    });
  }, [board, setDrafts]);
  useImportLegacyColors();

  return (
    <OptimisticContext.Provider value={optimistic.context}>
      <DraftsContext.Provider value={draftsContext}>
        <ProjectColorsContext.Provider value={config.projectColors}>
          {/* No bottom padding below md: the carousel is sized to end at the
              screen's foot, and any page left below it lets the page scroll
              on, pushing the first card's top under the tab strip. */}
          <main className="mx-auto flex max-w-[1600px] flex-col gap-4 p-4 max-md:pb-0 md:gap-6 md:p-6">
            {/* Below md the header stays put while the page scrolls, with a
                band above it covering the notch so nothing shows through. */}
            <header className="flex items-center justify-between gap-4 text-sm text-muted-foreground max-md:sticky max-md:top-[env(safe-area-inset-top)] max-md:z-20 max-md:-mx-4 max-md:-mt-4 max-md:h-14 max-md:bg-background max-md:px-4 max-md:before:absolute max-md:before:inset-x-0 max-md:before:bottom-full max-md:before:h-[env(safe-area-inset-top)] max-md:before:bg-background">
              <span className="flex min-w-0 items-center gap-1">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="shrink-0">
                    <SeamuxMark size={32} />
                  </span>
                  <span className="truncate text-xl font-bold tracking-tight text-foreground">
                    seamux
                  </span>
                </span>
                <ConfigDialog
                  config={config}
                  engines={engines}
                  remote={remote}
                  theme={theme}
                  notifications={notifications}
                  diagnostics={diagnostics}
                  blur={blur}
                />
                <ThemeToggle />
              </span>
              <span className="flex shrink-0 items-center gap-1 md:hidden">
                <Button
                  size="sm"
                  onClick={() => setDispatchOpen(true)}
                  className="bg-brand-ramp text-brand-foreground shadow-sm hover:opacity-90"
                >
                  <Plus />
                  New
                </Button>
                <BoardMenu
                  remote={remote}
                  orphans={board.orphans}
                  version={board.version}
                  now={now}
                />
              </span>
              <span className="flex min-w-0 items-center gap-3 max-md:hidden">
                {remote.enabled && remote.mdns.listening && (
                  <a
                    href={remote.mdns.url}
                    className="flex shrink-0 items-center gap-1 text-xs text-foreground"
                    title={`mDNS is on: the board answers the network at ${remote.mdns.url}`}
                  >
                    <Wifi className="size-3.5" />
                    LAN
                  </a>
                )}
                {remote.pid && remote.domain && (
                  <a
                    href={`https://${remote.domain}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex shrink-0 items-center gap-1 text-xs text-foreground"
                    title={`Remote access is on: the tunnel serves this board at ${remote.domain}`}
                  >
                    <Globe className="size-3.5" />
                    Remote
                  </a>
                )}
                <Button
                  size="xs"
                  variant="ghost"
                  className="max-md:hidden"
                  onClick={() => setShowDone(!showDone)}
                  title={
                    showDone
                      ? "Hide chats closed in the last 30m"
                      : "Show chats closed in the last 30m"
                  }
                >
                  {showDone ? <EyeOff /> : <Eye />}
                  {showDone ? "Hide done" : `Show done (${counts.done})`}
                </Button>
                {board.version && (
                  <span
                    className="truncate font-mono text-xs opacity-70"
                    title={firstWords(board.version.subject, 12)}
                  >
                    {board.version.hash}
                  </span>
                )}
                <span className="shrink-0 text-xs tabular-nums">
                  updated {new Date(now).toLocaleTimeString()}
                </span>
              </span>
            </header>

            <div
              className={cn(
                dispatchOpen
                  ? "max-md:fixed max-md:inset-0 max-md:z-40 max-md:flex max-md:flex-col max-md:gap-3 max-md:overflow-y-auto max-md:bg-background max-md:p-4 max-md:pt-[max(1rem,env(safe-area-inset-top))] max-md:pb-[max(1rem,env(safe-area-inset-bottom))]"
                  : "max-md:hidden",
              )}
            >
              <div className="flex items-center justify-between md:hidden">
                <h2 className="text-base font-medium">Dispatch new work</h2>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Close"
                  onClick={() => setDispatchOpen(false)}
                >
                  <X />
                </Button>
              </div>
              <DispatchBar
                directories={config.directories}
                worktreeByDefault={config.worktreeByDefault}
                defaultEngine={config.defaultEngine}
                engines={engines}
                onDispatched={() => setDispatchOpen(false)}
              />
            </div>
            <Warnings warnings={board.warnings} />
            {board.cmux && <CmuxProblem problem={board.cmux} />}

            {/* Below md, a carousel of columns under the header and a sticky strip of tabs,
                filling the screen once scrolled to, each column scrolling on
                its own; from md, the grid. */}
            <div className="flex flex-col">
              <ColumnTabs
                columns={mobileColumns}
                counts={counts}
                actions={actions}
                active={active}
                onPick={pick}
              />
              <div
                ref={carousel}
                className={cn(
                  "relative max-md:-mx-4 max-md:flex max-md:h-[calc(100dvh-6.5rem-env(safe-area-inset-top))] max-md:snap-x max-md:snap-mandatory max-md:gap-3 max-md:overflow-x-auto max-md:overscroll-x-contain max-md:scroll-px-4 max-md:px-4 max-md:[scrollbar-width:none]",
                  "md:grid md:grid-cols-2 md:gap-4",
                  XL_GRID_COLS[columnCount],
                )}
              >
                {attention.length > 0 && (
                  <BoardColumn
                    column="attention"
                    cards={[]}
                    notices={attention}
                    now={now}
                  />
                )}
                {pinned.length > 0 && (
                  <BoardColumn column="pinned" cards={pinned} now={now} />
                )}
                {COLUMNS.map((column) => (
                  <BoardColumn
                    key={column}
                    column={column}
                    cards={byColumn(column)}
                    starting={column === "working" ? starting : []}
                    now={now}
                    className={cn(!columns.includes(column) && "md:hidden")}
                  />
                ))}
              </div>
            </div>

            {board.orphans.length > 0 && (
              <footer className="flex flex-col gap-2 border-t pt-4 text-xs text-muted-foreground max-md:hidden">
                <span title={ORPHANS_NOTE}>
                  Background sessions not matched to an open chat
                </span>
                <div className="flex flex-wrap gap-1">
                  {board.orphans.map((b) => (
                    <OrphanBadge key={b.id} orphan={b} />
                  ))}
                </div>
              </footer>
            )}
          </main>
        </ProjectColorsContext.Provider>
      </DraftsContext.Provider>
    </OptimisticContext.Provider>
  );
}
