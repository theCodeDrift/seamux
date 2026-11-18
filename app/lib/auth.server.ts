import type { MiddlewareFunction } from "react-router";

import {
  basicAuthHeader,
  readCredentials,
  sameSecret,
} from "~/lib/credentials";
import {
  ACCESS_HEADER,
  checkTunnelRequest,
  forbiddenPage,
  isLanHost,
} from "~/lib/remote.server";
import { SEAMUX_HOME } from "~/lib/paths.server";

// In front of every route: documents, data requests and actions. The
// servers' remoteGate has already checked every request, by its socket too;
// this checks again what it can without the socket.
//
// Through the tunnel, Cloudflare Access is the login: the request must carry
// a valid Access token, and HTTP Basic isn't asked for. Otherwise HTTP Basic,
// when credentials are configured. Without them it lets everything through,
// since remoteGate only lets this Mac in then, except at a LAN name,
// which never answers without them.
export const requireAuth: MiddlewareFunction<Response> = async (
  { request },
  next,
) => {
  const tunnel = await checkTunnelRequest(
    SEAMUX_HOME,
    request.headers.get("host"),
    request.headers.get(ACCESS_HEADER),
  );
  if (tunnel.verdict === "allowed") return next();
  if (tunnel.verdict === "denied") {
    return new Response(forbiddenPage(tunnel.reason), {
      status: 403,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  const credentials = readCredentials(SEAMUX_HOME);
  if (!credentials) {
    if (!isLanHost(SEAMUX_HOME, request.headers.get("host"))) return next();
    return new Response(
      forbiddenPage(
        "SEAMUX_USER and SEAMUX_PASS are unset, and the board doesn't answer the network without them",
        false,
      ),
      { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
  const given = request.headers.get("authorization") ?? "";
  if (sameSecret(given, basicAuthHeader(credentials))) return next();
  return new Response("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="seamux", charset="UTF-8"' },
  });
};
