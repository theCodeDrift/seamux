# mDNS

Reaching the board on the local network by this Mac's `.local` name or IP address (LAN access), behind the board's HTTP Basic credentials. Measured on macOS 26.5.1 with Vite 8.3.0 and React Router 7.18.4. [docs/remote-connections.md](../docs/remote-connections.md) is the setup guide.

In seamux: `lanHost`, `lanAddresses`, `isLanHost`, `isLoopback` and `remoteGate` in [remote.server.ts](../app/lib/remote.server.ts). What the dev server does along the way is in [Vite and React Router](vite-and-react-router.md), including [Safari's cache](vite-and-react-router.md#vite-serves-its-pre-bundled-dependencies-as-immutable), which a phone on the network found first.

## `scutil --get LocalHostName` is the name Bonjour answers for

On a Mac whose `hostname` is `My-Mac.local`, it's `My-Mac`. macOS already answers for it on every network it joins, so seamux has nothing to advertise.

- **Measured:** macOS 26.5.1.
- **In seamux:** `lanHost` in [remote.server.ts](../app/lib/remote.server.ts).

## A Mac resolves its own `.local` name to `::1` first

`curl http://<name>.local:<port>/` on the Mac itself connects over loopback, so it counts as local. Testing a request from the network needs `--resolve <name>.local:<port>:<LAN address>`.

- **Measured:** macOS 26.5.1.
- **See also:** [Fake a request from the network](measuring.md#fake-a-request-from-the-network).

## Vite's `host: true` listens on `*` over IPv6, dual-stack

An IPv4 peer shows up as `::ffff:192.168.1.151`, and IPv4 loopback as `::ffff:127.0.0.1`, so the loopback check matches both forms.

- **Measured:** macOS 26.5.1, Vite 8.3.0.
- **In seamux:** `isLoopback` in [remote.server.ts](../app/lib/remote.server.ts).

## Vite lets any IP address through `allowedHosts`, whatever it lists

A dev server with `allowedHosts: []` answered `Host: 192.168.1.5:54999` and `Host: [2001:db8::1]:54999` with 200, and `Host: evil.example:54999` and `Host: osmium.local:54999` with 403. `isHostAllowed` returns true for any IPv4 or IPv6 Host before it reads the list, so reaching the board at this Mac's own address takes nothing from Vite, and only seamux's gate decides it. Node's `fetch` drops a `Host` it's given and sends the URL's, so test this with `curl -H 'Host: …'`.

- **Measured:** Vite 8.3.0, Node 24, macOS 26.5.1.
- **In seamux:** `lanAddresses` and `checkRequest` in [remote.server.ts](../app/lib/remote.server.ts); [vite.config.ts](../vite.config.ts) lists only the `.local` name.

## Vite refuses a `.local` name sent in capitals, before any plugin sees the request

`curl` to `http://Osmium.local:54321/` sends `Host: Osmium.local:54321` as typed, and the dev server answered 403 "Blocked request. This host ("Osmium.local") is not allowed.", while `Host: osmium.local:54321` got the board. A browser lowercases the name before sending it, so only scripts and Shortcuts met it. Vite's `isHostAllowed` compares the Host with `server.allowedHosts` case for case, and `lanHost` gives the name lowercased, as `osmium.local`. Vite adds that check to its middleware before it runs any plugin's `configureServer`, so seamux's own gate, a `configureServer` middleware, never saw the request. A `request` listener prepended on Vite's `httpServer` runs ahead of both.

- **Measured:** Vite 8.3.0, macOS 26.5.1.
- **In seamux:** `lowercaseHost` in [remote.server.ts](../app/lib/remote.server.ts), which [vite.config.ts](../vite.config.ts) prepends to the dev server's `request` listeners and [server/serve.ts](../server/serve.ts) runs first.
- **See also:** [`scutil --get LocalHostName` is the name Bonjour answers for](#scutil---get-localhostname-is-the-name-bonjour-answers-for).
