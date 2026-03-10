from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

from app.core.config import settings


logger = logging.getLogger(__name__)


def is_smtp_configured() -> bool:
    return bool((settings.SMTP_HOST or "").strip() and (settings.SMTP_FROM or "").strip())


def send_email_text(to_email: str, subject: str, body_text: str) -> None:
    """Send a plain text email.

    NOTE: This function is synchronous. Use FastAPI BackgroundTasks to avoid blocking.
    """
    if not is_smtp_configured():
        if settings.DEBUG:
            logger.warning(
                "SMTP is not configured (SMTP_HOST/SMTP_FROM missing) — skipping email to %s",
                to_email,
            )
        return

    msg = EmailMessage()
    msg["From"] = settings.SMTP_FROM
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body_text)

    host = settings.SMTP_HOST
    port = int(settings.SMTP_PORT)
    user = (settings.SMTP_USER or "").strip()
    password = settings.SMTP_PASS or ""

    try:
        if settings.SMTP_SSL:
            with smtplib.SMTP_SSL(host, port, timeout=15) as server:
                if user:
                    server.login(user, password)
                server.send_message(msg)
                return

        with smtplib.SMTP(host, port, timeout=15) as server:
            server.ehlo()
            if settings.SMTP_TLS:
                server.starttls()
                server.ehlo()
            if user:
                server.login(user, password)
            server.send_message(msg)

    except Exception:
        # Do not crash request flows. Log and move on.
        logger.exception("Failed to send email to %s via SMTP", to_email)
