import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getEpisodeMemory, saveEpisodeJournal } from "@/lib/memory/memory.fn";
import { JOURNAL_LABEL, type JournalAction } from "@/lib/memory/journal";

export function EpisodeMemory({
  episodeId,
  allowJournal,
}: {
  episodeId: string;
  allowJournal: boolean;
}) {
  const qc = useQueryClient();
  const [lots, setLots] = useState("");
  const [entryPrice, setEntryPrice] = useState("");
  const [exitPrice, setExitPrice] = useState("");
  const [note, setNote] = useState("");
  const q = useQuery({
    queryKey: ["episode-memory", episodeId],
    queryFn: () => getEpisodeMemory({ data: { episodeId } }),
    staleTime: 15_000,
    retry: 0,
  });
  const journal = q.data?.journal;
  useEffect(() => {
    if (!journal) return;
    setLots(journal.lots != null ? String(journal.lots) : "");
    setEntryPrice(journal.entryPrice != null ? String(journal.entryPrice) : "");
    setExitPrice(journal.exitPrice != null ? String(journal.exitPrice) : "");
    setNote(journal.note ?? "");
  }, [journal]);
  const save = useMutation({
    mutationFn: (action: JournalAction) =>
      saveEpisodeJournal({
        data: {
          episodeId,
          action,
          lots: lots.trim() || null,
          entryPrice: entryPrice.trim() || null,
          exitPrice: exitPrice.trim() || null,
          note: note.trim() || null,
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["episode-memory", episodeId] });
    },
  });

  const mem = q.data;
  const pm = mem?.postmortem;

  return (
    <div className="mt-2 space-y-2" data-episode-memory={episodeId}>
      {allowJournal ? (
        <div className="space-y-2">
          <p className="text-[11px] text-subtle">Diario humano — no modifica V1 ni el desenlace.</p>
          <div className="flex gap-1">
            {(["took", "skipped", "partial"] as const).map((action) => (
              <button
                key={action}
                type="button"
                disabled={save.isPending}
                data-journal-action={action}
                onClick={() => save.mutate(action)}
                className={
                  journal?.action === action
                    ? "min-h-11 flex-1 rounded-[var(--radius-md)] bg-buy-dim text-xs font-medium text-buy"
                    : "min-h-11 flex-1 rounded-[var(--radius-md)] bg-surface text-xs font-medium text-muted"
                }
              >
                {JOURNAL_LABEL[action]}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1">
            <label className="block">
              <span className="text-[10px] tracking-wide text-subtle uppercase">Lote</span>
              <input
                className="mt-0.5 min-h-11 w-full rounded-[var(--radius-md)] bg-surface px-2 font-mono text-xs tabular"
                inputMode="decimal"
                value={lots}
                onChange={(e) => setLots(e.target.value)}
                aria-label="Lote"
              />
            </label>
            <label className="block">
              <span className="text-[10px] tracking-wide text-subtle uppercase">Entrada</span>
              <input
                className="mt-0.5 min-h-11 w-full rounded-[var(--radius-md)] bg-surface px-2 font-mono text-xs tabular"
                inputMode="decimal"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
                aria-label="Precio real de entrada"
              />
            </label>
            <label className="block">
              <span className="text-[10px] tracking-wide text-subtle uppercase">Salida</span>
              <input
                className="mt-0.5 min-h-11 w-full rounded-[var(--radius-md)] bg-surface px-2 font-mono text-xs tabular"
                inputMode="decimal"
                value={exitPrice}
                onChange={(e) => setExitPrice(e.target.value)}
                aria-label="Precio real de salida"
              />
            </label>
          </div>
          <label className="block">
            <span className="text-[10px] tracking-wide text-subtle uppercase">Nota</span>
            <input
              className="mt-0.5 min-h-11 w-full rounded-[var(--radius-md)] bg-surface px-2 text-xs"
              maxLength={280}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label="Nota"
            />
          </label>
        </div>
      ) : null}
      {journal?.note && !allowJournal ? <p className="text-[11px] text-subtle">{journal.note}</p> : null}
      {pm ? (
        <div className="rounded-[var(--radius-md)] bg-surface px-3 py-2" data-postmortem={episodeId}>
          <p className="text-[11px] font-medium tracking-wider text-muted uppercase">Post-mortem</p>
          <ul className="mt-1 space-y-0.5">
            {pm.facts.slice(0, 12).map((f) => (
              <li key={f.key} className="flex justify-between gap-2 text-[11px]">
                <span className="text-subtle">{f.label}</span>
                <span className={f.pending ? "text-wait" : "font-mono tabular"}>{f.value}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[10px] leading-snug text-subtle">{pm.disclaimer}</p>
        </div>
      ) : q.isLoading ? (
        <p className="text-[11px] text-subtle">Memoria…</p>
      ) : null}
    </div>
  );
}
