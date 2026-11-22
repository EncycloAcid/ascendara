import { cn } from "@/lib/utils";

/**
 * A bordered tray holding stat tiles side by side. Each tile is a value block
 * over a caption strip, with a narrow gap between the two.
 */
export const StatGroup = ({ className, children }) => (
  <div
    className={cn(
      "grid auto-cols-fr grid-flow-col gap-3 rounded-[16px] border border-border/70 bg-background/60 p-2.5 backdrop-blur-md",
      className
    )}
  >
    {children}
  </div>
);

export const StatTile = ({ label, children, className, valueClassName }) => (
  <div className={cn("flex min-w-0 flex-col gap-1", className)}>
    <div
      className={cn(
        "flex min-h-[88px] flex-1 items-center justify-center gap-2 rounded-b-[4px] rounded-t-[10px] bg-card px-4 text-[1.6rem] font-semibold tracking-tight text-foreground/85",
        valueClassName
      )}
    >
      {children}
    </div>
    <div className="flex h-10 items-center justify-center truncate rounded-b-[10px] rounded-t-[4px] bg-card px-3 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground/70">
      {label}
    </div>
  </div>
);
