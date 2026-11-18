// The compiled board: what the supervisor runs in place of the dev server
// when seamux is installed from npm, or with SEAMUX_COMPILED=1.
//
//   node dist/serve.js --port 54321
//
// It serves what `npm run build` made, behind the same checks the dev server
// makes: the remote-access gate, ahead of the static files and the board
// alike. Like the
// dev server, it binds 127.0.0.1 unless LAN access is on, and reads the
// tunnel's hostname and the LAN access switch once, at startup; the
// supervisor restarts it when LAN access changes.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createRequestHandler } from "@react-router/express";
import express from "express";
import type { ServerBuild } from "react-router";

import { packagePath, SEAMUX_HOME } from "../app/lib/paths.server.ts";
import {
  lanWanted,
  LISTEN_ENV,
  lowercaseHost,
  remoteDomain,
  remoteGate,
} from "../app/lib/remote.server.ts";

const DEFAULT_PORT = 54321;

function port(): number {
  const i = process.argv.indexOf("--port");
  const value = Number(
    i >= 0 ? process.argv[i + 1] : (process.env.PORT ?? DEFAULT_PORT),
  );
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Not a port: ${value}`);
  }
  return value;
}

// .env in SEAMUX_HOME, as the dev server loads the checkout's: for settings
// read from the environment, such as SEAMUX_CMUX_APP. What the environment
// already sets wins. The credentials and the tunnel's settings are read from
// the file on every request regardless, so editing those needs no restart.
const envFile = join(SEAMUX_HOME, ".env");
if (existsSync(envFile)) {
  const shell = { ...process.env };
  process.loadEnvFile(envFile);
  Object.assign(process.env, shell);
}

const lan = lanWanted(SEAMUX_HOME);
// The board's loaders run in this process, and tell the Remote tab.
process.env[LISTEN_ENV] = lan ? "lan" : "local";
process.env.NODE_ENV = "production";

const build = (await import(
  pathToFileURL(packagePath("build/server/index.js")).href
)) as ServerBuild;
const domain = remoteDomain(SEAMUX_HOME);

const app = express();
app.disable("x-powered-by");
// The Host in one case, as the dev server has it (lowercaseHost).
app.use((req, _res, next) => {
  lowercaseHost(req);
  next();
});
app.use(remoteGate(SEAMUX_HOME));
// Hashed file names, so they can be kept for good.
app.use(
  "/assets",
  express.static(packagePath("build/client/assets"), {
    immutable: true,
    maxAge: "1y",
  }),
);
app.use(express.static(packagePath("build/client"), { maxAge: "1h" }));
app.all(
  "*",
  createRequestHandler({
    // cloudflared hands requests over http, so an action through the tunnel
    // has an https Origin that doesn't match its request URL; React Router
    // would refuse it as cross-site. assertFromBoard still requires the
    // Origin to be exactly https://<domain>.
    build: { ...build, allowedActionOrigins: domain ? [domain] : [] },
  }),
);

const host = lan ? "::" : "127.0.0.1";
const listening = app.listen(port(), host, () => {
  console.log(`[seamux] serving the compiled board on http://127.0.0.1:${port()}/`);
});
listening.on("error", (err) => {
  console.error(`[seamux] ${err.message}`);
  process.exit(1);
});
