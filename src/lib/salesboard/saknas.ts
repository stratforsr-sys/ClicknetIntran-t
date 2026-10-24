/**
 * Säljtavlan före och efter 0250: en tabell eller funktion som inte finns än,
 * skild från ett riktigt fel.
 *
 * Ren logik utan anrop, så att den går att prova med node
 * (`tests/salesboard-server.mjs`). Ögonblicksbilden, åtkomsten, parningen och
 * inställningarnas skrivrutt läser alla tabeller som kommer med 0250, och alla
 * frågar här vad ett fel betyder.
 *
 * ===========================================================================
 * "SAKNAS" ÄR ETT UNDANTAG, INTE EN STANDARD.
 *
 * Före 0250 finns tabellerna inte, och tavlan går vidare utan dem: ingen kan
 * ha valt att vara dold, det finns inga testhändelser och ingen statistik. Men
 * "saknas" gäller bara så länge 0250 inte är körd. Har en annan del av 0250
 * svarat betyder en tabell som saknas något annat (ett schema som inte laddats
 * om, ett namnbyte), och då är det ett fel. För säljarnas val är skillnaden
 * hela poängen: att tro att ingen valt att vara dold visar varje dold säljare
 * med namn.
 *
 * Ett riktigt fel (nätet, en timeout, en rättighet) är aldrig "saknas". Det
 * ger 503, och tavlan väntar ut det.
 * ===========================================================================
 */

/**
 * Felkoderna för ett objekt som inte finns: en tabell (42P01 från Postgres,
 * PGRST205 från PostgREST) och en funktion (42883 och PGRST202).
 */
const SAKNAS = new Set(["42P01", "PGRST205", "42883", "PGRST202"]);

/** Säger felet att tabellen eller funktionen inte finns? Alla andra fel är riktiga fel. */
export function saknasIDatabasen(fel: unknown): boolean {
  if (typeof fel !== "object" || fel === null) return false;
  const kod = (fel as { code?: unknown }).code;
  return typeof kod === "string" && SAKNAS.has(kod);
}

/** Hur en läsning gick: den svarade, objektet finns inte än, eller ett riktigt fel. */
export type Lasning = "svar" | "saknas" | "fel";

/** Läsningens läge ur dess `error`. Inget fel är ett svar. */
export function lasningen(fel: unknown): Lasning {
  if (fel === null || fel === undefined) return "svar";
  return saknasIDatabasen(fel) ? "saknas" : "fel";
}

/**
 * Vad säljarnas val i `salesboard_person` ger, när de övriga läsningarna ur
 * 0250 (statistiken och testhändelserna) gick som de gick.
 *
 *   "rader"  valen svarade, och raderna gäller
 *   "inga"   tabellen saknas och inget annat ur 0250 har svarat: 0250 är inte
 *            körd, och då kan ingen ha valt att vara dold
 *   "fel"    valen gick inte att läsa, eller tabellen saknas fast 0250 är
 *            körd. Felet går åt det säkra hållet: hellre ingen bild än en bild
 *            med den dolda säljarens namn.
 */
export function personvalen(val: Lasning, ovriga: readonly Lasning[]): "rader" | "inga" | "fel" {
  if (val === "svar") return "rader";
  if (val === "fel") return "fel";
  return ovriga.includes("svar") ? "fel" : "inga";
}

const varnade = new Set<string>();

/** Skriver en varning i loggen en gång per process och nyckel, inte vid varje bild. */
export function varnaEnGang(nyckel: string, text: string): void {
  if (varnade.has(nyckel)) return;
  varnade.add(nyckel);
  console.warn(text);
}

/**
 * Säger felet att tabellen eller funktionen inte finns än? Då svarar den ja och
 * säger det i loggen en gång. Alla andra fel ger nej.
 */
export function saknasAn(objekt: string, fel: unknown): boolean {
  if (!saknasIDatabasen(fel)) return false;
  varnaEnGang(`saknas ${objekt}`, `Säljtavlan: ${objekt} finns inte än (0250 är inte körd). Tavlan går vidare utan.`);
  return true;
}
