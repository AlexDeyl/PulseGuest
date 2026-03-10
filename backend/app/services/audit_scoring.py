from __future__ import annotations

from typing import Any, Iterable, TypedDict


class AuditRunScore(TypedDict):
    score_sum: int | float
    score_max: int | float
    score_percent: float | None
    answered_scored: int
    total_scored_questions: int


_NA_CHOICES = {
    "",
    "n/a",
    "na",
    "n\\a",
    "not_applicable",
    "not-applicable",
    "none",
    "skip",
    "skipped",
}


def _as_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return float(int(value))
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        s = value.strip().replace(",", ".")
        if not s:
            return None
        try:
            return float(s)
        except ValueError:
            return None
    return None


def _normalize_number(value: float) -> int | float:
    if float(value).is_integer():
        return int(value)
    return round(float(value), 2)


def _question_id(question: Any) -> int | None:
    raw = getattr(question, "id", None)
    try:
        return int(raw) if raw is not None else None
    except Exception:
        return None


def _question_answer_type(question: Any) -> str:
    return str(getattr(question, "answer_type", "") or "").strip().lower()


def _question_options(question: Any) -> dict[str, Any]:
    raw = getattr(question, "options", None)
    return raw if isinstance(raw, dict) else {}


def _answer_payload(answer: Any) -> dict[str, Any]:
    raw = getattr(answer, "value", None)
    return raw if isinstance(raw, dict) else {}


def _choice_from_payload(payload: dict[str, Any]) -> str:
    return str(payload.get("choice") or "").strip().lower()


def _resolve_choice_map_scores(question: Any) -> dict[str, float] | None:
    """
    Optional generic support for future score maps:
    options = {"scores": {"ok": 1, "bad": 0}}
    """
    options = _question_options(question)
    raw = options.get("scores")
    if not isinstance(raw, dict):
        return None

    out: dict[str, float] = {}
    for k, v in raw.items():
        num = _as_number(v)
        if num is None:
            continue
        key = str(k or "").strip().lower()
        if not key:
            continue
        out[key] = float(num)

    return out or None


def resolve_question_scoring(question: Any) -> dict[str, Any] | None:
    """
    Question is scoreable only if we can safely derive scoring rules.

    Supported now:
    - answer_type == "yesno_score"  -> default yes=1 / no=0, overridable by options
    - answer_type == "yesno" + explicit yes_score/no_score in options
    - options.scores dict (safe optional extension for future use)
    """
    answer_type = _question_answer_type(question)
    options = _question_options(question)

    yes_score = _as_number(options.get("yes_score"))
    no_score = _as_number(options.get("no_score"))

    if answer_type == "yesno_score":
        if yes_score is None:
            yes_score = 1.0
        if no_score is None:
            no_score = 0.0
        return {
            "kind": "yesno",
            "yes_score": float(yes_score),
            "no_score": float(no_score),
            "max_score": max(float(yes_score), float(no_score)),
        }

    if answer_type == "yesno" and yes_score is not None and no_score is not None:
        return {
            "kind": "yesno",
            "yes_score": float(yes_score),
            "no_score": float(no_score),
            "max_score": max(float(yes_score), float(no_score)),
        }

    score_map = _resolve_choice_map_scores(question)
    if score_map:
        return {
            "kind": "choice_map",
            "score_map": score_map,
            "max_score": max(score_map.values()),
        }

    return None


def resolve_answer_score(question: Any, answer: Any | None) -> float | None:
    """
    Returns actual score for a single answer or None if:
    - question is not scoreable
    - answer is absent
    - answer is N/A / skipped / non-evaluable
    """
    scoring = resolve_question_scoring(question)
    if scoring is None or answer is None:
        return None

    payload = _answer_payload(answer)
    choice = _choice_from_payload(payload)

    if choice in _NA_CHOICES:
        return None

    if scoring["kind"] == "yesno":
        if choice == "yes":
            return float(scoring["yes_score"])
        if choice == "no":
            return float(scoring["no_score"])

        # fallback: use already stored numeric score if choice is missing,
        # but only for scoreable yes/no questions
        payload_score = _as_number(payload.get("score"))
        if payload_score is not None:
            return float(payload_score)
        return None

    if scoring["kind"] == "choice_map":
        score_map: dict[str, float] = scoring["score_map"]
        if choice in score_map:
            return float(score_map[choice])

        payload_score = _as_number(payload.get("score"))
        if payload_score is not None:
            return float(payload_score)
        return None

    return None


def calculate_run_score(
    *,
    questions: Iterable[Any],
    answers: Iterable[Any],
) -> AuditRunScore:
    """
    Centralized run scoring.

    Rules:
    - counts only scoreable questions
    - text/comment/photo/service fields are excluded
    - N/A / skipped / non-evaluable answers are excluded from denominator
    - unanswered scoreable questions do not break calculation
    - if denominator == 0 -> score_percent = None
    """
    answers_by_question_id: dict[int, Any] = {}

    for answer in answers:
        qid_raw = getattr(answer, "question_id", None)
        try:
            qid = int(qid_raw)
        except Exception:
            continue
        answers_by_question_id[qid] = answer

    score_sum = 0.0
    score_max = 0.0
    answered_scored = 0
    total_scored_questions = 0

    for question in questions:
        qid = _question_id(question)
        scoring = resolve_question_scoring(question)
        if qid is None or scoring is None:
            continue

        total_scored_questions += 1

        actual_score = resolve_answer_score(question, answers_by_question_id.get(qid))
        if actual_score is None:
            continue

        max_score = _as_number(scoring.get("max_score"))
        if max_score is None:
            continue

        answered_scored += 1
        score_sum += float(actual_score)
        score_max += float(max_score)

    score_percent: float | None = None
    if score_max > 0:
        score_percent = round((score_sum / score_max) * 100.0, 2)

    return {
        "score_sum": _normalize_number(score_sum),
        "score_max": _normalize_number(score_max),
        "score_percent": score_percent,
        "answered_scored": int(answered_scored),
        "total_scored_questions": int(total_scored_questions),
    }
