import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("sessions/:sessionId/messages", "routes/session-messages.ts"),
  route("sessions/:sessionId/action", "routes/session-action.ts"),
  route("sessions/:sessionId/commands", "routes/session-commands.ts"),
  route("services/:service/action", "routes/service-action.ts"),
  route("dispatch", "routes/dispatch.ts"),
  route("terminal", "routes/terminal.ts"),
  route("directories", "routes/directories.ts"),
  route("config", "routes/config.ts"),
  route("diagnostics", "routes/diagnostics.ts"),
  route("reset", "routes/reset.ts"),
  route("theme/set", "routes/theme-set.ts"),
  route("theme/events", "routes/theme-events.ts"),
  route("restart", "routes/restart.ts"),
  route("file", "routes/file.tsx"),
  route("file/stat", "routes/file-stat.ts"),
  route("file/download", "routes/file-download.ts"),
  route("file/raw/*", "routes/file-raw.ts", { id: "file-raw" }),
  route("file/sandbox/*", "routes/file-raw.ts", { id: "file-sandbox" }),
] satisfies RouteConfig;
