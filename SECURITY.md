# Security Policy

It's a webpage to your terminal. We're gonna do all we can to help you lock it
down, but it's also not perfect. We're going to do our best to keep things
secure.

## Reporting a Vulnerability

Report directly to oss+seamux@codedrift.com

## What counts

The board is meant to answer only:

- requests from the board's own pages on `127.0.0.1`,
- with mDNS on, requests to this Mac's `.local` name carrying the board's HTTP Basic credentials,
- through the Cloudflare tunnel, requests carrying a valid Cloudflare Access token.

Anything else that can read the board, or make it act, is in scope: another website driving it from your browser, a request from the network without credentials, a tunnel request without a valid token, or a way to reach files or sessions the board shouldn't. [Remote connections](docs/remote-connections.md) describes each way in.

Out of scope: what a session does once someone who is allowed in sends it a prompt. That is the agent's own permission model. So is what someone allowed in runs in the board's [terminal](README.md#terminal), which is a shell on the Mac by design.
