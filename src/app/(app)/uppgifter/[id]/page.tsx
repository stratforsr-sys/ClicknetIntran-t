import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Markdown } from "@/components/Markdown";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { svenskKlocka } from "@/lib/klocka";
import {
  LAGE_ETIKETT,
  ROLL_ETIKETT,
  ROLL_FORKLARING,
  arStangd,
  farBjudaIn,
  farGranska,
  farRedigera,
  fristtext,
  type Krets,
  type Lage,
} from "@/lib/uppgifter";
import { hamtaUppgift } from "@/lib/uppgifter-server";
import { Bock } from "../Bock";
import { Egenskaper } from "./Egenskaper";
import { Handlingar, Inbjudan, Kopplingsformular, Kommentar, Deluppgift } from "./Handlingar";

export const dynamic = "force-dynamic";

/**
 * En uppgift.
 *
 * ===========================================================================
 * HANDLINGEN LIGGER ÖVERST, INTE I EN SPALT LÄNGRE NER
 *
 * Första utkastet la "Vad nu?" i ett kort i högerspalten, under fakta och
 * inbjudna. Det var fel ordning på en sida vars enda uppgift är att driva något
 * framåt: den knapp man kom hit för att trycka på låg under vikningen på en
 * bärbar skärm, och på telefon efter allt annat.
 *
 * Nu bär TOPPKORTET hela arbetsflödet — rubrik, läge, egenskaper och knappen —
 * och resten av sidan är sammanhang man läser när man vill. Ordningen svarar på
 * frågorna i den takt de faktiskt ställs: vad är det, hur ligger det till, vad
 * gör jag nu, och först därefter vem mer är med.
 *
 * ----------------------------------------------------------------------------
 * SIDAN RITAR BARA DET DEN INLOGGADE FÅR GÖRA
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

  const { uppgift: u, handelser, namn, projekt } = svar;
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
  const granskare = u.medlemmar.filter((m) => m.role === "granskare");

  const idag = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());
  const mittProjekt = projekt.find((p) => p.id === u.project_id) ?? null;

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

  const klaraDelar = u.delar.filter((d) => arStangd(d.lage)).length;

  return (
    <div className="flex flex-col gap-4 pt-2">
      {/* Brödsmulan säger var man är OCH tar en tillbaka. Ligger projektet
          emellan står det med — det är den vägen man kom, och den man vill
          tillbaka till när uppgiften är avbockad. */}
      <nav aria-label="Var du är" className="flex flex-wrap items-center gap-1.5 text-small text-ink-500">
        <Link href="/uppgifter" className="transition-colors duration-fast hover:text-brand-700">
          Uppgifter
        </Link>
        {mittProjekt && (
          <>
            <Ikon namn="tillbaka" className="size-3 rotate-180 text-ink-300" />
            <Link
              href={`/uppgifter/projekt/${mittProjekt.id}`}
              className="transition-colors duration-fast hover:text-brand-700"
            >
              {mittProjekt.name}
            </Link>
          </>
        )}
      </nav>

      {/* ===================== ARBETSKORTET ===================== */}
      <Card status={KANT[u.lage]}>
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              {redigerar && !stangd && <Bock id={u.id} lage={u.lage} granskare={granskare.length} />}
              <h1 className={stangd ? "text-h1 text-ink-500 line-through" : "text-h1 text-ink-900"}>{u.title}</h1>
            </div>
            <Lagesmarke lage={u.lage} />
          </div>

          <Egenskaper
            id={u.id}
            title={u.title}
            descriptionMd={u.description_md}
            assigneeId={u.assignee_id}
            assigneeNamn={u.assignee_id ? (namn.get(u.assignee_id) ?? "Okänd") : null}
            dueDate={u.due_date}
            dueTime={u.due_time}
            startsOn={u.starts_on}
            estimateMinutes={u.estimate_minutes}
            priority={u.priority}
            projectId={u.project_id}
            projektNamn={mittProjekt?.name ?? null}
            personer={valbara}
            projekt={projekt.filter((p) => !p.archived_at).map((p) => ({ id: p.id, namn: p.name }))}
            idag={idag}
            kanAndra={redigerar}
          />

          {/* NÄSTA STEG I EN MENING, före knapparna. Den som landar här mitt i
              ett godkännandeflöde ska slippa härleda läget ur vilka knappar som
              råkar finnas. */}
          <div className="border-t border-canvas pt-4">
            <p className="mb-3 text-body text-ink-700">
              {nastaSteg(u.lage, granskare.length, granskar, redigerar, namn.get(u.assignee_id ?? "") ?? null)}
            </p>
            <Handlingar
              id={u.id}
              lage={u.lage}
              granskare={granskare.length}
              kanArbeta={redigerar && !stangd}
              kanGranska={granskar}
              kanAvbryta={bjuderIn && !stangd}
              kanAteroppna={redigerar && stangd}
            />
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {u.description_md && (
            <Card>
              <CardHeader titel="Beskrivning" />
              <Markdown text={u.description_md} />
            </Card>
          )}

          <Card>
            <CardHeader
              titel="Deluppgifter"
              beskrivning={
                u.delar.length === 0
                  ? "Dela upp uppgiften i steg som går att bocka av var för sig."
                  : `${klaraDelar} av ${u.delar.length} klara`
              }
            />

            {u.delar.length > 0 && (
              <>
                {/* Mätaren är liten med flit: den svarar på "hur långt har vi
                    kommit" utan att konkurrera med raderna under. */}
                <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-canvas">
                  <div
                    className="h-full rounded-full bg-brand-500 transition-[width] duration-fast"
                    style={{ width: `${Math.round((klaraDelar / u.delar.length) * 100)}%` }}
                  />
                </div>

                <ul className="mb-4 flex flex-col">
                  {u.delar.map((d) => (
                    <li
                      key={d.id}
                      className="group flex items-center gap-2 border-b border-canvas py-1.5 last:border-0"
                    >
                      {/* Bocken direkt i listan. Att behöva öppna varje steg för
                          att kryssa av det gör checklistan till ett hinder. */}
                      <Bock id={d.id} lage={d.lage} granskare={0} liten />
                      <Link
                        href={`/uppgifter/${d.id}`}
                        className={
                          arStangd(d.lage)
                            ? "flex-1 text-body text-ink-300 line-through"
                            : "flex-1 text-body text-ink-900 transition-colors duration-fast group-hover:text-brand-700"
                        }
                      >
                        {d.title}
                      </Link>
                      {d.due_date && (
                        <span className="tnum shrink-0 text-small text-ink-500">{fristtext(d.due_date, idag)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {redigerar && !stangd && <Deluppgift foralderId={u.id} />}
          </Card>

          <Card>
            <CardHeader titel="Historik" beskrivning="Ingenting skrivs över. Raderna står kvar." />
            <ol className="flex flex-col">
              {handelser.map((h) => (
                <li key={h.id} className="flex gap-3 border-b border-canvas py-3 last:border-0">
                  <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${PRICK[h.type] ?? "bg-ink-300"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-body text-ink-900">
                      {HANDELSE_TEXT[h.type] ?? h.type} <span className="text-ink-500">— {h.namn}</span>
                    </p>
                    {h.note && (
                      <p
                        className={
                          h.type === "returnerad"
                            ? "mt-1 rounded-sm bg-danger-tint px-3 py-2 text-small whitespace-pre-line text-danger-ink"
                            : "mt-1 text-small whitespace-pre-line text-ink-700"
                        }
                      >
                        {h.note}
                      </p>
                    )}
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
            <CardHeader titel="Vilka är med" beskrivning={bjuderIn ? "En roll per person." : undefined} />
            <ul className="mb-4 flex flex-col gap-2.5">
              {u.assignee_id && <Medlemsrad namn={namn.get(u.assignee_id) ?? "Okänd"} roll="Ansvarig" />}
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
            <CardHeader titel="Hör ihop med" beskrivning={u.kopplingar.length === 0 ? "Inget kopplat än." : undefined} />
            {u.kopplingar.length > 0 && (
              <ul className="mb-4 flex flex-col gap-2">
                {u.kopplingar.map((k) => (
                  <li key={k.id} className="flex items-center gap-2">
                    <span className="shrink-0 rounded-full bg-canvas px-2 py-0.5 text-micro text-ink-500">
                      {SLAG_ETIKETT[k.slag] ?? k.slag}
                    </span>
                    {k.href ? (
                      <Link
                        href={k.href}
                        className="truncate text-body text-ink-900 transition-colors duration-fast hover:text-brand-700"
                      >
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

/**
 * Nästa steg, i en mening.
 *
 * TEXTEN ÄR SKRIVEN TILL DEN SOM LÄSER DEN, inte om uppgiften. "Väntar på
 * godkännande" är ett tillstånd; "Anna har lämnat in den — du kan godkänna
 * eller skicka tillbaka" säger vad just du ska göra. Skillnaden är hela
 * anledningen till att raden finns ovanför knapparna i stället för att bara
 * upprepa lägesmärket.
 */
function nastaSteg(
  lage: Lage,
  granskare: number,
  jagGranskar: boolean,
  jagArbetar: boolean,
  ansvarig: string | null,
): string {
  if (lage === "klar") return "Klar. Öppna den igen om något visade sig återstå.";
  if (lage === "avbruten") return "Avbruten. Den räknas inte längre som något som ska göras.";

  if (lage === "granskas") {
    if (jagGranskar) return `${ansvarig ?? "Någon"} har lämnat in den. Godkänn, eller skicka tillbaka med ett skäl.`;
    return granskare === 1
      ? "Inlämnad. Granskaren tar ställning härnäst."
      : "Inlämnad. Det räcker att en av granskarna godkänner.";
  }

  if (lage === "returnerad") {
    return jagArbetar
      ? "Skickad tillbaka. Läs skälet i historiken, gör om, och lämna in igen."
      : "Skickad tillbaka till den ansvariga.";
  }

  if (!jagArbetar) return "Du följer den här uppgiften men driver den inte.";

  if (granskare > 0) {
    return lage === "pagar"
      ? "Igång. När du är klar lämnar du in den för godkännande."
      : "Sätt igång när du vill. Den räknas som klar först när en granskare godkänt den.";
  }

  return lage === "pagar"
    ? "Igång. Bocka av den med ringen vid rubriken när den är gjord."
    : "Inte påbörjad än. Bocka av den med ringen vid rubriken när den är gjord.";
}

/** Kortets vänsterkant. Bara lägen som kräver något av någon får färg. */
const KANT: Record<Lage, "danger" | "warn" | "info" | "ok" | undefined> = {
  ej_paborjad: undefined,
  pagar: "info",
  granskas: "warn",
  returnerad: "danger",
  klar: "ok",
  avbruten: undefined,
};

function Lagesmarke({ lage }: { lage: Lage }) {
  const TON: Record<Lage, string> = {
    ej_paborjad: "bg-canvas text-ink-500",
    pagar: "bg-info-tint text-info-ink",
    granskas: "bg-warn-tint text-warn-ink",
    returnerad: "bg-danger-tint text-danger-ink",
    klar: "bg-ok-tint text-ok-ink",
    avbruten: "bg-canvas text-ink-500",
  };

  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-micro uppercase ${TON[lage]}`}>
      {LAGE_ETIKETT[lage]}
    </span>
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
