/**
 * Leads från hemsidan (0076). Ren logik — inga importer, så att tolkningen går
 * att prova utan att starta något annat. Samma skäl som `arenden.ts` och
 * `samtal.ts`.
 *
 * ===========================================================================
 * TOLKNINGEN ÄR GENERÖS MED FORMEN OCH STRÄNG MED INNEHÅLLET
 *
 * Vi vet inte vilket formulärverktyg hemsidan kör, och det kan bytas utan att
 * någon säger till navet. Därför tas fälten emot under alla rimliga namn —
 * svenska och engelska, med och utan bindestreck, platt eller inlindat i
 * `data` som Webflow gör — och allt navet inte känner igen sparas under
 * "Övriga fält" i stället för att tappas.
 *
 * Det som däremot MÅSTE finnas är en väg tillbaka till kunden: e-post eller
 * telefon. Ett lead utan någon av dem går inte att ringa, och det är inte ett
 * lead utan en anonym kommentar.
 * ===========================================================================
 */

export type Leadstatus = "new" | "contacted" | "meeting" | "won" | "lost" | "spam";

export const STATUSAR: Leadstatus[] = ["new", "contacted", "meeting", "won", "lost", "spam"];

export const STATUS_ETIKETT: Record<Leadstatus, string> = {
  new: "Ny",
  contacted: "Kontaktad",
  meeting: "Möte bokat",
  won: "Blev kund",
  lost: "Ej aktuell",
  spam: "Spam",
};

/** Badge-ton per status. AC-U5.2: färgen bär aldrig beskedet ensam — ordet står alltid bredvid. */
export const STATUS_TON: Record<Leadstatus, "warn" | "info" | "brand" | "ok" | "neutral"> = {
  new: "warn",
  contacted: "info",
  meeting: "brand",
  won: "ok",
  lost: "neutral",
  spam: "neutral",
};

/** Det som fortfarande kräver att någon gör något. Listans förval. */
export const OPPNA: Leadstatus[] = ["new", "contacted", "meeting"];

export function arLeadstatus(varde: unknown): varde is Leadstatus {
  return typeof varde === "string" && (STATUSAR as string[]).includes(varde);
}

// -----------------------------------------------------------------------------
// K27
// -----------------------------------------------------------------------------

/**
 * Exakt samma uttryck som `ser_ut_som_personnummer()` i 0030. Står de inte
 * lika maskerar mottagaren för lite, och då faller villkoret `lead_inget_personnummer`
 * på ett lead som borde ha gått in.
 *
 * Det fångar också ett tiosiffrigt mobilnummer och ett AB:s orgnummer. Det är
 * priset, och det är samma pris som 0030 betalar: numret har eget fält.
 */
const PERSONNUMMER = /\d{6}[-+]?\d{4}/;
const PERSONNUMMER_ALLA = /\d{6}[-+]?\d{4}/g;

export const DOLT_NUMMER = "[nummer dolt]";

export function maskeraPersonnummer(text: string): string {
  // Upprepas tills inget finns kvar. En ersättning kan inte skapa en ny följd
  // av siffror — ersättningen har inga — men regeln ska inte vila på det.
  let ut = text;
  for (let i = 0; i < 5 && PERSONNUMMER.test(ut); i++) {
    ut = ut.replace(PERSONNUMMER_ALLA, DOLT_NUMMER);
  }
  return ut;
}

// -----------------------------------------------------------------------------
// Fältnamn
// -----------------------------------------------------------------------------

/** "E-post" → "epost", "your-name" → "yourname", "first_name" → "firstname". */
export function nyckel(namn: string): string {
  return namn
    .toLowerCase()
    .replace(/[åä]/g, "a")
    .replace(/ö/g, "o")
    .replace(/é/g, "e")
    .replace(/[^a-z0-9]/g, "");
}

type Falt =
  | "name"
  | "firstname"
  | "lastname"
  | "company"
  | "email"
  | "phone"
  | "message"
  | "page_url"
  | "source"
  | "utm_source"
  | "utm_medium"
  | "utm_campaign";

/**
 * Alla namn ett fält kan komma under, redan normaliserade med `nyckel()`.
 *
 * `website` står MED FLIT INTE som honungsfälla nedan, trots att det är det
 * vanligaste namnet i guiderna på nätet: ett B2B-formulär frågar ofta efter
 * kundens hemsida på riktigt. Det hamnar under Övriga fält.
 */
const ALIAS: Record<Falt, string[]> = {
  name: ["namn", "name", "fullname", "fulltnamn", "kontaktperson", "contactname", "yourname", "ditt namn"],
  firstname: ["fornamn", "firstname", "fname", "givenname"],
  lastname: ["efternamn", "lastname", "lname", "surname", "familyname"],
  company: ["foretag", "company", "bolag", "foretagsnamn", "companyname", "organisation", "organization", "firma"],
  email: ["epost", "email", "mail", "epostadress", "emailaddress", "youremail"],
  phone: ["telefon", "phone", "tel", "mobil", "mobile", "telefonnummer", "phonenumber", "mobilnummer", "yourphone"],
  message: ["meddelande", "message", "msg", "fraga", "kommentar", "comment", "comments", "beskrivning", "yourmessage", "text"],
  page_url: ["pageurl", "page", "sida", "url", "landingpage", "formurl", "sourceurl"],
  source: ["kalla", "source", "leadsource"],
  utm_source: ["utmsource"],
  utm_medium: ["utmmedium"],
  utm_campaign: ["utmcampaign"],
};

const FALT_AV_NYCKEL = new Map<string, Falt>(
  (Object.entries(ALIAS) as [Falt, string[]][]).flatMap(([falt, alias]) =>
    alias.map((a) => [nyckel(a), falt] as [string, Falt]),
  ),
);

/**
 * Honungsfällan. Ett dolt fält som en människa aldrig ser och därför aldrig
 * fyller i — men en robot som fyller i allt den hittar gör det.
 *
 * Hemsidan lägger till `<input name="_honeypot" style="display:none" tabindex="-1" autocomplete="off">`.
 */
const HONUNGSFALT = new Set(["honeypot", "gotcha", "hpfalt", "honungsfalla"]);

/** Fält som formulärverktygen skickar om sig själva, och som inte säger något om kunden. */
const BRUS = new Set(["site", "triggertype", "publishedpath", "formid", "formname", "submissionid", "siteid", "pageid", "nonce", "action", "token", "recaptcha", "grecaptcharesponse", "gresponse", "cfturnstileresponse"]);

// -----------------------------------------------------------------------------
// Tolkningen
// -----------------------------------------------------------------------------

export type TolkatLead = {
  source: string;
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  page_url: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  extra: Record<string, string>;
};

export type Spamskal = "honungsfalla" | "lankar";

export type Tolkning =
  | { ok: true; lead: TolkatLead; spam: Spamskal | null }
  | { ok: false; fel: string };

const MAX_EXTRA_FALT = 40;
const MAX_EXTRA_VARDE = 1000;
/**
 * I BYTE, inte i tecken. Databasens tak (`pg_column_size(extra) <= 20000` i
 * 0076) räknar byte, och å, ä och ö är två var — ett formulär med långa svenska
 * svar hade annars fällts av villkoret fast det klarade gränsen här.
 */
const MAX_EXTRA_TOTALT = 12_000;

const KODARE = new TextEncoder();
const byte = (t: string) => KODARE.encode(t).length;

function text(varde: unknown): string | null {
  if (varde === null || varde === undefined) return null;
  if (typeof varde === "string") return varde.trim() || null;
  if (typeof varde === "number" || typeof varde === "boolean") return String(varde);
  if (Array.isArray(varde)) {
    const delar = varde.map(text).filter((d): d is string => Boolean(d));
    return delar.length ? delar.join(", ") : null;
  }
  return null;
}

function klipp(varde: string | null, max: number): string | null {
  if (!varde) return null;
  return varde.length > max ? varde.slice(0, max - 1) + "…" : varde;
}

function arObjekt(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Plockar fram själva formulärfälten ur det verktyget skickade.
 *
 *   { namn: "…" }                         platt — det vi rekommenderar
 *   { data: { namn: "…" } }               Webflow, äldre
 *   { payload: { data: { namn: "…" } } }  Webflow, nyare
 *   { fields: { namn: { value: "…" } } }  Elementor och liknande
 *
 * Det inlindade lagret och toppnivån plattas ut till ett, så att `page_url` på
 * toppen och fälten i `data` båda följer med. Vid krock vinner det inlindade.
 */
export function plattaUt(ra: unknown): Record<string, unknown> {
  if (!arObjekt(ra)) return {};
  const ut: Record<string, unknown> = {};

  const lagg = (obj: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(obj)) {
      if (k in ut) continue;
      if (arObjekt(v) && "value" in v) ut[k] = v.value;
      else if (!arObjekt(v)) ut[k] = v;
    }
  };

  // DE INLINDADE FÄLTEN FÖRST. Webflow skickar formulärets eget namn som
  // `name` på toppnivån och kundens namn i `data` — läses toppen först heter
  // varje lead "Kontaktformulär". Toppnivån fyller bara i det som saknas.
  if (arObjekt(ra.payload) && arObjekt(ra.payload.data)) lagg(ra.payload.data);
  if (arObjekt(ra.data)) lagg(ra.data);
  if (arObjekt(ra.fields)) lagg(ra.fields);
  lagg(ra);
  return ut;
}

/**
 * Telefonnumret i en form som går att jämföra: bara siffror, och +46 skrivet
 * som en nolla. "070-123 45 67" och "+46 70 123 45 67" är samma kund.
 */
export function normaliseraTelefon(ra: string | null): string | null {
  if (!ra) return null;
  const plus = ra.trim().startsWith("+");
  let siffror = ra.replace(/\D/g, "");
  if (!siffror) return null;

  if (plus && siffror.startsWith("46")) siffror = "0" + siffror.slice(2);
  else if (siffror.startsWith("0046")) siffror = "0" + siffror.slice(4);
  else if (plus) siffror = "+" + siffror;

  // Färre än sex siffror är inget telefonnummer, det är ett felskrivet fält.
  return siffror.replace(/^\+/, "").length >= 6 ? siffror.slice(0, 20) : null;
}

/** Små bokstäver och inga blanksteg. Ingen fullständig RFC — bara det som avgör om ett brev kan nå fram. */
export function normaliseraEpost(ra: string | null): string | null {
  if (!ra) return null;
  const e = ra.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254 ? e : null;
}

/** Fler än två länkar i ett kontaktformulär skriver ingen människa. */
export function antalLankar(t: string | null): number {
  if (!t) return 0;
  return (t.match(/https?:\/\/|www\./gi) ?? []).length;
}

export const MAX_LANKAR = 2;

export function tolkaInskick(ra: unknown): Tolkning {
  const falt = plattaUt(ra);
  if (Object.keys(falt).length === 0) return { ok: false, fel: "Inga fält i anropet." };

  const kant: Partial<Record<Falt, string>> = {};
  const extra: Record<string, string> = {};
  let honung = false;
  let extraLangd = 0;

  for (const [ratNamn, ratVarde] of Object.entries(falt)) {
    const n = nyckel(ratNamn);
    const v = text(ratVarde);

    if (HONUNGSFALT.has(n)) {
      if (v) honung = true;
      continue;
    }
    if (!v || BRUS.has(n)) continue;

    const f = FALT_AV_NYCKEL.get(n);
    if (f && !kant[f]) {
      kant[f] = v;
      continue;
    }

    // Okänt fält, eller ett andra värde för ett känt (t.ex. både "namn" och
    // "name"). Det första vinner, resten syns under Övriga fält.
    if (Object.keys(extra).length >= MAX_EXTRA_FALT) continue;
    const k = maskeraPersonnummer(ratNamn.trim().slice(0, 80));
    const varde = maskeraPersonnummer(klipp(v, MAX_EXTRA_VARDE)!);
    const storlek = byte(k) + byte(varde);
    if (extraLangd + storlek > MAX_EXTRA_TOTALT) continue;
    extra[k] = varde;
    extraLangd += storlek;
  }

  const namn =
    kant.name ??
    ([kant.firstname, kant.lastname].filter(Boolean).join(" ").trim() || undefined);

  // Ett ogiltigt e-postvärde tappas inte — det kan vara en felskrivning som en
  // människa ser rätt på — men det ligger i Övriga fält, inte i e-postfältet,
  // eftersom ingenting ska försöka skicka till det.
  const email = normaliseraEpost(kant.email ?? null);
  if (kant.email && !email) extra["E-post (ogiltig)"] = maskeraPersonnummer(klipp(kant.email, 254)!);

  const phone = normaliseraTelefon(kant.phone ?? null);
  if (kant.phone && !phone) extra["Telefon (ogiltigt)"] = maskeraPersonnummer(klipp(kant.phone, 40)!);

  if (!email && !phone) {
    return { ok: false, fel: "Varken e-post eller telefon gick att läsa ut. Ett lead måste gå att kontakta." };
  }

  const message = klipp(kant.message ? maskeraPersonnummer(kant.message) : null, 5000);

  const lead: TolkatLead = {
    source: klipp(kant.source ?? null, 60) ?? "hemsida",
    name: klipp(namn ? maskeraPersonnummer(namn) : null, 200),
    company: klipp(kant.company ? maskeraPersonnummer(kant.company) : null, 200),
    email,
    phone,
    message,
    page_url: klipp(kant.page_url ?? null, 1000),
    utm_source: klipp(kant.utm_source ?? null, 200),
    utm_medium: klipp(kant.utm_medium ?? null, 200),
    utm_campaign: klipp(kant.utm_campaign ?? null, 200),
    extra,
  };

  const spam: Spamskal | null = honung
    ? "honungsfalla"
    : antalLankar(message) > MAX_LANKAR
      ? "lankar"
      : null;

  return { ok: true, lead, spam };
}

// -----------------------------------------------------------------------------
// Visning
// -----------------------------------------------------------------------------

/** Det ett lead heter i en lista och i en notis: företaget, annars personen, annars kontaktvägen. */
export function leadTitel(l: { company: string | null; name: string | null; email: string | null; phone: string | null }): string {
  return l.company || l.name || l.email || l.phone || "Okänt lead";
}

/** Raden under titeln: personen om titeln är företaget, och kontaktvägarna. */
export function leadUndertitel(l: { company: string | null; name: string | null; email: string | null; phone: string | null }): string {
  const delar: string[] = [];
  if (l.company && l.name) delar.push(l.name);
  if (l.email && leadTitel(l) !== l.email) delar.push(l.email);
  if (l.phone && leadTitel(l) !== l.phone) delar.push(l.phone);
  return delar.join(" · ");
}

/**
 * Hur länge ett lead legat. "12 min", "3 h", "2 d".
 *
 * Minuter och inte datum: det som avgör om ett lead fortfarande är varmt är hur
 * länge det väntat, och "07 okt 13:02" får läsaren att räkna själv.
 */
export function alder(iso: string, nu: Date = new Date()): string {
  const min = Math.max(0, Math.round((nu.getTime() - Date.parse(iso)) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

/** Hur långt bakåt en dubblett letas. Ett dygn: samma kund som skickar två gånger på en förmiddag. */
export const DUBBLETT_TIMMAR = 24;
