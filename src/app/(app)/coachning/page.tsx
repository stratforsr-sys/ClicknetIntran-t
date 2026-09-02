import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { getCurrentUser, fullName } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { LARMGRANS_DAGAR, larmar, sorteraLag } from "@/lib/coachning";
import { farCoacha, fokusomraden, hamtaLag } from "@/lib/coachning-server";
import { Lagvy, type Kortperson } from "./Lagvy";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coachning — Clicknet Nav" };

/**
 * Lagvyn.
 *
 * VYN VISAR VEM SOM BEHOVER NAGOT — INTE VEM SOM AR SAMST. Den bar darfor inga
 * poang, ingen placering och ingen jamforelse mellan personer. Det ar samma
 * linje som 0029 drog for adoptionen, som ar byggd for att gora
 * per-person-uppfoljning omojlig, och skalet ar detsamma: en lista som rangordnar
 * kollegor anvands till nagot annat an det den byggdes for.
 *
 * Den som inte coachar nagon skickas till sitt EGET kort. Coachningsvyn ar inte
 * stangd for saljaren — den ser bara annorlunda ut, precis som /avtal och /fel.
 *
 * SIDAN HAMTAR, KLIENTEN RITAR. Sokning och filter ar tillstand som inte hor
 * hemma i en adress: chefen skriver tre bokstaver, ser fel person och skriver
 * om. All data ar redan hamtad och redan behorighetsprovad av RLS, sa att lata
 * `Lagvy` sila i webblasaren ar en vy over ett svar — inte ett andra svar.
 */
export default async function CoachningSida() {
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");
  if (!farCoacha(user)) redirect(`/coachning/${user.employee.id}`);

  const mig = user.employee.id;

  const lag = sorteraLag(await hamtaLag(new Date(), mig), (r) => r.namn)
    /**
     * DET EGNA KORTET LIGGER INTE I RUTNATET.
     *
     * Chefen har egna coachningsuppgifter som alla andra, men de hor inte
     * hemma bland dem hon ska folja upp — och "Ny uppgift" pa sig sjalv mitt i
     * lagets rutnat ar en knapp som inte betyder nagot dar. Lanken "Min egen
     * coachning" uppe till hoger gar till samma kort.
     */
    .filter((r) => r.employee_id !== mig);

  const utanCoachning = lag.filter((r) => larmar(r.dagarSedan)).length;
  const forsenade = lag.reduce((s, r) => s + r.forsenade, 0);
  const vantar = lag.reduce((s, r) => s + r.vantarPaMig, 0);

  const supabase = await supabaseServer();

  /**
   * Underlaget till formularen hamtas EN gang for hela rutnatet.
   *
   * Kurserna, modulerna och dokumenten ar desamma oavsett vem uppgiften galler,
   * sa listorna gar ner till klienten en gang och delas av alla kort. Kollegorna
   * kommer hela och tunnas per kort — man ar aldrig sin egen motpart.
   */
  const [{ data: kollegor }, { data: mallar }, { data: mallposter }, fokus] = await Promise.all([
    supabase
      .from("employee")
      .select("id, first_name, last_name")
      .neq("status", "offboarded")
      .order("first_name"),
    supabase.from("coaching_template").select("id, name").eq("active", true).order("name"),
    supabase.from("coaching_template_item").select("template_id"),
    fokusomraden(),
  ]);

  const momentPer = new Map<string, number>();
  for (const p of mallposter ?? []) momentPer.set(p.template_id, (momentPer.get(p.template_id) ?? 0) + 1);

  const [{ data: kurser }, { data: moduler }, { data: dokument }] = await Promise.all([
    supabase.from("course").select("id, title").eq("status", "published").order("title"),
    supabase.from("course_module").select("id, title, kind, course_id").eq("kind", "roleplay"),
    supabase.from("document").select("id, title, doc_type").eq("status", "published").order("title"),
  ]);

  /**
   * Raderna bantas innan de gar over till klienten.
   *
   * `Uppgiftsrad` bar hela handelseloggen och beskrivningen i markdown — allt
   * det behover uppgiftssidan, ingenting av det behover ett kort i ett rutnat.
   * Skickat rakt igenom hade det blivit hundratals kilobyte i sidans nyttolast
   * for text som aldrig ritas.
   */
  const personer: Kortperson[] = lag.map((p) => ({
    employee_id: p.employee_id,
    namn: p.namn,
    team: p.team,
    start_date: p.start_date,
    dagarSedan: p.dagarSedan,
    forsenade: p.forsenade,
    vantarPaMig: p.vantarPaMig,
    fokus: p.fokus,
    uppgifter: p.uppgifter.map((u) => ({
      id: u.id,
      title: u.title,
      kind: u.kind,
      lage: u.lage,
      forsenad: u.forsenad,
      due_date: u.due_date,
      fokus: u.fokus,
      kraverDinBock: u.kraverDinBock,
    })),
  }));

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display text-ink-900">Coachning</h1>
          <p className="mt-1 text-body text-ink-500">
            {/* Den enda siffran vyn behover leda med. Underlaget ar entydigt:
                det ar coachningens FREKVENS som skiljer, inte dess form. */}
            {utanCoachning > 0
              ? `${utanCoachning} har inte coachats på ${LARMGRANS_DAGAR} dagar.`
              : "Alla har coachats den senaste månaden."}
            {forsenade > 0 && ` ${forsenade} uppgift${forsenade === 1 ? "" : "er"} är försenad${forsenade === 1 ? "" : "e"}.`}
            {vantar > 0 && ` ${vantar} väntar på din kvittering.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-4">
          <Link href="/coachning/mallar" className="text-small font-semibold text-brand-700 hover:text-brand-900">
            Mallar
          </Link>
          <Link
            href={`/coachning/${user.employee.id}`}
            className="text-small font-semibold text-brand-700 hover:text-brand-900"
          >
            Min egen coachning
          </Link>
        </div>
      </div>

      {personer.length === 0 ? (
        <Card>
          <EmptyState
            rubrik="Ingen att coacha än"
            text="Vyn fylls med de personer du är chef för. Saknas någon är det teamtillhörigheten i personalregistret som styr."
            handling={
              <Link href="/personal" className="text-small font-semibold text-brand-700 hover:text-brand-900">
                Till personalregistret
              </Link>
            }
          />
        </Card>
      ) : (
        <Lagvy
          personer={personer}
          kollegor={(kollegor ?? []).map((k) => ({ id: k.id, namn: fullName(k) }))}
          kurser={kurser ?? []}
          moduler={moduler ?? []}
          dokument={dokument ?? []}
          fokus={fokus}
          mallar={(mallar ?? []).map((m) => ({ id: m.id, name: m.name, moment: momentPer.get(m.id) ?? 0 }))}
          idag={new Date().toISOString().slice(0, 10)}
        />
      )}
    </div>
  );
}
