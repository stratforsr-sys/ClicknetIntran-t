import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Ikon } from "@/components/shell/Ikon";
import { Markdown } from "@/components/Markdown";
import { getCurrentUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { arStangd, forsenad, tidstext } from "@/lib/uppgifter";
import { hamtaProjektvy, type Uppgift } from "@/lib/uppgifter-server";
import { Lista, type Listrad, type Projektkarta } from "../../Lista";
import { Snabbrad } from "../../Snabbrad";
import { Projektpanel } from "./Projektpanel";

export const dynamic = "force-dynamic";

/**
 * Ett projekt.
 *
 * ===========================================================================
 * PROJEKTKORTET SKULLE VARA EN INGÅNG, INTE ETT FILTER
 *
 * Första utkastet lät kortet peka tillbaka till listan med `?projekt=`. Det
 * smalnade av samma sex vyer, vilket var billigt att bygga och fel i sak:
 * beställarens invändning 2026-09-11 var att man ska kunna GÅ IN i projektet
 * och arbeta där. Skillnaden är inte kosmetisk — ett filter har ingen egen
 * plats att lägga en uppgift på, ingen beskrivning, inga deltagare och inget
 * ställe att svara på "hur går det".
 *
 * Sidan är därför byggd runt EN fråga i taget: hur långt har projektet kommit,
 * vad är nästa sak att göra, och vem är med. Snabbraden ligger direkt under
 * mätaren och lägger uppgiften i projektet utan att man behöver skriva
 * `#projektnamn`.
 *
 * ----------------------------------------------------------------------------
 * ÖPPET OCH KLART ÄR TVÅ LISTOR, INTE EN MED ÖVERSTRUKNA RADER
 *
 * Ett projekt som rullat ett tag har fler klara uppgifter än öppna, och en enda
 * lista blir då en arkivhög man måste skrolla förbi för att hitta det som
 * återstår. Det klara ligger kvar — det är halva svaret på "hur går det" — men
 * under, och hopfällt i en egen rubrik.
 * ===========================================================================
 */
export default async function Projektsida({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user?.employee) notFound();

  const vy = await hamtaProjektvy(user, id);
  if (!vy) notFound();

  const { projekt: p, uppgifter, namn, idag } = vy;
  const mig = user.employee.id;

  const agare = p.owner_id === mig || p.medlemmar.some((m) => m.employee_id === mig && m.role === "redigerare");
  const styr = p.owner_id === mig;

  const oppna = uppgifter.filter((u) => !arStangd(u.lage));
  const klara = uppgifter.filter((u) => arStangd(u.lage));
  const forsenade = oppna.filter((u) => forsenad(u, idag));
  const kvarMinuter = oppna.reduce((s, u) => s + (u.estimate_minutes ?? 0), 0);

  const andel = uppgifter.length === 0 ? 0 : Math.round((klara.length / uppgifter.length) * 100);
  const senDeadline = Boolean(p.due_date && p.due_date < idag && oppna.length > 0);

  const projektkarta: Projektkarta = { [p.id]: { namn: p.name, farg: p.color } };
  const namnKarta: Record<string, string> = Object.fromEntries(namn);

  const till = (u: Uppgift): Listrad => ({
    id: u.id,
    title: u.title,
    assignee_id: u.assignee_id,
    project_id: u.project_id,
    due_date: u.due_date,
    due_time: u.due_time,
    estimate_minutes: u.estimate_minutes,
    priority: u.priority,
    lage: u.lage,
    granskare: u.granskare,
    kopplingar: u.kopplingar.map((k) => ({ etikett: k.etikett, slag: k.slag })),
    delar: u.delar.map((d) => ({ id: d.id, title: d.title, lage: d.lage })),
  });

  const { data: personer } = await (await supabaseServer())
    .from("employee")
    .select("id, first_name, last_name")
    .neq("status", "offboarded")
    .order("first_name");

  const valbara = (personer ?? []).map((x) => ({
    id: x.id as string,
    namn: `${x.first_name} ${x.last_name}`,
  }));

  return (
    <div className="flex flex-col gap-4 pt-2">
      <nav aria-label="Var du är" className="flex items-center gap-1.5 text-small text-ink-500">
        <Link href="/uppgifter" className="transition-colors duration-fast hover:text-brand-700">
          Uppgifter
        </Link>
        <Ikon namn="tillbaka" className="size-3 rotate-180 text-ink-300" />
        <span className="text-ink-700">{p.name}</span>
      </nav>

      {p.archived_at && (
        <div className="rounded-sm bg-canvas px-4 py-3 text-small text-ink-700">
          Det här projektet är arkiverat. Uppgifterna ligger kvar och går fortfarande att arbeta med.
        </div>
      )}

      {/* ===================== PROJEKTKORTET ===================== */}
      <Card>
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span aria-hidden className={`size-3 shrink-0 rounded-full ${STRECK[p.color] ?? "bg-brand-500"}`} />
              <h1 className="text-display text-ink-900">{p.name}</h1>
            </div>
            {styr && (
              <Projektpanel
                id={p.id}
                name={p.name}
                descriptionMd={p.description_md}
                color={p.color}
                dueDate={p.due_date}
                ownerId={p.owner_id}
                arkiverad={Boolean(p.archived_at)}
                medlemmar={p.medlemmar}
                personer={valbara}
              />
            )}
          </div>

          {/* MÄTAREN ÄR SVARET PÅ "HUR GÅR DET", och den står överst av det
              skälet. Talen under är samma svar i siffror — den som vill veta
              exakt hur många som är sena ska slippa räkna prickar. */}
          <div className="flex flex-col gap-2">
            <div className="h-2 overflow-hidden rounded-full bg-canvas">
              <div
                className={`h-full rounded-full transition-[width] duration-fast ${STRECK[p.color] ?? "bg-brand-500"}`}
                style={{ width: `${andel}%` }}
              />
            </div>
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <Tal varde={`${andel} %`} etikett="klart" stort />
              <Tal varde={oppna.length} etikett={oppna.length === 1 ? "öppen" : "öppna"} />
              <Tal varde={klara.length} etikett="klara" />
              {forsenade.length > 0 && <Tal varde={forsenade.length} etikett="försenade" larm />}
              {kvarMinuter > 0 && <Tal varde={tidstext(kvarMinuter) ?? ""} etikett="beräknat kvar" />}
            </div>
          </div>

          <dl className="flex flex-wrap gap-x-8 gap-y-3 border-t border-canvas pt-4">
            <Fakta etikett="Ägare">{namn.get(p.owner_id) ?? "Okänd"}</Fakta>
            <Fakta etikett="Deadline" larm={senDeadline}>
              {p.due_date ?? "Ingen"}
            </Fakta>
            <Fakta etikett="Deltagare">
              {p.medlemmar.length === 0 ? "Bara du" : `${p.medlemmar.length + 1} personer`}
            </Fakta>
          </dl>

          {p.description_md && (
            <div className="border-t border-canvas pt-4">
              <Markdown text={p.description_md} />
            </div>
          )}
        </div>
      </Card>

      {/* ===================== ARBETET ===================== */}
      {agare && !p.archived_at && (
        <Snabbrad
          projektNamn={[p.name]}
          projektId={p.id}
          placeholder={`Vad ska göras i ${p.name}?`}
        />
      )}

      <Card>
        <CardHeader
          titel="Att göra"
          beskrivning={
            oppna.length === 0
              ? undefined
              : `${oppna.length} öppna${forsenade.length > 0 ? `, varav ${forsenade.length} försenade` : ""}`
          }
        />
        {oppna.length === 0 ? (
          <EmptyState
            rubrik={uppgifter.length === 0 ? "Inga uppgifter än" : "Allt är avbockat"}
            text={
              uppgifter.length === 0
                ? "Skriv den första saken som måste göras i fältet ovanför. Du kan sätta datum och ansvarig direkt i raden."
                : "Ingenting öppet i projektet just nu. Det som gjorts står kvar nedanför."
            }
          />
        ) : (
          <Lista rader={oppna.map(till)} namn={namnKarta} projekt={projektkarta} idag={idag} visaAnsvarig />
        )}
      </Card>

      {klara.length > 0 && (
        <details className="group rounded-md bg-surface p-4 shadow-elev-1 md:p-6">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
            <h2 className="text-h2 text-ink-900">
              Klart <span className="tnum text-ink-300">{klara.length}</span>
            </h2>
            <Ikon
              namn="tillbaka"
              className="size-4 -rotate-90 text-ink-300 transition-transform duration-fast group-open:rotate-90"
            />
          </summary>
          <div className="mt-4">
            <Lista rader={klara.map(till)} namn={namnKarta} projekt={projektkarta} idag={idag} visaAnsvarig />
          </div>
        </details>
      )}

      {p.medlemmar.length > 0 && (
        <Card>
          <CardHeader
            titel="Vilka är med"
            beskrivning="Deltagarna ser projektet. Vilka uppgifter de ser avgörs av varje uppgift för sig."
          />
          <ul className="flex flex-col gap-2.5">
            <li className="flex items-center justify-between gap-3">
              <span className="truncate text-body text-ink-900">{namn.get(p.owner_id) ?? "Okänd"}</span>
              <span className="shrink-0 rounded-full bg-brand-tint px-2 py-0.5 text-micro text-brand-ink">Ägare</span>
            </li>
            {p.medlemmar.map((m) => (
              <li key={m.employee_id} className="flex items-center justify-between gap-3">
                <span className="truncate text-body text-ink-900">{m.namn}</span>
                <span className="shrink-0 rounded-full bg-canvas px-2 py-0.5 text-micro text-ink-500">
                  {m.role === "redigerare" ? "Redigerare" : "Kan se"}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

const STRECK: Record<string, string> = {
  brand: "bg-brand-500",
  info: "bg-info",
  accent: "bg-accent",
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
};

function Tal({
  varde,
  etikett,
  stort = false,
  larm = false,
}: {
  varde: string | number;
  etikett: string;
  stort?: boolean;
  larm?: boolean;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span
        className={
          stort
            ? "tnum text-h1 text-ink-900"
            : larm
              ? "tnum text-body font-semibold text-danger-ink"
              : "tnum text-body font-semibold text-ink-900"
        }
      >
        {varde}
      </span>
      <span className="text-small text-ink-500">{etikett}</span>
    </span>
  );
}

function Fakta({ etikett, children, larm = false }: { etikett: string; children: ReactNode; larm?: boolean }) {
  return (
    <div>
      <dt className="text-micro text-ink-500 uppercase">{etikett}</dt>
      <dd className={larm ? "mt-0.5 text-body text-danger-ink" : "mt-0.5 text-body text-ink-900"}>{children}</dd>
    </div>
  );
}
