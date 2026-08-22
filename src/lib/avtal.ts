/**
 * E9.1 avtalsmallar. Ren logik, inga importer.
 *
 * Mallen ar markdown med platshallare i formen {{nyckel}}. Renderingen ar
 * avsiktligt dum: den kan inte gora nagot annat an att byta ut en nyckel mot
 * ett varde. Ingen `if`, ingen slinga, ingen uttrycksutvardering.
 *
 * ===========================================================================
 * EN OFYLLD PLATSHALLARE RENDERAS ALDRIG SOM TOMT.
 *
 * Det ar hela skalet att filen finns. Ett anstallningsavtal dar {{manadslon}}
 * blev en tom rad ser ut som ett avtal utan lon — och det ar ett dokument som
 * gar att skriva under. En mall med ett stavfel i en nyckel ska falla nar
 * mallen sparas, och ett avtal med ett tomt varde ska falla nar avtalet
 * skapas. Bada faller hogt och tidigt, aldrig tyst i utskriften.
 * ===========================================================================
 */

export type Variabel = {
  nyckel: string;
  etikett: string;
  /** Hamtas ur personalregistret i stallet for att skrivas for hand. */
  fran?: "employee";
  hjalp?: string;
};

/**
 * Vad en mall far anvanda.
 *
 * Listan ar stangd. En mall som anvander en nyckel som inte star har gar inte
 * att spara — annars hade "{{lön}}" och "{{manadslon}}" bott bredvid varandra
 * och den ena tyst renderats som ingenting.
 *
 * ===========================================================================
 * PERSONNUMMER STAR INTE MED, OCH DET AR ETT BESLUT.
 *
 * Navet lagrar inget personnummer nagonstans. `tests/rls.mjs` fragar
 * information_schema och faller den dag en kolumn som bar ett dyker upp — den
 * regeln kom med E15 och foddes ur K27.
 *
 * Ett avtal med `variables` som jsonb hade varit ett satt att smyga in ett
 * personnummer dar schemakontrollen inte ser det. Darfor: ingen variabel for
 * det, OCH ett check-villkor i 0028 som nekar en personnummerformad strang i
 * jsonben. Skyddet ar strukturellt, inte en regel att komma ihag.
 *
 * Foljden ar verklig och ska sagas rakt ut: det utskrivna avtalet har en rad
 * dar personnumret fylls i for hand. Ska navet bara det maste K27-linjen
 * omprovas medvetet — inte kringgas har.
 * ===========================================================================
 */
export const VARIABLER: Variabel[] = [
  { nyckel: "fornamn", etikett: "Förnamn", fran: "employee" },
  { nyckel: "efternamn", etikett: "Efternamn", fran: "employee" },
  { nyckel: "anstallningsnummer", etikett: "Anställningsnummer", fran: "employee" },
  { nyckel: "bolag", etikett: "Bolag", fran: "employee" },
  { nyckel: "startdatum", etikett: "Startdatum", fran: "employee" },
  { nyckel: "anstallningsform", etikett: "Anställningsform", fran: "employee" },

  { nyckel: "befattning", etikett: "Befattning", hjalp: "Till exempel Säljare eller Teamledare" },
  { nyckel: "manadslon", etikett: "Månadslön i kronor" },
  { nyckel: "arbetstid", etikett: "Arbetstid", hjalp: "Till exempel 40 timmar per vecka" },
  { nyckel: "arbetsort", etikett: "Arbetsort" },
  { nyckel: "semesterdagar", etikett: "Semesterdagar per år" },

  // E7.16 hor hemma har och inte i franvaromodulen — se ROADMAP raderna om
  // varfor uppsagningstiden ar ett avtalsvillkor och inte en franvaroregel.
  { nyckel: "uppsagningstid", etikett: "Uppsägningstid" },

  {
    nyckel: "provanstallning",
    etikett: "Provanställning",
    hjalp: "Till exempel 6 månader. Skriv ett streck om avtalet inte är en provanställning",
  },
];

export const VARIABELNYCKLAR = VARIABLER.map((v) => v.nyckel);

export type Avtalsstatus = "draft" | "issued" | "withdrawn";
export type Mallstatus = "draft" | "published" | "archived";

export const AVTALSSTATUS_ETIKETT: Record<Avtalsstatus, string> = {
  draft: "Utkast",
  issued: "Utfärdat",
  withdrawn: "Tillbakadraget",
};

export const MALLSTATUS_ETIKETT: Record<Mallstatus, string> = {
  draft: "Utkast",
  published: "Publicerad",
  archived: "Arkiverad",
};

/** Alla {{nycklar}} som forekommer i en text, i den ordning de star. */
export function hittaPlatshallare(mall: string): string[] {
  const traffar = mall.match(/\{\{\s*[a-z0-9_]+\s*\}\}/gi) ?? [];
  const sedda = new Set<string>();
  const ut: string[] = [];
  for (const t of traffar) {
    const nyckel = t.replace(/[{}]/g, "").trim().toLowerCase();
    if (!sedda.has(nyckel)) {
      sedda.add(nyckel);
      ut.push(nyckel);
    }
  }
  return ut;
}

/**
 * Nycklar i mallen som inte finns i listan ovan.
 *
 * Anropas nar en MALL sparas. Ett stavfel ska stoppa den som skriver mallen,
 * inte overraska den som ska skriva under avtalet.
 */
export function okandaPlatshallare(mall: string): string[] {
  return hittaPlatshallare(mall).filter((n) => !VARIABELNYCKLAR.includes(n));
}

/**
 * Ett halvt par klamrar ar nastan alltid ett stavfel, och det renderas som
 * vanlig text rakt in i avtalet. `{{lon}` skulle sta kvar ordagrant i
 * dokumentet utan att nagon marker det forran det ar underskrivet.
 */
export function trasigaKlamrar(mall: string): boolean {
  const utanHela = mall.replace(/\{\{\s*[a-z0-9_]+\s*\}\}/gi, "");
  return utanHela.includes("{{") || utanHela.includes("}}");
}

export type Renderingsfel = { saknade: string[]; okanda: string[] };

/**
 * Byter ut varje {{nyckel}} mot sitt varde.
 *
 * Kastar om nagot saknas. Att returnera texten med ett tomt hal hade gett ett
 * dokument som gar att skriva ut och skriva under — se rubriken hogst upp.
 *
 * Ett medvetet tomt varde skrivs som ett streck i formularet. Skillnaden
 * mellan "inte ifyllt" och "gäller inte" ska finnas i datan, inte i tolkningen
 * av en tom strang.
 */
export function rendera(mall: string, varden: Record<string, string>): string {
  const nycklar = hittaPlatshallare(mall);
  const okanda = nycklar.filter((n) => !VARIABELNYCKLAR.includes(n));
  const saknade = nycklar.filter(
    (n) => VARIABELNYCKLAR.includes(n) && !(varden[n] ?? "").toString().trim(),
  );

  if (okanda.length > 0 || saknade.length > 0) {
    const fel: Renderingsfel = { saknade, okanda };
    throw new AvtalsfelError(fel);
  }

  return mall.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_m, nyckel: string) =>
    varden[nyckel.toLowerCase()].toString().trim(),
  );
}

export class AvtalsfelError extends Error {
  saknade: string[];
  okanda: string[];

  constructor(fel: Renderingsfel) {
    const delar: string[] = [];
    if (fel.saknade.length) delar.push(`saknar värde för ${fel.saknade.join(", ")}`);
    if (fel.okanda.length) delar.push(`okända fält: ${fel.okanda.join(", ")}`);
    super(`Avtalet kan inte skapas: ${delar.join("; ")}.`);
    this.name = "AvtalsfelError";
    this.saknade = fel.saknade;
    this.okanda = fel.okanda;
  }
}

/**
 * Personnummerformad strang.
 *
 * Samma monster som databasens check-villkor i 0028 och samma som maskeringen
 * i fel.ts. Finns i koden ocksa for att kunna ge ett begripligt besked i
 * stallet for ett radbrott fran Postgres.
 */
export function serUtSomPersonnummer(text: string): boolean {
  return /\b(?:19|20)?\d{6}[-+]?\d{4}\b/.test(text);
}

/** Adressdel ur en rubrik. Samma regler som nyheternas slug. */
export function tillSlug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[åä]/g, "a")
      .replace(/ö/g, "o")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "mall"
  );
}
