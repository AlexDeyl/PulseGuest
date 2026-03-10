from __future__ import annotations

from typing import Any, TypedDict


class HumanField(TypedDict, total=False):
    key: str
    label: str
    kind: str
    value_text: str
    raw_value: Any


def _human_fallback_label(field: str, ftype: str | None = None) -> str:
    key = (field or "").lower()
    t = (ftype or "").lower()
    if t == "email" or "email" in key:
        return "Email"
    if t == "phone" or "phone" in key or "tel" in key:
        return "Телефон"
    if key == "name" or "first_name" in key:
        return "Имя"
    if "comment" in key:
        return "Комментарий"
    if "rating" in key or "nps" in key:
        return "Оценка"
    return field


def _safe_str(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, (str, int, float, bool)):
        return str(v)
    try:
        import json

        return json.dumps(v, ensure_ascii=False)
    except Exception:
        return str(v)


def humanize_extra_answers(
    *,
    schema: dict[str, Any] | None,
    answers: dict[str, Any] | None,
    dev: bool = False,
    hide_unknown: bool = True,
    skip_keys: set[str] | None = None,
) -> list[HumanField]:
    """Convert raw answers into UI-friendly rows.

    Mirrors FE mapping (rating/text/choice/contact + __other_text).
    Used to avoid returning full raw JSON answers/meta in non-dev mode.
    """
    schema = schema or {}
    answers = answers or {}
    skip = skip_keys or set()

    defs: dict[str, dict[str, Any]] = {}
    slides = schema.get("slides")
    if not isinstance(slides, list):
        slides = []

    for slide in slides:
        if not isinstance(slide, dict):
            continue
        stype = str(slide.get("type") or "")
        title = str(slide.get("title") or "").strip()

        if stype in ("rating", "nps"):
            field = str(slide.get("field") or "rating_overall")
            defs[field] = {
                "label": title or _human_fallback_label(field, stype),
                "kind": "rating",
            }
            continue

        if stype == "text":
            field = str(slide.get("field") or "").strip()
            if not field:
                continue
            defs[field] = {
                "label": title or _human_fallback_label(field, stype),
                "kind": "text",
            }
            continue

        if stype == "choice":
            field = str(slide.get("field") or "").strip()
            if not field:
                continue
            mode = str(slide.get("mode") or "single")
            raw_options = slide.get("options")
            options: list[dict[str, str]] = []
            if isinstance(raw_options, list):
                for o in raw_options:
                    if not isinstance(o, dict):
                        continue
                    val = str(o.get("value") or "").strip()
                    lab = str(o.get("label") or o.get("value") or "").strip()
                    if val and lab:
                        options.append({"value": val, "label": lab})

            defs[field] = {
                "label": title or _human_fallback_label(field, stype),
                "kind": "choice_multi" if mode == "multi" else "choice_single",
                "options": options,
            }
            continue

        if stype == "contact":
            fields = slide.get("fields")
            if not isinstance(fields, list):
                fields = []
            for f in fields:
                if not isinstance(f, dict):
                    continue
                field = str(f.get("field") or "").strip()
                if not field:
                    continue
                ftype = str(f.get("type") or "").strip()
                flabel = str(f.get("label") or "").strip()
                defs[field] = {
                    "label": flabel or _human_fallback_label(field, ftype),
                    "kind": "contact",
                }

    other_text: dict[str, str] = {}
    for k, v in list(answers.items()):
        if isinstance(k, str) and k.endswith("__other_text"):
            base = k[: -len("__other_text")]
            txt = str(v or "").strip()
            if txt:
                other_text[base] = txt

    rows: list[HumanField] = []

    for k, raw in list(answers.items()):
        if raw is None:
            continue
        if not isinstance(k, str):
            continue
        if k.endswith("__other_text"):
            continue
        if k in skip:
            continue

        d = defs.get(k)
        if d is None:
            if hide_unknown:
                continue
            row: HumanField = {
                "key": k,
                "label": f"Неизвестное поле ({k})",
                "kind": "unknown",
                "value_text": _safe_str(raw),
            }
            if dev:
                row["raw_value"] = raw
            rows.append(row)
            continue

        kind = str(d.get("kind") or "unknown")
        label = str(d.get("label") or k)
        value_text = ""

        if kind in ("rating", "text", "contact"):
            value_text = _safe_str(raw)
        elif kind == "choice_single":
            rv = _safe_str(raw)
            if rv == "other":
                value_text = f"Другое: {other_text.get(k)}" if other_text.get(k) else "Другое"
            else:
                opt = next((o for o in d.get("options") or [] if o.get("value") == rv), None)
                value_text = (opt.get("label") if opt else None) or rv
        elif kind == "choice_multi":
            if isinstance(raw, list):
                arr = [_safe_str(x).strip() for x in raw]
                arr = [x for x in arr if x]
            else:
                rv = _safe_str(raw).strip()
                arr = [rv] if rv else []

            parts: list[str] = []
            for rv in arr:
                if rv == "other":
                    parts.append(f"Другое: {other_text.get(k)}" if other_text.get(k) else "Другое")
                    continue
                opt = next((o for o in d.get("options") or [] if o.get("value") == rv), None)
                parts.append((opt.get("label") if opt else None) or rv)
            value_text = ", ".join([p for p in parts if p.strip()])

        if (not dev) and (not str(value_text).strip()):
            continue

        row2: HumanField = {
            "key": k,
            "label": label,
            "kind": kind,
            "value_text": value_text,
        }
        if dev:
            row2["raw_value"] = raw
        rows.append(row2)

    return rows
