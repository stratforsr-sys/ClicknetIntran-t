import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { Markdown } from "@/components/Markdown";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { svenskKlocka } from "@/lib/klocka";
import {
  LAGE_ETIKETT,
  LAGE_TON,
  PRIORITET_ETIKETT,
  ROLL_ETIKETT,
  ROLL_FORKLARING,
  arStangd,
  farBjudaIn,
  farGranska,
  farRedigera,
  fristtext,
  tidstext,
  visaPrioritet,
  type Krets,
} from "@/lib/uppgifter";
import { hamtaUppgift } from "@/lib/uppgifter-server";
import { Handlingar, Inbjudan, Kopplingsformular, Kommentar, Deluppgift } from "./Handlingar";

export const dynamic = "force-dynamic";

/**
 * En uppgift.
 *
 * ===========================================================================
 * SIDAN RITAR BARA DET DEN INLOGGADE FAKTISKT FÅR GÖRA
 *
 * Knapparna avgörs av `farRedigera()`, `farBjudaIn()` och `farGranska()` — samma
 * rena funktioner som server action kör en gång till innan den skriver. Det är
 * INTE dubbelarbete: det som döljs här är en artighet, det som nekas där är
 * spärren. En knapp som bara gömts med CSS är ingen spärr alls.
 *
 * HISTORIKEN LIGGER SIST OCH SYNS ALLTID. Den är hela skälet att modulen inte
 * har någon status-kolumn: "Returnerad av Anna — saknar underlaget" står kvar
 * även sedan uppgiften gjorts om och godkänts, och det är den raden man
 * behöver den tredje gången samma sak kommer tillbaka.
 * ===========================================================================
 */
export default async function Uppgiftssida({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user?.employee) notFound();

  const svar = await hamtaUppgift(user, id);
  if (!svar) notFound();

  const { uppgift: u, handelser, namn } = svar;
  const mig = user.employee.id;

  const krets: Krets = {
    mig,
    assignee_id: u.assignee_id,
    created_by: u.created_by,
    minRoll: u.minRoll,
  };

  const redigerar = farRedigera(krets);
  const bjuderIn = farBjudaIn(krets);
  const granskar = farGranska(krets);
  const stangd = arStangd(u.lage);

  const idag = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());

  // Väljarna läser med ANVÄNDARENS EGEN TOKEN och följer alltså
  // `employee_read` — se rubriken vid `namnkarta()` i uppgifter-server.ts.
  const supabase = await supabaseServer();
  const [{ data: personer }, { data: order }, { data: arenden }, { data: kurser }, { data: coachning }] =
    await Promise.all([
      supabase
        .from("employee")
        .select("id, first_name, last_name")
        .neq("status", "offboarded")
        .order("first_name"),
      supabase.from("sales_order").select("id, company_name").order("created_at", { ascending: false }).limit(50),
      supabase.from("hr_case").select("id, subject").order("created_at", { ascending: false }).limit(50),
      supabase.from("course").select("id, title").eq("status", "published").order("title"),
      supabase.from("coaching_task").select("id, title").is("cancelled_at", null).limit(50),
    ]);

  const valbara = (personer ?? []).map((p) => ({
    id: p.id as string,
    namn: `${p.first_name} ${p.last_name}`,
  }));

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href="/uppgifter"
        className="inline-flex items-center gap-2 self-start text-small text-ink-500 transition-colors duration-fast hover:text-brand-700"
      >
        <Ikon namn="tillbaka" className="size-4" />
        Uppgifter
      </Link>

      <Card status={u.lage === "returnerad" ? "danger" : u.lage === "granskas" ? "warn" : undefined}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className={stangd ? "text-h1 text-ink-500 line-through" : "text-h1 text-ink-900"}>{u.title}</h1>
            <Badge ton={LAGE_TON[u.lage]}>{LAGE_ETIKETT[u.lage]}</Badge>
          </div>

          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            <Fakta etikett="Ansvarig">
              {u.assignee_id ? (namn.get(u.assignee_id) ?? "Okänd") : "Ingen — ligger i inkorgen"}
            </Fakta>
            <Fakta etikett="Upplagd av">{namn.get(u.created_by) ?? "Okänd"}</Fakta>
            <Fakta etikett="Frist">
              {u.due_date ? `${fristtext(u.due_date, idag)}${u.due_time ? ` ${u.due_time}` : ""}` : "Ingen"}
            </Fakta>
            <Fakta etikett="Beräknad tid">{tidstext(u.estimate_minutes) ?? "Inte uppskattad"}</Fakta>
            {visaPrioritet(u.priority) && <Fakta etikett="Prioritet">{PRIORITET_ETIKETT[u.priority]}</Fakta>}
          </dl>

          {u.description_md && (
            <div className="border-t border-canvas pt-4">
              <Markdown text={u.description_md} />
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader
              titel="Deluppgifter"
              beskrivning={
                u.delar.length === 0
                  ? "Dela upp uppgiften i steg som går att bocka av var för sig."
                  : `${u.delar.filter((d) => arStangd(d.lage)).length} av ${u.delar.length} klara`
              }
            />
            {u.delar.length > 0 && (
              <ul className="mb-4 flex flex-col">
                {u.delar.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 border-b border-canvas py-2.5 last:border-0">
                    <span
                      aria-hidden
                      className={
                        arStangd(d.lage) ? "size-2 rounded-full bg-ok" : "size-2 rounded-full bg-ink-300"
                      }
                    />
                    <Link
                      href={`/uppgifter/${d.id}`}
                      className={
                        arStangd(d.lage)
                          ? "flex-1 text-body text-ink-300 line-through"
                          : "flex-1 text-body text-ink-900 hover:text-brand-700"
                      }
                    >
                      {d.title}
                    </Link>
                    {d.due_date && <span className="tnum text-small text-ink-500">{fristtext(d.due_date, idag)}</span>}
                  </li>
                ))}
              </ul>
            )}
            {redigerar && !stangd && <Deluppgift foralderId={u.id} />}
          </Card>

          <Card>
            <CardHeader titel="Historik" beskrivning="Ingenting skrivs över. Raderna står kvar." />
            <ol className="flex flex-col">
              {handelser.map((h) => (
                <li key={h.id} className="flex gap-3 border-b border-canvas py-3 last:border-0">
                  <span
                    aria-hidden
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${PRICK[h.type] ?? "bg-ink-300"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-body text-ink-900">
                      {HANDELSE_TEXT[h.type] ?? h.type}{" "}
                      <span className="text-ink-500">— {h.namn}</span>
                    </p>
                    {h.note && <p className="mt-1 text-small whitespace-pre-line text-ink-700">{h.note}</p>}
                    <p className="mt-0.5 text-micro text-ink-300">
                      {h.at.slice(0, 10)} {svenskKlocka(h.at)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-4 border-t border-canvas pt-4">
              <Kommentar id={u.id} />
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader titel="Vad nu?" />
            <Handlingar
              id={u.id}
              lage={u.lage}
              granskare={u.medlemmar.filter((m) => m.role === "granskare").length}
              kanArbeta={redigerar && !stangd}
              kanGranska={granskar}
              kanAvbryta={bjuderIn && !stangd}
              kanAteroppna={redigerar && stangd}
            />
          </Card>

          <Card>
            <CardHeader
              titel="Vilka är med"
              beskrivning={bjuderIn ? "En roll per person." : undefined}
            />
            <ul className="mb-4 flex flex-col gap-2">
              {u.assignee_id && (
                <Medlemsrad namn={namn.get(u.assignee_id) ?? "Okänd"} roll="Ansvarig" />
              )}
              <Medlemsrad namn={namn.get(u.created_by) ?? "Okänd"} roll="La upp den" />
              {u.medlemmar.map((m) => (
                <Medlemsrad
                  key={m.employee_id}
                  namn={m.namn}
                  roll={ROLL_ETIKETT[m.role]}
                  forklaring={ROLL_FORKLARING[m.role]}
                  granskare={m.role === "granskare"}
                />
              ))}
            </ul>
            {bjuderIn && <Inbjudan id={u.id} personer={valbara} nuvarandeAnsvarig={u.assignee_id} />}
          </Card>

          <Card>
            <CardHeader titel="Hör ihop med" />
            {u.kopplingar.length > 0 && (
              <ul className="mb-4 flex flex-col gap-2">
                {u.kopplingar.map((k) => (
                  <li key={k.id} className="flex items-center gap-2">
                    <span className="shrink-0 rounded-full bg-canvas px-2 py-0.5 text-micro text-ink-500">
                      {SLAG_ETIKETT[k.slag] ?? k.slag}
                    </span>
                    {k.href ? (
                      <Link href={k.href} className="truncate text-body text-ink-900 hover:text-brand-700">
                        {k.etikett}
                      </Link>
                    ) : (
                      <span className="truncate text-body text-ink-900">{k.etikett}</span>
                    )}
                    {k.slag === "person" && !k.visible_to_subject && (
                      <span
                        title="Personen ser inte den här uppgiften i navet. Den följer ändå med i hens registerutdrag."
                        className="shrink-0 rounded-full bg-warn-tint px-2 py-0.5 text-micro text-warn-ink"
                      >
                        Dold
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {redigerar && (
              <Kopplingsformular
                id={u.id}
                personer={valbara}
                order={(order ?? []).map((o) => ({ id: o.id as string, namn: o.company_name as string }))}
                arenden={(arenden ?? []).map((a) => ({ id: a.id as string, namn: a.subject as string }))}
                kurser={(kurser ?? []).map((k) => ({ id: k.id as string, namn: k.title as string }))}
                coachning={(coachning ?? []).map((c) => ({ id: c.id as string, namn: c.title as string }))}
              />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Fakta({ etikett, children }: { etikett: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-micro uppercase text-ink-500">{etikett}</dt>
      <dd className="mt-0.5 text-body text-ink-900">{children}</dd>
    </div>
  );
}

function Medlemsrad({
  namn,
  roll,
  forklaring,
  granskare = false,
}: {
  namn: string;
  roll: string;
  forklaring?: string;
  granskare?: boolean;
}) {
  return (
    <li className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <span className="block truncate text-body text-ink-900">{namn}</span>
        {forklaring && <span className="block text-micro text-ink-500">{forklaring}</span>}
      </div>
      <span
        className={
          granskare
            ? "shrink-0 rounded-full bg-brand-tint px-2 py-0.5 text-micro text-brand-ink"
            : "shrink-0 rounded-full bg-canvas px-2 py-0.5 text-micro text-ink-500"
        }
      >
        {roll}
      </span>
    </li>
  );
}

const HANDELSE_TEXT: Record<string, string> = {
  skapad: "Upplagd",
  tilldelad: "Tilldelad",
  paborjad: "Påbörjad",
  inlamnad: "Inlämnad för godkännande",
  godkand: "Godkänd",
  returnerad: "Returnerad",
  klar: "Markerad klar",
  ateroppnad: "Öppnad igen",
  avbruten: "Avbruten",
  kommentar: "Kommentar",
};

const PRICK: Record<string, string> = {
  godkand: "bg-ok",
  klar: "bg-ok",
  returnerad: "bg-danger",
  avbruten: "bg-ink-300",
  inlamnad: "bg-warn",
  paborjad: "bg-info",
};

const SLAG_ETIKETT: Record<string, string> = {
  order: "Order",
  arende: "Ärende",
  person: "Person",
  coachning: "Coachning",
  kurs: "Utbildning",
  dokument: "Rutin",
  kandidat: "Kandidat",
  avtal: "Avtal",
  samtal: "Samtal",
};
