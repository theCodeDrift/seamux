import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";

import type { Column } from "~/lib/board";
import { useOptimistic } from "~/lib/optimistic";
import type { ActionResult } from "~/routes/session-action";

type Intent =
  | "send"
  | "interrupt"
  | "resume"
  | "attach"
  | "delete"
  | "fork"
  | "close"
  | "reload"
  | "pin"
  | "unpin"
  | "pin-move"
  | "rename"
  | "answer"
  | "approve"
  | "deny"
  | "choose"
  | "queue"
  | "queue-edit"
  | "queue-send"
  | "queue-drop"
  | "draft-send"
  | "draft-take"
  | "send-failure-dismiss";

// Where each verb puts the card, shown as it is sent, ahead of the poll.
// Answering a question or approving a tool sets the turn going again.
const MOVES: Partial<Record<Intent, Column>> = {
  send: "working",
  "queue-send": "working",
  "draft-send": "working",
  answer: "working",
  approve: "working",
  interrupt: "idle",
  resume: "idle",
  close: "done",
};

// Posts one of the board's write verbs for a session. `onSuccess` runs once
// per successful submission, with its result, `onFailure` once per failed
// one, e.g. to put back a draft cleared when it was sent.
export function useSessionAction(
  sessionId: string,
  onSuccess?: (result: ActionResult) => void,
  onFailure?: () => void,
) {
  const fetcher = useFetcher<ActionResult>();
  const handled = useRef<ActionResult | undefined>(undefined);
  const { expect, drop } = useOptimistic();
  // Whether the verb in flight moved the card, to put back if it fails.
  const moved = useRef(false);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (handled.current === fetcher.data) return;
    handled.current = fetcher.data;
    if (fetcher.data.ok) onSuccess?.(fetcher.data);
    else {
      if (moved.current) drop(sessionId);
      onFailure?.();
    }
  }, [fetcher.state, fetcher.data, onSuccess, onFailure, drop, sessionId]);

  return {
    // Attachments go as files, each with the label it has in the text.
    submit: (
      intent: Intent,
      fields: Record<string, string> = {},
      attachments: { label: string; file: File }[] = [],
    ) => {
      const column = MOVES[intent];
      moved.current = column != null;
      if (column) expect(sessionId, column);
      const action = `/sessions/${sessionId}/action`;
      if (attachments.length === 0) {
        return fetcher.submit(
          { intent, ...fields },
          { method: "post", action },
        );
      }
      const form = new FormData();
      form.set("intent", intent);
      for (const [k, v] of Object.entries(fields)) form.set(k, v);
      for (const a of attachments) {
        form.append("attachment", a.file);
        form.append("attachmentLabel", a.label);
      }
      return fetcher.submit(form, {
        method: "post",
        action,
        encType: "multipart/form-data",
      });
    },
    pending: fetcher.state !== "idle",
    error: fetcher.state === "idle" ? (fetcher.data?.error ?? null) : null,
  };
}
