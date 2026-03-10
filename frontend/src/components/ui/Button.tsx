import { cn } from "../../shared/cn";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
};

export function Button({ variant = "primary", className, ...props }: Props) {
  return (
    <button
      {...props}
      className={cn(
        "group inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--pg-input-border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
        "active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-55 disabled:shadow-none",
        variant === "primary" &&
          "bg-[image:var(--pg-gradient)] text-[color:var(--pg-on-primary)] shadow-[0_12px_32px_rgba(0,0,0,0.20)] hover:brightness-105",
        variant === "secondary" &&
          "border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] text-[color:var(--pg-text)] shadow-sm hover:border-[color:var(--pg-input-border-focus)]/40 hover:bg-[color:var(--pg-card-hover)]",
        className
      )}
    />
  );
}
