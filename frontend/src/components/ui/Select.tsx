import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../../shared/cn";

export type SelectOption = { value: string; label: string };

export function Select({
  value,
  onValueChange,
  options,
  placeholder = "Выберите…",
  className,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
      <SelectPrimitive.Trigger
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-2xl px-4 py-3 text-sm outline-none transition",
          "border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)]",
          "text-[color:var(--pg-text)] hover:bg-[color:var(--pg-card-hover)]",
          "focus:border-[color:var(--pg-input-border-focus)]",
          className
        )}
      >
        <SelectPrimitive.Value
          placeholder={placeholder}
          className="text-[color:var(--pg-text)] data-[placeholder]:text-[color:var(--pg-placeholder)]"
        />
        <SelectPrimitive.Icon>
          <ChevronDown className="h-4 w-4 text-[color:var(--pg-muted)]" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={10}
          className={cn(
            "z-50 overflow-hidden rounded-2xl border shadow-2xl backdrop-blur-xl",
            "border-[color:var(--pg-popover-border)] bg-[color:var(--pg-popover-bg)]"
          )}
        >
          <SelectPrimitive.Viewport className="p-2">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                className={cn(
                  "relative flex cursor-pointer select-none items-center rounded-xl px-3 py-2 text-sm outline-none transition",
                  "text-[color:var(--pg-text)]",
                  "data-[highlighted]:bg-[color:var(--pg-card-hover)]"
                )}
              >
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-2">
                  <Check className="h-4 w-4 text-emerald-500/90" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
