import { getSql } from "../src/lib/db.ts";
import { loadShadowEpisodes } from "../src/lib/learn/shadow-db.ts";
import { buildShadowReplayReport } from "../src/lib/learn/shadow-replay.ts";

const sql = await getSql();
const episodes = await loadShadowEpisodes(sql);
if (!episodes.length) {
  console.error("Shadow replay: no hay episodios en la base de datos disponible.");
  process.exitCode = 2;
} else {
  const report = buildShadowReplayReport(episodes);
  console.log(JSON.stringify(report, null, 2));
}
