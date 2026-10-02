import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";
import {
  ChevronRight,
  Plus,
  RotateCcw,
  Save,
  Send,
  Settings,
  X,
} from "lucide-react";

import { DirectoryPicker } from "~/components/directory-picker";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Textarea } from "~/components/ui/textarea";
import {
  DEFAULT_MACROS,
  ENGINE_LABELS,
  ENGINES,
  MACRO_NAMES,
  MACROS,
  type Config,
  type Engine,
  type MacroName,
} from "~/lib/config";
import type { RemoteStatus } from "~/lib/remote.server";
import type { Notifications } from "~/components/waiting-alerts";
import type { Blur } from "~/lib/use-blur";
import type { Diagnostics } from "~/lib/use-diagnostics";
import { cn } from "~/lib/utils";
import type { ConfigResult } from "~/routes/config";

const TABS = [
  { key: "general", label: "General" },
  { key: "macros", label: "Macros" },
  { key: "remote", label: "Remote" },
  { key: "debug", label: "Debug" },
] as const;
type Tab = (typeof TABS)[number]["key"];

// Posts one config change. The board's loader re-runs after it, which is
// how the dialog sees the new config. onSaved hears each change that saved,
// with the fields it was sent with.
function useConfigAction(onSaved?: (fields: Record<string, string>) => void) {
  const fetcher = useFetcher<ConfigResult>();
  const sent = useRef<Record<string, string>>({});
  const handled = useRef<ConfigResult | undefined>(undefined);
  const saved = useRef(onSaved);
  saved.current = onSaved;
  useEffect(() => {
    const result = fetcher.data;
    if (fetcher.state !== "idle" || !result || handled.current === result)
      return;
    handled.current = result;
    if (result.ok) saved.current?.(sent.current);
  }, [fetcher.state, fetcher.data]);
  return {
    submit: (intent: string, fields: Record<string, string> = {}) => {
      sent.current = fields;
      fetcher.submit(
        { intent, ...fields },
        { method: "post", action: "/config" },
      );
    },
    pending: fetcher.state !== "idle",
    ok: fetcher.state === "idle" && fetcher.data?.ok === true,
    error: fetcher.state === "idle" ? (fetcher.data?.error ?? null) : null,
  };
}

// The cog in the header, and the dialog it opens: seamux's own settings.
export function ConfigDialog({
  config,
  engines,
  remote,
  notifications,
  diagnostics,
  blur,
}: {
  config: Config;
  // Which agents this Mac can launch.
  engines: Record<Engine, boolean>;
  remote: RemoteStatus;
  notifications: Notifications;
  diagnostics: Diagnostics;
  blur: Blur;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("general");
  return (
    <>
      <Button
        size="icon-xs"
        variant="ghost"
        title="Configure seamux"
        aria-label="Configure seamux"
        onClick={() => setOpen(true)}
      >
        <Settings />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="h-[min(40rem,calc(100dvh-2rem))] grid-rows-[auto_auto_minmax(0,1fr)] sm:max-w-2xl max-md:h-dvh! max-md:max-w-none! max-md:rounded-none max-md:pt-[max(1rem,env(safe-area-inset-top))] max-md:pb-[max(1rem,env(safe-area-inset-bottom))] max-md:ring-0">
          <DialogHeader>
            <DialogTitle>Configure seamux</DialogTitle>
            <DialogDescription>
              Kept in seamux's store, and applied as soon as you change it.
            </DialogDescription>
          </DialogHeader>
          <div
            role="tablist"
            className="flex gap-1 overflow-x-auto border-b [scrollbar-width:none]"
          >
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "-mb-px shrink-0 cursor-pointer border-b-2 px-3 py-1.5 text-sm",
                  tab === t.key
                    ? "border-foreground font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="-mx-4 overflow-y-auto px-4 pb-1">
            {tab === "general" ? (
              <GeneralTab
                config={config}
                engines={engines}
                notifications={notifications}
              />
            ) : tab === "macros" ? (
              <MacrosTab config={config} />
            ) : tab === "remote" ? (
              <RemoteTab remote={remote} />
            ) : (
              <DebugTab diagnostics={diagnostics} blur={blur} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function GeneralTab({
  config,
  engines,
  notifications,
}: {
  config: Config;
  engines: Record<Engine, boolean>;
  notifications: Notifications;
}) {
  return (
    <div className="flex flex-col gap-6">
      <EngineSetting current={config.defaultEngine} installed={engines} />
      <WorktreeSetting on={config.worktreeByDefault} />
      <NotificationSetting {...notifications} />
      {/* Last, since the list can grow long. */}
      <DirectoriesSetting directories={config.directories} />
    </div>
  );
}

function DirectoriesSetting({ directories }: { directories: string[] }) {
  const adder = useConfigAction();
  const remover = useConfigAction();
  const discovered = useFetcher<{ directories: string[] }>();
  const [path, setPath] = useState("");
  const wasPending = useRef(false);

  // Clear the box once an add succeeds.
  useEffect(() => {
    if (wasPending.current && !adder.pending && adder.ok) setPath("");
    wasPending.current = adder.pending;
  }, [adder.pending, adder.ok]);

  const suggestions = (discovered.data?.directories ?? []).filter(
    (d) => !directories.includes(d),
  );
  const add = () => {
    if (path.trim()) adder.submit("add-directory", { path: path.trim() });
  };

  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium">Directories</h3>
      <p className="text-muted-foreground">
        What the dispatch bar's directory picker offers. With none listed, it
        offers every directory seamux can find: live sessions, past dispatches,
        and repos under your code folders.
      </p>
      {directories.length > 0 && (
        <ul className="flex flex-col divide-y rounded-lg border">
          {directories.map((d) => (
            <li key={d} className="flex items-center gap-2 px-2 py-1">
              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                {d}
              </span>
              <Button
                size="icon-xs"
                variant="ghost"
                title="Remove from the picker"
                aria-label={`Remove ${d}`}
                disabled={remover.pending}
                onClick={() => remover.submit("remove-directory", { path: d })}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <DirectoryPicker
          value={path}
          onValueChange={setPath}
          options={suggestions}
          onFocus={() => {
            if (discovered.state === "idle" && !discovered.data)
              discovered.load("/directories?discovered");
          }}
          placeholder="/path/to/project"
          className="flex-1"
          inputClassName="text-xs"
        />
        <Button
          type="submit"
          size="sm"
          disabled={adder.pending || !path.trim()}
        >
          <Plus />
          Add
        </Button>
      </form>
      {(adder.error ?? remover.error) && (
        <p className="text-destructive">{adder.error ?? remover.error}</p>
      )}
    </section>
  );
}

function EngineSetting({
  current,
  installed,
}: {
  current: Engine;
  installed: Record<Engine, boolean>;
}) {
  const action = useConfigAction();
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium">Default agent</h3>
      <p className="text-muted-foreground">
        What the dispatch bar starts new sessions with, through cmux. You can
        still pick another for a single dispatch. Fan-out workers always run
        Claude Code.
      </p>
      <div role="radiogroup" className="flex flex-wrap gap-2">
        {ENGINES.map((e) => (
          <label
            key={e}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-1.5",
              installed[e]
                ? "cursor-pointer"
                : "cursor-not-allowed text-muted-foreground",
              current === e && "border-foreground",
            )}
            title={installed[e] ? undefined : "Not found on this Mac"}
          >
            <input
              type="radio"
              name="default-engine"
              checked={current === e}
              disabled={!installed[e] || action.pending}
              onChange={() => action.submit("default-engine", { engine: e })}
            />
            {ENGINE_LABELS[e]}
            {!installed[e] && <span className="text-xs">not installed</span>}
          </label>
        ))}
      </div>
      {action.error && <p className="text-destructive">{action.error}</p>}
    </section>
  );
}

function WorktreeSetting({ on }: { on: boolean }) {
  const action = useConfigAction();
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium">Worktrees</h3>
      <label className="flex cursor-pointer items-start gap-2">
        <Switch
          className="mt-0.5"
          checked={on}
          disabled={action.pending}
          onCheckedChange={(checked) =>
            action.submit("worktree-default", { on: String(checked) })
          }
        />
        <span>
          Use worktrees by default
          <span className="block text-muted-foreground">
            The dispatch bar's "new worktree" switch starts on, so dispatched
            work gets its own worktree unless you turn it off.
          </span>
        </span>
      </label>
      {action.error && <p className="text-destructive">{action.error}</p>}
    </section>
  );
}

// Kept in this browser rather than the store, since the permission is the
// browser's to give.
function NotificationSetting({ enabled, permission, toggle }: Notifications) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium">Notifications</h3>
      <SwitchRow
        checked={enabled}
        disabled={permission === "unsupported" || permission === "denied"}
        onCheckedChange={() => void toggle()}
        label="Desktop notifications"
      >
        {permission === "unsupported"
          ? "This browser can't notify from this address. Browsers only allow it on a secure origin: open the board on localhost or through the tunnel."
          : permission === "denied"
            ? "Notifications are blocked for this site. Allow them in the browser's site settings, then turn this on."
            : "Notify when a chat starts waiting while the board isn't the focused window. Kept in this browser only."}
      </SwitchRow>
    </section>
  );
}

function DebugTab({
  diagnostics,
  blur,
}: {
  diagnostics: Diagnostics;
  blur: Blur;
}) {
  const action = useConfigAction();
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h3 className="font-medium">Screenshots</h3>
        <SwitchRow
          checked={blur.enabled}
          disabled={false}
          onCheckedChange={blur.setEnabled}
          label="Blur cards for screenshots"
        >
          Blurs what each chat says, where it runs and when: names, paths,
          branches, how long ago, prompts, replies, questions and open files,
          leaving the board's
          layout, columns and controls readable. For sharing a screenshot or
          attaching one to a bug report. Kept in this browser only.
        </SwitchRow>
      </section>
      <DiagnosticsSetting {...diagnostics} />
      <section className="flex flex-col gap-2">
        <h3 className="font-medium">Autocomplete</h3>
        <p className="text-muted-foreground">
          Slash commands are listed once per folder and kept for ten minutes,
          or until <code>/reload-skills</code> is sent from the board. Clear
          them to list every folder's commands again the next time you type{" "}
          <code>/</code>.
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={action.pending}
            onClick={() => action.submit("clear-commands")}
          >
            <RotateCcw />
            Clear autocomplete cache
          </Button>
          {action.ok && <span className="text-muted-foreground">Cleared</span>}
        </div>
        {action.error && <p className="text-destructive">{action.error}</p>}
      </section>
    </div>
  );
}

// Kept in this browser: it is this browser's layout that is being looked at.
function DiagnosticsSetting({ enabled, setEnabled, send, last }: Diagnostics) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium">Diagnostics</h3>
      <SwitchRow
        checked={enabled}
        disabled={false}
        onCheckedChange={setEnabled}
        label="Send layout diagnostics from this browser"
      >
        A snapshot of the screen size, media queries, stylesheets, and every
        column's and card's size and computed style, sent when the board loads,
        when the window is resized or turned, and on demand. Saved on the Mac
        in <code>data/diagnostics/</code>, for triage from a phone.
      </SwitchRow>
      {enabled && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={send}>
            <Send />
            Send now
          </Button>
          {last && (
            <span
              className={last.error ? "text-destructive" : "text-muted-foreground"}
            >
              {last.error
                ? `Failed at ${last.at}: ${last.error}`
                : `Sent at ${last.at}`}
            </span>
          )}
        </div>
      )}
      <p className="text-muted-foreground">
        Stuck on old code, or an error page after a restart?{" "}
        <a href="/reset" className="underline hover:text-foreground">
          Clear this browser's cache for the board
        </a>
        . Drafts and settings are kept.
      </p>
      {enabled && last && (
        <pre className="max-h-64 overflow-auto rounded-md border bg-muted/50 px-2 py-1 font-mono text-[11px] leading-snug">
          {JSON.stringify(last.snapshot, null, 2)}
        </pre>
      )}
    </section>
  );
}

function MacrosTab({ config }: { config: Config }) {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground">
        System macros are prompts the dispatcher sends into a session for you.{" "}
        <code>{"{{name}}"}</code> is filled in when it is sent.
      </p>
      {MACRO_NAMES.map((name) => (
        // Keyed on the saved text, so a save or reset starts a fresh draft.
        <MacroEditor
          key={`${name}:${config.macros[name].text}`}
          name={name}
          saved={config.macros[name].text}
          custom={config.macros[name].custom}
        />
      ))}
    </div>
  );
}

function MacroEditor({
  name,
  saved,
  custom,
}: {
  name: MacroName;
  saved: string;
  custom: boolean;
}) {
  const info = MACROS[name];
  const action = useConfigAction();
  const [draft, setDraft] = useState(saved);
  const dirty = draft !== saved;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 font-medium">
        {info.label}
        <span className="text-xs font-normal text-muted-foreground">
          {custom ? "customised" : "default"}
        </span>
      </h3>
      <p className="text-muted-foreground">{info.when}</p>
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={Math.min(12, Math.max(3, draft.split("\n").length + 1))}
        className="font-mono text-xs"
      />
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {info.variables.map((v) => (
          <li key={v.name}>
            <code className="text-foreground">{`{{${v.name}}}`}</code>{" "}
            {v.meaning}
            {info.required === v.name && " (required)"}
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!dirty || action.pending}
          onClick={() => action.submit("save-macro", { name, text: draft })}
        >
          <Save />
          Save
        </Button>
        {dirty && (
          <Button size="sm" variant="ghost" onClick={() => setDraft(saved)}>
            Discard changes
          </Button>
        )}
        {(custom || draft !== DEFAULT_MACROS[name]) && (
          <Button
            size="sm"
            variant="ghost"
            disabled={action.pending}
            onClick={() => {
              setDraft(DEFAULT_MACROS[name]);
              if (custom) action.submit("reset-macro", { name });
            }}
          >
            <RotateCcw />
            Reset to default
          </Button>
        )}
        {action.error && (
          <span className="text-destructive">{action.error}</span>
        )}
      </div>
    </section>
  );
}

// A switch with its label and a caption beneath, as a label so the whole row
// toggles it.
function SwitchRow({
  checked,
  disabled,
  onCheckedChange,
  label,
  children,
}: {
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex items-start gap-2",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
      )}
    >
      <Switch
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
      <span>
        {label}
        <span className="block text-muted-foreground">{children}</span>
      </span>
    </label>
  );
}

// Every switch here turns on only from this Mac, and off from anywhere.
function RemoteTab({ remote }: { remote: RemoteStatus }) {
  const action = useConfigAction();
  const local = !remote.viaTunnel && !remote.mdns.viaLan;
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h3 className="font-medium">Remote connections</h3>
        <SwitchRow
          checked={remote.enabled}
          disabled={(!remote.enabled && !local) || action.pending}
          onCheckedChange={(checked) =>
            action.submit("remote", { on: String(checked) })
          }
          label="Enable remote connections"
        >
          Lets other devices reach the board, over your network with mDNS or
          from anywhere through a Cloudflare tunnel, or both. Off, or with
          neither on, it answers only this Mac, at localhost, 127.0.0.1 or
          [::1]. It can only be turned on from this Mac, and turns off from
          anywhere.
          {!local &&
            " You're viewing this remotely, so turning it off disconnects this page."}
        </SwitchRow>
        {action.error && <p className="text-destructive">{action.error}</p>}
      </section>
      {remote.enabled && (
        <>
          <MdnsSetting remote={remote} local={local} />
          <TunnelSetting remote={remote} local={local} />
        </>
      )}
    </div>
  );
}

function MdnsSetting({
  remote,
  local,
}: {
  remote: RemoteStatus;
  local: boolean;
}) {
  const action = useConfigAction(({ on }) =>
    on === "true" ? toast.success("mDNS enabled") : toast("mDNS disabled"),
  );
  const { mdns } = remote;
  const host = new URL(mdns.url).hostname;
  let state: string;
  if (!mdns.secured) {
    state = `Set SEAMUX_USER and SEAMUX_PASS in ${remote.home}/.env first.`;
  } else if (!mdns.wanted) state = "Off.";
  else if (mdns.listening) state = "On: listening on the network.";
  else if (remote.supervised)
    state = "Restarting the board to listen on the network…";
  else state = "On, but the board needs restarting to listen on the network.";
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium">mDNS</h3>
      <SwitchRow
        checked={mdns.wanted}
        disabled={(!mdns.wanted && (!local || !mdns.secured)) || action.pending}
        onCheckedChange={(checked) =>
          action.submit("mdns", { on: String(checked) })
        }
        label="Enable mDNS"
      >
        This Mac is reachable at{" "}
        <a href={mdns.url} className="font-mono text-xs underline">
          {host}
        </a>
        . Turning this on lets the board accept more than the 127.0.0.1
        loopback: it listens on every network this Mac joins, and restarts to do
        so. Every request is asked for SEAMUX_USER and SEAMUX_PASS, which
        plain HTTP sends unencrypted, so use it on networks you trust.{" "}
        {state}
        {mdns.viaLan &&
          " You're viewing this over the network, so turning it off disconnects this page."}
      </SwitchRow>
      {action.error && <p className="text-destructive">{action.error}</p>}
    </section>
  );
}

function TunnelSetting({
  remote,
  local,
}: {
  remote: RemoteStatus;
  local: boolean;
}) {
  const action = useConfigAction(({ on }) =>
    on === "true"
      ? toast.success("Cloudflare Tunnel enabled")
      : toast("Cloudflare Tunnel disabled"),
  );
  const configured = remote.missing.length === 0;
  const url = remote.domain ? `https://${remote.domain}` : null;
  const canToggle = remote.wanted || (configured && local);
  let state: string;
  if (!remote.wanted) state = "Off.";
  else if (remote.pid) state = `On: cloudflared is running, pid ${remote.pid}.`;
  else if (!remote.supervised) {
    state =
      "On, but no supervisor is running to start cloudflared. Start the board with npm run seamux.";
  } else state = "Starting cloudflared…";
  return (
    // Open to begin with once any of its variables is set.
    <details open={remote.cfSet} className="group flex flex-col">
      <summary className="flex cursor-pointer list-none items-center gap-1 font-medium [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
        Enable Cloudflare Tunnel
        <span className="text-xs font-normal text-muted-foreground">
          {remote.wanted ? "on" : "off"}
        </span>
      </summary>
      <div className="mt-2 flex flex-col gap-4">
        <p className="text-muted-foreground">
          Opens the board at your Cloudflare tunnel's hostname, behind
          Cloudflare Access. Through the tunnel the board asks for no password
          of its own: it checks every request's Access token instead, and
          refuses any request without a valid one, so it stays shut even if the
          Access application is removed. The tunnel's hostname is answered
          only for cloudflared, on this Mac, even with mDNS on.
        </p>
        <SwitchRow
          checked={remote.wanted}
          disabled={!canToggle || action.pending}
          onCheckedChange={(checked) =>
            action.submit("tunnel", { on: String(checked) })
          }
          label={
            url ? (
              <>
                Serve the board at{" "}
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs underline"
                >
                  {url}
                </a>
              </>
            ) : (
              "Serve the board through the tunnel"
            )
          }
        >
          {state}
          {remote.viaTunnel &&
            " You're viewing this through the tunnel, so turning it off disconnects this page."}
        </SwitchRow>
        {action.error && <p className="text-destructive">{action.error}</p>}
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground">
            Read from <code>{remote.home}/.env</code> or the environment.
            cloudflared writes its log to <code>data/tunnel.log</code> there.
          </p>
          <ul className="flex flex-col divide-y rounded-lg border text-xs">
            {REMOTE_VARIABLES.map((v) => {
              const unset = remote.missing.includes(v.name);
              return (
                <li
                  key={v.name}
                  className="flex items-baseline gap-2 px-2 py-1"
                >
                  <code className="shrink-0">{v.name}</code>
                  <span className="min-w-0 flex-1 text-muted-foreground">
                    {v.meaning}
                  </span>
                  <span className={cn("shrink-0", unset && "text-destructive")}>
                    {unset ? "unset" : "set"}
                  </span>
                </li>
              );
            })}
          </ul>
          {remote.tunnel && (
            <p className="text-xs text-muted-foreground">
              Tunnel <code>{remote.tunnel}</code>
            </p>
          )}
        </div>
      </div>
    </details>
  );
}

const REMOTE_VARIABLES = [
  { name: "SEAMUX_CF_TOKEN", meaning: "the tunnel's token, from Zero Trust" },
  { name: "SEAMUX_CF_DOMAIN", meaning: "its public hostname" },
  {
    name: "SEAMUX_CF_TEAM",
    meaning: "your Zero Trust team, e.g. myteam.cloudflareaccess.com",
  },
  { name: "SEAMUX_CF_AUD", meaning: "the Access application's AUD tag" },
];
