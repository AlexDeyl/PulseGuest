import * as Popover from "@radix-ui/react-popover";
import { CalendarDays } from "lucide-react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "../../shared/cn";

export function DatePicker({
  value,
  onChange,
  placeholder = "Выберите дату",
  className,
}: {
  value: string; // ISO YYYY-MM-DD или ""
  onChange: (iso: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const selected = value ? parseISO(value) : undefined;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full items-center justify-between gap-2 rounded-2xl px-4 py-3 text-sm outline-none transition",
            "border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)]",
            "text-[color:var(--pg-text)] hover:bg-[color:var(--pg-card-hover)]",
            "focus:border-[color:var(--pg-input-border-focus)]",
            className
          )}
        >
          <span className={cn(!value && "text-[color:var(--pg-placeholder)]")}>
            {value ? format(parseISO(value), "d MMMM yyyy", { locale: ru }) : placeholder}
          </span>
          <CalendarDays className="h-4 w-4 text-[color:var(--pg-muted)]" />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          sideOffset={10}
          className={cn(
            "z-50 rounded-3xl border p-3 shadow-2xl backdrop-blur-xl",
            "border-[color:var(--pg-popover-border)] bg-[color:var(--pg-popover-bg)]"
          )}
        >
          <div className="rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-2">
            <DayPicker
              mode="single"
              selected={selected}
              onSelect={(d) => {
                if (!d) return;
                onChange(d.toISOString().slice(0, 10));
              }}
              weekStartsOn={1}
              locale={ru}
              showOutsideDays
              className="pg-calendar"
            />
          </div>

          <div className="mt-3 flex justify-end">
            <Popover.Close asChild>
              <button
                type="button"
                className="rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-4 py-2 text-xs text-[color:var(--pg-text)] hover:bg-[color:var(--pg-card-hover)]"
              >
                Закрыть
              </button>
            </Popover.Close>
          </div>

          <Popover.Arrow className="fill-[color:var(--pg-popover-bg)]" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
