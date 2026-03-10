export default function Backdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* fixed wallpaper behind everything */}
      <div className="absolute inset-0" style={{ background: "var(--pg-wallpaper)" }} />

      {/* blobs */}
      <div className="absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-[color:var(--pg-blob-1)] blur-3xl" />
      <div className="absolute -right-48 top-10 h-[520px] w-[520px] rounded-full bg-[color:var(--pg-blob-2)] blur-3xl" />
      <div className="absolute left-1/3 -bottom-56 h-[520px] w-[520px] rounded-full bg-[color:var(--pg-blob-3)] blur-3xl" />

      {/* subtle top sheen */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_55%)]" />
    </div>
  );
}
