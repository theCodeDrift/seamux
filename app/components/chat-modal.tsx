import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { useFetcher } from "react-router";
import {
  Check,
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
import type { Card, ChatMessage, QueuedMessage } from "~/lib/board";
import { ENGINE_FEATURES } from "~/lib/config";
import { scrollKey } from "~/lib/sweep";
import { useCoarsePointer } from "~/lib/use-pointer";
import { useSessionAction } from "~/lib/use-session-action";
import { keyHint, useSubmitKey } from "~/lib/use-submit-key";
import { cn } from "~/lib/utils";

const POLL_MS = 3000;
// Within this many pixels of the end counts as reading the latest message.
const AT_END_PX = 40;

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
  queueing: boolean;
  pending: boolean;
  error: string | null;
  // null when the chat's agent can't fork: only Claude Code can.
  onFork: (() => void) | null;
  forking: boolean;
  // The chat's name, renamable here, where a double-click can't reach on a
  // phone.
  title?: ReactNode;
}) {
  const coarse = useCoarsePointer();
  const asking = card.waiting?.ask != null;
  const submitKey = useSubmitKey();
  const fetcher = useFetcher<{ messages: ChatMessage[] }>();
  const url = `/sessions/${card.sessionId}/messages`;
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
    // Opening the chat, or a change in how many messages there are, moves the
    // view to the end; nothing else should.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scroller, count]);

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
                  onChange={(e) => onDraftChange(e.target.value)}
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
                {onFork && (
                  <Button
                    variant="outline"
                    disabled={
                      forking || !draft.trim() || attachments.length > 0
                    }
                    onClick={onFork}
                    title={
                      attachments.length > 0
                        ? "A fork can't take attachments yet"
                        : "Start a new session with this chat's context and this message"
                    }
                  >
                    <GitFork />
                    {forking ? "Forking…" : "Fork"}
                  </Button>
                )}
                <Button
                  disabled={!canSend}
                  onClick={send}
                  title={
                    queueing
                      ? `Queue, to send once this turn ends${keyHint(submitKey)}`
                      : `Send${keyHint(submitKey)}`
                  }
                >
                  <SendHorizontal />
                  {pending
                    ? queueing
                      ? "Queueing…"
                      : "Sending…"
                    : queueing
                      ? "Queue"
                      : "Send"}
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
// one message per turn, and can be edited, sent now, or removed.
function QueuedList({ card }: { card: Card }) {
  if (card.terminalQueue.length === 0 && card.boardQueue.length === 0) {
    return null;
  }
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
        <QueuedItem key={m.id} card={card} message={m} />
      ))}
    </section>
  );
}

function QueuedItem({ card, message }: { card: Card; message: QueuedMessage }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(message.text);
  const submitKey = useSubmitKey();
  const edit = useSessionAction(card.sessionId, () => setEditing(false));
  const other = useSessionAction(card.sessionId);
  const id = String(message.id);
  const save = () =>
    text.trim() && edit.submit("queue-edit", { id, text: text.trim() });
  const error = edit.error ?? other.error;

  return (
    <div className="flex flex-col gap-1 rounded-lg border px-3 py-2 text-sm">
      <div className="flex items-start gap-2">
        {editing ? (
          <Textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                save();
              } else if (e.key === "Escape") {
                // Cancel the edit, not the whole modal.
                e.stopPropagation();
                setEditing(false);
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
                disabled={edit.pending || !text.trim()}
                onClick={save}
                title={`Save${keyHint(submitKey)}`}
              >
                <Check />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => setEditing(false)}
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
                onClick={() => {
                  setText(message.text);
                  setEditing(true);
                }}
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

// A command the user ran with `!`, and what it printed. One still running
// may be waiting on the user, as a login waits for its URL to be opened,
// so it says so rather than showing nothing.
// The conversation, apart from the input so a keystroke there doesn't
// render every message's markdown again.
const Conversation = memo(function Conversation({
  messages,
  cwd,
}: {
  messages: ChatMessage[];
  cwd: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      {messages.map((m, i) =>
        m.role === "shell" ? (
          <ShellRun key={`${m.at}-${i}`} run={m} />
        ) : (
          <div
            key={`${m.at}-${i}`}
            className={cn(
              "sensitive max-w-[85%] rounded-lg px-3 py-2 text-sm max-md:text-base",
              m.role === "user"
                ? "self-end whitespace-pre-wrap break-words bg-primary text-primary-foreground"
                : "prose prose-sm max-md:prose-base self-start bg-muted dark:prose-invert prose-pre:overflow-x-auto prose-pre:bg-background prose-pre:text-foreground prose-code:before:content-none prose-code:after:content-none",
            )}
          >
            {m.role === "user" ? (
              <MessageText text={m.text} />
            ) : (
              <Markdown base={cwd}>{m.text}</Markdown>
            )}
          </div>
        ),
      )}
    </div>
  );
});

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
