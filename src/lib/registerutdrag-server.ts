import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { BARN, KALLOR } from "@/lib/registerutdrag";
import { ordningFor } from "@/lib/registerutdrag-ordning";
import { delaUpp, iTur, lasSidvis } from "@/lib/sidvis";

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

type Rad = Record<string, unknown>;

/**
 * F1-2. Laser ALLA rader dar `kolumn` ar `varde`, eller ett av `varden`.
 *
 * Supabase-API:t kapar tyst vid 1000 rader, och fyra anstallda hade redan fler
 * samtal och filer an sa. Varje fraga las darfor sidvis i primarnyckelns
 * ordning (`registerutdrag-ordning.ts`), och en lista med id fragas i omgangar
 * om 100: en IN-lista med tusen uuid ar en URL pa 37 kB, och nekas den blir
 * svaret tomt.
 *
 * Gar nagot fel returneras `null`, aldrig en tom lista. Anroparen gor det till
 * en rad i utdraget.
 */
async function lasAllt(
  db: SupabaseClient,
  tabell: string,
  kolumn: string,
  varden: string | string[],
): Promise<{ rader: Rad[] } | { fel: string }> {
  const omgangar = Array.isArray(varden) ? delaUpp(varden, 100) : [varden];
  const rader: Rad[] = [];
  try {
    for (const omgang of omgangar) {
      rader.push(
        ...(await lasSidvis<Rad>((fran, till) => {
          let fraga = db.from(tabell).select("*");
          fraga = Array.isArray(omgang) ? fraga.in(kolumn, omgang) : fraga.eq(kolumn, omgang);
          for (const k of ordningFor(tabell)) fraga = fraga.order(k);
          return fraga.range(fran, till);
        })),
      );
    }
  } catch (e) {
    return { fel: e instanceof Error ? e.message : String(e) };
  }
  return { rader };
}

/**
 * Omgangarna kommer var for sig i ordning; hela listan sorteras efter tid
 * efterat, som fragan gjorde nar den var en enda.
 */
function kronologiskt(utfall: { rader: Rad[] } | { fel: string }, falt: string) {
  if ("rader" in utfall) {
    utfall.rader.sort((a, b) => Date.parse(String(a[falt])) - Date.parse(String(b[falt])));
  }
  return utfall;
}

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

  // Ett fel far inte tyst bli en tom lista. Ett utdrag som saknar en tabell
  // ser likadant ut som ett dar det inte fanns nagot, och den skillnaden ar
  // hela poangen med handlingen. Kallor som inte gick att lasa sparas har, sa
  // att det som hamtas via dem (arendets dialog, filens oppningar) inte heller
  // blir en tom lista.
  const olasta = new Set<string>();
  const svar = (tabell: string, andamal: string, utfall: { rader: Rad[] } | { fel: string }) => {
    if ("fel" in utfall) olasta.add(tabell);
    data[tabell] = { andamal, rader: "fel" in utfall ? [{ fel: `Kunde inte läsas: ${utfall.fel}` }] : utfall.rader };
  };
  const via = (tabell: string, falt: string): string[] | null =>
    olasta.has(tabell)
      ? null
      : [...new Set((data[tabell]?.rader ?? []).map((r) => (r as Rad)[falt] as string))].filter(Boolean);
  const olast = (kalla: string) => ({ fel: `${kalla} gick inte att läsa, så inte heller det som hör till den` });

  // Sex at gangen. En i taget tog over sex sekunder for den med flest samtal,
  // och 2026-10-22 hade Nav 2.0-grenen nastan dubbelt sa manga kallor.
  const utfall = await iTur(KALLOR, 6, (kalla) => lasAllt(db, kalla.tabell, kalla.kolumn, employeeId));
  KALLOR.forEach((kalla, i) => svar(kalla.tabell, kalla.andamal, utfall[i]));

  /**
   * S09 (F1-1). Tabeller som bara nas via en forlader: svaren pa ovningarna,
   * provsvaren och, for den som anstallts via rekryteringen, hela processen.
   * Ar barnet sjalvt en kalla (coaching_task_note: det du skrivit i andras
   * uppgifter) slas raderna ihop pa id, sa att chefens anteckningar i dina
   * egna uppgifter ocksa kommer med.
   */
  const barnUtfall = await iTur(BARN, 6, async (b) => {
    const ids = via(b.foralder, b.falt);
    return ids ? lasAllt(db, b.tabell, b.kolumn, ids) : olast(b.foralder);
  });
  BARN.forEach((b, i) => {
    const nytt = barnUtfall[i];
    const redan = data[b.tabell];
    // Ett fel i en av lasningarna gor kallan olast; en redan olast kalla star kvar som den ar.
    if ("fel" in nytt || !redan) return svar(b.tabell, b.andamal, nytt);
    if (olasta.has(b.tabell)) return;
    const ihop = new Map<unknown, Rad>();
    for (const r of [...(redan.rader as Rad[]), ...nytt.rader]) ihop.set(r.id ?? JSON.stringify(r), r);
    svar(b.tabell, b.andamal, { rader: [...ihop.values()] });
  });

  // Dialogen i egna arenden. Gar inte att hamta pa employee_id — traden hanger
  // pa arendet — och att utelamna den hade gjort arendena till rubriker utan
  // innehall.
  const arendeIds = via("hr_case", "id");
  svar(
    "case_message",
    "Dialog i dina ärenden",
    arendeIds ? await lasAllt(db, "case_message", "case_id", arendeIds) : olast("hr_case"),
  );

  /**
   * 0054. Historiken i uppgifter som handlar om dig.
   *
   * Samma grepp som arendedialogen ovan, och behovs av samma skal: `task_event`
   * har ingen kolumn som pekar ut vem raden HANDLAR om — bara vem som skrev
   * den. Utan den har hamtningen hade utdraget redovisat att det finns en dold
   * uppgift om personen, men inte de kommentarer, returneringar och
   * motiveringar som skrivits i den. Det ar halva svaret, och halva svaret ar
   * det utdraget minst av allt ska ge.
   *
   * Bada hallen raknas: uppgifter du ar ansvarig for OCH uppgifter som pekar pa
   * dig via `task_link`.
   */
  const ansvarig = via("task", "id");
  const lankad = via("task_link", "task_id");
  const uppgiftIds = ansvarig && lankad ? [...new Set([...ansvarig, ...lankad])] : null;

  svar(
    "task_event",
    "Historik och kommentarer i uppgifter som rör dig",
    uppgiftIds
      ? kronologiskt(await lasAllt(db, "task_event", "task_id", uppgiftIds), "at")
      : olast(ansvarig ? "task_link" : "task"),
  );

  // K36: vem som oppnat filerna om dig. Hamtas via filen och inte pa
  // `actor_id` — den kolumnen pekar pa den som last, och pa den vagen hade
  // utdraget blivit en lista over andras lakarintyg man rakat oppna.
  //
  // Att den HAR ar sjalva poangen med loggen. Ett utdrag som redovisar att ett
  // lakarintyg finns men inte vem som last det svarar pa halva fragan.
  const filIds = via("file_object", "id");
  svar(
    "file_access_log",
    "Vem som öppnat filerna om dig, och när",
    filIds ? kronologiskt(await lasAllt(db, "file_access_log", "file_id", filIds), "ts") : olast("file_object"),
  );

  // Handelseloggen fran bada hallen: det du gjorde, och det som gjordes med
  // ditt konto. AC-12.1 raknar bada som uppgifter om personen.
  const [somAktor, somObjekt] = await Promise.all([
    lasAllt(db, "audit_log", "actor_id", employeeId),
    lasAllt(db, "audit_log", "object_id", employeeId),
  ]);

  // Samma rad kan vara bade aktor och objekt — en rollandring man gjort pa
  // sig sjalv, till exempel. Duplikaten bort pa id.
  const logg = new Map<number, Rad>();
  for (const rad of [...("rader" in somAktor ? somAktor.rader : []), ...("rader" in somObjekt ? somObjekt.rader : [])]) {
    logg.set(rad.id as number, rad);
  }
  svar(
    "audit_log",
    "Händelselogg — vad du gjort och vad som gjorts med ditt konto",
    "fel" in somAktor ? somAktor : "fel" in somObjekt ? somObjekt : { rader: [...logg.values()] },
  );

  /**
   * 0057. Kalenderdelningen, fran bada hallen.
   *
   * "Anna har gett Bertil delegatbehorighet i sin kalender" ar en uppgift om
   * BADA tva, och de tva svaren ar olika: Annas utdrag ska saga vem hon oppnat
   * sin dag for, Bertils vem som oppnat sin for honom. En enda kolumn i KALLOR
   * hade bara kunnat ge det ena — slingan ovan nycklar pa tabellnamnet, sa den
   * andra raden hade skrivit over den forsta.
   *
   * Delningen ar dessutom den enda vagen in i nagon annans uppgiftslista som
   * finns i navet (se 0057). Att den gar att lasa ut ar darfor inte en
   * formalitet: det ar svaret pa "vem kan se vad jag skriver".
   */
  const [delatAvMig, delatTillMig] = await Promise.all([
    lasAllt(db, "calendar_share", "owner_id", employeeId),
    lasAllt(db, "calendar_share", "viewer_id", employeeId),
  ]);

  svar(
    "calendar_share",
    "Kalenderdelning — vem du öppnat din kalender för, och vems du fått se",
    "fel" in delatAvMig
      ? delatAvMig
      : "fel" in delatTillMig
        ? delatTillMig
        : { rader: [...delatAvMig.rader, ...delatTillMig.rader] },
  );

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
