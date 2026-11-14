/**
 * Gästens kalenderfil (0072): ska utkorgens `ics`-rad skickas?
 *
 * Ren logik, så att den går att prova utan databas. Raden köas av `lk_ics_ko`
 * med händelsens sekvens just då; när den töms gäller den bara om händelsen
 * fortfarande ser ut så. En senare ändring har köat en egen rad.
 */
export type IcsLage = {
  tid: string | null;
  dag: string | null;
  ics_sequence: number;
  cancelled_at: string | null;
};

/**
 * `borttagen`: adressen är inte med på mötet längre (Möten, Ändra, 2026-11-03). Då gäller en avbokning också
 * för ett möte som står kvar: den tar bort mötet ur just den gästens kalender.
 */
export function icsGaller(e: IcsLage | null, epost: string, sekvens: number, metod: "REQUEST" | "CANCEL", borttagen = false): boolean {
  // Ett heldagsmöte (0204) har ingen tid men en dag, och får sin fil som en
  // heldagspost (`somMote` → `heldag`). Förut krävdes `tid`, och gästen till ett
  // heldagsmöte fick ingenting fast kvittot sa att inbjudan gick ut.
  if (!e || !(e.tid || e.dag) || !epost) return false;
  if (e.ics_sequence !== sekvens) return false;
  if (metod === "CANCEL") return Boolean(e.cancelled_at) || borttagen;
  return !e.cancelled_at;
}

/**
 * Mötens egen rubrik i kalendern (2026-11-13): "<prefix> - <bolaget>: Möte", "<bolaget>: Möte" eller den gamla
 * "SEO-möte: <bolaget>" (`moteRubrik`/`arEgenRubrik` i motenforma.ts). Den är navets, med kundens eget namn i, och
 * står aldrig i kundens brev: där heter mötet "Möte med <bolaget>". Prövas på rubriken ensam, eftersom en avbokning
 * efter Radera byggs när mötesraden redan är borta.
 */
export function arMotesRubrik(titel: string | null | undefined): boolean {
  return !!titel && (/: Möte$/.test(titel) || /^SEO-möte: /.test(titel));
}

/** Ett brev i loggen (`integration_log.body`, `handling: "ics"`, bara de som gått fram). */
export type Brevlogg = { epost?: unknown; metod?: unknown; nar?: unknown; namn?: unknown; plats?: unknown; lank?: unknown };

/** Det senaste brevet till adressen. `brev` är nyast först. */
export function forraBrevet(brev: Brevlogg[], epost: string): Brevlogg | null {
  return brev.find((x) => String(x.epost ?? "").toLowerCase() === epost) ?? null;
}

/**
 * Vad en inbjudan till en gäst gäller, ur det gästen senast fått. Ingenting tidigare, eller en avbokning: en första
 * inbjudan. Samma tid som förra brevet: platsen eller länken har ändrats. Annars en ny tid. Brev från före
 * 2026-11-03 saknar adressen i loggen; finns sådana för mötet blir det "ny tid", som förut.
 */
export function brevslag(brev: Brevlogg[], epost: string, sekvens: number, nar: string): "ny" | "tid" | "andrad" {
  if (sekvens <= 0) return "ny";
  const forra = forraBrevet(brev, epost);
  if (!forra) return brev.some((x) => x.epost === undefined) ? "tid" : "ny";
  if (forra.metod === "CANCEL") return "ny";
  return forra.nar === nar ? "andrad" : "tid";
}

/**
 * Namnet gästen hälsades med i förra brevet (loggas sedan 2026-11-13). En avbokning byggs när den skickas, och då
 * kan namnet vara borta ur mötet: efter Radera finns mötesraden inte, och en kontakt vars adress tagits bort står
 * inte längre på bolaget. Utan ett tidigare namn: null, och brevet hälsar "Hej,".
 */
export function forraNamnet(brev: Brevlogg[], epost: string): string | null {
  const n = forraBrevet(brev, epost)?.namn;
  return typeof n === "string" && n.trim() ? n.trim() : null;
}

/**
 * Platsen och länken i förra brevet till adressen (loggas sedan 2026-11-14), eller null när brevet är äldre än så
 * eller inget finns. Ett brev om en ändring säger då vad som är nytt: "Här kommer länken till mötet" när bara
 * Teams-länken kommit till, i stället för att platsen ändrats.
 */
export function forraPlatsen(brev: Brevlogg[], epost: string): { plats: string | null; url: string | null } | null {
  const f = forraBrevet(brev, epost);
  if (!f || !("plats" in f)) return null;
  return { plats: typeof f.plats === "string" ? f.plats : null, url: typeof f.lank === "string" ? f.lank : null };
}
