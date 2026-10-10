import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Paperclip, SendHorizontal } from "lucide-react";
import { toast } from "sonner";

import { AttachmentChips } from "~/components/attachments";
import { DirectoryPicker } from "~/components/directory-picker";

import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import {
  attachmentLabel,
  fitAttachments,
  insertLabels,
  kindOf,
  MAX_ATTACHMENTS,
  type Attachment,
} from "~/lib/attachments";
import { ENGINE_LABELS, ENGINES, type Engine } from "~/lib/config";
import { useOptimistic } from "~/lib/optimistic";
import { releaseFocus } from "~/lib/use-focus-restore";
import { useSessionStorage } from "~/lib/use-session-storage";
import { keyHint, useSubmitKey } from "~/lib/use-submit-key";
import type { DispatchResult } from "~/routes/dispatch";

const LAST_DIR_KEY = "seamux:last-dir";
const PROMPT_KEY = "seamux:dispatch:prompt";
const CWD_KEY = "seamux:dispatch:cwd";
const WORKTREE_KEY = "seamux:dispatch:worktree";
const ENGINE_KEY = "seamux:dispatch:engine";

function readLastDir(): string {
  try {
    return localStorage.getItem(LAST_DIR_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeLastDir(dir: string) {
  try {
    localStorage.setItem(LAST_DIR_KEY, dir);
  } catch {}
}

// The primary action: start new work as its own session, in a chosen
// directory, instead of cramming another goal into an existing chat.
export function DispatchBar({
  directories,
  worktreeByDefault,
  defaultEngine,
  engines,
  onDispatched,
}: {
  // The configured directories; empty means offer every one seamux finds.
  directories: string[];
  worktreeByDefault: boolean;
  defaultEngine: Engine;
  // Which agents this Mac can launch.
  engines: Record<Engine, boolean>;
  // Called once a dispatch has started; a failure doesn't call it.
  onDispatched?: () => void;
}) {
  const dispatcher = useFetcher<DispatchResult>();
  const submitKey = useSubmitKey();
  const dirs = useFetcher<{ directories: string[] }>();
  const [prompt, setPrompt] = useSessionStorage(PROMPT_KEY, "");
  const [cwd, setCwd] = useSessionStorage(CWD_KEY, "");
  // Starts from the configured default; a tick changed here holds for the
  // tab, until the default itself changes.
  const [worktree, setWorktree] = useSessionStorage(
    WORKTREE_KEY,
    worktreeByDefault,
  );
  const lastDefault = useRef(worktreeByDefault);
  useEffect(() => {
    if (lastDefault.current === worktreeByDefault) return;
    lastDefault.current = worktreeByDefault;
    setWorktree(worktreeByDefault);
  }, [worktreeByDefault, setWorktree]);
  // The agent, the same way: the configured default until changed here.
  const [engine, setEngine] = useSessionStorage<Engine>(
    ENGINE_KEY,
    defaultEngine,
  );
  const lastEngine = useRef(defaultEngine);
  useEffect(() => {
    if (lastEngine.current === defaultEngine) return;
    lastEngine.current = defaultEngine;
    setEngine(defaultEngine);
  }, [defaultEngine, setEngine]);
  const available = ENGINES.filter((e) => engines[e]);
  // One remembered from before it was uninstalled falls back to one that is.
  const chosen = engines[engine] ? engine : (available[0] ?? "claude");
  const handled = useRef<DispatchResult | undefined>(undefined);
  // The prompt is cleared, from state and storage, as it is sent, so a
  // reload mid-dispatch can't bring it back; a failure puts it back.
  const sent = useRef("");
  // The new chat shows in Working as it is sent, until the board lists it.
  const { spawn, started } = useOptimistic();
  const spawning = useRef("");
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  // Files pasted, dropped or picked, held until the dispatch starts, like a
  // chat's. Only those whose label is still in the prompt go with it; they
  // don't outlast a reload, which leaves only their labels.
  const [held, setHeld] = useState<Attachment[]>([]);
  const attachments = held.filter((a) => prompt.includes(a.label));
  const [attachError, setAttachError] = useState<string | null>(null);
  const attach = (files: File[]) => {
    const { fit, error } = fitAttachments(files, attachments.length);
    setAttachError(error);
    if (fit.length === 0) return;
    let n = held.reduce((max, a) => Math.max(max, a.n), 0);
    const added = fit.map((file) => {
      const kind = kindOf(file.type);
      n += 1;
      const label = attachmentLabel(kind, n);
      return { label, n, kind, file, url: URL.createObjectURL(file) };
    });
    setHeld((list) => [...list, ...added]);
    const el = promptRef.current;
    const { text, caret } = insertLabels(
      prompt,
      el?.selectionStart ?? prompt.length,
      el?.selectionEnd ?? prompt.length,
      added.map((a) => a.label),
    );
    setPrompt(text);
    requestAnimationFrame(() => el?.setSelectionRange(caret, caret));
  };
  const detach = (label: string) => {
    setPrompt((p) => p.replace(`${label} `, "").replace(label, ""));
    setHeld((list) =>
      list.filter((a) => {
        if (a.label !== label) return true;
        URL.revokeObjectURL(a.url);
        return false;
      }),
    );
  };
  const heldNow = useRef(held);
  heldNow.current = held;
  useEffect(
    () => () => heldNow.current.forEach((a) => URL.revokeObjectURL(a.url)),
    [],
  );

  // An unsent directory from before a reload wins over the last one used.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(CWD_KEY) !== null) return;
    } catch {}
    setCwd(readLastDir());
  }, [setCwd]);

  const promptNow = useRef(prompt);
  promptNow.current = prompt;
  const pending = dispatcher.state !== "idle";
  const result = dispatcher.data;
  useEffect(() => {
    if (pending || !result || handled.current === result) return;
    handled.current = result;
    started(spawning.current, result.ok ? result.sessionId : null);
    if (result.ok) {
      toast.success(
        `Started “${sent.current.trim().split("\n")[0].slice(0, 80)}”`,
        { description: "It is in Working, and fills in once it is up." },
      );
      // What was sent goes; what a prompt written since holds stays.
      setHeld((list) =>
        list.filter((a) => {
          if (promptNow.current.includes(a.label)) return true;
          URL.revokeObjectURL(a.url);
          return false;
        }),
      );
      releaseFocus("dispatch:prompt");
      writeLastDir(cwd);
      onDispatched?.();
    } else {
      setPrompt((p) => p || sent.current);
    }
  }, [pending, result, cwd, setPrompt, onDispatched, started]);

  const loadDirs = () => {
    if (directories.length === 0 && dirs.state === "idle" && !dirs.data)
      dirs.load("/directories");
  };
  const options =
    directories.length > 0 ? directories : (dirs.data?.directories ?? []);

  const canDispatch = !pending && prompt.trim() !== "" && cwd.trim() !== "";
  const submit = () => {
    if (!canDispatch) return;
    sent.current = prompt;
    setPrompt("");
    spawning.current = spawn({
      name: prompt.trim(),
      cwd: cwd.trim(),
      intent: prompt.trim(),
      engine: chosen,
      forked: false,
    });
    // Attachments go as files, each with the label it has in the prompt.
    const form = new FormData();
    form.set("prompt", prompt);
    form.set("cwd", cwd.trim());
    form.set("engine", chosen);
    if (worktree) form.set("worktree", "on");
    for (const a of attachments) {
      form.append("attachment", a.file);
      form.append("attachmentLabel", a.label);
    }
    dispatcher.submit(form, {
      method: "post",
      action: "/dispatch",
      encType: "multipart/form-data",
    });
  };

  return (
    <section className="flex flex-col gap-2 rounded-xl border bg-card p-2 shadow-sm transition-shadow focus-within:border-ring/60 focus-within:ring-3 focus-within:ring-ring/15">
      <Textarea
        ref={promptRef}
        data-focus-key="dispatch:prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        // Files on the clipboard or dropped in are attached; a paste of
        // anything else is text as usual.
        onPaste={(e) => {
          const files = [...e.clipboardData.files];
          if (files.length === 0) return;
          e.preventDefault();
          attach(files);
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          const files = [...e.dataTransfer.files];
          if (files.length === 0) return;
          e.preventDefault();
          attach(files);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={`Dispatch new work: what should a new session do?${keyHint(submitKey)}`}
        rows={2}
        className="sensitive min-h-0 resize-y border-0 bg-transparent text-base max-md:min-h-48 shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <AttachmentChips attachments={attachments} onDetach={detach} />
      {/* One row from md: the agent, the directory taking what room there
          is and the worktree box, then, well apart, the paperclip and
          Dispatch. Below md the directory and the worktree box take the
          first line, and the agent the second, with the paperclip and
          Dispatch at its far end. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {available.length > 1 && (
          <select
            value={chosen}
            onChange={(e) => setEngine(e.target.value as Engine)}
            title="The agent the new session runs"
            className="order-3 shrink-0 rounded-lg border bg-background py-1.5 pr-3 pl-2 text-sm md:order-none"
          >
            {available.map((e) => (
              <option key={e} value={e}>
                {ENGINE_LABELS[e]}
              </option>
            ))}
          </select>
        )}
        <DirectoryPicker
          data-focus-key="dispatch:cwd"
          value={cwd}
          onValueChange={setCwd}
          options={options}
          onFocus={loadDirs}
          onPicked={() => promptRef.current?.focus()}
          placeholder="/dir pick"
          className="order-1 min-w-0 flex-1 md:order-none"
          inputClassName="sensitive text-sm"
        />
        <label className="order-2 flex shrink-0 cursor-pointer items-center gap-2 text-sm text-muted-foreground md:order-none">
          <input
            type="checkbox"
            checked={worktree}
            onChange={(e) => setWorktree(e.target.checked)}
            className="size-4 cursor-pointer accent-brand-primary"
          />
          Worktree
        </label>
        {/* Ends the first line below md. */}
        <div className="order-2 h-0 basis-full md:hidden" />
        <div className="order-4 ml-auto flex items-center gap-2 md:order-none md:ml-9">
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
          {/* A bare paperclip beside the rest; labelled once it has a line
              of its own. */}
          <Button
            variant="ghost"
            className="md:size-8 md:px-0"
            disabled={attachments.length >= MAX_ATTACHMENTS}
            onClick={() => picker.current?.click()}
            title="Attach files or images"
            aria-label="Attach files or images"
          >
            <Paperclip />
            <span className="md:hidden">Attach</span>
          </Button>
          <Button
            disabled={!canDispatch}
            onClick={submit}
            className="bg-brand-ramp text-brand-foreground shadow-sm hover:opacity-90"
          >
            <SendHorizontal />
            {pending ? "Starting…" : "Dispatch"}
          </Button>
        </div>
      </div>
      {attachError && (
        <p className="px-1 text-sm text-destructive">{attachError}</p>
      )}
      {result && !pending && !result.ok && (
        <p className="px-1 text-sm text-destructive">{result.error}</p>
      )}
    </section>
  );
}
