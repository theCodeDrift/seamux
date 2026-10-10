import type { ComponentProps } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "~/lib/utils";

/**
 * A native select with its own chevron. Chrome on macOS pins the native
 * arrow to the border, whatever the padding, so the select drops its
 * appearance and draws the chevron the directory picker uses. `className`
 * places the wrapper; `selectClassName` styles the select itself.
 */
export function NativeSelect({
  className,
  selectClassName,
  ...props
}: ComponentProps<"select"> & { selectClassName?: string }) {
  return (
    <span className={cn("relative inline-flex", className)}>
      <select
        {...props}
        className={cn(
          "w-full appearance-none rounded-lg border bg-background py-1.5 pr-8 pl-2.5 text-sm",
          selectClassName,
        )}
      />
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  );
}
