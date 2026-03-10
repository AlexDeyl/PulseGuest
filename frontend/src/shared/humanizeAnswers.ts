type ChoiceOption = { value: string; label: string };

type FieldDef = {
  key: string;
  label: string;
  kind: "rating" | "text" | "choice_single" | "choice_multi" | "contact";
  options?: ChoiceOption[];
};

export type HumanFieldRow = {
  key: string;
  label: string;
  kind: FieldDef["kind"] | "unknown";
  valueText: string;
  rawValue: unknown;
};

function humanFallbackLabel(field: string, ftype?: string) {
  const key = (field || "").toLowerCase();
  const t = (ftype || "").toLowerCase();
  if (t === "email" || key.includes("email")) return "Email";
  if (t === "phone" || key.includes("phone") || key.includes("tel")) return "Телефон";
  if (key === "name" || key.includes("first_name")) return "Имя";
  if (key.includes("comment")) return "Комментарий";
  if (key.includes("rating") || key.includes("nps")) return "Оценка";
  return field;
}

function safeStr(v: unknown) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function buildDefsFromSchema(schema: any): Record<string, FieldDef> {
  const defs: Record<string, FieldDef> = {};
  const slides = Array.isArray(schema?.slides) ? schema.slides : [];

  for (const slide of slides) {
    if (!slide || typeof slide !== "object") continue;
    const stype = String((slide as any).type ?? "");
    const title = String((slide as any).title ?? "").trim();

    if (stype === "rating" || stype === "nps") {
      const field = String((slide as any).field ?? "rating_overall");
      defs[field] = {
        key: field,
        label: title || humanFallbackLabel(field, stype),
        kind: "rating",
      };
      continue;
    }

    if (stype === "text") {
      const field = String((slide as any).field ?? "");
      if (!field) continue;
      defs[field] = {
        key: field,
        label: title || humanFallbackLabel(field, stype),
        kind: "text",
      };
      continue;
    }

    if (stype === "choice") {
      const field = String((slide as any).field ?? "");
      if (!field) continue;
      const mode = String((slide as any).mode ?? "single");
      const rawOptions = (slide as any).options;
      const options: ChoiceOption[] = Array.isArray(rawOptions)
        ? rawOptions
            .filter((o: any) => o && typeof o === "object")
            .map((o: any) => ({
              value: String(o.value ?? ""),
              label: String(o.label ?? o.value ?? ""),
            }))
            .filter((o: any) => o.value && o.label)
        : [];
      defs[field] = {
        key: field,
        label: title || humanFallbackLabel(field, stype),
        kind: mode === "multi" ? "choice_multi" : "choice_single",
        options,
      };
      continue;
    }

    if (stype === "contact") {
      const fields = Array.isArray((slide as any).fields) ? (slide as any).fields : [];
      for (const f of fields) {
        if (!f || typeof f !== "object") continue;
        const field = String((f as any).field ?? "");
        if (!field) continue;
        const ftype = String((f as any).type ?? "");
        const flabel = String((f as any).label ?? "").trim();
        defs[field] = {
          key: field,
          label: flabel || humanFallbackLabel(field, ftype),
          kind: "contact",
        };
      }
    }
  }

  return defs;
}

function kindLabel(kind: HumanFieldRow["kind"]) {
  switch (kind) {
    case "rating":
      return "Оценка";
    case "text":
      return "Текст";
    case "choice_single":
      return "Выбор (один)";
    case "choice_multi":
      return "Выбор (несколько)";
    case "contact":
      return "Контакт";
    default:
      return "Поле";
  }
}

export function humanizeAnswers(
  schema: any,
  answers: Record<string, unknown>,
  opts?: { dev?: boolean; hideUnknown?: boolean }
): HumanFieldRow[] {
  const dev = Boolean(opts?.dev);
  const hideUnknown = opts?.hideUnknown ?? !dev;

  const defs = buildDefsFromSchema(schema);
  const otherText: Record<string, string> = {};

  // Собираем __other_text заранее и не отображаем его отдельной строкой.
  for (const [k, v] of Object.entries(answers || {})) {
    if (k.endsWith("__other_text")) {
      const base = k.slice(0, -"__other_text".length);
      const txt = String(v ?? "").trim();
      if (txt) otherText[base] = txt;
    }
  }

  const rows: HumanFieldRow[] = [];

  for (const [k, raw] of Object.entries(answers || {})) {
    if (raw == null) continue;
    if (k.endsWith("__other_text")) continue;

    const def = defs[k];
    if (!def) {
      if (hideUnknown) continue;
      rows.push({
        key: k,
        label: `Неизвестное поле (${k})`,
        kind: "unknown",
        valueText: safeStr(raw),
        rawValue: raw,
      });
      continue;
    }

    let valueText = "";

    if (def.kind === "rating" || def.kind === "text" || def.kind === "contact") {
      valueText = safeStr(raw);
    }

    if (def.kind === "choice_single") {
      const rv = safeStr(raw);
      if (rv === "other") {
        valueText = otherText[k] ? `Другое: ${otherText[k]}` : "Другое";
      } else {
        const opt = (def.options || []).find((o) => o.value === rv);
        valueText = opt?.label ?? rv;
      }
    }

    if (def.kind === "choice_multi") {
      const arr = Array.isArray(raw) ? raw.map((x) => safeStr(x)).filter(Boolean) : [safeStr(raw)].filter(Boolean);
      const parts: string[] = [];
      for (const rv of arr) {
        if (rv === "other") {
          parts.push(otherText[k] ? `Другое: ${otherText[k]}` : "Другое");
          continue;
        }
        const opt = (def.options || []).find((o) => o.value === rv);
        parts.push(opt?.label ?? rv);
      }
      valueText = parts.join(", ");
    }

    if (!dev && String(valueText).trim() === "") continue;

    rows.push({
      key: k,
      label: def.label,
      kind: def.kind,
      valueText,
      rawValue: raw,
    });
  }

  return rows;
}

export function humanKindLabel(kind: HumanFieldRow["kind"]) {
  return kindLabel(kind);
}
