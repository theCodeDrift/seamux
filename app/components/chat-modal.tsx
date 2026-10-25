import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useFetcher } from "react-router";
import {
  Check,
  Copy,
  GitFork,
  Paperclip,
  Pencil,
  SendHorizontal,
  X,
} from "lucide-react";

import { AttachmentChips, MessageText } from "~/components/attachments";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { EDGE, EDGE_FRAME, ENGINE_CORNER } from "~/components/card-edge";
import { ContextBar } from "~/components/context-bar";
import {
  COUNTING,
  countdownTitle,
  SendIcon,
  StackedLabel,
} from "~/components/countdown";
import { Markdown } from "~/components/markdown";
import { useSlashMenu } from "~/components/slash-menu";
import { SubagentDetail } from "~/components/subagent-list";
import { Textarea } from "~/components/ui/textarea";
import { WorkerDetail, workerCount } from "~/components/worker-list";
import { WaitingPanel } from "~/components/waiting-panel";
import {
  fitAttachments,
  insertLabels,
  MAX_ATTACHMENTS,
  type Attachment,
} from "~/lib/attachments";
import {
  MESSAGES_SHOWN,
  type Card,
  type ChatMessage,
  type QueuedMessage,
} from "~/lib/board";
import { ENGINE_FEATURES } from "~/lib/config";
import { macroLabel } from "~/lib/macro-echo";
import { projectOf } from "~/lib/project-colors";
import type { TriggerPhrase } from "~/lib/trigger-phrase";
import { queueEditsKey, scrollKey } from "~/lib/sweep";
import { useCoarsePointer } from "~/lib/use-pointer";
import { useSessionAction } from "~/lib/use-session-action";
import { useSessionStorage } from "~/lib/use-session-storage";
import { useTrigger } from "~/lib/use-trigger";
import { keyHint, useSubmitKey } from "~/lib/use-submit-key";
import { cn } from "~/lib/utils";

const POLL_MS = 3000;
// Within this many pixels of the end counts as reading the latest message.
const AT_END_PX = 40;

// The two ways to split a tangent off a chat: into a new worktree, or a
// copy in the chat's own folder.
const FORK = {
  label: "Fork",
  busy: "Forking…",
  icon: <GitFork />,
  title:
    "Start a new session with this chat's context and this message, in a new worktree",
  worktree: true,
};
const CLONE = {
  label: "Clone",
  busy: "Cloning…",
  icon: <Copy />,
  title:
    "Start a new session with this chat's context and this message, in this chat's folder",
  worktree: false,
};

// Full-screen view of one card: the conversation, and room to write the
// next message. The draft is shared with the card's inline input.
export function ChatModal({
  card,
  open,
  onOpenChange,
  draft,
  onDraftChange,
  attachments,
  onAttach,
  onDetach,
  onSend,
  canSend,
  outgoing,
  trigger,
  queueing,
  pending,
  error,
  onFork,
  forking,
  title,
}: {
  card: Card;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: string;
  onDraftChange: (draft: string) => void;
  // Files pasted or dropped in, held until the message is sent. `onAttach`
  // returns the label each one takes in the text.
  attachments: Attachment[];
  onAttach: (files: File[]) => string[];
  onDetach: (label: string) => void;
  onSend: () => void;
  canSend: boolean;
  // The draft without the trigger phrase, which never goes with it.
  outgoing: string;
  trigger: TriggerPhrase;
  queueing: boolean;
  pending: boolean;
  error: string | null;
  // null when the chat's agent can't fork: only Claude Code can. With
  // `worktree`, the fork runs in a new worktree of its own.
  onFork: ((worktree: boolean) => void) | null;
  forking: boolean;
  // The chat's name, renamable here, where a double-click can't reach on a
  // phone.
  title?: ReactNode;
}) {
  const coarse = useCoarsePointer();
  // A chat already in a worktree forks into a new one by default, and can
  // be cloned where it is; any other chat is cloned where it is by default,
  // and can fork into a new worktree.
  const inWorktree = projectOf(card.cwd) !== card.cwd;
  const [forkingInto, setForkingInto] = useState(false);
  const fork = (worktree: boolean) => {
    setForkingInto(worktree);
    onFork?.(worktree);
  };
  const [primary, secondary] = inWorktree ? [FORK, CLONE] : [CLONE, FORK];
  const forkBlocked =
    attachments.length > 0 ? "A fork can't take attachments yet" : null;
  const forkDisabled = forking || !draft.trim() || forkBlocked !== null;
  const asking = card.waiting?.ask != null;
  const submitKey = useSubmitKey();
  const fetcher = useFetcher<{ messages: ChatMessage[]; total: number }>();
  // The last this-many messages, more each time earlier ones are asked for.
  const [shown, setShown] = useState(MESSAGES_SHOWN);
  const url = `/sessions/${card.sessionId}/messages?limit=${shown}`;
  // The dialog mounts its content a render or two after it opens, so the
  // scroller is state: effects that need it rerun once it exists.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const restored = useRef(false);

  // Remember where the conversation was scrolled to, so a reload lands back
  // there rather than at the end. Reading the end is remembered as such, so
  // messages that arrive meanwhile still show.
  useEffect(() => {
    if (!open || !scroller) return;
    const el = scroller;
    const key = scrollKey(card.sessionId);
    const save = () => {
      const atEnd =
        el.scrollHeight - el.scrollTop - el.clientHeight < AT_END_PX;
      try {
        if (atEnd) sessionStorage.removeItem(key);
        else sessionStorage.setItem(key, String(el.scrollTop));
      } catch {}
    };
    window.addEventListener("pagehide", save);
    return () => window.removeEventListener("pagehide", save);
  }, [open, scroller, card.sessionId]);

  useEffect(() => {
    if (!open) return;
    fetcher.load(url);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") fetcher.load(url);
    }, POLL_MS);
    return () => clearInterval(id);
    // fetcher is a new object each render; the url is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, url]);

  const messages = fetcher.data?.messages;
  const count = messages?.length ?? 0;
  const total = fetcher.data?.total ?? 0;
  useEffect(() => {
    if (!open || !scroller) return;
    if (messages && !restored.current) {
      restored.current = true;
      const key = scrollKey(card.sessionId);
      let top: string | null = null;
      try {
        top = sessionStorage.getItem(key);
        sessionStorage.removeItem(key);
      } catch {}
      if (top !== null) {
        scroller.scrollTop = Number(top);
        return;
      }
    }
    scroller.scrollTop = scroller.scrollHeight;
    // Opening the chat, or a new message, moves the view to the end; nothing
    // else should, earlier messages loading above least of all.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scroller, total]);

  // Earlier messages load above what is on screen, which stays where it was:
  // the same distance from the end once they're in.
  const fromEnd = useRef<number | null>(null);
  const showEarlier = () => {
    if (fromEnd.current !== null) return;
    if (scroller) fromEnd.current = scroller.scrollHeight - scroller.scrollTop;
    setShown((n) => n + MESSAGES_SHOWN);
  };
  useLayoutEffect(() => {
    if (!scroller || fromEnd.current === null) return;
    scroller.scrollTop = scroller.scrollHeight - fromEnd.current;
    fromEnd.current = null;
  }, [scroller, count]);

  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const slash = useSlashMenu({
    sessionId: card.sessionId,
    enabled:
      open && card.drivable && ENGINE_FEATURES[card.engine].slashCommands,
    draft,
    setDraft: onDraftChange,
    anchor: input,
  });

  // A pasted or dropped file goes in as a label where the cursor is.
  const [attachError, setAttachError] = useState<string | null>(null);
  const attach = (files: File[]) => {
    const { fit, error } = fitAttachments(files, attachments.length);
    setAttachError(error);
    if (fit.length === 0) return;
    const el = input.current;
    const { text, caret } = insertLabels(
      draft,
      el?.selectionStart ?? draft.length,
      el?.selectionEnd ?? draft.length,
      onAttach(fit),
    );
    onDraftChange(text);
    requestAnimationFrame(() => el?.setSelectionRange(caret, caret));
  };

  // Sending returns to the board; a failed send shows on the card, with the
  // draft put back.
  const send = () => {
    if (!canSend) return;
    onSend();
    onOpenChange(false);
  };

  // Typed here to end in the trigger phrase, it sends on its own.
  const { left, typed } = useTrigger({
    text: draft,
    outgoing,
    seconds: trigger.seconds,
    ready: open && canSend,
    fire: send,
  });

  const workers = workerCount(card.fanouts);
  const rail = workers > 0 || card.subagents.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // On a phone, open on the conversation rather than raising the
        // keyboard over it.
        initialFocus={coarse || asking ? true : input}
        // Framed like its card, so the chat keeps its status and engine; clipped
        // like it too, so the edge follows the rounded corners.
        className={cn(
          EDGE_FRAME,
          EDGE[card.column],
          ENGINE_CORNER[card.engine],
          "flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-5xl flex-col gap-4 overflow-hidden sm:max-w-5xl max-md:h-dvh! max-md:w-screen! max-md:max-w-none! max-md:rounded-none max-md:after:rounded-none max-md:pt-[max(1rem,env(safe-area-inset-top))] max-md:pb-[max(1rem,env(safe-area-inset-bottom))] max-md:ring-0",
        )}
      >
        <DialogHeader>
          <DialogTitle className="flex min-w-0 items-center gap-1 pr-8">
            {title ?? <span className="sensitive">{card.name}</span>}
          </DialogTitle>
          <DialogDescription className="sensitive font-mono text-xs">
            {card.cwd}
            {card.branch && ` · ${card.branch}`}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-4 flex min-h-0 flex-1 border-y">
          <div
            ref={setScroller}
            className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
          >
            {!messages && fetcher.state !== "idle" && (
              <p className="text-muted-foreground">Loading conversation…</p>
            )}
            {messages?.length === 0 && (
              <p className="text-muted-foreground">No messages yet.</p>
            )}
            {messages && total > count && (
              <div className="mb-3 flex justify-center">
                <Button variant="ghost" size="sm" onClick={showEarlier}>
                  Show earlier messages
                </Button>
              </div>
            )}
            {messages && <Conversation messages={messages} cwd={card.cwd} />}
          </div>
          {rail && (
            <aside className="hidden w-72 shrink-0 overflow-y-auto border-l px-4 py-3 md:block">
              <SideRail card={card} />
            </aside>
          )}
        </div>

        {/* The side panel has no room below md: a fold instead. */}
        {rail && (
          <details className="max-h-56 shrink-0 overflow-y-auto md:hidden">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {[
                workers > 0 && `Workers (${workers})`,
                card.subagents.length > 0 &&
                  `Subagents (${card.subagents.length})`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </summary>
            <div className="pt-2">
              <SideRail card={card} />
            </div>
          </details>
        )}

        {/* What the chat is blocked on, answered here as on its card. */}
        {card.waiting && (
          <div className="max-h-[40dvh] shrink-0 overflow-y-auto text-xs max-md:text-sm">
            <WaitingPanel card={card} />
          </div>
        )}

        <QueuedList card={card} />

        {/* An open question is answered in its own form, above. */}
        {!asking && (
          <>
            <AttachmentChips attachments={attachments} onDetach={onDetach} />

            <div className="flex flex-col gap-2 md:flex-row md:items-end">
              <div className="relative flex min-w-0 flex-1 flex-col">
                {slash.menu}
                <Textarea
                  ref={input}
                  data-focus-key={`chat:${card.sessionId}`}
                  value={draft}
                  onChange={(e) => {
                    onDraftChange(e.target.value);
                    typed(e.target.value);
                  }}
                  // Files on the clipboard or dropped in are attached; a paste
                  // of anything else is text as usual.
                  onPaste={(e) => {
                    const files = [...e.clipboardData.files];
                    if (files.length === 0 || !card.drivable) return;
                    e.preventDefault();
                    attach(files);
                  }}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes("Files"))
                      e.preventDefault();
                  }}
                  onDrop={(e) => {
                    const files = [...e.dataTransfer.files];
                    if (files.length === 0 || !card.drivable) return;
                    e.preventDefault();
                    attach(files);
                  }}
                  onKeyDown={(e) => {
                    if (slash.onKeyDown(e)) return;
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder={
                    !onFork
                      ? card.drivable
                        ? queueing
                          ? `Next message${keyHint(submitKey, " to queue it for when this turn ends")}`
                          : `Next message${keyHint(submitKey, " to send")}`
                        : "Not running"
                      : !card.drivable
                        ? "Not running: write a tangent to fork from this chat"
                        : queueing
                          ? `Next message${keyHint(submitKey, " to queue it for when this turn ends")}, or a tangent to fork`
                          : `Next message${keyHint(submitKey, " to send")}, or a tangent to fork`
                  }
                  className="sensitive max-h-[30dvh] min-h-20 resize-y overflow-y-auto rounded-b-none border-b-0 focus-visible:border-input focus-visible:ring-0 md:max-h-[40dvh] md:min-h-32"
                />
                <ContextBar context={card.context} className="border-input" />
              </div>
              <div className="flex justify-end gap-2 md:flex-col">
                {/* The file dialog, for what can't be pasted or dropped: on a
                phone, nothing can. */}
                <input
                  ref={picker}
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => {
                    const files = [...(e.target.files ?? [])];
                    e.target.value = "";
                    if (files.length > 0) attach(files);
                  }}
                />
                <Button
                  variant="outline"
                  disabled={
                    !card.drivable || attachments.length >= MAX_ATTACHMENTS
                  }
                  onClick={() => picker.current?.click()}
                  title="Attach files or images"
                >
                  <Paperclip />
                  Attach
                </Button>
                {/* Fork and Clone share a row: whichever suits the chat
                by name, the other as an icon beside it. */}
                {onFork && (
                  <div className="flex">
                    <Button
                      variant="outline"
                      className="flex-1 rounded-r-none"
                      disabled={forkDisabled}
                      onClick={() => fork(primary.worktree)}
                      title={forkBlocked ?? primary.title}
                    >
                      {primary.icon}
                      {forking && forkingInto === primary.worktree
                        ? primary.busy
                        : primary.label}
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="rounded-l-none border-l-0"
                      disabled={forkDisabled}
                      onClick={() => fork(secondary.worktree)}
                      title={
                        forkBlocked ?? `${secondary.label}: ${secondary.title}`
                      }
                      aria-label={secondary.label}
                    >
                      {secondary.icon}
                    </Button>
                  </div>
                )}
                <Button
                  disabled={!canSend}
                  onClick={send}
                  className={left === null ? undefined : COUNTING}
                  title={
                    left !== null
                      ? countdownTitle(left, queueing ? "Queue" : "Send")
                      : queueing
                        ? `Queue, to send once this turn ends${keyHint(submitKey)}`
                        : `Send${keyHint(submitKey)}`
                  }
                >
                  <SendIcon left={left} icon={<SendHorizontal />} />
                  <StackedLabel
                    labels={[
                      [queueing ? "Queue" : "Send", !pending && left === null],
                      [queueing ? "Queueing…" : "Sending…", pending],
                      [String(left ?? trigger.seconds), left !== null],
                    ]}
                  />
                </Button>
              </div>
            </div>
          </>
        )}
        {(error ?? attachError) && (
          <p className="text-sm text-destructive">{error ?? attachError}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// What waits for the chat's turn to end. Claude Code's own queue, typed in
// the terminal, goes first and can only be read here; seamux's queue follows,
// one message per turn, and can be edited, sent now, or removed. An edit in
// progress is kept in session storage, by message id, so a reload, such as
// the board restarting after a landing, leaves it open with what was typed.
function QueuedList({ card }: { card: Card }) {
  const [edits, setEdits] = useSessionStorage<Record<string, string>>(
    queueEditsKey(card.sessionId),
    {},
  );
  // An edit outlives its message only until the list sees it gone: sent,
  // removed, or taken by the queue.
  const queued = card.boardQueue.map((m) => String(m.id)).join(",");
  useEffect(() => {
    const ids = new Set(queued.split(","));
    setEdits((all) => {
      const kept = Object.entries(all).filter(([id]) => ids.has(id));
      return kept.length === Object.keys(all).length
        ? all
        : Object.fromEntries(kept);
    });
  }, [queued, edits, setEdits]);

  if (card.terminalQueue.length === 0 && card.boardQueue.length === 0) {
    return null;
  }
  const setEdit = (id: string, text: string | null) =>
    setEdits((all) => {
      const { [id]: _, ...rest } = all;
      return text === null ? rest : { ...rest, [id]: text };
    });
  return (
    <section className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Queued
      </h3>
      {card.terminalQueue.map((text, i) => (
        <div
          key={`terminal-${i}`}
          className="flex items-start gap-2 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground"
          title="Typed in the terminal, so Claude Code holds it"
        >
          <p className="sensitive min-w-0 flex-1 whitespace-pre-wrap break-words">
            <MessageText text={text} />
          </p>
          <span className="shrink-0 text-xs">in the terminal</span>
        </div>
      ))}
      {card.boardQueue.map((m) => (
        <QueuedItem
          key={m.id}
          card={card}
          message={m}
          text={edits[String(m.id)] ?? null}
          setText={(text) => setEdit(String(m.id), text)}
        />
      ))}
    </section>
  );
}

// `text` is the edit in progress, null while the message isn't being edited.
function QueuedItem({
  card,
  message,
  text,
  setText,
}: {
  card: Card;
  message: QueuedMessage;
  text: string | null;
  setText: (text: string | null) => void;
}) {
  const editing = text !== null;
  const submitKey = useSubmitKey();
  const edit = useSessionAction(card.sessionId, () => setText(null));
  const other = useSessionAction(card.sessionId);
  const id = String(message.id);
  const save = () =>
    text?.trim() && edit.submit("queue-edit", { id, text: text.trim() });
  const error = edit.error ?? other.error;

  return (
    <div className="flex flex-col gap-1 rounded-lg border px-3 py-2 text-sm">
      <div className="flex items-start gap-2">
        {editing ? (
          <Textarea
            autoFocus
            value={text ?? ""}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                save();
              } else if (e.key === "Escape") {
                // Cancel the edit, not the whole modal.
                e.stopPropagation();
                setText(null);
              }
            }}
            className="sensitive min-h-20 flex-1 resize-y"
          />
        ) : (
          <p className="sensitive min-w-0 flex-1 whitespace-pre-wrap break-words">
            <MessageText text={message.text} />
          </p>
        )}
        <div className="flex shrink-0 gap-1">
          {editing ? (
            <>
              <Button
                size="icon-xs"
                disabled={edit.pending || !text?.trim()}
                onClick={save}
                title={`Save${keyHint(submitKey)}`}
              >
                <Check />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => setText(null)}
                title="Cancel (Esc)"
              >
                <X />
              </Button>
            </>
          ) : (
            <>
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => setText(message.text)}
                title="Edit"
              >
                <Pencil />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                disabled={!card.drivable || other.pending}
                onClick={() => other.submit("queue-send", { id })}
                title="Send now: Claude Code takes it at its next step"
              >
                <SendHorizontal />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                disabled={other.pending}
                onClick={() => other.submit("queue-drop", { id })}
                title="Remove from the queue"
              >
                <X />
              </Button>
            </>
          )}
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// The conversation, apart from the input so a keystroke there doesn't
// render every message's markdown again. A reply can arrive as several
// messages, so a run of them shares one bubble and reads as the one response
// it is. The tool calls between replies show as one line of tool names, and
// a macro seamux sent by its name: each says what happened without the
// clutter of what went in and came out.
const Conversation = memo(function Conversation({
  messages,
  cwd,
}: {
  messages: ChatMessage[];
  cwd: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      {groupReplies(messages).map((m, i) =>
        Array.isArray(m) ? (
          <div
            key={`${m[0].at}-${i}`}
            className="sensitive prose prose-sm max-md:prose-base max-w-[85%] self-start rounded-lg bg-muted px-3 py-2 text-sm max-md:text-base dark:prose-invert prose-pre:overflow-x-auto prose-pre:bg-background prose-pre:text-foreground prose-code:before:content-none prose-code:after:content-none"
          >
            {m.map((reply, j) => (
              <Markdown key={j} base={cwd}>
                {reply.text}
              </Markdown>
            ))}
          </div>
        ) : m.role === "shell" ? (
          <ShellRun key={`${m.at}-${i}`} run={m} />
        ) : m.role === "tools" ? (
          <div
            key={`${m.at}-${i}`}
            className="sensitive self-start rounded-full border px-3 py-1 text-xs text-muted-foreground max-md:text-sm"
          >
            💻 called {toolCalls(m.calls)}
          </div>
        ) : m.role === "macro" ? (
          <div
            key={`${m.at}-${i}`}
            className="sensitive self-end rounded-full border px-3 py-1 text-xs text-muted-foreground max-md:text-sm"
          >
            {macroLabel(m.name)}
          </div>
        ) : (
          <div
            key={`${m.at}-${i}`}
            className="sensitive max-w-[85%] self-end whitespace-pre-wrap break-words rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground max-md:text-base"
          >
            <MessageText text={m.text} />
          </div>
        ),
      )}
    </div>
  );
});

type Reply = Extract<ChatMessage, { text: string }> & { role: "assistant" };

// "Bash ×3, Read": each tool a run of calls used, and how often.
function toolCalls(calls: { name: string; count: number }[]): string {
  return calls
    .map((c) => (c.count > 1 ? `${c.name} ×${c.count}` : c.name))
    .join(", ");
}

// Gathers each run of consecutive replies into one array, leaving every
// other message as it is.
function groupReplies(messages: ChatMessage[]): (ChatMessage | Reply[])[] {
  const out: (ChatMessage | Reply[])[] = [];
  for (const m of messages) {
    const last = out.at(-1);
    if (m.role !== "assistant") out.push(m);
    else if (Array.isArray(last)) last.push(m as Reply);
    else out.push([m as Reply]);
  }
  return out;
}

// A command the user ran with `!`, and what it printed. One still running
// may be waiting on the user, as a login waits for its URL to be opened,
// so it says so rather than showing nothing.
function ShellRun({ run }: { run: Extract<ChatMessage, { role: "shell" }> }) {
  return (
    <div className="sensitive w-full max-w-[85%] self-end overflow-hidden rounded-lg border font-mono text-xs max-md:text-sm">
      <div className="whitespace-pre-wrap break-words bg-muted px-3 py-2">
        <span className="select-none text-muted-foreground">! </span>
        {run.command}
      </div>
      {run.output === null ? (
        <p className="px-3 py-2 font-sans text-muted-foreground">
          Running. Its output shows in the terminal until it finishes.
        </p>
      ) : run.output ? (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words px-3 py-2">
          {run.output}
        </pre>
      ) : null}
    </div>
  );
}

const RAIL_HEADING =
  "mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground";

// The fan-out workers the chat started, then its subagents.
function SideRail({ card }: { card: Card }) {
  return (
    <div className="flex flex-col gap-6">
      {card.fanouts.length > 0 && (
        <section>
          <h3 className={RAIL_HEADING}>Workers</h3>
          <WorkerDetail fanouts={card.fanouts} />
        </section>
      )}
      {card.subagents.length > 0 && (
        <section>
          <h3 className={RAIL_HEADING}>Subagents</h3>
          <SubagentDetail subagents={card.subagents} now={Date.now()} />
        </section>
      )}
    </div>
  );
}
