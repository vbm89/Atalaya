import { cn } from "@/lib/utils";

export function Sparkline({
  values,
  positive,
  variant = "line",
}: {
  values: number[];
  positive: boolean | null;
  variant?: "line" | "area";
}) {
  if (values.length < 2) {
    return <div className="h-10 w-full rounded-[var(--radius-sm)] bg-elevated" />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 160;
  const h = 40;
  const coords = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / span) * (h - 6) - 3;
    return { x, y };
  });
  const pts = coords.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1]!;
  const area =
    variant === "area"
      ? `0,${h} ${pts} ${w},${h}`
      : "";
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={cn(
        "h-10 w-full",
        positive == null && "text-muted",
        positive === true && "text-buy",
        positive === false && "text-sell",
      )}
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      {area ? <polygon points={area} fill="currentColor" opacity="0.16" /> : null}
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={pts}
      />
      {variant === "area" ? <circle cx={last.x} cy={last.y} r="2.1" fill="currentColor" /> : null}
    </svg>
  );
}
