import { MemoryStick } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import type { MemoryPressure } from "~/lib/board";
import { cn } from "~/lib/utils";

export const MEMORY_LABELS: Record<
  Exclude<MemoryPressure, "normal">,
  { label: string; title: string }
> = {
  warn: {
    label: "Memory pressure",
    title:
      "macOS reports memory pressure: every new chat adds to it, and past this it starts closing apps",
  },
  critical: {
    label: "System loaded",
    title:
      "macOS reports critical memory pressure and may close apps, chats included. Close a chat before starting another",
  },
};

// Beside LAN and Remote in the header, from a warning up.
export function MemoryBadge({
  memory,
  className,
}: {
  memory: MemoryPressure | null;
  className?: string;
}) {
  if (!memory || memory === "normal") return null;
  const { label, title } = MEMORY_LABELS[memory];
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 text-xs",
        memory === "critical" ? "text-destructive" : "text-warning-text",
        className,
      )}
      title={title}
    >
      <MemoryStick className="size-3.5" />
      {label}
    </span>
  );
}

// Asked before starting another chat on a loaded Mac.
export function LoadedConfirm({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start another chat on a loaded Mac?</DialogTitle>
          <DialogDescription>
            macOS reports critical memory pressure. Every chat is its own
            process, and past this point macOS closes apps to free memory,
            chats mid-turn among them. Closing a chat first frees some.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            Start it anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
