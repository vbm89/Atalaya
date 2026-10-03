/**
 * Estado del secreto para la HOME.
 * Solo configured true/false. Nunca el valor.
 * null = sin respuesta todavía. No se trata como "falta".
 */
export function secretConfigured(
  row: { watchSecretConfigured?: boolean | null; watchSecret?: string | null } | null | undefined,
): boolean | null {
  if (row == null) return null;
  if (row.watchSecret === "CONFIGURED") return true;
  if (row.watchSecret === "NOT_CONFIGURED") return false;
  if (row.watchSecretConfigured === true) return true;
  if (row.watchSecretConfigured === false) return false;
  return null;
}

export function secretStatusLabel(configured: boolean | null): "SECRETO CONFIGURADO" | "SIN SECRETO" | null {
  if (configured === true) return "SECRETO CONFIGURADO";
  if (configured === false) return "SIN SECRETO";
  return null;
}
