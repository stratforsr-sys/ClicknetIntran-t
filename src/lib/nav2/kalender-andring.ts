/**
 * Kalendern: vad i ett möte som ändrats när formuläret sparas (granskningen E2).
 *
 * Förut gick varje "Spara" på ett befintligt möte genom flytt, längd och
 * lk_andra_mote, var och en med egna notiser, och lk_andra_mote skickade alltid
 * "ändrat" med ny .ics, också till kunder ("Ny tid … Vi har flyttat mötet"),
 * fast ingenting ändrats. Nu räknar rutten ut vad som ändrats, svarar "Inget
 * ändrades." utan anrop när mängden är tom, och gör annars ett enda anrop till
 * lk_spara_mote (0212), som räknar samma sak en gång till i databasen.
 *
 * Ren, utan databas: tests/kalender-andring.mjs.
 */

export type KalMote = {
  dag: string;
  tid: string | null;
  minuter: number | null;
  title: string;
  plats: string | null;
  online_url: string | null;
  agenda: string;
  deltagare: string[];
  valfria: string[];
  reminder_min: number | null;
  reminder_off: boolean;
  show_as: string;
  is_private: boolean;
};

export type MotesDel = "tid" | "plats" | "innehall" | "deltagare" | "valfria" | "paminnelse" | "visa" | "privat";

const text = (v: string | null | undefined) => (v ?? "").trim();
const klocka = (v: string | null | undefined) => (v ? v.slice(0, 5) : null);
const mangd = (a: readonly string[]) => [...new Set(a)].sort().join(",");

/**
 * `tid` = dag, klockslag eller längd. `plats` = plats eller möteslänk.
 * `innehall` = rubrik eller agenda. Resten heter som det de gäller.
 */
export function andradeDelar(fore: KalMote, efter: KalMote): Set<MotesDel> {
  const ut = new Set<MotesDel>();
  if (fore.dag !== efter.dag || klocka(fore.tid) !== klocka(efter.tid) || (fore.minuter ?? null) !== (efter.minuter ?? null)) ut.add("tid");
  if (text(fore.plats) !== text(efter.plats) || text(fore.online_url) !== text(efter.online_url)) ut.add("plats");
  if (text(fore.title) !== text(efter.title) || (fore.agenda ?? "") !== (efter.agenda ?? "")) ut.add("innehall");
  if (mangd(fore.deltagare) !== mangd(efter.deltagare)) ut.add("deltagare");
  if (mangd(fore.valfria) !== mangd(efter.valfria)) ut.add("valfria");
  if (Boolean(fore.reminder_off) !== Boolean(efter.reminder_off) || (!efter.reminder_off && (fore.reminder_min ?? null) !== (efter.reminder_min ?? null))) ut.add("paminnelse");
  if ((fore.show_as || "upptagen") !== (efter.show_as || "upptagen")) ut.add("visa");
  if (Boolean(fore.is_private) !== Boolean(efter.is_private)) ut.add("privat");
  return ut;
}

/**
 * Vad de som var med och är kvar får, och om externa gäster får en ny .ics.
 * Samma regel som lk_spara_mote (0212); här för kvittot och provet.
 *   - tid eller plats: `kalender-flyttad` (lk_spara_mote tar `-tyst` när varken gamla eller nya tiden ligger inom sju dagar, som lk_ny_tid), ny .ics
 *   - bara rubrik eller agenda: `kalender-flyttad-tyst`, ingen .ics
 *   - bara påminnelse, Visa som, Privat, valfria eller deltagare: inget
 * Nya deltagare får alltid en inbjudan och borttagna "inställt".
 */
export function motesBesked(delar: ReadonlySet<MotesDel>): { kvarvarande: "kalender-flyttad" | "kalender-flyttad-tyst" | null; ics: boolean } {
  if (delar.has("tid") || delar.has("plats")) return { kvarvarande: "kalender-flyttad", ics: true };
  if (delar.has("innehall")) return { kvarvarande: "kalender-flyttad-tyst", ics: false };
  return { kvarvarande: null, ics: false };
}

/**
 * Minuter före mötet då personen påminns, eller null = ingen påminnelse (granskningen E4; 0212).
 * Deltagarens rad går före mötets: `reminder_off` true = Ingen, false eller en gammal rad med
 * minuter = deltagarens egna minuter, null utan minuter = mötets. Mötets `reminder_off` = Ingen.
 * Används av `motespaminnelser` i kalender-push.ts.
 */
export function skaPaminna(
  mote: { reminder_min: number | null; reminder_off: boolean },
  deltagare: { reminder_min: number | null; reminder_off: boolean | null },
): number | null {
  if (deltagare.reminder_off === true) return null;
  if (deltagare.reminder_min !== null && deltagare.reminder_min !== undefined) return deltagare.reminder_min;
  if (mote.reminder_off) return null;
  return mote.reminder_min ?? null;
}

/**
 * Ombudet ("Kan planera om" eller "Delegat", 0201) ser inte allt arrangören ser: utan att vara med får hen ingen
 * möteslänk, och ett privat möte visas som "Privat" utan deltagare, plats och agenda. Formuläret skickar tillbaka det
 * det visade, och utan den här regeln hade en sparning raderat länken (med mejl och .ics till alla) eller döpt om
 * mötet och tagit bort deltagarna (granskningens efterkontroll, V2).
 */
export function ombudetsFalt(a: { arrangor: boolean; privat: boolean; deltar: boolean; video: string | null | undefined }): { fel: string } | { video: string | null | undefined } {
  if (a.arrangor || a.deltar) return { video: a.video };
  if (a.privat) return { fel: "Ett privat möte ändras av arrangören." };
  return { video: a.video === null ? undefined : a.video };
}
