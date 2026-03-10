import { useEffect, useMemo, useState } from "react";
import GlassCard from "./GlassCard";
import { Button } from "./ui/Button";
import { adminBlob, adminJson, downloadBlob } from "../shared/adminApi";
import { API_BASE } from "../shared/api/public";

type Props = {
  open: boolean;
  onClose: () => void;
  locationId: number;
  slug: string;
  title?: string;
};

export default function QrModal({ open, onClose, locationId, slug, title }: Props) {
  const [publicUrl, setPublicUrl] = useState<string>("");
  const [svgUrl, setSvgUrl] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const safeSlug = useMemo(() => (slug || "").trim().replace(/^\/+/, ""), [slug]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  };

  const fallbackPublicUrl = useMemo(() => {
    const rel = safeSlug ? `/${safeSlug}` : "/";
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return origin ? `${origin}${rel}` : rel;
  }, [safeSlug]);

  useEffect(() => {
    if (!open) return;

    let alive = true;
    let objectUrl: string | null = null;

    const run = async () => {
      setLoading(true);
      setErr(null);
      setPublicUrl("");
      setSvgUrl("");

      try {
        // 1) public url (admin endpoint; fallback to window origin)
        let url = "";
        try {
          const r = await adminJson<{ public_url: string }>(
            `/api/admin/admin/locations/${locationId}/public-url`
          );
          url = (r?.public_url || "").trim();
        } catch {
          url = "";
        }
        if (!url) url = fallbackPublicUrl;

        // 2) SVG QR (admin endpoint; if forbidden -> fallback to public QR endpoint)
        let svgBlob: Blob | null = null;
        try {
          const r = await adminBlob(`/api/admin/admin/locations/${locationId}/qr.svg`);
          svgBlob = r.blob;
        } catch {
          // public fallback (safe: only slug)
          const res = await fetch(`${API_BASE}/api/public/qr/${encodeURIComponent(safeSlug)}.svg`);
          if (!res.ok) throw new Error("Не удалось получить QR");
          svgBlob = await res.blob();
        }

        objectUrl = URL.createObjectURL(svgBlob);

        if (!alive) return;
        setPublicUrl(url);
        setSvgUrl(objectUrl);
      } catch (e: any) {
        if (!alive) return;
        setErr("Не удалось загрузить QR. Попробуйте ещё раз.");
      } finally {
        if (alive) setLoading(false);
      }
    };

    void run();

    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, locationId, safeSlug, fallbackPublicUrl]);

  const downloadSvg = async () => {
    if (!safeSlug) return;
    try {
      const r = await adminBlob(`/api/admin/admin/locations/${locationId}/qr.svg`);
      downloadBlob(r.blob, r.filename || `location-${locationId}-${safeSlug}.svg`);
    } catch {
      // public fallback
      const res = await fetch(`${API_BASE}/api/public/qr/${encodeURIComponent(safeSlug)}.svg`);
      if (!res.ok) return;
      const b = await res.blob();
      downloadBlob(b, `location-${locationId}-${safeSlug}.svg`);
    }
  };

  const openLink = () => {
    const u = (publicUrl || fallbackPublicUrl).trim();
    if (!u) return;
    window.open(u, "_blank", "noopener,noreferrer");
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-xl">
          <GlassCard>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm text-[color:var(--pg-muted)]">PulseGuest • QR</div>
                <div className="mt-1 text-xl font-semibold text-[color:var(--pg-text)]">
                  {title || "QR-код локации"}
                </div>
                <div className="mt-1 text-xs text-[color:var(--pg-faint)]">
                  {safeSlug ? `/${safeSlug}` : "—"}
                </div>
              </div>

              <Button variant="secondary" onClick={onClose}>
                Закрыть
              </Button>
            </div>

            {err ? <div className="mt-3 text-sm text-rose-300">{err}</div> : null}
            {loading ? <div className="mt-3 text-sm text-[color:var(--pg-muted)]">Загрузка…</div> : null}

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="grid place-items-center rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-4">
                {svgUrl ? (
                  <img
                    src={svgUrl}
                    alt="QR"
                    className="h-56 w-56 rounded-xl bg-white p-3"
                  />
                ) : (
                  <div className="text-sm text-[color:var(--pg-muted)]">Нет превью</div>
                )}
              </div>

              <div>
                <div className="text-xs text-[color:var(--pg-muted)]">Публичная ссылка</div>
                <div className="mt-2 break-all rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] p-3 text-sm text-[color:var(--pg-text)]">
                  {(publicUrl || fallbackPublicUrl).trim()}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={openLink} disabled={loading}>
                    Открыть
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => copy((publicUrl || fallbackPublicUrl).trim())}
                    disabled={loading}
                  >
                    Скопировать
                  </Button>
                  <Button variant="secondary" onClick={downloadSvg} disabled={loading}>
                    Скачать SVG
                  </Button>
                </div>

                <div className="mt-3 text-xs text-[color:var(--pg-faint)]">
                  SVG подходит для печати (статичный QR: зависит только от slug и PUBLIC_BASE_URL).
                </div>
              </div>
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
