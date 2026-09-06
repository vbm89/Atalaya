# Shadow V2 — Radar de oportunidades perdidas

## Objetivo

Detectar episodios en los que V1 no produjo ENTRY y, aun así, el setup congelado posteriormente alcanzó al menos 1R de MFE. Es una herramienta de investigación retrospectiva: no crea señales y no modifica V1.

## Regla

Un caso entra en el radar si:

1. el episodio no tuvo ENTRY V1 real;
2. existe MFE medible;
3. el MFE favorable es al menos 1R, usando como entrada teórica el extremo de la zona correspondiente a la dirección y como unidad de riesgo la distancia hasta SL.

Los casos se ordenan por fecha descendente.

## Replay

El replay muestra únicamente la fotografía congelada del episodio y su desenlace registrado: estado, sesgo 4H, setup, calidad, condición que faltaba, volumen, advertencias, niveles, MFE, MAE y primer toque.

No reconstruye velas futuras ni usa información futura para generar la hipótesis inicial. Por eso se denomina replay descriptivo, no backtest ni señal.

## Qué buscamos

Con suficiente muestra, el radar permitirá agrupar los casos por condiciones (sesgo 4H, setup, calidad, volumen, advertencias, condición de entrada) y estudiar si existe un patrón repetible de oportunidades que V1 deja fuera.

No se ajusta ninguna fórmula automáticamente. Cualquier hipótesis descubierta debe pasar después por TRAIN/TEST limpio y por revisión humana.
