import { cn } from "@/lib/utils";

export function Sparkline({
  values,
  positive,
}: {
  values: number[];
  positive: boolean | null;
}) {
  if (values.length < 2) {
    return <div className="h-10 w-full rounded-[var(--radius-sm)] bg-elevated" />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 160;
  const h = 40;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
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
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={pts}
      />
    </svg>
  );
}
