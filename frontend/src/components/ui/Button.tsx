import { cn } from "../../shared/cn";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
};

export function Button({ variant = "primary", className, ...props }: Props) {
  return (
    <button
      {...props}
      className={cn(
        "group inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold",
        "focus:outline-none focus:ring-2 focus:ring-[color:var(--pg-input-border-focus)] active:scale-[0.99]",
        "disabled:cursor-not-allowed disabled:opacity-60",
        variant === "primary" &&
          "bg-[image:var(--pg-gradient)] text-[color:var(--pg-on-primary)] shadow-[0_12px_40px_rgba(0,0,0,0.20)] hover:opacity-95",
        variant === "secondary" &&
          "border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] text-[color:var(--pg-text)] hover:bg-[color:var(--pg-card-hover)]",
        className
      )}
    />
  );
}
