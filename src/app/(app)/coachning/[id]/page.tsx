import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser, fullName } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { LAGE_ETIKETT, LAGE_TON, TYP_ETIKETT, dagarKvar } from "@/lib/coachning";
import {
  arChefFor,
  fokusomraden,
  kvPerOmrade,
  namnkarta,
  samtalFor,
  uppgifterFor,
  type Uppgiftsrad,
} from "@/lib/coachning-server";
import { NyUppgift } from "../NyUppgift";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coachningskort — Clicknet Nav" };

/**
 * Personkortet — den enda platsen dar hela bilden av en persons utveckling
 * star samlad.
 *
 * ALLT PA SIDAN AR LASBART FOR DEN DET GALLER. Det ar inte en bieffekt av
 * RLS-policyn utan hela linjen: coachningen far inga privata chefsanteckningar,
 * av samma skal som rubriken syns fore inspelningen i 0024 och som AC-3.13 drog
 * for franvaroreglerna. Den som berors av nagot ska kunna lasa det.
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

  const [uppgifter, kv, samtal, fokus] = await Promise.all([
    uppgifterFor(id),
    kvPerOmrade(id),
    samtalFor(id),
    fokusomraden(),
  ]);

  const oppna = uppgifter.filter((u) => u.lage !== "klar" && u.lage !== "avbruten");
  const avslutade = uppgifter.filter((u) => u.lage === "klar" || u.lage === "avbruten");

  const namn = await namnkarta([
    ...uppgifter.flatMap((u) => [u.created_by, u.partner_id ?? ""]),
    ...samtal.map((s) => s.coach_id),
  ]);

  // Motparter och mottagare for formularet. Hamtas under RLS, sa listan ar redan
  // begransad till dem chefen far se.
  const { data: kollegor } = await supabase
    .from("employee")
    .select("id, first_name, last_name")
    .neq("status", "offboarded")
    .neq("id", id)
    .order("first_name");

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
          <ul className="flex flex-col gap-2">
            {oppna.map((u) => (
              <Uppgiftskort key={u.id} u={u} namn={namn} />
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

      {samtal.length > 0 && (
        <Card>
          <CardHeader titel="Coachningssamtal" />
          <ul className="flex flex-col gap-3">
            {samtal.map((s) => (
              <li key={s.id} className="rounded-sm bg-canvas px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-small font-semibold text-ink-900">{s.held_on}</span>
                  <span className="text-small text-ink-500">{namn.get(s.coach_id) ?? "—"}</span>
                </div>
                {s.will_md && <p className="mt-1 text-small text-ink-700">{s.will_md}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {avslutade.length > 0 && (
        <Card>
          <CardHeader titel="Historik" beskrivning="Avslutade och avbrutna uppgifter. Ingenting skrivs över." />
          <ul className="flex flex-col gap-2">
            {avslutade.map((u) => (
              <Uppgiftskort key={u.id} u={u} namn={namn} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Uppgiftskort({ u, namn }: { u: Uppgiftsrad; namn: Map<string, string> }) {
  const kvar = dagarKvar(u.due_date);
  return (
    <li>
      <Link
        href={`/coachning/uppgift/${u.id}`}
        className="flex flex-col gap-1.5 rounded-sm bg-canvas px-4 py-3 hover:bg-surface-alt"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink-900">{u.title}</span>
          <Badge ton={LAGE_TON[u.lage]}>{LAGE_ETIKETT[u.lage]}</Badge>
          {/* Forsening ar ett EGET marke och inte ett lage — en uppgift kan
              vara bade underkand och forsenad, och bada sakerna ar sanna. */}
          {u.forsenad && <Badge ton="danger">Försenad</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-ink-500">
          <span>{TYP_ETIKETT[u.kind]}</span>
          {u.partner_id && <span>med {namn.get(u.partner_id) ?? "—"}</span>}
          {u.due_date && (
            <span className="tnum">
              {u.due_date}
              {kvar !== null && !u.forsenad && u.lage !== "klar" && kvar <= 7 && ` · ${kvar} dagar kvar`}
            </span>
          )}
          {u.fokus.map((f) => (
            <Badge key={f} ton="info">
              {f}
            </Badge>
          ))}
        </div>
      </Link>
    </li>
  );
}
