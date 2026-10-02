// The board always answers a request from this Mac addressed to localhost,
// 127.0.0.1 or [::1], and binds 127.0.0.1 for nothing else. The Remote tab
// opens two more ways in, each on its own switch, either or both:
//
// - mDNS: it listens on every interface and also answers this Mac's Bonjour
//   name, <LocalHostName>.local, from anywhere. That needs the HTTP Basic
//   credentials set.
// - the tunnel: a Cloudflare named tunnel from SEAMUX_CF_DOMAIN to the board,
//   with Cloudflare Access in front of it. The board also answers cloudflared,
//   on this Mac, at the tunnel's hostname, and only from loopback, even while
//   mDNS has it listening on the network. A request there must carry a valid
//   Access token for SEAMUX_CF_TEAM and SEAMUX_CF_AUD, checked here, and then
//   needs no HTTP Basic credentials. If the Access application is ever
//   deleted or loosened, the board still refuses.
//
// Whenever SEAMUX_USER and SEAMUX_PASS are set, every request other than the
// tunnel's must carry them, whatever it asks for.
//
// The switches live in .seamux.json. The supervisor (scripts/supervise.ts)
// starts and stops cloudflared to match, and restarts the dev server when
// mDNS changes, since vite.config.ts picks the address it listens on once.
//
// scripts/supervise.ts, vite.config.ts and the compiled server
// (server/serve.ts) import this under plain Node, so it uses node: builtins
// and relative imports only.

import {
  createPublicKey,
  verify,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { hostname } from "node:os";
import { join } from "node:path";

import {
  basicAuthHeader,
  readCredentials,
  readEnv,
  sameSecret,
} from "./credentials.ts";

// Every variable remote access needs. SEAMUX_CF_TUNNEL is only shown, since
// the token already names the tunnel.
export const REMOTE_ENV = [
  "SEAMUX_CF_TOKEN",
  "SEAMUX_CF_DOMAIN",
  "SEAMUX_CF_TEAM",
  "SEAMUX_CF_AUD",
] as const;

// The header Cloudflare Access adds to every request it lets through.
export const ACCESS_HEADER = "cf-access-jwt-assertion";

export interface RemoteSettings {
  token: string;
  // The tunnel's public hostname, e.g. seamux.example.com.
  domain: string;
  // The Zero Trust team's hostname, e.g. myteam.cloudflareaccess.com.
  team: string;
  // The Access application's audience tag.
  aud: string;
  tunnel: string | null;
}

// What the Remote tab shows. No secrets.
export interface RemoteStatus {
  // Where seamux keeps its .env and data/: its checkout, or ~/.seamux.
  home: string;
  // "Enable remote connections": with it off, neither way in is open.
  enabled: boolean;
  mdns: {
    // The switch.
    wanted: boolean;
    // e.g. http://my-mac.local:54321
    url: string;
    // Whether the running dev server listens beyond loopback.
    listening: boolean;
    // Whether SEAMUX_USER and SEAMUX_PASS are set; it won't turn on without.
    secured: boolean;
    // Whether this request came over the network to that name.
    viaLan: boolean;
  };
  // The tunnel's variables still unset; its switch can't turn on until none
  // are.
  missing: string[];
  // Whether any of them is set, which opens the tunnel's section.
  cfSet: boolean;
  domain: string | null;
  tunnel: string | null;
  // The tunnel's switch, and whether it applies: the tunnel runs when
  // `enabled` and `wanted` are both on.
  wanted: boolean;
  // cloudflared's pid, while it runs.
  pid: number | null;
  // Whether a supervisor is running to start it.
  supervised: boolean;
  // Whether this request came through the tunnel.
  viaTunnel: boolean;
}

// The settings, or null with the variables still missing. Read on every
// call, like the Basic credentials, so editing .env needs no restart (except
// for Vite's allowedHosts, which it reads once).
export function readRemoteSettings(dir: string): {
  settings: RemoteSettings | null;
  missing: string[];
} {
  const env = readEnv(dir, [...REMOTE_ENV, "SEAMUX_CF_TUNNEL"]);
  const missing = REMOTE_ENV.filter((name) => !env[name]);
  if (missing.length > 0) return { settings: null, missing };
  return {
    settings: {
      token: env.SEAMUX_CF_TOKEN!,
      domain: hostOf(env.SEAMUX_CF_DOMAIN!),
      team: teamHost(env.SEAMUX_CF_TEAM!),
      aud: env.SEAMUX_CF_AUD!.trim(),
      tunnel: env.SEAMUX_CF_TUNNEL ?? null,
    },
    missing: [],
  };
}

// The tunnel's hostname, once every variable is set: Vite's allowedHosts
// lets it through, for remoteGate to decide.
export function remoteDomain(dir: string): string | null {
  return readRemoteSettings(dir).settings?.domain ?? null;
}

// A bare hostname from what might be a URL, lowercased and without a port.
function hostOf(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "");
}

// A team given as "myteam", "myteam.cloudflareaccess.com" or its URL.
function teamHost(value: string): string {
  const host = hostOf(value);
  return host.includes(".") ? host : `${host}.cloudflareaccess.com`;
}

// --- The switches, kept in .seamux.json beside the port ------------------

function readRunFile(dir: string): Record<string, unknown> {
  try {
    const saved = JSON.parse(readFileSync(join(dir, ".seamux.json"), "utf8"));
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

// Merge `fields` into .seamux.json, keeping whatever else it holds.
export function updateRunFile(dir: string, fields: Record<string, unknown>) {
  writeFileSync(
    join(dir, ".seamux.json"),
    `${JSON.stringify({ ...readRunFile(dir), ...fields }, null, 2)}\n`,
  );
}

export type RemoteSwitch = "remote" | "tunnel" | "mdns";

// `remote` is the master switch. Before there was mDNS it was the tunnel's
// own switch, so a file without `tunnel` takes it from `remote`.
function readSwitches(dir: string): Record<RemoteSwitch, boolean> {
  const saved = readRunFile(dir);
  const remote = saved.remote === true;
  const tunnel = typeof saved.tunnel === "boolean" ? saved.tunnel : remote;
  return { remote, tunnel, mdns: saved.mdns === true };
}

export function remoteEnabled(dir: string): boolean {
  return readSwitches(dir).remote;
}

// Whether cloudflared should run.
export function tunnelWanted(dir: string): boolean {
  const s = readSwitches(dir);
  return s.remote && s.tunnel;
}

// Whether the board should listen on the network.
export function lanWanted(dir: string): boolean {
  const s = readSwitches(dir);
  return s.remote && s.mdns;
}

// Writes every switch, so the tunnel's no longer follows the master's.
export function setRemoteSwitch(dir: string, which: RemoteSwitch, on: boolean) {
  updateRunFile(dir, { ...readSwitches(dir), [which]: on });
}

function runPort(dir: string): number {
  const port = readRunFile(dir).port;
  return typeof port === "number" && Number.isInteger(port) ? port : 54321;
}

// --- mDNS: this Mac's Bonjour name ----------------------------------------

let lanName: string | null = null;

// This Mac's .local name, which macOS answers for over mDNS on every network
// it joins: its LocalHostName, as set in System Settings → General → Sharing.
// Elsewhere, the hostname. Lowercase, as Host headers compare.
export function lanHost(): string {
  if (lanName) return lanName;
  let name = "";
  if (process.platform === "darwin") {
    try {
      name = execFileSync("scutil", ["--get", "LocalHostName"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {}
  }
  if (!name) name = hostname().replace(/\.local$/i, "");
  lanName = `${name.toLowerCase()}.local`;
  return lanName;
}

export function isLanHost(dir: string, host: string | null): boolean {
  return host !== null && lanWanted(dir) && hostOf(host) === lanHost();
}

// Set by vite.config.ts in the dev server's own process, which is where the
// board's loaders run too.
export const LISTEN_ENV = "SEAMUX_LISTEN";

export function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  return (
    address === "::1" ||
    /^127\./.test(address) ||
    /^::ffff:127\./i.test(address)
  );
}

// The names a request from this Mac may be addressed to in every mode.
const LOCAL_NAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLocalName(host: string | null): boolean {
  return host !== null && LOCAL_NAMES.has(hostOf(host));
}

export type GateVerdict =
  | { verdict: "allowed" }
  | { verdict: "tunnel" }
  | { verdict: "login" }
  | { verdict: "denied"; reason: string };

// Whether the board answers a request, by its socket's address, its Host and
// its HTTP Basic credentials: "tunnel" for one addressed to the tunnel, which
// must then carry a valid Access token instead. Only the servers' own
// middleware can see the socket, so this runs there, ahead of everything
// they answer. The Host check also stops a page elsewhere that points its
// own name at this Mac from reading the board. The reason finishes "seamux
// refused this request because …".
export function checkRequest(
  dir: string,
  peer: string | undefined,
  host: string | null,
  authorization: string | null,
): GateVerdict {
  const lan = lanWanted(dir);
  const loopback = isLoopback(peer);
  const name = host === null ? null : hostOf(host);
  const domain = tunnelWanted(dir) ? remoteDomain(dir) : null;
  if (!loopback && !lan) {
    return {
      verdict: "denied",
      reason: "it came from the network, and mDNS is off in the Remote tab",
    };
  }
  if (domain !== null && name === domain) {
    // cloudflared connects from this Mac. With mDNS on the network can reach
    // the board too, and must not pass as cloudflared by naming the tunnel.
    if (!loopback) {
      return {
        verdict: "denied",
        reason: `it came from the network addressed to ${domain}, which only the tunnel answers`,
      };
    }
    return { verdict: "tunnel" };
  }
  const answered =
    (loopback && isLocalName(host)) || (lan && name === lanHost());
  if (!answered) {
    const names = [
      ...(loopback ? LOCAL_NAMES : []),
      ...(lan ? [lanHost()] : []),
      ...(domain !== null && loopback ? [domain] : []),
    ];
    return {
      verdict: "denied",
      reason: `it was addressed to ${host ?? "no host"}, and the board only answers ${names.join(", ")}`,
    };
  }
  const credentials = readCredentials(dir);
  if (!credentials) {
    if (!lan || name !== lanHost()) return { verdict: "allowed" };
    return {
      verdict: "denied",
      reason:
        "SEAMUX_USER and SEAMUX_PASS are unset, and the board doesn't answer the network without them",
    };
  }
  if (sameSecret(authorization ?? "", basicAuthHeader(credentials))) {
    return { verdict: "allowed" };
  }
  return { verdict: "login" };
}

// --- cloudflared's pid, written by the supervisor ------------------------

export function tunnelPidFile(dir: string): string {
  return join(dir, "data", "tunnel.pid");
}

export function tunnelLogFile(dir: string): string {
  return join(dir, "data", "tunnel.log");
}

export function livePid(path: string): number | null {
  try {
    const pid = Number(readFileSync(path, "utf8").trim());
    if (!Number.isInteger(pid) || pid <= 0) return null;
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

export function remoteStatus(dir: string, host: string | null): RemoteStatus {
  const { missing } = readRemoteSettings(dir);
  const env = readEnv(dir, ["SEAMUX_CF_DOMAIN", "SEAMUX_CF_TUNNEL"]);
  const switches = readSwitches(dir);
  return {
    home: dir,
    enabled: switches.remote,
    mdns: {
      wanted: switches.mdns,
      url: `http://${lanHost()}:${runPort(dir)}`,
      listening: process.env[LISTEN_ENV] === "lan",
      secured: readCredentials(dir) !== null,
      viaLan: isLanHost(dir, host),
    },
    missing,
    cfSet: missing.length < REMOTE_ENV.length,
    domain: env.SEAMUX_CF_DOMAIN ? hostOf(env.SEAMUX_CF_DOMAIN) : null,
    tunnel: env.SEAMUX_CF_TUNNEL ?? null,
    wanted: switches.tunnel,
    pid: livePid(tunnelPidFile(dir)),
    supervised: livePid(join(dir, "data", "serve.pid")) !== null,
    viaTunnel: isTunnelHost(dir, host),
  };
}

// --- Requests through the tunnel -----------------------------------------

// The tunnel's hostname, while the tunnel is on.
export function isTunnelHost(dir: string, host: string | null): boolean {
  const domain = tunnelWanted(dir) ? remoteDomain(dir) : null;
  return domain !== null && host !== null && hostOf(host) === domain;
}

export type TunnelVerdict =
  | { verdict: "local" }
  | { verdict: "allowed" }
  | { verdict: "denied"; reason: string };

// "local" for a request that didn't come through the tunnel; otherwise
// whether its Access token checks out, and if not, why.
export async function checkTunnelRequest(
  dir: string,
  host: string | null,
  token: string | null,
): Promise<TunnelVerdict> {
  const { settings } = readRemoteSettings(dir);
  if (!settings || host === null || hostOf(host) !== settings.domain) {
    return { verdict: "local" };
  }
  const checked = token
    ? await verifyAccessToken(token, settings)
    : { reason: "it carried no Cloudflare Access token" };
  if ("claims" in checked) return { verdict: "allowed" };
  console.warn(
    `[seamux] refused a request through the tunnel: ${checked.reason}`,
  );
  return { verdict: "denied", reason: checked.reason };
}

// --- The gate every request passes ---------------------------------------

// The header only Cloudflare's edge reads, ahead of Cache-Control, and drops
// before the response goes on to the browser.
export const EDGE_CACHE_HEADER = "Cloudflare-CDN-Cache-Control";

// checkRequest, then the Access token for a request through the tunnel. As
// middleware ahead of everything that answers requests: in dev, Vite's own
// (modules, assets, files under the checkout) before the board's auth
// middleware sees them; compiled, the static files and the board alike.
export function remoteGate(dir: string) {
  return (
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void,
  ) => {
    const gate = checkRequest(
      dir,
      req.socket.remoteAddress,
      req.headers.host ?? null,
      req.headers.authorization ?? null,
    );
    if (gate.verdict === "allowed") return next();
    if (gate.verdict === "login") {
      res.statusCode = 401;
      res.setHeader(
        "WWW-Authenticate",
        'Basic realm="seamux", charset="UTF-8"',
      );
      res.end("Authentication required");
      return;
    }
    if (gate.verdict === "denied") {
      console.warn(
        `[seamux] refused a request from ${req.socket.remoteAddress}: ${gate.reason}`,
      );
      res.statusCode = 403;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(forbiddenPage(gate.reason, false));
      return;
    }
    // Cloudflare's edge caches by extension, .css and .js among them, and
    // went on serving a stylesheet the dev server had since changed under the
    // same URL. The board is live: nothing it answers is stored there.
    res.setHeader(EDGE_CACHE_HEADER, "no-store");
    const token = req.headers[ACCESS_HEADER];
    checkTunnelRequest(
      dir,
      req.headers.host ?? null,
      typeof token === "string" ? token : null,
    ).then((tunnel) => {
      if (tunnel.verdict !== "denied") return next();
      res.statusCode = 403;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(forbiddenPage(tunnel.reason));
    }, next);
  };
}

// The 403 for a refused tunnel or network request, and why.
export function forbiddenPage(reason: string, tunnel = true): string {
  const escaped = reason.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>seamux: forbidden</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem}</style>
<h1>Forbidden</h1>
<p>seamux refused this request because ${escaped}.</p>
${tunnel ? "<p>If Cloudflare Access let you in, check SEAMUX_CF_TEAM and SEAMUX_CF_AUD in the board's .env against the Access application.</p>\n" : ""}`;
}

// Leeway for the clock on either side.
const SKEW_S = 60;

export interface AccessClaims {
  iss?: string;
  aud: string | string[];
  exp: number;
  nbf?: number;
  email?: string;
}

// Checks a Cloudflare Access JWT: RS256, signed by one of the team's keys,
// for this application, and in date. The issuer isn't checked: a renamed
// team keeps issuing under its old name, and the team's key and the
// application's AUD already rule out any other team or app. The reason for a
// refusal finishes "seamux refused this request because …".
export async function verifyAccessToken(
  token: string,
  { team, aud }: { team: string; aud: string },
): Promise<{ claims: AccessClaims } | { reason: string }> {
  const malformed = { reason: "its Access token is malformed" };
  const parts = token.split(".");
  if (parts.length !== 3) return malformed;
  const [head, body, signature] = parts;
  let header: { alg?: unknown; kid?: unknown };
  let claims: AccessClaims;
  try {
    header = JSON.parse(Buffer.from(head, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return malformed;
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    return malformed;
  }
  const key = await accessKey(team, header.kid);
  if (!key) {
    return {
      reason: `its Access token isn't signed by any key of ${team}, the team in SEAMUX_CF_TEAM`,
    };
  }
  const signed = verify(
    "RSA-SHA256",
    Buffer.from(`${head}.${body}`),
    key,
    Buffer.from(signature, "base64url"),
  );
  if (!signed) return { reason: "its Access token's signature is invalid" };
  // Signed by the team, so the claims below can be named in the reason.
  const now = Date.now() / 1000;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(aud)) {
    return {
      reason:
        "its Access login is for a different application from the one in SEAMUX_CF_AUD",
    };
  }
  if (typeof claims.exp !== "number" || claims.exp < now - SKEW_S) {
    return { reason: "its Access login has expired" };
  }
  if (typeof claims.nbf === "number" && claims.nbf > now + SKEW_S) {
    return { reason: "its Access login isn't valid yet" };
  }
  return { claims };
}

// The team's signing keys, from its certs endpoint. Kept for an hour, and
// fetched again early for a key id it doesn't know, at most every 30s, since
// Cloudflare rotates them.
const KEYS_FRESH_MS = 60 * 60_000;
const REFETCH_AFTER_MS = 30_000;
const keyCache = new Map<
  string,
  { at: number; keys: Map<string, KeyObject> }
>();
const inFlight = new Map<string, Promise<Map<string, KeyObject> | null>>();

async function accessKey(
  team: string,
  kid: string,
): Promise<KeyObject | undefined> {
  const cached = keyCache.get(team);
  const age = cached ? Date.now() - cached.at : Infinity;
  if (cached && age < KEYS_FRESH_MS) {
    if (cached.keys.has(kid) || age < REFETCH_AFTER_MS) {
      return cached.keys.get(kid);
    }
  }
  let pending = inFlight.get(team);
  if (!pending) {
    pending = fetchKeys(team).finally(() => inFlight.delete(team));
    inFlight.set(team, pending);
  }
  const keys = await pending;
  if (keys) keyCache.set(team, { at: Date.now(), keys });
  return (keys ?? cached?.keys)?.get(kid);
}

async function fetchKeys(team: string): Promise<Map<string, KeyObject> | null> {
  try {
    const res = await fetch(`https://${team}/cdn-cgi/access/certs`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const { keys } = (await res.json()) as {
      keys?: (JsonWebKey & { kid?: string })[];
    };
    const map = new Map<string, KeyObject>();
    for (const jwk of keys ?? []) {
      if (jwk.kid)
        map.set(jwk.kid, createPublicKey({ key: jwk, format: "jwk" }));
    }
    return map;
  } catch {
    return null;
  }
}
