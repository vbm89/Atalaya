export interface GlossaryEntry {
  id: string;
  title: string;
  what: string;
  forAtalaya: string;
  example: string;
}

/** Short, contextual glossary. Not a course. Copy is descriptive of V1, not a new rule. */
export const GLOSSARY: GlossaryEntry[] = [
  {
    id: "bos",
    title: "BOS",
    what: "Ruptura de estructura: el precio cierra más allá de un máximo o mínimo relevante.",
    forAtalaya: "V1 exige un BOS de 4H por cierre para tener dirección. Sin ese BOS no hay zona ni entrada.",
    example: "Si 4H es lateral y no hay BOS, Atalaya muestra ESPERAR — no hay BOS 4H por cierre.",
  },
  {
    id: "estructura",
    title: "Estructura",
    what: "El sesgo del gráfico: alcista, bajista o lateral, según máximos y mínimos.",
    forAtalaya: "El sesgo de 4H marca la dirección del setup. Un CHOCH de 1H contrario anula la idea.",
    example: "BAJISTA LOCAL · BOS a la baja: Atalaya solo busca ventas, no compras.",
  },
  {
    id: "zona",
    title: "Zona de origen",
    what: "Franja estructural del candle de origen. No es un rango de ejecución.",
    forAtalaya: "V1 la usa para triggers. La ficha muestra un solo precio de ENTRADA, no esta banda.",
    example: "El origen puede medir 34 $. La ENTRADA es un solo número.",
  },
  {
    id: "origen-htf",
    title: "Origen HTF",
    what: "El punto de 4H o 1H del que nace la zona del setup.",
    forAtalaya: "Si hay BOS 4H pero no hay zona anclada en 4H/1H, V1 espera. No improvisa la zona en 15M.",
    example: "ESPERAR — BOS 4H sin zona 4H/1H de origen válida.",
  },
  {
    id: "volumen",
    title: "Volumen",
    what: "Actividad de la vela respecto a su media. En proxies puede faltar.",
    forAtalaya: "V1 pide volumen suficiente en el trigger 15M y no admite 4H «muerto» para ENTRADA.",
    example: "Falta: volumen 15M insuficiente → TRIGGER PENDIENTE, no ENTRADA.",
  },
  {
    id: "trigger",
    title: "Trigger",
    what: "La confirmación de 15M que arma la entrada: fallo de aceptación o rechazo, por cierre.",
    forAtalaya: "Una mecha no basta. El 5M solo no crea ENTRADA. El trigger es 15M cerrado.",
    example: "Falta: cierre 15M de fallo de aceptación o rechazo.",
  },
  {
    id: "rr",
    title: "R:R",
    what: "Recompensa entre la entrada y TP1, dividida por el riesgo hasta el SL.",
    forAtalaya: "Es estructural (zona, SL, TP1 de V1). Mínimos 1,2 y 1,5. No usa ATR como objetivo.",
    example: "R:R 1,8 en el setup. Si baja de 1,5, V1 no da setup.",
  },
  {
    id: "entrada",
    title: "Entrada",
    what: "El único precio de referencia del setup: el bajo de la zona en venta, el alto en compra.",
    forAtalaya: "No es una orden. No es un rango. Es el entryPx de V1, el mismo que usa el R:R.",
    example: "VENTA · ENTRADA 4303,98. Análisis, no orden.",
  },
  {
    id: "sl",
    title: "SL",
    what: "Stop: nivel que invalida la idea si el precio lo atraviesa.",
    forAtalaya: "Viene del ancla estructural más un margen. Sin ancla, V1 espera. No es un múltiplo de ATR.",
    example: "SL 78.150. Un cierre 15M más allá de la invalidación tumba el setup.",
  },
  {
    id: "tp1",
    title: "TP1",
    what: "Primer objetivo a favor, tomado de estructura 4H.",
    forAtalaya: "Si no hay TP estructural, no hay setup. El desenlace histórico mira el primer toque de mecha 15M.",
    example: "TP1 77.100. Si la mecha 15M lo toca antes que el SL, el historial marca TP1.",
  },
  {
    id: "tp2",
    title: "TP2",
    what: "Segundo objetivo, si V1 encontró uno. Puede no existir.",
    forAtalaya: "Si no hay TP2, se muestra n/d. No se inventa un segundo objetivo.",
    example: "TP2 n/d: V1 no tenía un segundo nivel estructural.",
  },
  {
    id: "caducidad",
    title: "Caducidad",
    what: "La idea deja de ser válida por el paso del tiempo o porque el mapa se supersede.",
    forAtalaya: "V1 cierra el setup (ESPERAR — sin setup válido / mapa supersedido). No es un SL.",
    example: "El historial marca EXPIRADA si se cierra sin toque de SL ni TP.",
  },
  {
    id: "invalidacion",
    title: "Invalidación",
    what: "Nivel de cierre 15M que anula la estructura del BOS.",
    forAtalaya: "Un cierre 15M más allá de ese nivel → ESPERAR invalidado. Distinto del SL de gestión.",
    example: "ESPERAR — invalidado (cierre 15M > 77.964).",
  },
  {
    id: "noticia",
    title: "Noticia de alto impacto",
    what: "Evento de calendario (impacto alta) en la ventana de V1, no un titular RSS.",
    forAtalaya: "Bloquea ENTRADA nueva. MAPA o TRIGGER PENDIENTE pueden seguir, con aviso.",
    example: "Falta: noticia de alto impacto próxima.",
  },
  {
    id: "subyacente",
    title: "Subyacente cerrado",
    what: "La sesión del mercado de referencia no está abierta (CME para US100 y WTI).",
    forAtalaya: "BTC y XAU no se cierran por sesión. US100/WTI sin sesión → no ENTRADA.",
    example: "Falta: mercado del subyacente cerrado.",
  },
  {
    id: "mapa",
    title: "MAPA",
    what: "Hay zona y dirección, pero el precio aún no ha salido de la zona a favor.",
    forAtalaya: "No es una entrada. Falta la salida 15M de la zona. No se dispara Push de ENTRADA.",
    example: "Falta: salida 15M de la zona a favor.",
  },
  {
    id: "pending",
    title: "TRIGGER PENDIENTE",
    what: "La zona ya se armó; falta al menos una condición de ENTRADA.",
    forAtalaya: "No confundir con ESPERAR. Aquí hay setup. missingForEntry lista lo que falta.",
    example: "Falta: cierre 15M de fallo de aceptación o rechazo.",
  },
  {
    id: "entry",
    title: "ENTRADA",
    what: "V1 considera que el setup cumple todas las puertas del motor.",
    forAtalaya: "Sigue siendo análisis. No envía órdenes. wouldTrade nunca es «sí, opera».",
    example: "ENTRADA vigente. Análisis, no orden.",
  },
  {
    id: "proxy-broker",
    title: "PROXY vs bróker",
    what: "V1 analiza un instrumento público (CLUSDT, NDX100USDT, BTCUSDT, velas XAUUSDT). T4Trade opera otros símbolos (WTICash, US100Cash, BTCUSD, XAUUSD).",
    forAtalaya: "La ENTRADA V1 es del análisis. Sin feed T4Trade no hay precio de ejecución. No copies 89,64 a WTICash.",
    example: "WTI ENTRADA V1 89,64 sobre CLUSDT. Broker WTICash: FEED NO DISPONIBLE.",
  },
  {
    id: "wait",
    title: "ESPERAR",
    what: "No hay setup operable ahora.",
    forAtalaya: "La razón está en waitReason. No se dibuja zona como si existiera una operación.",
    example: "ESPERAR — no hay BOS 4H por cierre.",
  },
];

export function glossaryById(id: string): GlossaryEntry | undefined {
  return GLOSSARY.find((g) => g.id === id);
}

export const GLOSSARY_IDS = GLOSSARY.map((g) => g.id);
