import { Check, CircleHelp, Plus, ShieldQuestion } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  ASKED_IN_REPLY,
  hasPreviews,
  type Card,
  type Question,
  type Waiting,
} from "~/lib/board";
import { answerOf, takesText, useQuestionDrafts } from "~/lib/question-drafts";
import { useSessionAction } from "~/lib/use-session-action";
import { cn } from "~/lib/utils";

// Enter in a box inside the form leaves it be rather than answering: only
// the Answer button sends.
const holdEnter = (e: React.KeyboardEvent) => {
  if (e.key === "Enter") e.preventDefault();
};

const BOX =
  "rounded-md border bg-background px-2 py-1 outline-none placeholder:text-muted-foreground";

// An open AskUserQuestion, answered from the card. The board drives the
// same dialog the user would see in the terminal, and like it, offers a
// row for an answer of the user's own after the options.
function QuestionForm({
  card,
  ask,
}: {
  card: Card;
  ask: NonNullable<Waiting["ask"]>;
}) {
  const [drafts, update] = useQuestionDrafts(
    ask.toolUseId,
    ask.questions.length,
  );
  const { submit, pending, error } = useSessionAction(card.sessionId);
  const answers = ask.questions.map((q, i) => answerOf(q, drafts[i]));
  const ready = card.drivable && !pending && answers.every((a) => a != null);

  const toggle = (i: number, q: Question, option: number) => {
    const { picks, notes } = drafts[i];
    if (!q.multiSelect) return update(i, { picks: [option], text: "", notes });
    update(i, {
      picks: picks.includes(option)
        ? picks.filter((p) => p !== option)
        : [...picks, option].sort((a, b) => a - b),
      text: "",
      notes,
    });
  };

  return (
    <form
      className="flex flex-col gap-3 rounded-md border border-warning/40 bg-warning/5 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) {
          submit("answer", {
            toolUseId: ask.toolUseId,
            answers: JSON.stringify(answers),
          });
        }
      }}
    >
      {ask.questions.map((q, i) => {
        const draft = drafts[i];
        const previews = hasPreviews(q);
        const shown = previews ? q.options[draft.picks[0]]?.preview : null;
        return (
          <fieldset key={i} className="flex flex-col gap-1.5">
            <legend className="mb-1.5 flex items-start gap-1.5 font-medium">
              <CircleHelp className="mt-px size-3.5 shrink-0 text-warning" />
              <span className="sensitive">
                {q.question}
                {q.multiSelect && (
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    (pick any)
                  </span>
                )}
              </span>
            </legend>
            {q.options.map((o, j) => {
              const picked = draft.picks.includes(j);
              return (
                <button
                  type="button"
                  key={j}
                  onClick={() => toggle(i, q, j)}
                  aria-pressed={picked}
                  title={o.description ?? undefined}
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-md border bg-background px-2 py-1 text-left",
                    picked && "border-warning bg-warning/10",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-3 shrink-0 items-center justify-center border",
                      q.multiSelect ? "rounded-[3px]" : "rounded-full",
                      picked &&
                        "border-warning bg-warning text-warning-foreground",
                    )}
                  >
                    {picked && <Check className="size-2.5" />}
                  </span>
                  <span className="sensitive min-w-0">
                    {o.label}
                    {o.description && o.description !== o.label && (
                      <span className="block text-muted-foreground">
                        {o.description}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
            {shown != null && (
              <pre className="sensitive max-h-48 overflow-auto rounded-md border bg-muted/50 px-2 py-1 font-mono text-[11px] leading-snug max-md:text-xs">
                {shown}
              </pre>
            )}
            {previews &&
              draft.picks.length > 0 &&
              (draft.notes == null ? (
                <button
                  type="button"
                  onClick={() => update(i, { ...draft, notes: "" })}
                  className="flex cursor-pointer items-center gap-1 self-start text-muted-foreground hover:text-foreground"
                >
                  <Plus className="size-3" />
                  Add a note
                </button>
              ) : (
                <input
                  autoFocus
                  value={draft.notes}
                  onChange={(e) =>
                    update(i, { ...draft, notes: e.target.value })
                  }
                  onKeyDown={holdEnter}
                  placeholder="A note to go with your pick"
                  className={cn("sensitive", BOX)}
                />
              ))}
            {takesText(q) && (
              // Claude Code's "Type something", the row after the options.
              <label
                className={cn(
                  "flex cursor-text items-center gap-2 rounded-md border bg-background px-2 py-1",
                  draft.text.trim() && "border-warning bg-warning/10",
                )}
              >
                <span
                  className={cn(
                    "flex size-3 shrink-0 items-center justify-center rounded-full border",
                    draft.text.trim() &&
                      "border-warning bg-warning text-warning-foreground",
                  )}
                >
                  {draft.text.trim() && <Check className="size-2.5" />}
                </span>
                <input
                  value={draft.text}
                  onChange={(e) =>
                    update(i, { picks: [], text: e.target.value, notes: null })
                  }
                  onKeyDown={holdEnter}
                  placeholder="Type your answer here"
                  className="sensitive min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
                />
              </label>
            )}
          </fieldset>
        );
      })}
      <div className="flex items-center justify-end gap-2">
        {error && <p className="text-destructive">{error}</p>}
        <Button type="submit" size="xs" disabled={!ready}>
          {pending ? "Answering…" : "Answer"}
        </Button>
      </div>
    </form>
  );
}

// An open permission prompt, answered from the card. Approve is the dialog's
// "Yes"; Deny refuses the call and ends the turn, so the user can reply.
// Where the prompt can approve every later call as well, as Cursor's "Run
// Everything" does, that option shows under its own label.
function ApprovalButtons({
  card,
  approval,
}: {
  card: Card;
  approval: NonNullable<Waiting["approval"]>;
}) {
  const { submit, pending, error } = useSessionAction(card.sessionId);
  const disabled = !card.drivable || pending;
  const answer = (intent: "approve" | "approve-all" | "deny") =>
    submit(intent, { toolUseId: approval.toolUseId });
  return (
    <div className="flex items-center justify-end gap-2">
      {error && <p className="text-destructive">{error}</p>}
      <Button
        size="xs"
        variant="outline"
        disabled={disabled}
        onClick={() => answer("deny")}
      >
        Deny
      </Button>
      {approval.all && (
        <Button
          size="xs"
          variant="outline"
          disabled={disabled}
          onClick={() => answer("approve-all")}
        >
          {approval.all}
        </Button>
      )}
      <Button size="xs" disabled={disabled} onClick={() => answer("approve")}>
        {pending ? "Answering…" : "Approve"}
      </Button>
    </div>
  );
}

// Any other dialog, or a tool's own confirmation, answered with the option
// picked, in the terminal's order. No option is singled out: which one is
// safe depends on the dialog.
function DialogButtons({
  card,
  dialog,
}: {
  card: Card;
  dialog: NonNullable<Waiting["dialog"]>;
}) {
  const { submit, pending, error } = useSessionAction(card.sessionId);
  const disabled = !card.drivable || pending;
  return (
    <div className="flex flex-col gap-1.5">
      {dialog.options.map((label, i) => (
        <button
          type="button"
          key={i}
          disabled={disabled}
          onClick={() =>
            submit("choose", { dialog: dialog.key, option: String(i) })
          }
          className="cursor-pointer rounded-md border bg-background px-2 py-1 text-left hover:bg-muted disabled:cursor-default disabled:opacity-50"
        >
          {label}
        </button>
      ))}
      {error && <p className="text-destructive">{error}</p>}
    </div>
  );
}

// What a WAITING card is blocked on: its question to answer, the question
// its reply ended on, or the tool call waiting for approval.
export function WaitingPanel({ card }: { card: Card }) {
  const w = card.waiting;
  if (!w) return null;
  if (w.ask)
    return <QuestionForm key={w.ask.toolUseId} card={card} ask={w.ask} />;
  // Answered with the reply box, like any message.
  if (w.reason === ASKED_IN_REPLY) {
    return (
      <div className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/5 px-2 py-1">
        <CircleHelp className="mt-px size-3.5 shrink-0 text-warning" />
        <span className="min-w-0 break-words">
          <span className="font-medium">Asked: </span>
          <span className="sensitive">{w.detail}</span>
        </span>
      </div>
    );
  }
  const approval = w.reason === "permission prompt";
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-warning/40 bg-warning/5 px-2 py-1">
      <div className="flex items-start gap-1.5">
        <ShieldQuestion className="mt-px size-3.5 shrink-0 text-warning" />
        <span className="min-w-0">
          <span className="font-medium">
            {w.dialog ? (
              <span className="sensitive">{w.dialog.title}</span>
            ) : approval ? (
              "Needs approval"
            ) : (
              `Waiting: ${w.reason ?? "input"}`
            )}
            {w.tool && ` · ${w.tool}`}
          </span>
          {w.detail && (
            <span className="sensitive block break-words font-mono text-muted-foreground">
              {w.detail}
            </span>
          )}
          {w.dialog?.detail.map((line, i) => (
            <span
              key={i}
              className="sensitive block break-words text-muted-foreground"
            >
              {line}
            </span>
          ))}
        </span>
      </div>
      {w.dialog && (
        <DialogButtons key={w.dialog.key} card={card} dialog={w.dialog} />
      )}
      {w.approval && (
        <ApprovalButtons
          key={w.approval.toolUseId}
          card={card}
          approval={w.approval}
        />
      )}
    </div>
  );
}
