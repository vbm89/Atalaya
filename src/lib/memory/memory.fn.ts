import { createServerFn } from "@tanstack/react-start";
import { journalIncomplete, parseClearFields, parseJournalInput } from "./journal";

export const saveEpisodeJournal = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const raw = data as Record<string, unknown>;
    const parsed = parseJournalInput(raw);
    if ("error" in parsed) throw new Error(parsed.error);
    const clear = parseClearFields(raw.clearFields);
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const exists = await sql.query<{ episode_id: string }>(
      `select episode_id from signal_episodes where episode_id = $1`,
      [parsed.episodeId],
    );
    if (!exists.length) throw new Error("Episodio no encontrado.");
    const { upsertJournal } = await import("./persist");
    const journal = await upsertJournal(sql, parsed, clear);
    return {
      ok: true as const,
      action: journal.action,
      journal,
      incomplete: journalIncomplete(journal),
    };
  });

export const getEpisodeMemory = createServerFn({ method: "POST" })
  .validator((input: { episodeId: string }) => {
    const episodeId = input?.episodeId?.trim() ?? "";
    if (episodeId.length < 8) throw new Error("Episodio no válido.");
    return { episodeId };
  })
  .handler(async ({ data }) => {
    const { getSql } = await import("@/lib/db");
    const { loadContext, loadJournal, loadPostMortem, loadTape, loadHistoryRowForMemory } =
      await import("./persist");
    const sql = await getSql();
    const [context, journal, postmortem, tape] = await Promise.all([
      loadContext(sql, data.episodeId),
      loadJournal(sql, data.episodeId),
      loadPostMortem(sql, data.episodeId),
      loadTape(sql, data.episodeId),
    ]);
    let livePostmortem = postmortem;
    if (!livePostmortem) {
      const row = await loadHistoryRowForMemory(sql, data.episodeId);
      if (row) {
        const { buildPostMortem } = await import("./postmortem");
        livePostmortem = buildPostMortem({
          row,
          context,
          tape,
          journal,
          freeze: row.episode.freeze,
        });
      }
    }
    return {
      episodeId: data.episodeId,
      context,
      journal,
      postmortem: livePostmortem,
      tapeBars: tape.length,
    };
  });
