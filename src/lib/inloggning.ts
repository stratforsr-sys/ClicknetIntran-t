/**
 * Det inloggningens sidor, actions och mellanvaran delar, utan import. Modulen
 * ska kunna köras rakt av i ett prov (tests/inloggning.mjs), och den får inte
 * dra in server-only: sidan som ritar formuläret läser samma regler som
 * servern som tar emot det.
 */

/** Bolagets domän. Den som bara skriver "zen" menar zen@clicknet.se. */
export const DOMAN = "clicknet.se";

/**
 * Sekunder mellan två koder. Supabase nekar en ny kod till samma adress inom
 * en minut; räknaren i formuläret är till för att ingen ska behöva läsa det
 * felet.
 */
export const KOD_PAUS_S = 60;

/** Så länge en kod gäller (Supabase: mailer_otp_exp, 3600 s). */
export const KOD_GILTIG_MIN = 60;

/** Så länge "Glömt lösenordet?" håller dörren öppen efter koden (aterstallning.ts). */
export const ATERSTALL_MINUTER = 15;

/** Efter så många fel lösenord i rad föreslår sidan en kod i stället. */
export const FORSOK_INNAN_KOD = 3;

/** Kakan som minns kontot på enheten: adressen, namnet och när. */
export const KONTOKAKA = "nav_konto";

/**
 * Trimmar, gör gemener och fyller i domänen när den saknas.
 *
 * Förlåtande med flit: "Zen", " zen@Clicknet.se " och "zen@clicknet.se" är
 * samma person. Det som inte går att tolka lämnas som det är och nekas av
 * Supabase med navets eget felmeddelande.
 */
export function normaliseraEpost(varde: unknown): string {
  const v = String(varde ?? "").trim().toLowerCase();
  if (!v) return "";
  if (!v.includes("@") && /^[a-z0-9._+-]+$/.test(v)) return `${v}@${DOMAN}`;
  return v;
}

/** Ser adressen ut som en adress? Mer än så prövar inte navet; Supabase avgör. */
export function liknarEpost(v: string): boolean {
  return v.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
}

/**
 * Vart man skickas efter inloggningen.
 *
 * Bara vägar inom navet. "//evil.se" och "/\evil.se" är båda adresser till en
 * annan värd i en webbläsare, och "@evil.se" efter ursprunget blir en
 * användardel i adressen — därför krävs ett ensamt snedstreck först, och
 * inget snedstreck eller bakstreck direkt efter. Inloggningens egna sidor
 * släpps inte igenom, eftersom de skickar vidare igen.
 */
export function sakerNasta(varde: unknown, reserv = "/nav2"): string {
  const v = String(varde ?? "");
  if (!/^\/(?![/\\])/.test(v)) return reserv;
  if (/[\u0000-\u001f\u007f\\]/.test(v)) return reserv;
  if (v === "/" || v.startsWith("/logga-in") || v.startsWith("/auth")) return reserv;
  return v;
}

/**
 * Vyn en väg öppnar, med namnet Nav 2.0 ger den, eller null för navet självt.
 * "/kalender?dag=…" → "Kalendern", "/nav2?till=%2Forder" → "Order".
 */
const VYER: Record<string, string> = {
  kalender: "Kalendern",
  order: "Order",
  provision: "Provision",
  leads: "Leads",
  kv: "K&V",
  tid: "Tid",
  franvaro: "Frånvaro",
  uppgifter: "Uppgifter",
  rutiner: "Rutiner",
  utbildning: "Utbildning",
  arenden: "Ärenden",
  fel: "Fel",
  coachning: "Coachning",
  personal: "Anställda",
  rekrytering: "Rekrytering",
  avtal: "Avtal",
  nyheter: "Nyheter",
  logg: "Händelseloggen",
  adoption: "Adoption",
  profil: "Inställningar",
  sok: "Sök",
  filer: "filen",
  "byt-losenord": "lösenordsbytet",
};

export function malNamn(nasta: string): string | null {
  let vag = nasta;
  if (vag.startsWith("/nav2")) {
    const fraga = vag.split("?")[1] ?? "";
    const till = new URLSearchParams(fraga).get("till");
    if (!till) return null;
    vag = till;
  }
  const del = vag.split(/[?#]/)[0].split("/").filter(Boolean)[0];
  return del ? VYER[del] ?? null : null;
}

/* ---------- Tid, i Stockholm ---------- */

const VECKODAG = ["Söndag", "Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag"];
const MANAD = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];

export type Stund = { ar: number; manad: number; dag: number; veckodag: number; minut: number };

/** Kalenderdag och minut på dygnet i Stockholm, oavsett serverns zon. */
export function iStockholm(tid: Date): Stund {
  const delar = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(tid);
  const tal = (typ: string) => Number(delar.find((d) => d.type === typ)?.value);
  const ar = tal("year");
  const manad = tal("month");
  const dag = tal("day");
  return {
    ar,
    manad,
    dag,
    veckodag: new Date(Date.UTC(ar, manad - 1, dag)).getUTCDay(),
    minut: tal("hour") * 60 + tal("minute"),
  };
}

/** ISO-veckan för en kalenderdag. */
export function isoVecka(ar: number, manad: number, dag: number): number {
  const d = new Date(Date.UTC(ar, manad - 1, dag));
  const veckodag = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - veckodag);
  const forsta = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - forsta.getTime()) / 86400000 + 1) / 7);
}

/** Nav 2.0:s hälsning (ndHalsning i utkastets nd.js): före 10, före 18, sedan kväll. */
export function halsning(minut: number): string {
  return minut < 10 * 60 ? "God morgon" : minut < 18 * 60 ? "God eftermiddag" : "God kväll";
}

/** Nav 2.0:s datumrad: "Tisdag 20 oktober · vecka 43". */
export function dagText(tid: Date): string {
  const s = iStockholm(tid);
  return `${VECKODAG[s.veckodag]} ${s.dag} ${MANAD[s.manad - 1]} · vecka ${isoVecka(s.ar, s.manad, s.dag)}`;
}

export function klockslag(tid: Date): string {
  const m = iStockholm(tid).minut;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** När kontot senast loggade in här: "i dag 08:12", "i går 16:40", "13 oktober". */
export function senastText(tid: Date, nu: Date): string {
  const a = iStockholm(tid);
  const b = iStockholm(nu);
  const dagar = Math.round((Date.UTC(b.ar, b.manad - 1, b.dag) - Date.UTC(a.ar, a.manad - 1, a.dag)) / 86400000);
  const kl = klockslag(tid);
  if (dagar <= 0) return `i dag ${kl}`;
  if (dagar === 1) return `i går ${kl}`;
  if (dagar < 7) return `i ${VECKODAG[a.veckodag].toLowerCase()}s ${kl}`;
  return `${a.dag} ${MANAD[a.manad - 1]}${a.ar !== b.ar ? ` ${a.ar}` : ""}`;
}

/** En kalenderdag: "20 november", med året när det inte är i år. */
export function datumText(tid: Date, nu: Date): string {
  const a = iStockholm(tid);
  return `${a.dag} ${MANAD[a.manad - 1]}${a.ar !== iStockholm(nu).ar ? ` ${a.ar}` : ""}`;
}

/** Sekunder som minuter och sekunder: 42 → "0:42", 75 → "1:15". */
export function kvarText(sekunder: number): string {
  const s = Math.max(0, Math.ceil(sekunder));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/* ---------- Adressen ---------- */

function avstand(a: string, b: string): number {
  const rad = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let forra = rad[0];
    rad[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = rad[j];
      rad[j] = Math.min(rad[j] + 1, rad[j - 1] + 1, forra + (a[i - 1] === b[j - 1] ? 0 : 1));
      forra = tmp;
    }
  }
  return rad[b.length];
}

/**
 * Ett skrivfel i domänen: "zen@clicknet.com" → "zen@clicknet.se". Bara när
 * domänen ligger nära bolagets (högst två tecken fel, eller samma namn med en
 * annan ändelse), så att en riktig annan adress aldrig "rättas".
 */
export function foreslaRattning(epost: string): string | null {
  const v = epost.trim().toLowerCase();
  const delar = v.split("@");
  if (delar.length !== 2 || !delar[0] || !delar[1]) return null;
  const [lokal, doman] = delar;
  if (doman === DOMAN) return null;
  const namn = DOMAN.split(".")[0];
  const nara = avstand(doman, DOMAN) <= 2 || doman === namn || doman.startsWith(`${namn}.`) || avstand(doman.split(".")[0], namn) === 1 && doman.endsWith(".se");
  return nara ? `${lokal}@${DOMAN}` : null;
}

/** Sekunderna i Supabases "you can only request this after 42 seconds". */
export function sekunderUrFel(meddelande: string): number | null {
  const m = /after (\d+) seconds?/i.exec(meddelande);
  return m ? Math.min(3600, Number(m[1])) : null;
}

/* ---------- Supabases fel ---------- */

/**
 * Vad ett fel från inloggningstjänsten betyder för den som står vid formuläret.
 *
 * Felkoden (`code`) läses först; meddelandet bara när koden saknas, och
 * aldrig visas det. Två saker GoTrue inte skiljer på går inte att skilja på
 * här heller: fel kod och utgången kod ger samma "Token has expired or is
 * invalid", och fel lösenord och okänd adress samma "Invalid login
 * credentials". Det senare är med flit, så att formuläret inte röjer vilka
 * adresser som har konto.
 */
export type Felorsak =
  | { typ: "fel" }
  | { typ: "kod" }
  | { typ: "okant" }
  | { typ: "adress" }
  | { typ: "obekraftad" }
  | { typ: "avstangd" }
  | { typ: "sparr"; sekunder: number }
  | { typ: "mejlgrans" }
  | { typ: "tjanst" };

export function tolkaAuthFel(e: { code?: string; status?: number; message?: string }): Felorsak {
  const kod = e.code ?? "";
  const m = (e.message ?? "").toLowerCase();
  if (kod === "invalid_credentials" || m.includes("invalid login credentials")) return { typ: "fel" };
  if (kod === "otp_expired" || m.includes("token has expired or is invalid")) return { typ: "kod" };
  if (["otp_disabled", "signup_disabled", "user_not_found"].includes(kod) || m.includes("signups not allowed")) {
    return { typ: "okant" };
  }
  if (kod === "email_address_invalid") return { typ: "adress" };
  if (kod === "email_not_confirmed" || m.includes("email not confirmed")) return { typ: "obekraftad" };
  if (kod === "user_banned") return { typ: "avstangd" };
  const sekunder = sekunderUrFel(e.message ?? "");
  if (sekunder !== null) return { typ: "sparr", sekunder };
  if (kod === "over_email_send_rate_limit" || m.includes("email rate limit")) return { typ: "mejlgrans" };
  if (kod === "over_request_rate_limit" || e.status === 429 || m.includes("rate limit") || m.includes("too many")) {
    return { typ: "sparr", sekunder: 60 };
  }
  return { typ: "tjanst" };
}

/** Texterna som flera av inloggningens vägar säger, så att de säger samma sak. */
export const TEXT = {
  kodFel: "Koden stämmer inte eller har gått ut. Kontrollera att du tog den senaste.",
  kodSparr: "För många försök. Vänta en stund och be sedan om en ny kod.",
  tjanst: "Inloggningen svarar inte just nu. Försök igen om en stund.",
  mejlgrans: "Navet har skickat många mejl den senaste stunden. Försök igen om en stund.",
  ejSkickad: "Koden kunde inte skickas just nu. Försök igen om en stund.",
  utloggad: "Du är inte inloggad längre. Logga in igen.",
} as const;

/** "Öppnar Kalendern…" eller "Öppnar navet…" medan nästa sida laddas. */
export function oppnarText(till: string): string {
  const mal = malNamn(till);
  return mal ? `Öppnar ${mal}…` : "Öppnar navet…";
}

/* ---------- Kontot på enheten ---------- */

export type Konto = {
  epost: string;
  /** För- och efternamn ur personalregistret, om de fanns. */
  namn: string | null;
  /** När kontot senast loggade in på den här enheten (ISO). */
  senast: string | null;
};

/**
 * Läser kakan. Den är skriven av navet men ligger i webbläsaren, så den
 * behandlas som indata: allt prövas, och det som inte stämmer kastas.
 */
export function lasKonto(varde: string | undefined): Konto | null {
  if (!varde) return null;
  try {
    const d = JSON.parse(varde) as { e?: unknown; n?: unknown; t?: unknown };
    const epost = normaliseraEpost(d.e);
    if (!liknarEpost(epost)) return null;
    const namn = typeof d.n === "string" && d.n.trim() && d.n.length <= 80 ? d.n.trim() : null;
    const senast = typeof d.t === "string" && !Number.isNaN(Date.parse(d.t)) ? d.t : null;
    return { epost, namn, senast };
  } catch {
    return null;
  }
}

export function skrivKonto(k: Konto): string {
  return JSON.stringify({ e: k.epost, n: k.namn, t: k.senast });
}

export function fornamn(namn: string | null): string | null {
  return namn ? namn.split(/\s+/)[0] || null : null;
}

/** Initialerna och färgen som Nav 2.0:s avatar() ger samma namn. */
const AVC = ["#0E7A5F", "#C2410C", "#3A6EA5", "#8E54A8", "#5B6B2E", "#9A3412", "#2F5D62", "#7A4A06"];

export function initialer(namn: string): string {
  return namn
    .split(/\s+/)
    .filter(Boolean)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function avatarFarg(namn: string): string {
  return AVC[namn.length % AVC.length];
}
