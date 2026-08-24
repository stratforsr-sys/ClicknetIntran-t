import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";
import { EMPLOYMENT_TYPE_LABEL } from "@/lib/roles";
import {
  AvtalsfelError,
  VARIABELNYCKLAR,
  rendera,
  serUtSomPersonnummer,
} from "@/lib/avtal";

/**
 * E9.1. Vardena som hamtas ur personalregistret i stallet for att skrivas in.
 *
 * Bara uppgifter som redan STAR i `employee`. Ingenting harifran gar till
 * `salary_basis` eller nagon annanstans i E15 — se rubriken i 0028 om varfor
 * lonen ar det enda talet som skrivs for hand.
 *
 * Ett tomt varde lamnas tomt och fylls inte i med en gissning. Renderingen
 * faller pa det, vilket ar meningen: ett avtal med fel startdatum ar varre an
 * ett avtal som inte gick att skapa.
 */
export async function automatiskaVarden(employeeId: string): Promise<Record<string, string>> {
  const db = supabaseAdmin();

  const { data: e } = await db
    .from("employee")
    .select("first_name, last_name, employee_number, start_date, employment_type, company_id")
    .eq("id", employeeId)
    .maybeSingle();

  if (!e) return {};

  let bolag = "";
  if (e.company_id) {
    const { data: c } = await db.from("company").select("name").eq("id", e.company_id).maybeSingle();
    bolag = c?.name ?? "";
  }

  return {
    fornamn: e.first_name ?? "",
    efternamn: e.last_name ?? "",
    anstallningsnummer: e.employee_number ?? "",
    bolag,
    startdatum: e.start_date ?? "",
    anstallningsform: EMPLOYMENT_TYPE_LABEL[e.employment_type] ?? e.employment_type ?? "",
  };
}

export type Utkastresultat = { fel: string } | { avtalId: string };

/**
 * E9.1. Skapar ett avtalsutkast ur en mall.
 *
 * ===========================================================================
 * VARFOR DEN LIGGER HAR
 *
 * Tva vagar skapar avtal. `/avtal/nytt`, dar nagon valjer person och mall, och
 * rekryteringens anstallningsflode (E10.9), dar avtalet ar ett av flera saker
 * som faller ut nar en kandidat anstalls.
 *
 * Det som INTE far ligga pa tva stallen ar renderingen och de tva sparrarna
 * omkring den: personnummerkontrollen och att ett halvfyllt avtal inte sparas.
 * Se rubriken i src/lib/avtal.ts.
 * ===========================================================================
 *
 * BEHORIGHETEN KONTROLLERAS INTE HAR utan av anroparen, och de tva kretsarna
 * ar olika: `far_hantera_avtal()` slapper in saljchef, VD och admin, medan
 * rekryteringen ocksa slapper in den som har `recruiter`. En rekryterare utan
 * ledningsroll far darfor INTE skapa avtalet — anstallningsflodet fragar inte
 * ens, och checklistan far punkten i stallet.
 *
 * Renderar direkt och sparar RESULTATET. Faller renderingen skapas inget avtal
 * alls: ett avtal med en ofylld platshallare ar farligare an inget avtal.
 */
export async function skapaAvtalsutkast(
  employeeId: string,
  mallId: string,
  handskrivna: Record<string, string>,
  utfordAv: string,
): Promise<Utkastresultat> {
  const db = supabaseAdmin();

  const { data: mall } = await db
    .from("contract_template")
    .select("id, slug, title, body_md, status")
    .eq("id", mallId)
    .maybeSingle();

  if (!mall) return { fel: "Mallen finns inte." };
  if (mall.status !== "published") {
    return { fel: "Mallen är inte publicerad. Publicera den först, eller välj en annan." };
  }

  // Personens egna uppgifter hamtas har och tas INTE emot fran formularet. Ett
  // dolt falt med namnet i hade gatt att andra i webblasaren, och avtalet ska
  // handla om den person raden pekar pa.
  const auto = await automatiskaVarden(employeeId);

  const varden: Record<string, string> = { ...auto };
  for (const nyckel of VARIABELNYCKLAR) {
    if (nyckel in auto) continue;
    varden[nyckel] = (handskrivna[nyckel] ?? "").trim();
  }

  if (serUtSomPersonnummer(Object.values(varden).join(" "))) {
    return {
      fel: "Något av fälten ser ut att innehålla ett personnummer. Navet lagrar inte personnummer — lämna en rad att fylla i för hand på utskriften.",
    };
  }

  let text: string;
  try {
    text = rendera(mall.body_md, varden);
  } catch (e) {
    if (e instanceof AvtalsfelError) {
      const saknas = e.saknade.length ? ` Fyll i: ${e.saknade.join(", ")}.` : "";
      return { fel: `Avtalet kunde inte skapas.${saknas}` };
    }
    throw e;
  }

  const { data: skapat, error } = await db
    .from("contract")
    .insert({
      employee_id: employeeId,
      template_id: mall.id,
      template_slug: mall.slug,
      title: mall.title,
      body_md: text,
      variables: varden,
      status: "draft",
      created_by: utfordAv,
    })
    .select("id")
    .single();

  if (error || !skapat) return { fel: `Avtalet kunde inte sparas: ${error?.message ?? ""}` };

  await db.from("audit_log").insert({
    actor_id: utfordAv,
    action: "contract.created",
    object_type: "contract",
    object_id: skapat.id,
    meta: { mall: mall.slug },
  });

  return { avtalId: skapat.id };
}
