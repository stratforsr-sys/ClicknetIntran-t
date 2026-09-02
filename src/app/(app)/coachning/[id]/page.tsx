import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser, fullName } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { type Handelsetyp } from "@/lib/coachning";
import {
  arChefFor,
  fokusomraden,
  kvPerOmrade,
  namnkarta,
  samtalFor,
  tidslinjeFor,
  uppgifterFor,
  type Uppgiftsrad,
} from "@/lib/coachning-server";
import { NyUppgift } from "../NyUppgift";
import { NyttSamtal } from "../NyttSamtal";
import { TillampaMall } from "../TillampaMall";
import { Uppgiftskort } from "../Uppgiftskort";
import { Historik, type Historikpost } from "./Historik";
import { Tidslinje, type Tidslinjerad } from "./Tidslinje";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coachningskort — Clicknet Nav" };

/** Vad som star i historikens fotnot, beroende pa hur uppgiften faktiskt slutade. */
const SLUT_ORD: Partial<Record<Handelsetyp, string>> = {
  kvitterad: "Kvitterad",
  avbruten: "Avbruten",
};

/**
 * Personkortet — den enda platsen dar hela bilden av en persons utveckling
 * star samlad.
 *
 * ALLT PA SIDAN AR LASBART FOR DEN DET GALLER. Det ar inte en bieffekt av
 * RLS-policyn utan hela linjen: coachningen far inga privata chefsanteckningar,
 * av samma skal som rubriken syns fore inspelningen i 0024 och som AC-3.13 drog
 * for franvaroreglerna. Den som berors av nagot ska kunna lasa det.
 *
 * SIDAN AR OCKSA SALJARENS EGEN VY. Den som inte coachar nagon skickas hit av
 * `/coachning`, och da ar det har hennes uppgifter bor. Darfor ritas de som
 * egna kort och inte som rader i en lista: det ar den enda vy en saljare moter
 * i modulen, och den ska ga att lasa pa en telefon utan att se ut som ett
 * utdrag ur ett register.
 */
export default async function PersonkortSida({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");

  const egen = user.employee.id === id;
  const arChef = await arChefFor(user, id);
  // Varken egen eller chef: RLS hade gett noll rader anda, men en sida som
  // ritar nagon annans namn ovanfor en tom lista ar en sida som lackt namnet.
  if (!egen && !arChef) redirect(`/coachning/${user.employee.id}`);

  const supabase = await supabaseServer();
  const { data: person } = await supabase
    .from("employee")
    .select("id, first_name, last_name, start_date, status")
    .eq("id", id)
    .maybeSingle();

  if (!person) redirect("/coachning");

  const [uppgifter, kv, samtal, fokus, tidslinje] = await Promise.all([
    uppgifterFor(id),
    kvPerOmrade(id),
    samtalFor(id),
    fokusomraden(),
    tidslinjeFor(id),
  ]);

  const oppna = uppgifter.filter((u) => u.lage !== "klar" && u.lage !== "avbruten");
  const avslutade = uppgifter.filter((u) => u.lage === "klar" || u.lage === "avbruten");

  const namn = await namnkarta([
    ...uppgifter.flatMap((u) => [u.created_by, u.partner_id ?? "", ...u.handelser.map((h) => h.by ?? "")]),
    ...samtal.map((s) => s.coach_id),
    ...tidslinje.map((t) => t.av ?? ""),
  ]);

  /**
   * Historikens fotnot raknas fram ur den SISTA handelsen, inte ur den forsta
   * som rakar heta "kvitterad". En uppgift som lamnats in, underkants och
   * kvitterats om har tva bockar i loggen, och det ar den senare som galler.
   */
  const historik: Historikpost[] = avslutade.map((u) => {
    const slut = sistaAvslut(u);
    return {
      id: u.id,
      title: u.title,
      kind: u.kind,
      lage: u.lage,
      forsenad: u.forsenad,
      due_date: u.due_date,
      fokus: u.fokus,
      avslutatOrd: slut ? (SLUT_ORD[slut.type] ?? "Klar") : "Klar",
      avslutatDatum: slut ? slut.at.slice(0, 10) : null,
      avslutatAv: slut?.by ? (namn.get(slut.by) ?? null) : null,
    };
  });

  const tidslinjerader: Tidslinjerad[] = tidslinje.map((t) => ({
    nyckel: t.nyckel,
    datum: t.at.slice(0, 10),
    rubrik: t.rubrik,
    detalj: t.detalj,
    av: t.av ? (namn.get(t.av) ?? null) : null,
    href: t.href,
    ton: t.ton,
  }));

  // Motparter och mottagare for formularet. Hamtas under RLS, sa listan ar redan
  // begransad till dem chefen far se.
  const { data: kollegor } = await supabase
    .from("employee")
    .select("id, first_name, last_name")
    .neq("status", "offboarded")
    .neq("id", id)
    .order("first_name");

  const [{ data: mallar }, { data: mallposter }] = await Promise.all([
    supabase.from("coaching_template").select("id, name").eq("active", true).order("name"),
    supabase.from("coaching_template_item").select("template_id"),
  ]);

  const momentPer = new Map<string, number>();
  for (const p of mallposter ?? []) momentPer.set(p.template_id, (momentPer.get(p.template_id) ?? 0) + 1);

  const [{ data: kurser }, { data: moduler }, { data: dokument }] = await Promise.all([
    supabase.from("course").select("id, title").eq("status", "published").order("title"),
    supabase.from("course_module").select("id, title, kind, course_id").eq("kind", "roleplay"),
    supabase.from("document").select("id, title, doc_type").eq("status", "published").order("title"),
  ]);

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href={arChef ? "/coachning" : "/"}
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        {arChef ? "Tillbaka till coachning" : "Tillbaka till start"}
      </Link>

      <div>
        <h1 className="text-display text-ink-900">{egen ? "Min coachning" : fullName(person)}</h1>
        <p className="mt-1 text-body text-ink-500">
          {oppna.length === 0
            ? "Inga öppna uppgifter."
            : `${oppna.length} öppen${oppna.length === 1 ? "" : "a"} uppgift${oppna.length === 1 ? "" : "er"}.`}
        </p>
      </div>

      {kv.some((k) => k.senaste !== null) && (
        <Card>
          <CardHeader
            titel="Senaste K&V per område"
            beskrivning="Det som coachningen tränar mäts här. Områden utan mätning visas inte."
          />
          <ul className="flex flex-wrap gap-2">
            {kv
              .filter((k) => k.senaste !== null)
              .map((k) => (
                <li key={k.label} className="rounded-full bg-canvas px-3 py-1.5 text-small text-ink-700">
                  {k.label}{" "}
                  <span className="tnum font-semibold">
                    {k.senaste}
                    {k.tak !== null && ` / ${k.tak}`}
                  </span>
                </li>
              ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader titel="Öppna uppgifter" />
        {oppna.length === 0 ? (
          <EmptyState
            rubrik="Inget öppet"
            text={
              arChef
                ? "Lägg upp en coachningsuppgift nedan när något ska tränas."
                : "Du har inga coachningsuppgifter just nu."
            }
          />
        ) : (
          /* Ett kort per uppgift, inte en rad per uppgift. Det ar sa saljaren
             moter sin egen coachning, och en lista med fyra rader ger ingen
             kansla av vad som faktiskt ligger pa bordet. */
          <ul className="grid gap-3 sm:grid-cols-2">
            {oppna.map((u) => (
              <Uppgiftskort
                key={u.id}
                u={{
                  id: u.id,
                  title: u.title,
                  kind: u.kind,
                  lage: u.lage,
                  forsenad: u.forsenad,
                  due_date: u.due_date,
                  fokus: u.fokus,
                }}
                fotnot={u.partner_id ? `Med ${namn.get(u.partner_id) ?? "—"}` : null}
              />
            ))}
          </ul>
        )}
      </Card>

      {arChef && (
        <Card>
          <CardHeader
            titel="Ny coachningsuppgift"
            beskrivning="Den som ska göra den, med vem, och vem som kvitterar."
          />
          <NyUppgift
            assigneeId={id}
            kollegor={(kollegor ?? []).map((k) => ({ id: k.id, namn: fullName(k) }))}
            kurser={kurser ?? []}
            moduler={moduler ?? []}
            dokument={dokument ?? []}
            fokus={fokus}
          />
        </Card>
      )}

      {arChef && (mallar ?? []).length > 0 && (
        <Card>
          <CardHeader
            titel="Använd en mall"
            beskrivning="Lägger upp hela mallens moment med datum räknade från startdagen."
            handling={
              <Link href="/coachning/mallar" className="text-small font-semibold text-brand-700 hover:text-brand-900">
                Hantera mallar
              </Link>
            }
          />
          <TillampaMall
            assigneeId={id}
            mallar={(mallar ?? []).map((m) => ({ id: m.id, name: m.name, moment: momentPer.get(m.id) ?? 0 }))}
            forvaltDatum={person.start_date ?? new Date().toISOString().slice(0, 10)}
          />
        </Card>
      )}

      {arChef && !egen && (
        <Card>
          <CardHeader
            titel="Coachningssamtal"
            beskrivning="Mål, läge, alternativ och slutsats. Åtagandena blir uppgifter."
          />
          <NyttSamtal employeeId={id} idag={new Date().toISOString().slice(0, 10)} />
        </Card>
      )}

      {tidslinjerader.length > 0 && (
        <Card>
          <CardHeader
            titel="Tidslinje"
            beskrivning="Uppgifter, samtal, rollspel, kurser, certifikat och K&V i den ordning det hände."
          />
          <Tidslinje rader={tidslinjerader} />
        </Card>
      )}

      {samtal.length > 0 && (
        <Card>
          <CardHeader titel="Tidigare samtal" />
          <ul className="flex flex-col gap-3">
            {samtal.map((s) => (
              <li key={s.id} className="rounded-sm bg-canvas px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-small font-semibold text-ink-900">{s.held_on}</span>
                  <span className="text-small text-ink-500">{namn.get(s.coach_id) ?? "—"}</span>
                </div>
                {/* Hela protokollet, inte bara slutsatsen. Den som berors av
                    ett samtal ska kunna lasa vad som faktiskt skrevs. */}
                {[
                  ["Mål", s.goal_md],
                  ["Läge", s.reality_md],
                  ["Alternativ", s.options_md],
                  ["Slutsats", s.will_md],
                ]
                  .filter(([, v]) => v)
                  .map(([r, v]) => (
                    <p key={r} className="mt-1 text-small text-ink-700">
                      <span className="font-semibold">{r}:</span> {v}
                    </p>
                  ))}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {historik.length > 0 && (
        <Card>
          <CardHeader
            titel="Historik"
            beskrivning="Avslutade och avbrutna uppgifter. Ingenting skrivs över."
          />
          <Historik poster={historik} />
        </Card>
      )}
    </div>
  );
}

/**
 * Den handelse som faktiskt STANGDE uppgiften.
 *
 * Loggen kan innehalla flera bockar — inlamnad, underkand, inlamnad igen,
 * kvitterad — och det ar den SENASTE stangande som galler. En sokning efter
 * forsta `kvitterad` hade hittat en bock som sedan revs.
 *
 * De sjalvsanna typerna har ingen stangande handelse alls: laget kommer ur
 * `certification`, `course_attempt` eller `document_ack`. Da returneras null,
 * och vyn skriver "Klar" utan att pasta att nagon satte bocken.
 */
function sistaAvslut(u: Uppgiftsrad) {
  const stangande = u.handelser.filter((h) => h.type === "kvitterad" || h.type === "avbruten");
  if (stangande.length === 0) return null;
  return stangande.reduce((a, b) => (a.at > b.at ? a : b));
}
