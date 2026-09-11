# Shadow V2 — frequency research

Objetivo de investigación: comprobar si una futura V2 puede generar aproximadamente 5–10 oportunidades diarias sin convertir la frecuencia en un requisito que fuerce operaciones malas.

Reglas:
- V1 permanece congelada.
- Shadow no ejecuta ni autoriza operaciones.
- La métrica separa candidatos totales de EXTRA (episodios sin ENTRY V1).
- TP1/TP2 cuentan como éxito; SL como pérdida; expired/pending no entran en el denominador de éxito.
- El objetivo 5–10/día es una referencia de densidad, no un criterio de promoción.
- La densidad actual está limitada al universo de episodios V1 persistidos. No se inventan oportunidades fuera de ese universo.
- Para conseguir una V2 realmente independiente del universo V1 habrá que añadir un generador de mapas/zonas basado directamente en cinta de mercado; esa fase queda bloqueada hasta tener datos 15M/5M suficientes y tests anti-lookahead.

Criterio de promoción futuro: ninguna variante se activa en vivo por frecuencia. Primero debe superar el mínimo de muestra, tener expectativa neta positiva, estabilidad por activo/sesión y ausencia de leakage; después se estudia su integración en una V2 separada de V1.
