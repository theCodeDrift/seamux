import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { existsSync, readFileSync, unwatchFile, watchFile } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";

import { forgetDotenv } from "./app/lib/credentials.ts";
import { SEAMUX_HOME } from "./app/lib/paths.server.ts";
import {
  lanHost,
  lanWanted,
  LISTEN_ENV,
  lowercaseHost,
  remoteDomain,
  remoteGate,
} from "./app/lib/remote.server.ts";
import { landedFile, readLanding } from "./scripts/landed.ts";

// WSL does not deliver file events for Windows drives under /mnt/, so hot
// reload has to poll there. SEAMUX_POLL=1 forces it anywhere.
function needsPolling(): boolean {
  if (process.env.SEAMUX_POLL === "1") return true;
  if (process.platform !== "linux" || !process.cwd().startsWith("/mnt/")) {
    return false;
  }
  try {
    return /microsoft/i.test(readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}

// The remote-access gate, ahead of everything Vite answers itself. Vite
// checks the Host against allowedHosts before any plugin's middleware, so
// the Host is lowercased as the request arrives, ahead of that check too.
function remoteAccess(): Plugin {
  return {
    name: "seamux-remote-access",
    configureServer(server) {
      server.httpServer?.prependListener("request", lowercaseHost);
      server.middlewares.use(remoteGate(SEAMUX_HOME));
    },
  };
}

// Vite marks its pre-bundled dependencies immutable for a year. Safari on a
// phone keeps them, and after the board restarts and bundles them again, a
// reload runs its old copy of React beside the new chunks and fails on every
// render, never asking for the old files again. Asked to revalidate, the
// browser gets a 304 for each while nothing changed, and never a stale one.
function revalidateDeps(): Plugin {
  return {
    name: "seamux-revalidate-deps",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.includes("/node_modules/.vite/")) {
          const setHeader = res.setHeader.bind(res);
          res.setHeader = ((name: string, value: number | string | string[]) =>
            setHeader(
              name,
              name.toLowerCase() === "cache-control" ? "no-cache" : value,
            )) as typeof res.setHeader;
        }
        next();
      });
    },
  };
}

// Vite stamps an import with the time of its module's last hot update, and
// a stylesheet can change without one: a landing changed app.css's tokens
// and the stamp stayed put, so the same URL served new content, and a cache
// keyed by URL, like Cloudflare's edge, kept the old. The stylesheet's
// import carries the server's start time as well, so every start is a new
// URL too. Not as `v=`, which Vite takes for a pre-bundled dependency's
// version and serves as immutable for a year.
function bustStylesheet(): Plugin {
  const started = Date.now().toString(36);
  return {
    name: "seamux-bust-stylesheet",
    apply: "serve",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith("/app/root.tsx")) return;
      return code.replace(
        'import "./app.css";',
        `import "./app.css?boot=${started}";`,
      );
    },
  };
}

// Vite's file watcher missed a landing altogether: main had the new files,
// and the dev server kept serving the old modules, and the old stylesheet,
// until it restarted. `npm run land` records what it changed, and this
// replays each file to the watcher as a change, so hot reload sees every
// landing. A file the watcher did see is updated twice, which costs nothing.
// Polled rather than watched, since the watcher is what can't be trusted.
function replayLandings(): Plugin {
  return {
    name: "seamux-replay-landings",
    apply: "serve",
    configureServer(server) {
      const file = landedFile(SEAMUX_HOME);
      const replay = (now: { mtimeMs: number }, then: { mtimeMs: number }) => {
        if (now.mtimeMs === 0 || now.mtimeMs === then.mtimeMs) return;
        for (const name of readLanding(SEAMUX_HOME)) {
          const path = join(server.config.root, name);
          server.watcher.emit(existsSync(path) ? "change" : "unlink", path);
        }
      };
      watchFile(file, { interval: 500 }, replay);
      server.httpServer?.once("close", () => unwatchFile(file, replay));
    },
  };
}

// Before React Router loads .env again, so a variable deleted from it goes.
forgetDotenv();

// The tunnel's hostname and whether LAN access is on, read once at startup:
// changing either needs the dev server restarted, which the supervisor does
// for LAN access.
const domain = remoteDomain(SEAMUX_HOME);
const lan = lanWanted(SEAMUX_HOME);
// The board's loaders run in this process, and tell the Remote tab.
process.env[LISTEN_ENV] = lan ? "lan" : "local";

export default defineConfig({
  plugins: [
    remoteAccess(),
    revalidateDeps(),
    bustStylesheet(),
    replayLandings(),
    tailwindcss(),
    reactRouter(),
  ],
  // Bound to localhost only, unless LAN access is on: this server spawns processes
  // and reads every transcript. The Cloudflare tunnel connects from this Mac.
  server: {
    host: lan ? true : "127.0.0.1",
    // Vite lets any IP address through without being told, so this Mac's
    // network addresses need no entry (knowledge/mdns.md).
    allowedHosts: [...(domain ? [domain] : []), ...(lan ? [lanHost()] : [])],
    port: 54321,
    strictPort: true,
    watch: needsPolling() ? { usePolling: true, interval: 500 } : undefined,
  },
  resolve: {
    tsconfigPaths: true,
  },
});
