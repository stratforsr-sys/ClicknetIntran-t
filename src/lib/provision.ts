/**
 * E13, forsta skivan: intjanad provision. Ren logik — inga anrop, inga
 * hemligheter. Samma linje som `raster.ts` och `lonekostnad.ts`: motorn ska ga
 * att prova utan att starta Next.
 *
 * ===========================================================================
 * NAVET RAKNAR INGEN PROVISION.
 *
 * Filen summerar poster som nagon annan bestamt. Den vet ingenting om satser,
 * trappor eller garantiloner — Q78-Q80 ar obesvarade, och AC-10.1 kraver att
 * reglerna blir konfiguration och inte kod den dag de kommer.
 *
 * Frestelsen ar en `if` med en procentsats "sa lange, tills det riktiga
 * kommer". Da blir navet ett provisionssystem med en gissning i sig, och
 * gissningen ar den siffra folk kommer att brakas om. Se samma resonemang i
 * 0025 om varfor lonekostnaden inte har ett enda tal ur skattelagstiftningen.
 * ===========================================================================
 *
 * En post kan vara negativ. Det ar sa en rattelse ser ut (se 0031) — tabellen
 * ar append-only, sa summan ar det enda ordet som galler.
 */

import { svensktDatum } from "./klocka.ts";

export type Provisionspost = {
  period_month: string; // "2026-08-01"
  amount: number;
  deals: number | null;
};

/**
 * Manadsnyckeln for en tidpunkt: forsta dagen i manaden, som "2026-08-01".
 *
 * Manaden raknas i svensk tid, inte serverns. Pa Vercel star servern i UTC, och
 * den forsta i manaden klockan 00:30 svensk tid hade da bokforts pa manaden
 * innan. Se `klocka.ts` for hela bakgrunden.
 */
export function manadsnyckel(datum: Date | string = new Date()): string {
  const s = typeof datum === "string" ? datum : svensktDatum(datum);
  return `${s.slice(0, 7)}-01`;
}

/** Manaden `n` steg fore `nyckel`. Negativt `n` gar framat. */
export function manadFore(nyckel: string, n = 1): string {
  const ar = Number(nyckel.slice(0, 4));
  const manad = Number(nyckel.slice(5, 7));
  // Raknas i manadstal i stallet for med Date: en Date-baserad "minus en manad"
  // fran den 31:a landar pa fel manad, och nyckeln ar alltid den 1:a anda.
  const totalt = ar * 12 + (manad - 1) - n;
  return `${Math.floor(totalt / 12)}-${String((totalt % 12) + 1).padStart(2, "0")}-01`;
}

export type Manadssumma = {
  manad: string;
  belopp: number;
  affarer: number | null;
  poster: number;
};

/** Summan for en manad. Antalet affarer ar null nar ingen post angett nagot. */
export function summera(poster: Provisionspost[], manad: string): Manadssumma {
  const ur = poster.filter((p) => p.period_month === manad);
  const medAntal = ur.filter((p) => p.deals != null);

  return {
    manad,
    belopp: ur.reduce((s, p) => s + p.amount, 0),
    affarer: medAntal.length ? medAntal.reduce((s, p) => s + (p.deals ?? 0), 0) : null,
    poster: ur.length,
  };
}

export type Sammanfattning = {
  denna: Manadssumma;
  forra: Manadssumma;
  /** Skillnaden i kronor mot forra manaden. */
  skillnad: number;
  /** Ackumulerat under kalenderaret, inklusive innevarande manad. */
  iAr: number;
};

export function sammanfatta(
  poster: Provisionspost[],
  nu: Date | string = new Date(),
): Sammanfattning {
  const denna = manadsnyckel(nu);
  const forra = manadFore(denna);
  const ar = denna.slice(0, 4);

  const a = summera(poster, denna);
  const b = summera(poster, forra);

  return {
    denna: a,
    forra: b,
    skillnad: a.belopp - b.belopp,
    iAr: poster.filter((p) => p.period_month.startsWith(ar)).reduce((s, p) => s + p.amount, 0),
  };
}

/** Alla manader som har poster, nyast forst. */
export function manader(poster: Provisionspost[]): Manadssumma[] {
  const unika = [...new Set(poster.map((p) => p.period_month))].sort().reverse();
  return unika.map((m) => summera(poster, m));
}

const KRONOR = new Intl.NumberFormat("sv-SE", {
  style: "currency",
  currency: "SEK",
  maximumFractionDigits: 0,
});

/** "12 400 kr". Ore visas inte — provision bokfors i hela kronor. */
export function kronor(belopp: number): string {
  return KRONOR.format(Math.round(belopp));
}

/** Manaden med ord: "augusti 2026". */
export function manadsnamn(nyckel: string): string {
  const d = new Date(`${nyckel}T12:00:00Z`);
  return new Intl.DateTimeFormat("sv-SE", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/**
 * Tolkar ett inskrivet belopp. Accepterar mellanslag som tusentalsavgransare
 * och bade komma och punkt som decimaltecken — den som skriver "12 400,50"
 * ska inte motas av ett felmeddelande om format.
 *
 * Minustecken slapps igenom med flit: en rattelse ar en negativ post.
 *
 * U+2212 MINUS SIGN accepteras ocksa. Det ar inte petighet: `kronor()` SKRIVER
 * det tecknet, eftersom det ar vad sv-SE anvander. Den som kopierar ett
 * visat belopp for att bokfora en rattelse pa det klistrar alltsa in ett
 * minustecken som inte finns pa tangentbordet, och utan raden nedan motes hen
 * av "beloppet gick inte att tolka" pa ett tal navet sjalvt skrivit ut.
 */
export function tolkaBelopp(text: string): number | null {
  const rensat = text
    // Bade vanligt mellanslag och det harda mellanslag Intl skriver ut.
    .replace(/[\s\u00a0]/g, "")
    .replace(/kr$/i, "")
    .replace("\u2212", "-")
    .replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(rensat)) return null;

  const tal = Number(rensat);
  return Number.isFinite(tal) ? tal : null;
}

/**
 * Ar manadsnyckeln giltig och inte i framtiden?
 *
 * Framtida manader nekas for att en post i september som bokas i augusti inte
 * ar en intjaning utan en prognos, och de tva ska inte kunna blandas i samma
 * tabell.
 */
export function giltigManad(nyckel: string, nu: Date | string = new Date()): boolean {
  if (!/^\d{4}-\d{2}-01$/.test(nyckel)) return false;
  const manad = Number(nyckel.slice(5, 7));
  if (manad < 1 || manad > 12) return false;
  return nyckel <= manadsnyckel(nu);
}
