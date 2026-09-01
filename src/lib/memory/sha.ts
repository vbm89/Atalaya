/** Deploy identity. Not a V1 rule. Missing → null (PENDIENTE). */

export const V1_LABEL = "V1";

export function readGitSha(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw =
    env.VERCEL_GIT_COMMIT_SHA ??
    env.GIT_COMMIT_SHA ??
    env.GIT_SHA ??
    env.COMMIT_SHA ??
    null;
  if (typeof raw !== "string") return null;
  const sha = raw.trim().toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(sha)) return null;
  return sha;
}
