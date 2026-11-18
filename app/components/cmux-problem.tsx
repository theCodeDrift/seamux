import { Check, Copy, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import type { CmuxProblem as Problem } from "~/lib/board";
import { copyText } from "~/lib/clipboard";

// Covers the board while seamux can't reach cmux: every chat would show, and
// every send would fail, so it says why and how to fix it instead. It goes
// on its own once a poll reaches cmux.
export function CmuxProblem({ problem }: { problem: Problem }) {
  const { title, why, steps } = explain(problem);
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="cmux-problem-title"
      className="fixed inset-0 z-50 overflow-y-auto bg-background"
    >
      <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center gap-5 px-4 py-12">
        <div className="flex items-center gap-2 text-warning-text">
          <TriangleAlert className="size-5 shrink-0" />
          <span className="text-sm font-medium">
            seamux can't drive your chats
          </span>
        </div>
        <h1 id="cmux-problem-title" className="text-2xl font-semibold">
          {title}
        </h1>
        <p className="text-muted-foreground">{why}</p>
        <ol className="flex list-decimal flex-col gap-3 pl-5">
          {steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
        <p className="text-sm text-muted-foreground">
          This page checks again every few seconds and opens the board once
          seamux can reach cmux.
        </p>
      </div>
    </div>
  );
}

function explain({ trouble, start, home }: Problem): {
  title: string;
  why: string;
  steps: ReactNode[];
} {
  const restart = [
    "Stop seamux where it's running, with Ctrl+C.",
    "Open cmux, and a new workspace in it.",
    <>
      Start seamux there:
      <Command text={start} />
    </>,
  ];
  switch (trouble) {
    case "outside_cmux":
      return {
        title: "seamux was started outside cmux",
        why: "seamux sends messages by typing into each chat's cmux terminal, and cmux only lets programs started inside it do that. This seamux was started from another terminal, so it can list your chats but not send them anything.",
        steps: [
          ...restart,
          <>
            Or, to keep starting seamux from another terminal:{" "}
            <SocketMode mode="Automation mode" />, which lets in programs you
            run, wherever you start them.
          </>,
        ],
      };
    case "socket_off":
      return {
        title: "cmux's socket is off",
        why: "seamux sends messages by typing into each chat's cmux terminal, through cmux's control socket, and that socket is turned off.",
        steps: [
          <>
            Turn the socket on: <SocketMode mode="cmux processes only" />.
          </>,
          ...restart,
        ],
      };
    case "not_running":
      return {
        title: "cmux isn't running",
        why: "seamux sends messages by typing into each chat's cmux terminal, and it can't find cmux.",
        steps: restart,
      };
    case "not_installed":
      return {
        title: "cmux isn't installed",
        why: "seamux runs your chats in cmux, the terminal it types into, and can't find cmux on this Mac.",
        steps: [
          <>
            Install cmux from{" "}
            <a
              href="https://cmux.dev"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              cmux.dev
            </a>{" "}
            into Applications.
          </>,
          ...restart,
        ],
      };
    case "password":
      return {
        title: "cmux wants a password",
        why: "cmux's socket is set to ask for a password, and seamux doesn't have the right one.",
        steps: [
          <>
            Add the password from cmux's Settings to seamux's{" "}
            <code className="sensitive font-mono">{home}/.env</code>:
            <Command text="CMUX_SOCKET_PASSWORD=your-password" />
          </>,
          "Stop seamux with Ctrl+C, and start it again from a cmux terminal.",
        ],
      };
  }
}

// Setting cmux's socket mode, in the words cmux's Settings use.
function SocketMode({ mode }: { mode: string }) {
  return (
    <>
      in cmux's Settings, under <b>Automation</b>, set{" "}
      <b>Socket Control Mode</b> to <b>{mode}</b>
    </>
  );
}

function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="mt-2 flex items-center gap-2 rounded-md bg-muted px-3 py-2">
      <code className="sensitive min-w-0 flex-1 font-mono text-sm break-all select-all">
        {text}
      </code>
      <Button
        size="icon-sm"
        variant="ghost"
        title="Copy"
        onClick={() => {
          void copyText(text).then((ok) => {
            if (!ok) return;
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </span>
  );
}
