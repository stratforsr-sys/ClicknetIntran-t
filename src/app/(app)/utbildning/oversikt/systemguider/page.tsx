import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { getCurrentUser, hasRole, fullName } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { hamtaLage } from "@/lib/sparrar";
import { stampelfri } from "@/lib/stampelfri";
import { guiderForRoller } from "@/guider";
import {
  FRIST_DAGAR,
  STILLASTAENDE_DAGAR,
  personlage,
  starStilla,
  type Personlage,
  type Progress,
} from "@/lib/guider";
import type { Permission, Role } from "@/lib/roles";

export const dynamic = "force-dynamic";
export const metadata = { title: "Systemguider — progress — Clicknet Nav" };

/**
 * Hur långt personalen kommit i sina systemguider.
 *
 * ===========================================================================
 * VYN VISAR BARA DEM RLS SLÄPPER IGENOM.
 *
 * Teamledaren ser sitt team, ledningen ser alla — och den gränsen dras i
 * databasen (0041), inte här. Ett filter i den här filen hade varit ett andra
 * svar på samma fråga, och två svar glider isär. Samma resonemang som står över
 * kursöversikten i `/utbildning/oversikt`.
 *
 * NÄMNAREN ÄR PERSONLIG. "2 av 6" betyder ingenting om sexan är fel: en
 * säljare, en ekonom och en projektledare har olika paket, och den som saknar
 * behörigheten `payroll_cost_viewer` ska inte ha lönekostnadsguiden i sin
 * nämnare. Därför räknas guidelistan fram per person ur hennes roller,
 * behörigheter och om hon stämplar — precis som listan hon själv ser.
 * ===========================================================================
 *
 * DET FINNS INGEN KOLUMN "PROCENT". Den som står på steg tre av åtta i en tur
 * av sex är inte 6 procent klar på något meningsfullt sätt, och ett tal som ser
 * exakt ut inbjuder till att jämföra personer med varandra. Vyn svarar på två
 * frågor i stället: hur många turer är avklarade, och rör det sig.
 */
export default async function GuideOversikt() {
  const user = await getCurrentUser();
  if (!hasRole(user, "sales_manager", "admin", "ceo", "team_lead")) redirect("/utbildning");

  const supabase = await supabaseServer();

  const [lage, { data: personal }, { data: roller }, { data: behorigheter }, { data: rader }] =
    await Promise.all([
      hamtaLage(),
      supabase
        .from("employee")
        .select("id, first_name, last_name, start_date, status")
        .neq("status", "offboarded")
        .order("first_name"),
      supabase.from("employee_role").select("employee_id, role"),
      supabase.from("employee_permission").select("employee_id, permission"),
      supabase
        .from("guide_progress")
        .select("employee_id, guide_slug, version, steg, completed_at, updated_at"),
    ]);

  const rollPer = new Map<string, Role[]>();
  for (const r of roller ?? []) {
    rollPer.set(r.employee_id, [...(rollPer.get(r.employee_id) ?? []), r.role as Role]);
  }

  const behPer = new Map<string, Permission[]>();
  for (const b of behorigheter ?? []) {
    behPer.set(b.employee_id, [...(behPer.get(b.employee_id) ?? []), b.permission as Permission]);
  }

  const raderPer = new Map<string, Progress[]>();
  for (const r of rader ?? []) {
    raderPer.set(r.employee_id, [...(raderPer.get(r.employee_id) ?? []), r as Progress]);
  }

  const nu = new Date();

  const lista = (personal ?? []).map((p) => {
    const mina = rollPer.get(p.id) ?? [];
    const guider = guiderForRoller(mina, {
      stamplar: lage.stampling && !stampelfri(mina),
      behorigheter: behPer.get(p.id) ?? [],
    });
    return {
      person: p,
      lage: personlage(guider, raderPer.get(p.id) ?? [], p.start_date, nu),
    };
  });

  /**
   * Ordningen är hela vyn. Överst det som kräver något av chefen — försenade
   * först, sedan de som stannat av — och längst ner de som är klara. En lista
   * sorterad på namn hade begravt den enda raden som behövde läsas.
   */
  const rang = (l: Personlage) => (l.forsenad ? 0 : starStilla(l) ? 1 : l.onboardad ? 3 : 2);
  lista.sort((a, b) => rang(a.lage) - rang(b.lage) || (b.lage.stillestand ?? -1) - (a.lage.stillestand ?? -1));

  const kvar = lista.filter((r) => !r.lage.onboardad).length;

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display text-ink-900">Systemguider</h1>
          <p className="mt-1 max-w-[70ch] text-body text-ink-500">
            {lista.length === 0
              ? "Ingen personal att visa."
              : kvar === 0
                ? "Alla du ser är genomgångna."
                : `${kvar} av ${lista.length} är inte genomgångna än.`}
          </p>
        </div>
        <Link
          href="/utbildning/oversikt"
          className="text-small font-semibold text-brand-700 hover:text-brand-900"
        >
          Kursprogress
        </Link>
      </div>

      <Card className="p-0 md:p-0">
        <div className="p-4 md:p-6">
          <CardHeader
            titel="Läget per person"
            beskrivning={`Markeras efter ${STILLASTAENDE_DAGAR} dagar utan rörelse. Fristen för hela paketet är ${FRIST_DAGAR} dagar från startdatum.`}
          />
        </div>

        {lista.length === 0 ? (
          <div className="px-4 pb-6 md:px-6">
            <EmptyState
              rubrik="Ingen att visa"
              text="Du ser de personer du leder. Ledningen ser hela personalen."
            />
          </div>
        ) : (
          <>
            {/* UI-PRD §5.6: ingen zebrarandning, och på mobil blir varje rad ett kort. */}
            <table className="hidden w-full border-collapse md:table">
              <thead>
                <tr className="border-b border-canvas">
                  <Th>Person</Th>
                  <Th>Klara</Th>
                  <Th>Pågår</Th>
                  <Th>Senast</Th>
                  <Th>Läge</Th>
                </tr>
              </thead>
              <tbody>
                {lista.map(({ person, lage: l }) => (
                  <tr key={person.id} className="border-b border-canvas last:border-0">
                    <td className="px-6 py-3">
                      <Link
                        href={`/personal/${person.id}`}
                        className="text-body text-ink-900 hover:text-brand-700"
                      >
                        {fullName(person)}
                      </Link>
                    </td>
                    <td className="tnum px-6 py-3 text-body text-ink-900">
                      {l.klara} / {l.av}
                    </td>
                    <td className="px-6 py-3 text-small text-ink-500">
                      {l.pagar ? `${l.pagar.titel} · steg ${l.pagar.steg} av ${l.pagar.av}` : "—"}
                    </td>
                    <td className="px-6 py-3 text-small text-ink-500">
                      <Senast lage={l} />
                    </td>
                    <td className="px-6 py-3">
                      <Lagesmarke lage={l} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="flex flex-col md:hidden">
              {lista.map(({ person, lage: l }) => (
                <li key={person.id} className="border-b border-canvas px-4 py-4 last:border-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/personal/${person.id}`} className="text-body font-semibold text-ink-900">
                      {fullName(person)}
                    </Link>
                    <Lagesmarke lage={l} />
                  </div>
                  <p className="mt-1 text-small text-ink-500">
                    {l.klara} av {l.av} klara
                    {l.pagar ? ` · ${l.pagar.titel}, steg ${l.pagar.steg} av ${l.pagar.av}` : ""}
                  </p>
                  <p className="mt-0.5 text-small text-ink-500">
                    <Senast lage={l} />
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <p className="text-small text-ink-500">
        Guiderna låser ingenting. Den här vyn är till för att kunna fråga någon hur det går —
        inte för att räkna fel på henne.
      </p>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-6 py-3 text-left text-micro uppercase text-ink-500">{children}</th>;
}

function Senast({ lage }: { lage: Personlage }) {
  if (lage.stillestand === null) return <>Inte påbörjat</>;
  if (lage.stillestand === 0) return <>Idag</>;
  return <>{lage.stillestand === 1 ? "1 dag sedan" : `${lage.stillestand} dagar sedan`}</>;
}

function Lagesmarke({ lage }: { lage: Personlage }) {
  if (lage.onboardad) return <Badge ton="ok">Onboardad</Badge>;
  if (lage.forsenad) return <Badge ton="danger">Över fristen</Badge>;
  if (starStilla(lage)) return <Badge ton="warn">Står still</Badge>;
  if (lage.stillestand === null) return <Badge ton="neutral">Inte börjat</Badge>;
  return <Badge ton="brand">Pågår</Badge>;
}
