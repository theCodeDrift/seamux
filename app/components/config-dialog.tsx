import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";
import {
  Check,
  ChevronRight,
  Download,
  Ellipsis,
  Minus,
  Plus,
  RotateCcw,
  Save,
  Send,
  Settings,
  Trash2,
  Upload,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
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
import {
  COLOUR_FUNCTIONS,
  DEFAULT_THEME,
  NEW_THEME_LIGHT,
  parseThemeInput,
  printTheme,
  readThemeFile,
  THEME_NAME,
  themeFile,
} from "~/lib/theme";
import type { ThemeStatus } from "~/lib/theme.server";
import { previewColor, previewTheme } from "~/lib/use-theme";
import type { Notifications } from "~/components/waiting-alerts";
import {
  DEFAULT_TRIGGER,
  MAX_TRIGGER_PHRASE,
  MAX_TRIGGER_SECONDS,
  MIN_TRIGGER_SECONDS,
  type TriggerPhrase,
} from "~/lib/trigger-phrase";
import type { Blur } from "~/lib/use-blur";
import type { Diagnostics } from "~/lib/use-diagnostics";
import { cn } from "~/lib/utils";
import type { ConfigResult } from "~/routes/config";

const TABS = [
  { key: "general", label: "General" },
  { key: "macros", label: "Macros" },
  { key: "themes", label: "Themes" },
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
  theme,
  notifications,
  diagnostics,
  blur,
}: {
  config: Config;
  // Which agents this Mac can launch.
  engines: Record<Engine, boolean>;
  remote: RemoteStatus;
  theme: ThemeStatus;
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
          {/* The Themes tab fills it, and scrolls its list and editor
              instead; it scrolls only when the window is too short even
              for those. */}
          <div
            className={cn(
              "-mx-4 overflow-y-auto px-4 pb-1",
              tab === "themes" && "flex flex-col",
            )}
          >
            {tab === "general" ? (
              <GeneralTab
                config={config}
                engines={engines}
                notifications={notifications}
              />
            ) : tab === "macros" ? (
              <MacrosTab config={config} />
            ) : tab === "themes" ? (
              <ThemesTab
                theme={theme}
                local={!remote.viaTunnel && !remote.mdns.viaLan}
              />
            ) : tab === "remote" ? (
              <RemoteTab remote={remote} />
            ) : (
              <DebugTab
                diagnostics={diagnostics}
                blur={blur}
                themes={theme.themes.length}
              />
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
      <TriggerSetting trigger={config.triggerPhrase} />
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

function TriggerSetting({ trigger }: { trigger: TriggerPhrase }) {
  const action = useConfigAction();
  const [phrase, setPhrase] = useState(trigger.phrase);
  const [seconds, setSeconds] = useState(String(trigger.seconds));
  // Follows the saved value once it changes, as after a reset.
  useEffect(() => {
    setPhrase(trigger.phrase);
    setSeconds(String(trigger.seconds));
  }, [trigger.phrase, trigger.seconds]);
  const changed =
    phrase !== trigger.phrase || seconds !== String(trigger.seconds);
  const isDefault =
    trigger.phrase === DEFAULT_TRIGGER.phrase &&
    trigger.seconds === DEFAULT_TRIGGER.seconds;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium">Trigger phrase</h3>
      <p className="text-muted-foreground">
        A prompt in the dispatch bar, or a reply in a chat, that you type to end
        in this phrase goes on its own once it has stayed that way for the wait,
        so a dictated message can be sent by saying so. The phrase itself isn't
        sent, and case and punctuation don't count. The send button counts down
        meanwhile; any edit starts it over, and taking the phrase off stops it.
        Leave it empty to turn this off.
      </p>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          action.submit("trigger-phrase", { phrase, seconds });
        }}
      >
        <input
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          maxLength={MAX_TRIGGER_PHRASE}
          placeholder="Off"
          aria-label="Trigger phrase"
          className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1 text-sm"
        />
        <label className="flex items-center gap-1 text-muted-foreground">
          <input
            type="number"
            inputMode="numeric"
            min={MIN_TRIGGER_SECONDS}
            max={MAX_TRIGGER_SECONDS}
            step={1}
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
            aria-label="Seconds to wait"
            className="w-16 rounded-md border bg-transparent px-2 py-1 text-sm text-foreground"
          />
          seconds
        </label>
        <Button type="submit" size="sm" disabled={action.pending || !changed}>
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={action.pending || isDefault}
          onClick={() =>
            action.submit("trigger-phrase", {
              phrase: DEFAULT_TRIGGER.phrase,
              seconds: String(DEFAULT_TRIGGER.seconds),
            })
          }
        >
          Reset
        </Button>
      </form>
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
  themes,
}: {
  diagnostics: Diagnostics;
  blur: Blur;
  themes: number;
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
          leaving the board's layout, columns and controls readable. For sharing
          a screenshot or attaching one to a bug report. Kept in this browser
          only.
        </SwitchRow>
      </section>
      <DiagnosticsSetting {...diagnostics} />
      <section className="flex flex-col gap-2">
        <h3 className="font-medium">Autocomplete</h3>
        <p className="text-muted-foreground">
          Slash commands are listed once per folder and kept for ten minutes, or
          until <code>/reload-skills</code> is sent from the board. Clear them
          to list every folder's commands again the next time you type{" "}
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
      <ClearThemesSetting themes={themes} />
    </div>
  );
}

// Asks once more before it goes, since saved themes can't be had back.
function ClearThemesSetting({ themes }: { themes: number }) {
  const action = useConfigAction(() => setConfirming(false));
  const [confirming, setConfirming] = useState(false);
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium">Themes</h3>
      <p className="text-muted-foreground">
        Removes every saved theme and puts the board back on seamux's own.
      </p>
      <div className="flex items-center gap-2">
        {confirming ? (
          <>
            <Button
              variant="destructive"
              size="sm"
              disabled={action.pending}
              onClick={() => action.submit("clear-themes")}
            >
              <Trash2 />
              Remove {themes} {themes === 1 ? "theme" : "themes"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={themes === 0}
            onClick={() => setConfirming(true)}
          >
            <Trash2 />
            Clear all themes
          </Button>
        )}
      </div>
      {action.error && <p className="text-destructive">{action.error}</p>}
    </section>
  );
}

// Turns on only from this Mac, and off from anywhere.
function ThemeSetSetting({
  swap,
  local,
}: {
  swap: ThemeStatus["swap"];
  local: boolean;
}) {
  const action = useConfigAction();
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium">Set the theme from a script</h3>
      <SwitchRow
        checked={swap.on}
        disabled={(!swap.on && !local) || action.pending}
        onCheckedChange={(checked) =>
          action.submit("theme-set", { on: String(checked) })
        }
        label="Allow POST /theme/set"
      >
        From this Mac or over mDNS, never the tunnel. Turns on only from this
        Mac.
      </SwitchRow>
      {swap.on && (
        <pre className="overflow-x-auto rounded-md border bg-muted/50 px-2 py-1 font-mono text-[11px]">
          {`curl -u <user>:<password> -H 'content-type: application/json' -d '{"name": "<theme>", "color": "light"}' ${origin}/theme/set`}
        </pre>
      )}
      {action.error && <p className="text-destructive">{action.error}</p>}
    </section>
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
        when the window is resized or turned, and on demand. Saved on the Mac in{" "}
        <code>data/diagnostics/</code>, for triage from a phone.
      </SwitchRow>
      {enabled && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={send}>
            <Send />
            Send now
          </Button>
          {last && (
            <span
              className={
                last.error ? "text-destructive" : "text-muted-foreground"
              }
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
        so. Every request is asked for SEAMUX_USER and SEAMUX_PASS, which plain
        HTTP sends unencrypted, so use it on networks you trust. {state}
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
          Access application is removed. The tunnel's hostname is answered only
          for cloudflared, on this Mac, even with mDNS on.
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

// Saved themes on the left, seamux's own first; the chosen one's editor on
// the right. Kept in seamux's store and shown on every board. The chosen
// one is previewed on this browser until the tab closes; Make active shows
// it on every board.
function ThemesTab({ theme, local }: { theme: ThemeStatus; local: boolean }) {
  const [selected, setSelected] = useState<string | null>(theme.active.name);
  const [adding, setAdding] = useState(false);
  // A theme file's fields, for the new theme's editor to start from, and
  // what reading it left out.
  const [imported, setImported] = useState<{
    name: string;
    label: string;
    light: string;
    dark: string;
  } | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [importCount, setImportCount] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const importFile = async (file: File) => {
    const read = readThemeFile(await file.text(), file.name);
    if (!read.ok) {
      setImportNote(read.error);
      return;
    }
    const { skipped, ...fields } = read;
    setImported(fields);
    setImportNote(
      skipped.length > 0
        ? `Left out what this seamux can't use: ${skipped.join(", ")}`
        : null,
    );
    setImportCount((n) => n + 1);
    setAdding(true);
    setSelected(null);
  };
  const remover = useConfigAction(() => setSelected(DEFAULT_THEME));
  const current = theme.themes.find((t) => t.name === selected);
  const previewed =
    adding || (selected !== DEFAULT_THEME && !current) ? null : selected;
  useEffect(() => {
    previewTheme(previewed);
    return () => previewTheme(null);
  }, [previewed]);
  const pick = (name: string) => {
    setAdding(false);
    setSelected(name);
  };
  const entries = [
    { name: DEFAULT_THEME, label: "seamux" },
    ...theme.themes.map((t) => ({ name: t.name, label: t.label })),
  ];
  return (
    <div className="flex min-h-80 flex-1 flex-col gap-6">
      <div className="grid min-h-0 flex-1 gap-4 max-md:grid-rows-[minmax(5rem,10rem)_minmax(0,1fr)] md:grid-cols-[11rem_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col gap-2">
          <ul className="flex min-h-0 flex-1 flex-col divide-y overflow-y-auto rounded-lg border">
            {entries.map((t) => (
              <li key={t.name}>
                <button
                  type="button"
                  onClick={() => pick(t.name)}
                  className={cn(
                    "flex w-full cursor-pointer flex-col items-start px-2 py-1.5 text-left hover:bg-muted",
                    !adding && selected === t.name && "bg-muted",
                  )}
                >
                  <span className="flex w-full items-center gap-1">
                    <span className="min-w-0 flex-1 truncate">{t.label}</span>
                    {theme.active.name === t.name ? (
                      <span className="text-xs text-muted-foreground">
                        active
                      </span>
                    ) : (
                      previewed === t.name && (
                        <span className="text-xs text-muted-foreground">
                          preview
                        </span>
                      )
                    )}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {t.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {/* Each button's word shows where the list is wide enough for
              all three, as on a phone; in the narrow column, only + and −. */}
          <div className="@container">
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                aria-label="Add"
                title="Add a theme"
                onClick={() => {
                  setImported(null);
                  setImportNote(null);
                  setAdding(true);
                  setSelected(null);
                }}
              >
                <Plus />
                <span className="hidden @[17rem]:inline">Add</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                aria-label="Import"
                title="Import a theme file"
                onClick={() => fileInput.current?.click()}
              >
                <Upload />
                <span className="hidden @[17rem]:inline">Import</span>
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void importFile(file);
                }}
              />
              <Button
                size="sm"
                variant="ghost"
                aria-label="Remove"
                title="Remove this theme"
                disabled={!current || adding || remover.pending}
                onClick={() =>
                  current &&
                  remover.submit("remove-theme", { name: current.name })
                }
              >
                <Minus />
                <span className="hidden @[17rem]:inline">Remove</span>
              </Button>
            </div>
          </div>
          {remover.error && <p className="text-destructive">{remover.error}</p>}
          {importNote && (
            <p className="whitespace-pre-line text-xs text-muted-foreground">
              {importNote}
            </p>
          )}
        </div>
        {adding ? (
          <ThemeEditor
            key={`new:${importCount}`}
            name={null}
            saved={imported ?? { label: "", light: NEW_THEME_LIGHT, dark: "" }}
            suggestedName={imported?.name ?? ""}
            active={false}
            onSaved={pick}
          />
        ) : current ? (
          // Keyed on what's saved, so a save, or a change from another board,
          // starts a fresh draft.
          <ThemeEditor
            key={`${current.name}:${current.label}:${current.light}:${current.dark}`}
            name={current.name}
            saved={current}
            active={theme.active.name === current.name}
            onSaved={pick}
          />
        ) : (
          <BuiltInTheme active={theme.active.name === DEFAULT_THEME} />
        )}
      </div>
      <ThemeSetSetting swap={theme.swap} local={local} />
    </div>
  );
}

function BuiltInTheme({ active }: { active: boolean }) {
  const action = useConfigAction();
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium">seamux</h3>
      <p className="text-muted-foreground">
        seamux's own colours, from the mark's cyan to indigo. A theme needs only
        its two brand colours, <code>--brand-primary</code> and{" "}
        <code>--brand-secondary</code>: the rest of its palette is worked out
        from them, and anything else it sets replaces what was worked out. Leave
        out light or dark and it's made from the other's brand.
      </p>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={active || action.pending}
          onClick={() =>
            action.submit("activate-theme", { name: DEFAULT_THEME })
          }
        >
          <Check />
          {active ? "Active" : "Make active"}
        </Button>
      </div>
      {action.error && <p className="text-destructive">{action.error}</p>}
    </section>
  );
}

// Saves what's saved, not the draft, as <name>.seamux-theme.json.
function downloadThemeFile(
  name: string,
  saved: { label: string; light: string; dark: string },
) {
  const blob = new Blob([themeFile(name, saved)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.seamux-theme.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function ThemeEditor({
  name,
  saved,
  suggestedName = "",
  active,
  onSaved,
}: {
  // null for a theme not yet saved, which asks for its name.
  name: string | null;
  saved: { label: string; light: string; dark: string };
  // A new theme's name to start with, from a theme file.
  suggestedName?: string;
  active: boolean;
  onSaved: (name: string) => void;
}) {
  const saver = useConfigAction((fields) => onSaved(fields.name));
  const activator = useConfigAction();
  const [newName, setNewName] = useState(suggestedName);
  const [label, setLabel] = useState(saved.label);
  const [light, setLight] = useState(saved.light);
  const [dark, setDark] = useState(saved.dark);
  // Opens on the variant this browser shows, and previews whichever tab is
  // picked, light or dark, on this browser alone.
  const [mode, setMode] = useState<"light" | "dark">(() =>
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
      ? "dark"
      : "light",
  );
  useEffect(() => {
    if (name === null) return;
    previewColor(mode);
    return () => previewColor(null);
  }, [name, mode]);
  const [menu, setMenu] = useState(false);
  const themeName = name ?? newName.trim();
  const dirty =
    name === null ||
    label !== saved.label ||
    light !== saved.light ||
    dark !== saved.dark;
  // The draft as it would print: shown on this browser, which previews the
  // theme being edited, after the saved theme's rules, so it wins.
  const draft = parseThemeInput({ label: label || themeName, light, dark });
  const preview =
    name !== null && dirty && draft.ok
      ? printTheme(themeName, draft.theme)
      : "";
  const save = () =>
    saver.submit("save-theme", { name: themeName, label, light, dark });
  const text = mode === "light" ? light : dark;
  const setText = mode === "light" ? setLight : setDark;
  return (
    <section className="flex min-h-0 min-w-0 flex-col gap-2">
      {preview && <style>{preview}</style>}
      {name === null ? (
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            Name: lowercase letters, digits and dashes
          </span>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="duck"
            className="rounded-md border bg-transparent px-2 py-1 font-mono text-sm"
          />
        </label>
      ) : (
        <h3 className="font-mono text-xs text-muted-foreground">{name}</h3>
      )}
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Label</span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Duck"
          className="rounded-md border bg-transparent px-2 py-1 text-sm"
        />
      </label>
      <div role="tablist" className="flex gap-1 border-b">
        {(["light", "dark"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={cn(
              "-mb-px cursor-pointer border-b-2 px-3 py-1 text-sm capitalize",
              mode === m
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {m}
            {!(m === "light" ? light : dark).trim() && (
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                derived
              </span>
            )}
          </button>
        ))}
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        style={{ fieldSizing: "fixed" }}
        placeholder={`Empty: made from the ${mode === "light" ? "dark" : "light"} variant's brand colours`}
        className="min-h-24 flex-1 resize-none font-mono text-xs"
      />
      <p className="text-xs text-muted-foreground">
        JSON of token to value. Colours as hex,{" "}
        {COLOUR_FUNCTIONS.map((f, i) => (
          <span key={f}>
            {i > 0 && (i === COLOUR_FUNCTIONS.length - 1 ? " or " : ", ")}
            <code>{f}</code>
          </span>
        ))}
        ; <code className="whitespace-nowrap">--radius</code> in rem or px.
      </p>
      <div className="flex items-center gap-2">
        {/* Activates what's saved, not the draft; dimmed on the active one. */}
        {name !== null && (
          <Button
            size="sm"
            disabled={active || activator.pending}
            onClick={() => activator.submit("activate-theme", { name })}
          >
            <Check />
            {active ? "Active" : "Make active"}
          </Button>
        )}
        <Button
          size="sm"
          variant={name === null ? "default" : "outline"}
          disabled={!dirty || !THEME_NAME.test(themeName) || saver.pending}
          onClick={save}
        >
          <Save />
          Save
        </Button>
        {name !== null && (
          <Popover open={menu} onOpenChange={setMenu}>
            <PopoverTrigger
              aria-label="More"
              render={<Button size="icon-sm" variant="ghost" />}
            >
              <Ellipsis />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-48 gap-0.5 p-1.5">
              <button
                type="button"
                disabled={!dirty}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => {
                  setLabel(saved.label);
                  setLight(saved.light);
                  setDark(saved.dark);
                  setMenu(false);
                }}
              >
                <RotateCcw className="size-4" />
                Revert
              </button>
              <button
                type="button"
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                onClick={() => {
                  downloadThemeFile(name, saved);
                  setMenu(false);
                }}
              >
                <Download className="size-4" />
                Export
              </button>
            </PopoverContent>
          </Popover>
        )}
      </div>
      {(saver.error ?? activator.error) && (
        <p className="whitespace-pre-line text-destructive">
          {saver.error ?? activator.error}
        </p>
      )}
    </section>
  );
}
