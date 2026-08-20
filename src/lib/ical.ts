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
