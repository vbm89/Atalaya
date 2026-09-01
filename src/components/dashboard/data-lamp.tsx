import { cn } from "@/lib/utils";
import {
  lampDotClass,
  lampTextClass,
  type DataLamp,
  type WatchLamp,
} from "@/lib/watch/feed-lamp";

export function DataLampChip({
  lamp,
  label,
  note,
}: {
  lamp: DataLamp | WatchLamp;
  label: string;
  note?: string | null;
}) {
  return (
    <span className="inline-flex flex-col items-start gap-0.5" data-feed-lamp={lamp}>
      <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", lampTextClass(lamp))}>
        <span className={cn("size-1.5 shrink-0 rounded-full", lampDotClass(lamp))} aria-hidden />
        {label}
      </span>
      {note ? <span className="text-xs leading-snug text-subtle">{note}</span> : null}
    </span>
  );
}
