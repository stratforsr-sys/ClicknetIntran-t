/**
 * Uppgiftsmallarna. Ren logik, inga importer utom systerfilen `uppgifter.ts`.
 *
 * =============================================================================
 * EN MALL ÄR EN NAMNGIVEN CHECKLISTA MED DAGSFÖRSKJUTNING
 *
 * Beställarens val 2026-09-22, av tre alternativ. De två som valdes bort är
 * värda en rad var, för de kommer att föreslås igen:
 *
 *   EN STANDARDVECKA att lägga ut i kalendern hade legat på tvären med
 *   upprepningen i 0062. En serie ÄR redan "varje måndag 09:00, tills vidare",
 *   och en mall som lägger ut samma sak en vecka i taget hade varit ett andra
 *   sätt att göra en sak navet redan gör — med en annan datumräkning, som en
 *   dag ger ett annat svar.
 *
 *   EN FÄRDIG TEXT att återanvända löser inte det checklistor löser. Poängen
 *   med "Uppstart ny kund" är inte att slippa skriva rubriken; den är att ingen
 *   glömmer steg fyra.
 *
 * =============================================================================
 * MALLEN FÖDER RIKTIGA UPPGIFTER OCH SLÄPPER SEDAN TAGET
 *
 * Samma val som 0062 gjorde för serien, och av samma skäl: ingenting annat i
 * navet behöver lära sig något nytt. Skillnaden mot serien är att mallen föder
 * EN GÅNG. Den som sedan ändrar en av uppgifterna ändrar inte mallen, och den
 * som ändrar mallen rör inte det som redan skapats — därför finns varken
 * `series_on` eller `series_losgjord` här, bara `task.template_id` som säger
 * varifrån raden kom.
 * =============================================================================
 */

import { PRIORITETER, datumPlusDagar, type Prioritet } from "./uppgifter.ts";

/** Högst så många moment i en mall. Samma tak som coachningens mallar har. */
export const MAX_MOMENT = 50;

export type Mallmoment = {
  sort: number;
  title: string;
  offset_days: number;
  due_time: string | null;
  estimate_minutes: number | null;
  priority: Prioritet;
};

/**
 * Fältordningen i textrutan. Står här och inte bara i hjälptexten, så att
 * provet kan kontrollera att de fem beskrivs i den ordning de tolkas.
 */
export const FALTORDNING = ["rubrik", "dagar", "minuter", "klockslag", "prioritet"] as const;

/**
 * Tolkar textrutan till moment.
 *
 * =============================================================================
 * MALLEN SKRIVS SOM TEXT, INTE I ETT FORMULÄR MED "LÄGG TILL MOMENT"
 *
 * Samma val som coachningsmallarna, quizfrågorna och rollspelsrubrikerna gjorde.
 * En checklista skrivs i ett svep, ofta genom att klistra in från ett underlag
 * eller ur ett mejl. Sex omgångar av "lägg till rad, välj prioritet, sätt
 * dagar" gör samma arbete tio gånger långsammare, och den som ska skriva ner
 * hur man startar upp en kund gör det en gång och aldrig igen om det tar tjugo
 * minuter.
 *
 * =============================================================================
 * BARA RUBRIKEN KRÄVS, OCH ETT TOMT FÄLT ÄR INTE ETT FEL
 *
 * "Ring kunden" är en giltig rad. Den blir dag 0, ingen uppskattning, inget
 * klockslag, prioritet 3. Ett format som kräver fem fält per rad är ett format
 * man ger upp på vid rad tre — och en mall med tre moment som blev skriven är
 * mer värd än en med sex som inte blev det.
 *
 * ETT FELAKTIGT FÄLT AVVISAR HELA MALLEN och inte bara sin rad. Det är samma
 * linje som `tolkaMall()` i coachning.ts drar: en mall som sparas till hälften
 * ser riktig ut i listan, och den som använder den ett halvår senare får en
 * halv checklista utan att veta om det.
 * =============================================================================
 */
export function tolkaMoment(text: string): { moment: Mallmoment[]; fel: string | null } {
  const rader = text
    .split("\n")
    .map((r) => r.trim())
    .filter(Boolean);

  if (rader.length === 0) return { moment: [], fel: null };
  if (rader.length > MAX_MOMENT) {
    return { moment: [], fel: `Högst ${MAX_MOMENT} moment i en mall.` };
  }

  const ut: Mallmoment[] = [];

  for (const [i, rad] of rader.entries()) {
    const d = rad.split("|").map((x) => x.trim());
    const nr = i + 1;

    const title = d[0];
    if (!title) return { moment: [], fel: `Rad ${nr} saknar rubrik.` };
    if (title.length > 200) return { moment: [], fel: `Rad ${nr}: rubriken får vara högst 200 tecken.` };

    let offset = 0;
    if (d[1]) {
      const tal = Number(d[1]);
      if (!Number.isInteger(tal) || tal < 0 || tal > 365) {
        return { moment: [], fel: `Rad ${nr}: dagarna ska vara ett heltal mellan 0 och 365.` };
      }
      offset = tal;
    }

    let minuter: number | null = null;
    if (d[2]) {
      const tal = Number(d[2]);
      if (!Number.isInteger(tal) || tal <= 0 || tal > 1440) {
        return { moment: [], fel: `Rad ${nr}: minuterna ska vara ett heltal mellan 1 och 1440.` };
      }
      minuter = tal;
    }

    /**
     * Klockslaget normaliseras till `HH:MM`, aldrig till `H:MM`.
     *
     * Kolumnen är `time` i databasen och tar emot båda, men raden jämförs mot
     * `due_time` i kalendern med strängjämförelse på flera ställen — och
     * "9:00" sorterar efter "10:00". Felet syns som en post på fel plats i
     * dagen, vilket ingen läser som ett formatfel.
     */
    let tid: string | null = null;
    if (d[3]) {
      const m = /^(\d{1,2}):(\d{2})$/.exec(d[3]);
      const timme = m ? Number(m[1]) : -1;
      const minut = m ? Number(m[2]) : -1;
      if (!m || timme < 0 || timme > 23 || minut < 0 || minut > 59) {
        return { moment: [], fel: `Rad ${nr}: "${d[3]}" är inget klockslag. Skriv det som 09:00.` };
      }
      tid = `${String(timme).padStart(2, "0")}:${String(minut).padStart(2, "0")}`;
    }

    let prioritet: Prioritet = 3;
    if (d[4]) {
      const tal = Number(d[4]);
      if (!PRIORITETER.includes(tal as Prioritet)) {
        return { moment: [], fel: `Rad ${nr}: prioriteten ska vara 1, 2, 3 eller 4.` };
      }
      prioritet = tal as Prioritet;
    }

    ut.push({ sort: nr, title, offset_days: offset, due_time: tid, estimate_minutes: minuter, priority: prioritet });
  }

  return { moment: ut, fel: null };
}

/**
 * Momenten tillbaka till text, så att en sparad mall går att ändra i samma ruta
 * den skrevs i.
 *
 * SKRIVER BARA UT DE FÄLT SOM HAR ETT VÄRDE, med undantag för dem som måste stå
 * kvar för att hålla platsen. En mall som sparats som "Ring kunden" ska inte
 * komma tillbaka som "Ring kunden | 0 | | | 3" — då lär sig ingen formatet av
 * att läsa sin egen mall, och en rundtur genom formuläret hade dessutom gjort
 * varje rad längre än den var.
 */
export function momentTillText(moment: readonly Mallmoment[]): string {
  return moment
    .map((m) => {
      const falt = [
        m.title,
        String(m.offset_days),
        m.estimate_minutes === null ? "" : String(m.estimate_minutes),
        m.due_time ?? "",
        m.priority === 3 ? "" : String(m.priority),
      ];

      // Tomma fält på slutet klipps bort; tomma fält i mitten måste stå kvar,
      // annars flyttar sig allt efter dem ett steg åt vänster vid nästa tolkning.
      while (falt.length > 1 && falt[falt.length - 1] === "") falt.pop();
      if (falt.length === 2 && falt[1] === "0") falt.pop();

      return falt.join(" | ");
    })
    .join("\n");
}

/** Dagen momentet infaller, räknat från startdagen. */
export function momentdatum(start: string, moment: { offset_days: number }): string {
  return datumPlusDagar(start, moment.offset_days);
}

/**
 * "6 moment · dag 0–30 · 2 h 30 min" — raden under mallens namn i listan.
 *
 * SPÄNNVIDDEN OCH INTE BARA ANTALET. Skillnaden mellan en checklista som betas
 * av på en förmiddag och en som sträcker sig över en månad är det man behöver
 * veta innan man väljer mall, och den syns inte i "6 moment".
 */
export function mallsammanfattning(moment: readonly Mallmoment[]): string {
  if (moment.length === 0) return "Inga moment";

  // "Moment" böjs inte i plural på svenska — ett moment, sex moment.
  const delar = [`${moment.length} moment`];

  const forsta = Math.min(...moment.map((m) => m.offset_days));
  const sista = Math.max(...moment.map((m) => m.offset_days));
  delar.push(forsta === sista ? `dag ${forsta}` : `dag ${forsta}–${sista}`);

  const minuter = moment.reduce((s, m) => s + (m.estimate_minutes ?? 0), 0);
  if (minuter > 0) {
    const h = Math.floor(minuter / 60);
    const m = minuter % 60;
    delar.push(h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`);
  }

  return delar.join(" · ");
}

/**
 * Vad som händer när mallen används — kvittot INNAN knappen trycks.
 *
 * Formuläret visar "6 uppgifter skapas, 23 sep – 23 okt" under väljaren. Det
 * är den enda platsen där en mall med ett moment på dag 365 avslöjar sig innan
 * den lagt ett årsgammalt datum i någons lista.
 */
export function forhandsbild(
  moment: readonly Mallmoment[],
  start: string,
): { antal: number; forsta: string; sista: string } | null {
  if (moment.length === 0) return null;
  const datum = moment.map((m) => momentdatum(start, m)).sort();
  return { antal: moment.length, forsta: datum[0], sista: datum[datum.length - 1] };
}
