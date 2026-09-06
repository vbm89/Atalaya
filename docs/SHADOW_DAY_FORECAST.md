# Shadow V2 — Previsión del día

Research-only. No modifica V1 y no genera señales, ENTRADAS ni push.

## Contrato

Para XAUUSD, BTCUSD, US100 y WTI se calcula una lectura direccional del día:

- `SUBIR`
- `BAJAR`
- `NEUTRO`

El reloj de V1 no cambia: la ENTRADA V1 sigue naciendo únicamente en el cierre de 15M.

## Lectura

La primera versión combina, con mayor peso en temporalidades altas:

- 4H: sesgo
- 1H: estructura
- 15M: comportamiento
- 5M: detalle
- cambio del día
- noticias clasificadas disponibles

La salida muestra una **confianza técnica**, no una probabilidad calibrada. No debe interpretarse como una garantía ni como una orden de trading.

## Validación pendiente

Esta primera implementación es una hipótesis Shadow transparente. La confianza todavía no está calibrada con TRAIN/TEST. La siguiente fase debe persistir las previsiones al inicio del día y medir el resultado al cierre, con separación cronológica TRAIN/TEST y estado `INSUFFICIENT` cuando no haya muestra suficiente.

Hasta esa validación, la función sirve para acumular evidencia, no para sustituir V1.
