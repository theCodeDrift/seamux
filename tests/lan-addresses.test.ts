// LAN access answers this Mac's own network addresses as well as its .local
// name, for a device that can't resolve .local. An address is a LAN name
// like the .local one: behind the password, never local, and only while
// LAN access is on.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const interfaces = vi.hoisted(() => ({
  current: {} as Record<string, unknown[]>,
}));

vi.mock("node:os", async (importOriginal) => {
  const os = await importOriginal<typeof import("node:os")>();
  const networkInterfaces = () => interfaces.current;
  return { ...os, default: { ...os, networkInterfaces }, networkInterfaces };
});

const { basicAuthHeader } = await import("~/lib/credentials");
const { checkRequest, isLanHost, lanAddresses, remoteStatus } =
  await import("~/lib/remote.server");

const NETWORK = "192.168.1.30";
const AUTH = basicAuthHeader({ user: "me", pass: "secret" });

function nic(address: string, family: "IPv4" | "IPv6", internal = false) {
  return { address, family, internal, netmask: "", mac: "", cidr: null };
}

function home(switches: Record<string, unknown>, password = true): string {
  const dir = mkdtempSync(join(tmpdir(), "seamux-lan-"));
  if (password) {
    writeFileSync(join(dir, ".env"), "SEAMUX_USER=me\nSEAMUX_PASS=secret\n");
  }
  writeFileSync(join(dir, ".seamux.json"), JSON.stringify(switches));
  return dir;
}

const lanOn = () => home({ remote: true, mdns: true, port: 54321 });

beforeEach(() => {
  interfaces.current = {
    lo0: [nic("127.0.0.1", "IPv4", true), nic("::1", "IPv6", true)],
    en0: [
      nic("fe80::1c2b:3a4d:5e6f:7a8b", "IPv6"),
      nic("2001:DB8::20", "IPv6"),
      nic("192.168.1.20", "IPv4"),
    ],
  };
});

describe("lanAddresses", () => {
  it("lists this Mac's network addresses as a Host names them, IPv4 first", () => {
    expect(lanAddresses()).toEqual(["192.168.1.20", "[2001:db8::20]"]);
  });

  it("reads them again on every call", () => {
    interfaces.current = { en0: [nic("10.0.0.5", "IPv4")] };
    expect(lanAddresses()).toEqual(["10.0.0.5"]);
  });
});

describe("LAN access at an address", () => {
  it("answers the network at this Mac's address behind the password", () => {
    const dir = lanOn();
    for (const host of ["192.168.1.20:54321", "[2001:db8::20]:54321"]) {
      expect(checkRequest(dir, NETWORK, host, AUTH).verdict).toBe("allowed");
      expect(checkRequest(dir, NETWORK, host, null).verdict).toBe("login");
    }
  });

  it("refuses an address that isn't this Mac's", () => {
    const gate = checkRequest(lanOn(), NETWORK, "192.168.1.99:54321", AUTH);
    expect(gate.verdict).toBe("denied");
  });

  it("refuses an address once it's gone from this Mac", () => {
    const dir = lanOn();
    interfaces.current = { en0: [nic("10.0.0.5", "IPv4")] };
    const gate = checkRequest(dir, NETWORK, "192.168.1.20:54321", AUTH);
    expect(gate.verdict).toBe("denied");
  });

  it("refuses the address with LAN access off", () => {
    const dir = home({ remote: true, mdns: false });
    const gate = checkRequest(dir, NETWORK, "192.168.1.20:54321", AUTH);
    expect(gate.verdict).toBe("denied");
    expect(isLanHost(dir, "192.168.1.20:54321")).toBe(false);
  });

  it("refuses the address without a password set, even from this Mac", () => {
    const dir = home({ remote: true, mdns: true }, false);
    for (const peer of [NETWORK, "127.0.0.1"]) {
      const gate = checkRequest(dir, peer, "192.168.1.20:54321", null);
      expect(gate.verdict).toBe("denied");
    }
  });

  it("counts the address as LAN, not local", () => {
    expect(isLanHost(lanOn(), "192.168.1.20:54321")).toBe(true);
  });

  it("lists the board's address at each in the Remote tab", () => {
    expect(remoteStatus(lanOn(), null).mdns.addresses).toEqual([
      "http://192.168.1.20:54321",
      "http://[2001:db8::20]:54321",
    ]);
  });
});
