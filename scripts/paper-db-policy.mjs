export const expected = [
  "0001_paper_bot.sql",
  "0002_watch.sql",
  "0003_watch_push.sql",
  "0004_watch_v10.sql",
  "0005_memory.sql",
];

export const requiredPaperTables = ["paper_bot_state", "paper_bot_decision", "paper_bot_signal"];

export function isPrefix(applied) {
  if (applied.length > expected.length) return false;
  const seen = new Set();
  for (let index = 0; index < applied.length; index += 1) {
    const name = applied[index];
    if (typeof name !== "string" || seen.has(name) || name !== expected[index]) return false;
    seen.add(name);
  }
  return true;
}

export function paperTablesReady(tableNames, applied) {
  return (
    applied.length === expected.length &&
    isPrefix(applied) &&
    requiredPaperTables.every((table) => tableNames.includes(table))
  );
}
