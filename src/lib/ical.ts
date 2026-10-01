/**
 * E7.3 / AC-3.3: iCal-flöde. Ren logik — inga anrop, ingen databas.
 *
 * ===========================================================================
 * SJUKFRÅNVARO GÅR ALDRIG UT I ETT FLÖDE.
 *
 * Funktionen tar emot `Ledighet[]`, och den typen kan inte bära en sjukperiod:
 * `sick_report` har ingen `type_id`, ingen väg in i den här filen och ingen
 * anropare som skickar den. Ett flöde är en URL utan inloggning — det som går
 * ut i det ligger därefter hos den kalendertjänst mottagaren använder, och
 * ingen rotation av adressen tar tillbaka det som redan synkats dit.
 *
 * TYPEN FÖLJER INTE HELLER MED. Posterna heter "Namn — Ledig". Att någon är
 * föräldraledig eller vabbar är en upplysning om varför, och den hör hemma
 * bakom inloggning. `SAMMANFATTNING` nedan är därför en konstant och inte ett
 * fält — det ska krävas en kodändring, inte en konfigurationsändring, för att
 * lägga till den.
 * ===========================================================================
 */

export type Ledighet = {
  id: string;
  namn: string;
  starts_on: string;
  /** Inklusive. iCal vill ha dagen efter — se `dagenEfter`. */
  ends_on: string;
  part_day_minutes: number | null;
};

const SAMMANFATTNING = "Ledig";

/**
 * iCal escapar med omvänt snedstreck. Komma och semikolon är fältavgränsare i
 * formatet, så ett namn med komma skulle annars dela posten i två.
 */
function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function utanBindestreck(datum: string): string {
  return datum.replace(/-/g, "");
}

/** DTEND i en heldagspost är exklusiv: en endagsledighet slutar dagen efter. */
function dagenEfter(datum: string): string {
  const d = new Date(`${datum}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Rader viks vid 75 oktetter enligt RFC 5545. Google Calendar och Outlook
 * klarar långa rader i praktiken, men en enda tyst avvisad prenumeration är
 * dyrare att felsöka än den här funktionen är att skriva.
 */
function vik(rad: string): string {
  const bytes = Buffer.from(rad, "utf8");
  if (bytes.length <= 75) return rad;

  const delar: string[] = [];
  let i = 0;
  let gransen = 75;

  while (i < bytes.length) {
    let slut = Math.min(i + gransen, bytes.length);
    // Klipp aldrig mitt i ett tecken: fortsättningsbytes i UTF-8 börjar 10xxxxxx.
    while (slut > i && slut < bytes.length && (bytes[slut] & 0xc0) === 0x80) slut--;
    delar.push(bytes.subarray(i, slut).toString("utf8"));
    i = slut;
    gransen = 74; // Fortsättningsrader börjar med ett mellanslag.
  }

  return delar.join("\r\n ");
}

export function ical(poster: Ledighet[], titel: string, nu: Date = new Date()): string {
  const stamp = nu.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

  const rader: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Clicknet//Nav//SV",
    "CALSCALE:GREGORIAN",
    // Enkelriktat: mottagarens kalender ska inte försöka svara på inbjudningar.
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(titel)}`,
    "X-PUBLISHED-TTL:PT6H",
  ];

  for (const p of poster) {
    rader.push(
      "BEGIN:VEVENT",
      // UID måste vara stabil mellan hämtningar, annars dyker posten upp som
      // ny varje gång kalendern synkar.
      `UID:${p.id}@nav.clicknet.se`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${utanBindestreck(p.starts_on)}`,
      `DTEND;VALUE=DATE:${utanBindestreck(dagenEfter(p.ends_on))}`,
      `SUMMARY:${esc(`${p.namn} — ${SAMMANFATTNING}`)}`,
      // Ledighet är ingen mötesinbjudan och ska inte visa någon som upptagen
      // för mötesbokning.
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }

  rader.push("END:VCALENDAR");

  return rader.map(vik).join("\r\n") + "\r\n";
}

// =============================================================================
// Leveranskalendern (0072): möten som iCal
//
// Två sorters fil, och samma VEVENT i båda:
//
//   - `motesflode()`: ens egna händelser som prenumeration, `METHOD:PUBLISH`,
//     bredvid ledighetsflödet. Hämtas om var sjätte timme av mottagarens
//     kalender.
//   - `inbjudan()`: en bilaga i ett mejl, `METHOD:REQUEST` eller `CANCEL`. Det
//     är den Outlook och Gmail visar som en inbjudan med knappar.
//
// UID ÄR HÄNDELSENS ID OCH ÄNDRAS ALDRIG. En ombokning är samma UID med högre
// SEQUENCE (`calendar_event.ics_sequence`), och då flyttar mottagarens kalender
// mötet i stället för att lägga till ett till. Samma regel som för ledigheten
// ovan: en UID som byts gör en ändring till en dubblett.
// =============================================================================

export type Mote = {
  id: string;
  sekvens: number;
  rubrik: string;
  /** Start som tidpunkt. Skrivs i UTC, så att ingen sommartid räknas här. */
  start: Date;
  minuter: number;
  plats?: string | null;
  url?: string | null;
  beskrivning?: string | null;
  andrad?: Date | null;
};

export type Part = { namn?: string | null; epost: string };

function utc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Ett namn i en parameter (`CN=`) citeras; citattecken får inte stå i det. */
function cn(namn: string | null | undefined): string {
  const n = (namn ?? "").replace(/["\r\n]/g, "").trim();
  return n ? `;CN="${n}"` : "";
}

function vevent(
  m: Mote,
  nu: Date,
  extra: { status?: "CONFIRMED" | "CANCELLED"; organisator?: Part | null; deltagare?: (Part & { svara: boolean })[] } = {},
): string[] {
  const slut = new Date(m.start.getTime() + Math.max(5, m.minuter) * 60_000);
  const rader = [
    "BEGIN:VEVENT",
    `UID:${m.id}@nav.clicknet.se`,
    `SEQUENCE:${Math.max(0, m.sekvens)}`,
    `DTSTAMP:${utc(nu)}`,
    `DTSTART:${utc(m.start)}`,
    `DTEND:${utc(slut)}`,
    `SUMMARY:${esc(m.rubrik)}`,
  ];
  if (m.andrad) rader.push(`LAST-MODIFIED:${utc(m.andrad)}`);
  if (m.plats?.trim()) rader.push(`LOCATION:${esc(m.plats.trim())}`);
  if (m.url?.trim()) rader.push(`URL:${m.url.trim()}`);
  if (m.beskrivning?.trim()) rader.push(`DESCRIPTION:${esc(m.beskrivning.trim())}`);
  if (extra.organisator) rader.push(`ORGANIZER${cn(extra.organisator.namn)}:mailto:${extra.organisator.epost}`);
  for (const d of extra.deltagare ?? []) {
    rader.push(
      `ATTENDEE${cn(d.namn)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=${d.svara ? "TRUE" : "FALSE"}:mailto:${d.epost}`,
    );
  }
  rader.push(`STATUS:${extra.status ?? "CONFIRMED"}`, "TRANSP:OPAQUE", "END:VEVENT");
  return rader;
}

function kalender(metod: "PUBLISH" | "REQUEST" | "CANCEL", huvud: string[], kropp: string[]): string {
  const rader = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Clicknet//Nav//SV",
    "CALSCALE:GREGORIAN",
    `METHOD:${metod}`,
    ...huvud,
    ...kropp,
    "END:VCALENDAR",
  ];
  return rader.map(vik).join("\r\n") + "\r\n";
}

/** Prenumerationen på ens egna händelser. Enkelriktad, som ledighetsflödet. */
export function motesflode(poster: Mote[], titel: string, nu: Date = new Date()): string {
  return kalender(
    "PUBLISH",
    [`X-WR-CALNAME:${esc(titel)}`, "X-PUBLISHED-TTL:PT1H"],
    poster.flatMap((m) => vevent(m, nu)),
  );
}

/**
 * En inbjudan som bilaga. `REQUEST` för en ny eller ändrad tid, `CANCEL` för
 * ett inställt möte — mottagarens kalender tar då bort det.
 *
 * `svara` styr knapparna hos mottagaren. Kunden svarar organisatören direkt i
 * sin kalender; en kollega svarar i navet, där svaret hör hemma, och får därför
 * inga knappar som skickar ett mejl ingen läser.
 */
export function inbjudan(
  m: Mote,
  metod: "REQUEST" | "CANCEL",
  organisator: Part,
  mottagare: Part & { svara: boolean },
  nu: Date = new Date(),
): string {
  return kalender(
    metod,
    [],
    vevent(m, nu, {
      status: metod === "CANCEL" ? "CANCELLED" : "CONFIRMED",
      organisator,
      deltagare: [mottagare],
    }),
  );
}
