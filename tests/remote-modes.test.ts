// mDNS and the tunnel, each on its own switch and both together. With mDNS
// on the board listens on the network, and the network must never pass as
// cloudflared by naming the tunnel's hostname.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { basicAuthHeader } from "~/lib/credentials";
import {
  checkRequest,
  lanHost,
  lanWanted,
  setRemoteSwitch,
  tunnelWanted,
} from "~/lib/remote.server";

const DOMAIN = "board.example.com";
const LOOPBACK = "127.0.0.1";
const NETWORK = "192.168.1.20";
const AUTH = basicAuthHeader({ user: "me", pass: "secret" });

function home(switches: Record<string, boolean>): string {
  const dir = mkdtempSync(join(tmpdir(), "seamux-modes-"));
  writeFileSync(
    join(dir, ".env"),
    [
      "SEAMUX_USER=me",
      "SEAMUX_PASS=secret",
      "SEAMUX_CF_TOKEN=token",
      `SEAMUX_CF_DOMAIN=${DOMAIN}`,
      "SEAMUX_CF_TEAM=team",
      "SEAMUX_CF_AUD=aud",
    ].join("\n"),
  );
  writeFileSync(join(dir, ".seamux.json"), JSON.stringify(switches));
  return dir;
}

const both = () => home({ remote: true, mdns: true, tunnel: true });

describe("mDNS and the tunnel together", () => {
  it("runs both", () => {
    const dir = both();
    expect(lanWanted(dir)).toBe(true);
    expect(tunnelWanted(dir)).toBe(true);
  });

  it("runs neither with remote connections off", () => {
    const dir = home({ remote: false, mdns: true, tunnel: true });
    expect(lanWanted(dir)).toBe(false);
    expect(tunnelWanted(dir)).toBe(false);
  });

  it("leaves one on when the other turns on", () => {
    const dir = home({ remote: true, mdns: true, tunnel: false });
    setRemoteSwitch(dir, "tunnel", true);
    const saved = JSON.parse(readFileSync(join(dir, ".seamux.json"), "utf8"));
    expect(saved).toMatchObject({ remote: true, mdns: true, tunnel: true });
  });

  it("hands cloudflared's requests to the Access check", () => {
    expect(checkRequest(both(), LOOPBACK, DOMAIN, null).verdict).toBe(
      "tunnel",
    );
  });

  it("refuses the network addressed to the tunnel's hostname", () => {
    const gate = checkRequest(both(), NETWORK, DOMAIN, AUTH);
    expect(gate.verdict).toBe("denied");
  });

  it("answers the network at the .local name behind the password", () => {
    const dir = both();
    expect(checkRequest(dir, NETWORK, lanHost(), AUTH).verdict).toBe(
      "allowed",
    );
    expect(checkRequest(dir, NETWORK, lanHost(), null).verdict).toBe("login");
  });

  it("refuses the network addressed to a local name", () => {
    const gate = checkRequest(both(), NETWORK, "127.0.0.1:54321", AUTH);
    expect(gate.verdict).toBe("denied");
  });

  it("asks this Mac for the password at localhost", () => {
    const dir = both();
    expect(checkRequest(dir, LOOPBACK, "localhost:54321", null).verdict).toBe(
      "login",
    );
    expect(checkRequest(dir, LOOPBACK, "localhost:54321", AUTH).verdict).toBe(
      "allowed",
    );
  });
});

describe("one at a time", () => {
  it("refuses the network with only the tunnel on", () => {
    const dir = home({ remote: true, mdns: false, tunnel: true });
    expect(checkRequest(dir, NETWORK, lanHost(), AUTH).verdict).toBe("denied");
    expect(checkRequest(dir, NETWORK, DOMAIN, null).verdict).toBe("denied");
    expect(checkRequest(dir, LOOPBACK, DOMAIN, null).verdict).toBe("tunnel");
  });

  it("doesn't answer the tunnel's hostname with only mDNS on", () => {
    const dir = home({ remote: true, mdns: true, tunnel: false });
    expect(checkRequest(dir, LOOPBACK, DOMAIN, AUTH).verdict).toBe("denied");
    expect(checkRequest(dir, NETWORK, lanHost(), AUTH).verdict).toBe(
      "allowed",
    );
  });
});
