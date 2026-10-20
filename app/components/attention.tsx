import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";
import { ExternalLink, LoaderCircle, LogIn, Play, X } from "lucide-react";

import { notify } from "~/components/waiting-alerts";
import { Button, buttonVariants } from "~/components/ui/button";
import { needsAction, type ServiceNotice } from "~/lib/board";
import {
  ENGINE_COLORS,
  ENGINE_FOREGROUNDS,
  ENGINE_LABELS,
  type Engine,
} from "~/lib/config";
import { cn } from "~/lib/utils";
import type { ServiceActionResult } from "~/routes/service-action";

export const ATTENTION_ACCENT = "bg-attention";

// Posts one of a service's verbs: sign in, paste a code, stop, resume.
function useServiceAction(service: Engine) {
  const fetcher = useFetcher<ServiceActionResult>();
  return {
    submit: (intent: string, fields: Record<string, string> = {}) =>
      fetcher.submit(
        { intent, ...fields },
        { method: "post", action: `/services/${service}/action` },
      ),
    pending: fetcher.state !== "idle",
    error: fetcher.state === "idle" ? (fetcher.data?.error ?? null) : null,
  };
}

// A toast when a sign-in ends, and a notification when a service newly
// needs the user, the way a chat that starts waiting does. Neither fires for
// what the first board shows.
export function useServiceAlerts(notices: ServiceNotice[], notifying: boolean) {
  const seen = useRef<Map<Engine, ServiceNotice> | null>(null);
  useEffect(() => {
    const before = seen.current;
    seen.current = new Map(notices.map((n) => [n.service, n]));
    if (!before) return;
    for (const n of notices) {
      const was = before.get(n.service);
      const label = ENGINE_LABELS[n.service];
      if (was?.login?.state === "running" && n.login?.state === "done") {
        toast.success(`${label} sign-in complete`, { id: `login:${n.service}` });
      }
      if (was?.login?.state === "running" && n.login?.state === "failed") {
        toast.error(`${label} sign-in failed`, {
          id: `login:${n.service}`,
          description: n.login.message ?? undefined,
        });
      }
      if (
        notifying &&
        !document.hasFocus() &&
        n.needsLogin &&
        !was?.needsLogin
      ) {
        void notify(
          `${label} needs you to sign in`,
          summary(n),
          `seamux:service:${n.service}`,
        );
      }
    }
  }, [notices, notifying]);
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

function summary(n: ServiceNotice): string {
  if (n.signedIn === false) return "Signed out";
  if (n.needsLogin) return "Login expired";
  if (n.stopped.length > 0)
    return `${plural(n.stopped.length, "chat")} stopped on an expired login`;
  return "";
}

// A card per service in trouble, in the service's own color: a full border
// of it, over the card's color mixed with it.
function ServiceCard({ notice }: { notice: ServiceNotice }) {
  const { service, login, stopped } = notice;
  const action = useServiceAction(service);
  const label = ENGINE_LABELS[service];
  const running = login?.state === "running";
  const status = running
    ? "Signing in…"
    : login?.state === "done"
      ? "Signed in"
      : summary(notice);
  return (
    <section
      style={
        {
          "--service": ENGINE_COLORS[service],
          "--service-foreground": ENGINE_FOREGROUNDS[service],
        } as CSSProperties
      }
      className="flex flex-col gap-3 rounded-xl border-2 border-(--service) bg-[color-mix(in_oklch,var(--service)_14%,var(--card))] p-3 text-sm text-card-foreground shadow-sm dark:bg-[color-mix(in_oklch,var(--service)_18%,var(--card))] dark:shadow-black/20"
    >
      <header className="flex items-center justify-between gap-2">
        <span className="flex shrink-0 items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-full bg-(--service)" />
          <span className="text-base font-semibold">{label}</span>
        </span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {status}
        </span>
      </header>

      {running && login && <SignIn notice={notice} action={action} />}

      {login?.state === "failed" && (
        <p className="text-xs text-destructive">
          {login.message ?? "The sign-in didn't finish."}
        </p>
      )}

      {notice.needsLogin && !running && (
        <p className="text-xs text-muted-foreground">
          {notice.signedIn === false
            ? `${label} is signed out on this Mac.`
            : "A chat's login expired since the last sign-in."}{" "}
          You can sign in from here, on this Mac or any other device.
        </p>
      )}

      {stopped.length > 0 && (
        <SessionList
          lead="Stopped on an expired login"
          sessions={stopped}
        />
      )}

      {!running && (notice.needsLogin || stopped.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {notice.needsLogin && (
            <Button
              size="sm"
              disabled={action.pending}
              onClick={() => action.submit("login")}
              className="bg-(--service) text-(--service-foreground) hover:bg-(--service)/85"
            >
              {action.pending ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <LogIn />
              )}
              {login?.state === "failed" ? "Try again" : "Sign in"}
            </Button>
          )}
          {stopped.length > 0 && notice.signedIn !== false && (
            <Button
              size="sm"
              variant="outline"
              disabled={action.pending}
              onClick={() => action.submit("resume")}
              title={`Send each stopped chat "continue"`}
            >
              <Play />
              Resume {plural(stopped.length, "chat")}
            </Button>
          )}
        </div>
      )}

      {action.error && <p className="text-xs text-destructive">{action.error}</p>}
    </section>
  );
}

function SessionList({
  lead,
  sessions,
}: {
  lead: string;
  sessions: { sessionId: string; name: string }[];
}) {
  return (
    <div className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{lead}:</span>
      <ul className="flex flex-wrap gap-1">
        {sessions.map((s) => (
          <li
            key={s.sessionId}
            className="sensitive max-w-full truncate rounded-md bg-background/60 px-1.5 py-0.5"
          >
            {s.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

// A sign-in in progress, which opens no tab by itself. Claude Code's has a
// link that calls back to this Mac, used when the board is viewed here, and
// one whose page shows a code to paste back, used anywhere else. Codex's
// shows a code to enter on its site.
function SignIn({
  notice,
  action,
}: {
  notice: ServiceNotice;
  action: ReturnType<typeof useServiceAction>;
}) {
  const login = notice.login!;
  const [code, setCode] = useState("");
  // Known only in the browser, so the server's render assumes elsewhere.
  const [onThisMac, setOnThisMac] = useState(false);
  useEffect(
    () =>
      setOnThisMac(["127.0.0.1", "localhost"].includes(location.hostname)),
    [],
  );
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current && !action.pending && !action.error) setCode("");
    sent.current = action.pending;
  }, [action.pending, action.error]);
  if (!login.url) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" />
        Starting the sign-in…
      </p>
    );
  }
  const direct = onThisMac ? login.localUrl : null;
  const open = (
    <a
      href={direct ?? login.url}
      target="_blank"
      rel="noreferrer"
      className={cn(
        buttonVariants({ size: "sm" }),
        "bg-(--service) text-(--service-foreground) hover:bg-(--service)/85",
      )}
    >
      <ExternalLink />
      Open sign-in page
    </a>
  );
  const cancel = (
    <Button
      size="sm"
      variant="ghost"
      disabled={action.pending}
      onClick={() => action.submit("login-cancel")}
    >
      <X />
      Cancel
    </Button>
  );
  if (login.deviceCode) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">
          Open the page and enter this code. It expires 15 minutes after it
          was made.
        </p>
        <code className="self-start rounded-md bg-background/70 px-2 py-1 font-mono text-lg tracking-widest select-all">
          {login.deviceCode}
        </code>
        <div className="flex flex-wrap gap-2">
          {open}
          {cancel}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        {direct
          ? "Open the page and sign in. It finishes here by itself."
          : "Open the page, sign in, and paste the code it shows."}
      </p>
      <div className="flex flex-wrap gap-2">
        {open}
        {cancel}
      </div>
      {login.takesCode && !direct && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) action.submit("login-code", { code });
          }}
        >
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Paste the code"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 font-mono text-xs outline-none placeholder:font-sans placeholder:text-muted-foreground max-md:text-base"
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={action.pending || !code.trim()}
          >
            Submit
          </Button>
        </form>
      )}
    </div>
  );
}

// Left of everything, and only while a service needs looking at. It can't
// be pinned: it holds no chats.
export function AttentionCards({ notices }: { notices: ServiceNotice[] }) {
  return notices.map((n) => <ServiceCard key={n.service} notice={n} />);
}

export function attentionCount(notices: ServiceNotice[]): number {
  return notices.filter(needsAction).length;
}
