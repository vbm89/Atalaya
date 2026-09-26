/** Vercel Cron envía `Authorization: Bearer $CRON_SECRET`. Sin secreto, se rechaza. */
export function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}
