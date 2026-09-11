# Prompt de implementación — Shadow V2 frecuencia

Trabaja SOLO en `research/shadow-v2-frequency`.

Objetivo: evolucionar Atalaya hacia una futura V2 capaz de buscar más oportunidades (referencia 5–10/día) sin relajar V1 ni convertir la frecuencia en un requisito de ejecución.

Reglas obligatorias:
- NO tocar PROD/main.
- NO modificar los 6 archivos V1 protegidos.
- Shadow es investigación: no ejecuta ni autoriza entradas.
- No backfill inventado.
- No look-ahead: una hipótesis solo puede usar información disponible en su momento de decisión.
- TP1/TP2 son éxito; SL pérdida; expired/pending quedan fuera del denominador de éxito.
- Mantener separación EXTRA vs OVERLAP.
- Toda nueva variante debe tener muestra mínima antes de considerarse candidata a promoción.
- No optimizar TEST ni seleccionar parámetros con el resultado futuro.

Trabajo actual ya implementado:
- definición oficial de outcome desde ENTRY en `3562508`;
- stats incluyen expired en `b1b3470`;
- scoreboard de densidad en `shadow-frequency.ts`;
- documentación del objetivo en `shadow-v2-frequency.md`.

Siguiente fase, NO activarla en vivo todavía:
1. Ampliar el generador Shadow para que la investigación pueda producir oportunidades independientes del ENTRY V1, usando únicamente cinta histórica persistida disponible.
2. Priorizar estrategias de mayor frecuencia: breakout+retest, liquidity sweep+reclaim, FVG retest y momentum/pullback.
3. Añadir métricas por día, activo, sesión y variante: candidatos, EXTRA, decididos, TP1, TP2, SL, expired, éxito, R medio, MFE/MAE y frecuencia/día.
4. Mantener 15M como referencia y usar 5M/1M solo cuando exista cinta real capturada; nunca sintetizar 5M/1M desde 15M.
5. Añadir tests deterministas contra look-ahead, misma vela SL+TP y separación ENTRY/MAP.
6. No cambiar V1 ni conectar estas variantes al flujo live hasta que los datos demuestren expectativa positiva y estabilidad.

La meta no es fabricar 5–10 operaciones. La meta es descubrir si existe suficiente ventaja independiente para que 5–10 oportunidades diarias sean una consecuencia natural del sistema.
