# Vite and React Router

The board's own web stack: the dev server the supervisor runs from a checkout, the compiled server (`server/serve.ts`) an installed package runs, and the browsers that load them. Measured on macOS 26.5.1 with Vite 8.3.0 and React Router 7.18.4 unless an entry says otherwise.

Entries about the web stack that live in other domains:

- [The origin sees the public hostname as `Host`](cloudflare-tunnel.md#the-origin-sees-the-public-hostname-as-host): Vite's `allowedHosts`.
- [cloudflared forwards over http, so React Router refuses actions](cloudflare-tunnel.md#cloudflared-forwards-over-http-so-react-router-refuses-actions): `allowedActionOrigins`.
- [Vite's `host: true` listens on `*` over IPv6, dual-stack](mdns.md#vites-host-true-listens-on--over-ipv6-dual-stack).
- [Vite refuses a `.local` name sent in capitals, before any plugin sees the request](mdns.md#vite-refuses-a-local-name-sent-in-capitals-before-any-plugin-sees-the-request): `allowedHosts`.

## React Router's dev server copies `.env` into `process.env`, and never takes a variable back out

It calls `Object.assign(process.env, loadEnv(...))` from its plugin's `config` hook, at startup and again when Vite restarts itself over a changed `.env`. That hook runs after `vite.config.ts` is evaluated, in the same process, so a variable deleted from `.env` stayed set until the process exited.

- **Measured:** Vite 8.3.0, React Router 7.18.4.
- **In seamux:** `forgetDotenv` in [credentials.ts](../app/lib/credentials.ts), called at the top of [vite.config.ts](../vite.config.ts), clears every `SEAMUX_` variable the dev server's own environment didn't set, before each load.

## React Router checks a POST's Origin only on its `.data` requests, never on a plain POST to a resource route

A POST to `/config.data`, which is how the board's own fetchers send an action, with `Origin: http://evil.example` got a 400 "Bad Request" from React Router before the action ran. The same POST to `/config` reached the action, and `assertFromBoard` answered 403. A POST to `/theme-swap` (now `/theme/set`) with that Origin got 204, back when that route checked a token in place of the Origin. React Router's check runs in `singleFetchAction` and `handleDocumentRequest`, and not in `handleResourceRequest`, which serves every route without a page. That covers all of seamux's actions, so a form another site posts to one of them meets `assertFromBoard` and nothing else.

This entry used to say React Router refuses a cross-origin POST before any action runs. That held only for the `.data` request the board sends, which is where it was first seen.

- **Measured:** React Router 7.18.4, Vite 8.3.0.
- **In seamux:** `assertFromBoard` in [guard.server.ts](../app/lib/guard.server.ts), which every action but [theme-set.ts](../app/routes/theme-set.ts) calls; that one, for scripts, refuses any Origin but the board's own.
- **See also:** [cloudflared forwards over http, so React Router refuses actions](cloudflare-tunnel.md#cloudflared-forwards-over-http-so-react-router-refuses-actions).

## Vite serves its pre-bundled dependencies as immutable

They go out as `Cache-Control: max-age=31536000,immutable`. Safari on an iPhone keeps them and doesn't ask for them again on a reload. After the board restarted and re-bundled, the phone's page failed on every render with `null is not an object (evaluating 'dispatcher.useContext')`, two copies of React, and reloading a dozen times didn't clear it. Vite answers a revalidation with a 304, so asking costs little.

- **Measured:** macOS 26.5.1, Vite 8.3.0, React Router 7.18.4, Safari on iOS.
- **In seamux:** the `revalidateDeps` plugin in [vite.config.ts](../vite.config.ts) sends `no-cache` in place of `immutable`.
- **See also:** [Safari honours `Clear-Site-Data: "cache"`](#safari-honours-clear-site-data-cache-and-chrome-ignored-it-on-127001), for a phone already stuck.

## Safari honours `Clear-Site-Data: "cache"`, and Chrome ignored it on `127.0.0.1`

An immutable script came from the cache on reload, and after a page answering with the header, WebKit fetched it again and Chromium didn't. Only clearing all browsing data got the iPhone off the duplicate React.

- **Measured:** Playwright's WebKit and Chromium; versions not recorded.
- **In seamux:** [app/routes/reset.ts](../app/routes/reset.ts), the `/reset` page, sends the header, and the error page links to it.
- **See also:** [Try it in Playwright's WebKit](measuring.md#try-it-in-playwrights-webkit).

## Vite doesn't always move an import's `?t=` stamp

The dev server rewrites `import "./app.css"` in `root.tsx` to `/app/app.css?t=<last hot update>`. A landing at 15:52 changed `app.css` and the stamp stayed at 14:57, the landing before, so the same URL served a different stylesheet. A fresh start of the dev server drops the stamp altogether, back to a URL served before.

- **Measured:** Vite 8.3.0, React Router 7.18.4, `@tailwindcss/vite` 4.
- **In seamux:** `bustStylesheet` in [vite.config.ts](../vite.config.ts) adds `?boot=<server start>` to the import, in dev only; the compiled board's stylesheet is named by its hash.
- **See also:** [Cloudflare's edge kept a stylesheet the board had changed](cloudflare-tunnel.md#cloudflares-edge-kept-a-stylesheet-the-board-had-changed), and [Vite's file watcher missed a landing](#vites-file-watcher-missed-a-landing), which leaves every stamp where it was.

## Vite's file watcher missed a landing

After `npm run land` fast-forwarded main, the files on disk were new and the dev server kept serving the old ones: `dispatch-bar.tsx` without the landed change, its importers still stamped with the landing before, and a stylesheet without the Tailwind classes the change used. It stayed that way through reloads, on `localhost` as much as on a phone, until the board restarted. The landing before it, half an hour earlier on the same server, was picked up. A throwaway Vite project with its watcher off (`server.watch: null`) shows the cure: emitting `change` for a file on `server.watcher` updates it as an edit would, a new stamp on its importers and the stylesheet's, and a stylesheet regenerated with the file's classes.

- **Measured:** macOS 26.5.1, Vite 8.3.0, React Router 7.18.4, `@tailwindcss/vite` 4.3.3. Why the watcher missed it is not known.
- **In seamux:** [scripts/land.ts](../scripts/land.ts) records the files a landing changed in `data/board.landed` ([scripts/landed.ts](../scripts/landed.ts)); `replayLandings` in [vite.config.ts](../vite.config.ts) polls that file and emits a change for each.

## Vite serves any `v=` query as immutable

A module requested with a `v=` query goes out as `Cache-Control: max-age=31536000,immutable`, as the pre-bundled dependencies do: Vite's `DEP_VERSION_RE` matches `v=` anywhere in the query, whatever the module. `bustStylesheet`'s `?v=` put the stylesheet under it, so a browser was told to keep each start's stylesheet for a year. Any other name, such as `?boot=`, goes out as `no-cache`.

- **Measured:** Vite 8.3.0, `@tailwindcss/vite` 4.3.3.
- **In seamux:** `bustStylesheet` in [vite.config.ts](../vite.config.ts) uses `?boot=`.
- **See also:** [Vite serves its pre-bundled dependencies as immutable](#vite-serves-its-pre-bundled-dependencies-as-immutable).

## A resource route's `ReadableStream` reaches the browser unbuffered, through the dev server

A loader returning `new Response(stream, { headers: { "Content-Type": "text/event-stream" } })` delivered each event to an `EventSource` as it was enqueued: a theme set by POST reached an open board in 6 to 55 ms, against the 3 seconds the poll took. Neither Vite's middleware nor React Router's request handler held the body back. Through the compiled server and through Cloudflare's tunnel it's unmeasured.

- **Measured:** React Router 7.18.4, Vite 8.3.0, Chrome 154.0.8037.95, macOS 26.5.1.
- **In seamux:** [theme-events.ts](../app/routes/theme-events.ts), and `useThemeSync` in [use-theme.ts](../app/lib/use-theme.ts).

## Chrome won't show a PDF in a sandboxed document, and says `ERR_BLOCKED_BY_CLIENT`

A rendered HTML page in the file viewer linked its exported PDF with `target="_blank"`. The new tab opened at the PDF's `/file/sandbox/…` URL and showed "This page has been blocked by Chrome" with `ERR_BLOCKED_BY_CLIENT`, the error an ad blocker gives, though none was involved. Two things sandboxed that tab, and either one blocks Chrome's PDF viewer: a popup from a sandboxed frame inherits its sandbox unless the frame allows `allow-popups-to-escape-sandbox`, and the PDF's own `Content-Security-Policy: sandbox …` sandboxes it even when opened directly. So the viewer's frame lets popups leave the sandbox, which is safe because every HTML file seamux serves arrives sandboxed by its own header, and a PDF's bytes carry no sandbox header.

- **Measured:** Chrome 155.0.8059.40 on macOS 26.5.1, from a real page on the tunnel; the fix not yet re-measured there.
- **In seamux:** `SANDBOX_FLAGS` in [app/lib/files.ts](../app/lib/files.ts), on the viewer's frame in [app/routes/file.tsx](../app/routes/file.tsx), and `fileResponse` in [app/lib/files.server.ts](../app/lib/files.server.ts).
