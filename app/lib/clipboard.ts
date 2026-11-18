// Copies `text` to the clipboard, resolving whether it did. The Clipboard API
// exists only in a secure context, so on the board opened over LAN access, a
// plain-HTTP origin, `navigator.clipboard` is undefined; there it falls back to
// `execCommand("copy")` on a hidden textarea, which still works from a click.
export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Refused, as when the document lacks focus: try the fallback.
    }
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "0";
  area.style.opacity = "0";
  // Inside an open dialog, so its focus trap doesn't pull focus back out.
  const host =
    document.activeElement?.closest("[role=dialog]") ?? document.body;
  host.append(area);
  const focused = document.activeElement as HTMLElement | null;
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  focused?.focus({ preventScroll: true });
  return ok;
}
