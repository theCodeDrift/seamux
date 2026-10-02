# Remote connections

Out of the box the board answers only this Mac: a request must come from this Mac, addressed to `localhost`, `127.0.0.1` or `[::1]`. Any other name, even one that points at this Mac, is refused, so a website can't point its own domain at `127.0.0.1` and read the board. The config dialog's Remote tab has two other ways in, either or both:

- **mDNS**, for devices on the same network: the board answers at this Mac's `.local` name, behind its HTTP Basic password.
- **A Cloudflare tunnel**, for anywhere: the board answers at a hostname of yours, behind Cloudflare Access.

On a phone the board shows one column at a time; see [Columns](../README.md#columns). Through the tunnel it can also be added to the Home Screen, where it opens full screen with its own icon.

Both sit under one switch, **Enable remote connections**. With it off, neither is open and the Remote tab hides their settings. With it on, each has its own switch, and both can be on at once: say, a phone at home over mDNS and a laptop elsewhere through the tunnel. Each keeps its own login: the password at the `.local` name, Cloudflare Access at the tunnel's hostname.

Whenever `SEAMUX_USER` and `SEAMUX_PASS` are set, every request asks for them, from this Mac too and for every file the board serves, except through the tunnel, where Cloudflare Access is the login. Every switch on the tab can only be turned on from this Mac, and turns off from anywhere, so a lost phone can't reopen the board once you've shut it.

<!-- Screenshot: the Remote tab with remote connections off -->

## mDNS

<!-- Screenshot: the Remote tab with mDNS on -->

macOS already answers for its Bonjour name on every network it joins. The name is the LocalHostName under System Settings → General → Sharing, and `scutil --get LocalHostName` prints it. **Enable mDNS** opens the board to the network at that name: `http://<name>.local:54321`. The Remote tab shows the address.

Before you turn it on:

1. [Set a password](getting-started.md#set-a-password). mDNS won't turn on without `SEAMUX_USER` and `SEAMUX_PASS`, and a request from the network is refused while either is unset.
2. Run the board under its supervisor (`npx seamux`, or `npm run seamux` in a clone). The server picks the address it listens on at startup, so the supervisor restarts it when mDNS is switched on or off. Without the supervisor, restart the board yourself.

Then turn on **Enable remote connections** and **Enable mDNS**. The board restarts, listening on every interface rather than only loopback, and the header shows "LAN". The first time, macOS may ask whether to accept incoming connections to `node`; allow it, or the firewall blocks the network.

A request from another machine must:

- be addressed to `<name>.local`. The same board reached by its IP address, or with a forged `Host: 127.0.0.1`, is refused, so a request from the network can never pass as one from this Mac;
- carry the HTTP Basic credentials, including requests for Vite's own files. So does a request from this Mac.

HTTP Basic over plain HTTP sends the password unencrypted, and anyone on the network can read it. Use mDNS on networks you trust, and the tunnel everywhere else.

Turning mDNS off shuts the network out straight away, and the board then restarts to listen on loopback only.

## Cloudflare tunnel

<!-- Screenshot: the Enable Cloudflare Tunnel section, expanded -->

A Cloudflare named tunnel connects out from this Mac to Cloudflare, so the tunnel alone keeps the board listening on loopback only, and nothing on your network changes. It answers `localhost` as it does out of the box, and the tunnel's hostname only for `cloudflared`, on this Mac. With mDNS on too, the board listens on the network, but a request from the network addressed to the tunnel's hostname is still refused, so nothing there can pass as `cloudflared`. Cloudflare Access sits in front of it and asks you to log in.

The Remote tab's **Enable Cloudflare Tunnel** section starts collapsed, and opens by itself once any of its variables is set.

### Set it up once

1. `brew install cloudflared`.
2. **Tunnel.** In the Cloudflare dashboard, open Zero Trust → Networks → Tunnels and mesh (`https://dash.cloudflare.com/<account>/one/networks/connectors`) and create a tunnel. Give it a public hostname on a domain Cloudflare serves, such as `seamux.example.com`, pointing at `http://localhost:54321` (the board's port). Put the tunnel's token in `SEAMUX_CF_TOKEN` and the hostname in `SEAMUX_CF_DOMAIN`.
3. **Access application.** Open Access Controls → Applications (`https://dash.cloudflare.com/<account>/one/access-controls/apps`) and add a self-hosted application with a policy that allows only you. A self-hosted application defaults to a private IP: switch its destination to a public hostname and fill in both the subdomain and the domain. Left without the subdomain, it protects only the bare domain, and the board answers every request with a 403. Put the application's AUD tag, from its Additional settings tab, in `SEAMUX_CF_AUD`.
4. **Team.** Your team name is on the right of Zero Trust's Get started page (`https://dash.cloudflare.com/<account>/one/overview/get-started`). Put it in `SEAMUX_CF_TEAM`, as the name or as `<team>.cloudflareaccess.com`.
5. Restart the board, since the server reads the hostname once at startup.

All four variables go in seamux's `.env` (`~/.seamux/.env`, or the clone's) or the environment. `SEAMUX_CF_TUNNEL`, the tunnel's id, is optional and only shown in the Remote tab.

To check Access covers the hostname, run `curl -sI https://seamux.example.com`. It should redirect (302) to `<team>.cloudflareaccess.com`. A 403 `Forbidden` without that redirect means requests reach the board without an Access token, so fix the application's hostname.

### Turn it on

Turn on **Enable remote connections**, open **Enable Cloudflare Tunnel**, and switch on **Serve the board at…**. The switch can only be turned on once all four variables are set.

While it's on, the supervisor runs `cloudflared`, restarts it if it exits, and writes its log to `data/tunnel.log`. The header shows "Remote".

### How requests are checked

A request through the tunnel must carry a valid Cloudflare Access token for that team and application, including requests for Vite's own files. It's then let in without the HTTP Basic password. Without a valid token it gets a 403, so if the Access application is ever removed, the board stays shut. A refused request gets a Forbidden page that says why, and the board logs it.

Everything the board answers through the tunnel tells Cloudflare not to cache it, since the board is live. If a page through the tunnel still looks older than the same page on `localhost`, purge the hostname's cache in the Cloudflare dashboard.

## Where the switches are kept

In `.seamux.json`, so they survive restarts:

```json
{ "port": 54321, "remote": true, "mdns": false, "tunnel": true }
```

`remote` is **Enable remote connections**; `mdns` and `tunnel` apply only while it's on. Before mDNS, `remote` was the tunnel's own switch, so a file without `tunnel` keeps the tunnel as `remote` has it.
