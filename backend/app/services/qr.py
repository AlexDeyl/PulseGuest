from __future__ import annotations

import hashlib
import io


def _etag_for_payload(payload: str, *, kind: str) -> str:
    h = hashlib.sha256()
    h.update(kind.encode("utf-8"))
    h.update(b"\0")
    h.update(payload.encode("utf-8"))
    return h.hexdigest()


def make_qr_svg(payload: str, *, scale: int = 8, border: int = 2) -> tuple[bytes, str]:
    """Return (svg_bytes, etag)."""
    import segno  # lazy import

    qr = segno.make(payload, error="M")
    buf = io.BytesIO()
    qr.save(buf, kind="svg", scale=scale, border=border)
    svg_bytes = buf.getvalue()
    return svg_bytes, _etag_for_payload(payload, kind="svg")


def make_qr_png(payload: str, *, scale: int = 8, border: int = 2) -> tuple[bytes, str]:
    """Return (png_bytes, etag).

    PNG support is optional: segno needs either Pillow or pypng.
    We intentionally don't hard-depend on PNG libs in minimal build.
    """
    import segno  # lazy import

    qr = segno.make(payload, error="M")
    buf = io.BytesIO()
    try:
        qr.save(buf, kind="png", scale=scale, border=border)
    except Exception as e:
        raise ImportError("PNG writer backend is not installed (Pillow/pypng).") from e

    png_bytes = buf.getvalue()
    return png_bytes, _etag_for_payload(payload, kind="png")
