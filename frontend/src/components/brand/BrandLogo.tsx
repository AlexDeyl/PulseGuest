import pulseStayLogo from "../../assets/brand/pulsestay-logo.png";

type BrandLogoProps = {
  className?: string;
  logoClassName?: string;
  titleClassName?: string;
  subtitleClassName?: string;
  title?: string;
  subtitle?: string;
  showSubtitle?: boolean;
  variant?: "full" | "icon";
  gradientTitle?: boolean;
  stacked?: boolean;
};

export default function BrandLogo({
  className,
  logoClassName,
  titleClassName,
  subtitleClassName,
  title = "PulseStay",
  subtitle = "Feedback platform",
  showSubtitle = true,
  variant = "full",
  gradientTitle = false,
  stacked = false,
}: BrandLogoProps) {
  const gradientTitleStyle = gradientTitle
    ? {
        backgroundImage:
          "linear-gradient(90deg, #d946ef 0%, #a855f7 38%, #22c55e 100%)",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
      }
    : undefined;

  if (variant === "icon") {
    return (
      <img
        src={pulseStayLogo}
        alt="PulseStay"
        className={logoClassName ?? "h-10 w-10 object-contain"}
        draggable={false}
      />
    );
  }

  if (stacked) {
    return (
      <div className={className ?? "min-w-0"}>
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-1.5">
          <img
            src={pulseStayLogo}
            alt="PulseStay"
            className={logoClassName ?? "h-10 w-10 shrink-0 object-contain"}
            draggable={false}
          />
          <div
            className={
              titleClassName ??
              "truncate text-[24px] font-semibold leading-none tracking-[-0.05em] text-[color:var(--pg-text)]"
            }
            style={gradientTitleStyle}
          >
            {title}
          </div>
        </div>

        {showSubtitle ? (
          <div
            className={
              subtitleClassName ??
              "mt-2 text-sm text-[color:var(--pg-muted)]"
            }
          >
            {subtitle}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={className ?? "flex min-w-0 items-center gap-3"}>
      <img
        src={pulseStayLogo}
        alt="PulseStay"
        className={logoClassName ?? "h-11 w-11 shrink-0 object-contain"}
        draggable={false}
      />
      <div className="min-w-0 leading-tight">
        <div
          className={
            titleClassName ??
            "truncate text-sm font-semibold tracking-[-0.03em] text-[color:var(--pg-text)]"
          }
          style={gradientTitleStyle}
        >
          {title}
        </div>
        {showSubtitle ? (
          <div
            className={
              subtitleClassName ??
              "truncate text-xs text-[color:var(--pg-muted)]"
            }
          >
            {subtitle}
          </div>
        ) : null}
      </div>
    </div>
  );
}
