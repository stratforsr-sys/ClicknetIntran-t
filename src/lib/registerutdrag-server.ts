import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { KALLOR } from "@/lib/registerutdrag";

/**
 * AC-12.4, K25: registerutdrag. All data om en person, som JSON.
 *
 * K14 lovar personalen det i klartext, och det ar dessutom artikel 15 i
 * dataskyddsforordningen. Utdraget ar avsiktligt trakigt: raka tabellrader,
 * inga sammanfattningar. Den som vill veta vad navet har om sig ska se det
 * som faktiskt star dar, inte navets tolkning av det.
 */

export type Utdrag = {
  om: { id: string; namn: string; epost: string };
  skapat: string;
  anmarkning: string[];
  data: Record<string, { andamal: string; rader: unknown[] }>;
};

/**
 * Hamtar hela utdraget.
 *
 * Kors med service role och inte med den fragandes egen token. RLS ar byggd
 * for vardagsvyerna: en saljare ser sin egen rad i `payroll_row` men ingen
 * rad alls i `document_view`, och ett utdrag som speglade vyerna hade darfor
 * undanhallit precis det som ar mest angelaget att fa se — vad navet
 * registrerar utan att visa. Behorigheten kontrolleras i stallet av
 * anroparen, en gang, och varje utdrag skrivs i handelseloggen.
 */
export async function hamtaRegisterutdrag(
  db: SupabaseClient,
  employeeId: string,
): Promise<Utdrag | null> {
  const { data: person } = await db
    .from("employee")
    .select("id, first_name, last_name, email")
    .eq("id", employeeId)
    .maybeSingle();

  if (!person) return null;

  const data: Utdrag["data"] = {};

  for (const kalla of KALLOR) {
    const { data: rader, error } = await db
      .from(kalla.tabell)
      .select("*")
      .eq(kalla.kolumn, employeeId);

    // Ett fel far inte tyst bli en tom lista. Ett utdrag som saknar en tabell
    // ser likadant ut som ett dar det inte fanns nagot, och den skillnaden ar
    // hela poangen med handlingen.
    data[kalla.tabell] = error
      ? { andamal: kalla.andamal, rader: [{ fel: error.message }] }
      : { andamal: kalla.andamal, rader: rader ?? [] };
  }

  // Dialogen i egna arenden. Gar inte att hamta pa employee_id — traden hanger
  // pa arendet — och att utelamna den hade gjort arendena till rubriker utan
  // innehall.
  const arendeIds = (data.hr_case?.rader ?? []).map((r) => (r as { id: string }).id);
  const { data: meddelanden } =
    arendeIds.length > 0
      ? await db.from("case_message").select("*").in("case_id", arendeIds)
      : { data: [] };
  data.case_message = { andamal: "Dialog i dina ärenden", rader: meddelanden ?? [] };

  // K36: vem som oppnat filerna om dig. Hamtas via filen och inte pa
  // `actor_id` — den kolumnen pekar pa den som last, och pa den vagen hade
  // utdraget blivit en lista over andras lakarintyg man rakat oppna.
  //
  // Att den HAR ar sjalva poangen med loggen. Ett utdrag som redovisar att ett
  // lakarintyg finns men inte vem som last det svarar pa halva fragan.
  const filIds = (data.file_object?.rader ?? []).map((r) => (r as { id: string }).id);
  const { data: oppningar } =
    filIds.length > 0
      ? await db.from("file_access_log").select("*").in("file_id", filIds).order("ts")
      : { data: [] };
  data.file_access_log = {
    andamal: "Vem som öppnat filerna om dig, och när",
    rader: oppningar ?? [],
  };

  // Handelseloggen fran bada hallen: det du gjorde, och det som gjordes med
  // ditt konto. AC-12.1 raknar bada som uppgifter om personen.
  const [{ data: somAktor }, { data: somObjekt }] = await Promise.all([
    db.from("audit_log").select("*").eq("actor_id", employeeId),
    db.from("audit_log").select("*").eq("object_id", employeeId),
  ]);

  // Samma rad kan vara bade aktor och objekt — en rollandring man gjort pa
  // sig sjalv, till exempel. Duplikaten bort pa id.
  const logg = new Map<number, unknown>();
  for (const rad of [...(somAktor ?? []), ...(somObjekt ?? [])]) {
    logg.set((rad as { id: number }).id, rad);
  }
  data.audit_log = {
    andamal: "Händelselogg — vad du gjort och vad som gjorts med ditt konto",
    rader: [...logg.values()],
  };

  return {
    om: {
      id: person.id,
      namn: `${person.first_name} ${person.last_name}`,
      epost: person.email,
    },
    skapat: new Date().toISOString(),
    anmarkning: [
      "Utdraget innehåller de uppgifter navet har om dig, tabell för tabell.",
      "Lösenordet finns inte med. Navet lagrar det inte — det ligger hashat hos Supabase och går inte att läsa ut, varken av dig eller av oss.",
      "Uppladdade filer redovisas som rader under file_object: när filen kom in, hur stor den är och dess kontrollsumma. Själva innehållet hämtas i navet, och varje sådan öppning står under file_access_log — även våra egna.",
      "Kolumner som slutar på _by eller _id pekar på andra personer i registret. De står som identifierare och inte som namn, eftersom uppgiften då hade varit om någon annan än dig.",
      "Dialogen i dina ärenden är med i sin helhet, alltså även det ledningen skrivit till dig.",
    ],
    data,
  };
}
