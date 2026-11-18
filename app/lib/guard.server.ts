import { data } from "react-router";

import { SEAMUX_HOME } from "~/lib/paths.server";
import { isLanHost, isLocalName, isTunnelHost } from "~/lib/remote.server";

// Whether the request was made on this Mac, not through the tunnel or over
// the network. A request from another machine that claims a local Host never
// gets this far: remoteGate refuses it by its socket.
export function isLocalRequest(request: Request): boolean {
  return isLocalName(request.headers.get("host"));
}

// The tunnel's hostname, which the auth middleware has already checked for
// a valid Cloudflare Access token.
function isTunnelRequest(request: Request): boolean {
  return isTunnelHost(SEAMUX_HOME, request.headers.get("host"));
}

// This Mac's .local name or network address while LAN access is on. HTTP
// Basic has already let it in.
function isLanRequest(request: Request): boolean {
  return isLanHost(SEAMUX_HOME, request.headers.get("host"));
}

// The board's actions spawn sessions and type into them. A browser lets any
// website POST a form to 127.0.0.1, so only accept requests the board itself
// made: the Host must be local, the tunnel's or a LAN one (no DNS
// rebinding) and the Origin must match it.
export function assertFromBoard(request: Request) {
  const host = request.headers.get("host") ?? "";
  const origin = request.headers.get("origin");
  const fromBoard =
    isLocalRequest(request) || isLanRequest(request)
      ? origin === `http://${host}`
      : isTunnelRequest(request) && origin === `https://${host}`;
  if (!fromBoard) throw data("Forbidden", { status: 403 });
}

// Reads of files on disk. Another website can't read the response, but it
// could embed a script or probe which paths exist, so refuse any request a
// page on another site made.
export function assertLocalRead(request: Request) {
  assertLocalHost(request);
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") {
    throw data("Forbidden", { status: 403 });
  }
}

// No DNS rebinding: a site that points its own name at 127.0.0.1 would
// otherwise be same-origin with the board.
export function assertLocalHost(request: Request) {
  if (
    !isLocalRequest(request) &&
    !isTunnelRequest(request) &&
    !isLanRequest(request)
  ) {
    throw data("Forbidden", { status: 403 });
  }
}

export const SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
