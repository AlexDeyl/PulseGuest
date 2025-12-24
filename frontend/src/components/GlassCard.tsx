import { cn } from "../shared/cn";

export default function GlassCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
        className={cn(
            "rounded-3xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-6",
            "backdrop-blur-xl",
            "shadow-[var(--pg-shadow)]",
            "ring-1 ring-inset ring-[color:var(--pg-inset)]",
            className
        )}
        >
      {children}
    </div>
  );
}
