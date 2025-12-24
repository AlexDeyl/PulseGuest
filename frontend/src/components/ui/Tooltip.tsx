import * as TooltipPrimitive from "@radix-ui/react-tooltip";

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={250}>{children}</TooltipPrimitive.Provider>;
}

export function Tooltip({
  content,
  children,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={10}
          className="z-50 max-w-xs rounded-xl border border-[color:var(--pg-popover-border)] bg-[color:var(--pg-popover-bg)] px-3 py-2 text-xs text-[color:var(--pg-text)] shadow-2xl backdrop-blur"
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-[color:var(--pg-popover-bg)]" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
