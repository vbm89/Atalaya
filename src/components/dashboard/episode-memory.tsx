import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getEpisodeMemory, saveEpisodeJournal } from "@/lib/memory/memory.fn";
import {
  JOURNAL_LABEL,
  journalIncomplete,
  type JournalAction,
  type JournalClearField,
} from "@/lib/memory/journal";
import { madridStamp } from "@/lib/memory/session";

function savedLabel(ms: number | null | undefined): string | null {
  if (ms == null) return null;
  const stamp = madridStamp(ms);
  return stamp ? `Guardado · ${stamp.time}` : null;
}

export function EpisodeMemory({ episodeId }: { episodeId: string }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<JournalAction | null>(null);
  const [lots, setLots] = useState("");
  const [entryPrice, setEntryPrice] = useState("");
  const [exitPrice, setExitPrice] = useState("");
  const [note, setNote] = useState("");
  const [clear, setClear] = useState<JournalClearField[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["episode-memory", episodeId],
    queryFn: () => getEpisodeMemory({ data: { episodeId } }),
    staleTime: 15_000,
    retry: 0,
  });
  const journal = q.data?.journal;
  useEffect(() => {
    if (!journal) return;
    setSelected(journal.action);
    setLots(journal.lots != null ? String(journal.lots) : "");
    setEntryPrice(journal.entryPrice != null ? String(journal.entryPrice) : "");
    setExitPrice(journal.exitPrice != null ? String(journal.exitPrice) : "");
    setNote(journal.note ?? "");
    setClear([]);
  }, [journal]);

  const save = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error("Selecciona TOMÉ, NO TOMÉ o PARCIAL.");
      return saveEpisodeJournal({
        data: {
          episodeId,
          action: selected,
          lots: lots.trim() || null,
          entryPrice: entryPrice.trim() || null,
          exitPrice: exitPrice.trim() || null,
          note: note.trim() || null,
          clearFields: clear,
        },
      });
    },
    onSuccess: (res) => {
      setFeedback(savedLabel(res.journal.updatedAtMs) ?? "Guardado correctamente");
      setClear([]);
      void qc.invalidateQueries({ queryKey: ["episode-memory", episodeId] });
    },
    onError: (err) => {
      setFeedback(err instanceof Error ? `Error al guardar: ${err.message}` : "Error al guardar");
    },
  });

  const markClear = (field: JournalClearField, wipe: () => void) => {
    wipe();
    setClear((prev) => (prev.includes(field) ? prev : [...prev, field]));
    setFeedback(null);
  };
  const unclear = (field: JournalClearField) => {
    setClear((prev) => prev.filter((f) => f !== field));
  };

  const mem = q.data;
  const pm = mem?.postmortem;
  const persistedIncomplete = journal ? journalIncomplete(journal) : false;
  const savedHint = feedback ?? (journal ? savedLabel(journal.updatedAtMs) : null);
  const saveError = save.isError;

  return (
    <div className="mt-2 space-y-2" data-episode-memory={episodeId}>
      <div className="space-y-2">
        <p className="text-[11px] text-subtle">
          Diario humano — no modifica V1 ni el desenlace. TOMÉ no convierte MAPA/PENDING en ENTRADA.
        </p>
        <div className="flex gap-1">
          {(["took", "skipped", "partial"] as const).map((action) => (
            <button
              key={action}
              type="button"
              disabled={save.isPending}
              data-journal-action={action}
              onClick={() => {
                setSelected(action);
                setFeedback(null);
              }}
              className={
                selected === action
                  ? "min-h-11 flex-1 rounded-[var(--radius-md)] bg-buy-dim text-xs font-medium text-buy"
                  : "min-h-11 flex-1 rounded-[var(--radius-md)] bg-surface text-xs font-medium text-muted"
              }
            >
              {JOURNAL_LABEL[action]}
            </button>
          ))}
        </div>
        {persistedIncomplete ? (
          <p className="text-[11px] font-medium text-wait" data-journal-incomplete>
            REGISTRO INCOMPLETO — faltan lote o entrada real.
          </p>
        ) : null}
        <div className="grid grid-cols-3 gap-1">
          <label className="block">
            <span className="flex min-h-11 items-center justify-between gap-1">
              <span className="text-[10px] tracking-wide text-subtle uppercase">Lote</span>
              <button
                type="button"
                className="text-[10px] text-muted"
                data-journal-clear="lots"
                onClick={() => markClear("lots", () => setLots(""))}
              >
                Vaciar
              </button>
            </span>
            <input
              className="min-h-11 w-full rounded-[var(--radius-md)] bg-surface px-2 font-mono text-xs tabular"
              inputMode="decimal"
              value={lots}
              onChange={(e) => {
                setLots(e.target.value);
                unclear("lots");
                setFeedback(null);
              }}
              aria-label="Lote"
            />
          </label>
          <label className="block">
            <span className="flex min-h-11 items-center justify-between gap-1">
              <span className="text-[10px] tracking-wide text-subtle uppercase">Entrada</span>
              <button
                type="button"
                className="text-[10px] text-muted"
                data-journal-clear="entryPrice"
                onClick={() => markClear("entryPrice", () => setEntryPrice(""))}
              >
                Vaciar
              </button>
            </span>
            <input
              className="min-h-11 w-full rounded-[var(--radius-md)] bg-surface px-2 font-mono text-xs tabular"
              inputMode="decimal"
              value={entryPrice}
              onChange={(e) => {
                setEntryPrice(e.target.value);
                unclear("entryPrice");
                setFeedback(null);
              }}
              aria-label="Precio real de entrada"
            />
          </label>
          <label className="block">
            <span className="flex min-h-11 items-center justify-between gap-1">
              <span className="text-[10px] tracking-wide text-subtle uppercase">Salida</span>
              <button
                type="button"
                className="text-[10px] text-muted"
                data-journal-clear="exitPrice"
                onClick={() => markClear("exitPrice", () => setExitPrice(""))}
              >
                Vaciar
              </button>
            </span>
            <input
              className="min-h-11 w-full rounded-[var(--radius-md)] bg-surface px-2 font-mono text-xs tabular"
              inputMode="decimal"
              value={exitPrice}
              onChange={(e) => {
                setExitPrice(e.target.value);
                unclear("exitPrice");
                setFeedback(null);
              }}
              aria-label="Precio real de salida"
            />
          </label>
        </div>
        <label className="block">
          <span className="flex min-h-11 items-center justify-between gap-1">
            <span className="text-[10px] tracking-wide text-subtle uppercase">Nota</span>
            <button
              type="button"
              className="text-[10px] text-muted"
              data-journal-clear="note"
              onClick={() => markClear("note", () => setNote(""))}
            >
              Vaciar
            </button>
          </span>
          <input
            className="min-h-11 w-full rounded-[var(--radius-md)] bg-surface px-2 text-xs"
            maxLength={280}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              unclear("note");
              setFeedback(null);
            }}
            aria-label="Nota"
          />
        </label>
        <button
          type="button"
          data-journal-save
          disabled={save.isPending}
          onClick={() => save.mutate()}
          className="min-h-11 w-full rounded-[var(--radius-md)] bg-buy-dim text-sm font-medium text-buy"
        >
          {save.isPending ? "Guardando…" : "GUARDAR"}
        </button>
        {savedHint ? (
          <p
            className={`text-[11px] ${saveError ? "text-sell" : "text-muted"}`}
            data-journal-saved={!saveError ? "" : undefined}
            data-journal-error={saveError ? "" : undefined}
          >
            {savedHint}
          </p>
        ) : null}
      </div>
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
