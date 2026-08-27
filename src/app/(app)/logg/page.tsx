import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { supabaseServer } from "@/lib/supabase/server";
import { fullName } from "@/lib/auth";
import { modulNamn, TYPER, TYP_ETIKETT, typFor, type Handelsetyp } from "@/lib/handelselogg";

export const dynamic = "force-dynamic";

/**
 * AC-12.1. Loggen ar lasbar for sales_manager, ceo och admin — RLS avgor.
 *
 * ===========================================================================
 * OMBYGGD 2026-08-27 (E6.1). SIDAN KANDE SJU ACTIONS AV FEMTIOSJU.
 *
 * Kartan har hette HANDELSE och bar `employee.created`, `role.granted` och fem
 * till — M1:s handelser. Allt annat navet loggat sedan dess, femtio actions
 * fran tio moduler, ritades som sin egen rastrang: "commission_period.closed".
 *
 * Det var inte ett skonhetsfel. Ingressen pastod att loggen innehaller
 * "rollforandringar, kontoandringar och offboarding", och den som last det och
 * skrollat forbi trettio obegripliga strangar drar slutsatsen att resten ar
 * skrap — inte att sidan inte hunnit med. En logg man inte tror pa ar ingen
 * logg.
 *
 * Nu gar bade indelningen och modulnamnet genom `src/lib/handelselogg.ts`, som
 * ar den enda platsen dar en action far en betydelse och som
 * `tests/handelselogg.mjs` haller efter. En ny modul syns har utan att nagon
 * ror den har filen — och en modul som INTE registrerats faller provet.
 * ===========================================================================
 */

/**
 * Fargen sager typ, aldrig allvarlighetsgrad. Loggen bedomer ingenting — samma
 * linje som `dagslinje.ts`: en avbildning, inte ett omdome.
 *
 * Undantaget ar utlamnande, som far `warn`. Inte for att det ar fel — det ar
 * det oftast inte — utan for att det ar den enda typen nagon behover kunna
 * hitta med ogat nar fragan ar "vem har sett vad".
 */
const TON: Record<Handelsetyp, "ok" | "warn" | "danger" | "info" | "brand" | "neutral"> = {
  autentisering: "brand",
  behorighet: "info",
  skapande: "neutral",
  andring: "neutral",
  radering: "danger",
  utlamnande: "warn",
  system: "neutral",
};

/**
 * Handelser som ar en hel mening i sig och inte "modul + verb".
 *
 * "Konto inloggning" ar inte svenska. De har far darfor sta fardigskrivna, och
 * listan ar kort med flit — vaxer den forbi en handfull ar det ett tecken pa
 * att namngivningen av actions glidit.
 */
const HELA_MENINGAR: Record<string, string> = {
  "auth.login": "Inloggning",
  "auth.logout": "Utloggning",
  "auth.login_failed": "Misslyckad inloggning",
  "auth.password_changed": "Lösenord bytt",
  "auth.temp_password_set": "Tillfälligt lösenord satt",
  "auth.step2_verified": "Enhet bekräftad",
  "auth.step2_failed": "Fel kod för enheten",
  "auth.step2_forgotten": "Enhet glömd",
  "employee.data_export": "Registerutdrag uttaget",
  "job.night_ok": "Nattjobbet kördes",
  "job.night_partial": "Nattjobbet kördes med fel",
  "error.new": "Fel fångat",
  "time.in": "Instämpling",
  "time.out": "Utstämpling",
  "time.left_open": "Stämpling lämnad öppen",
  "time.auto_closed": "Dag stängd av systemet",
  "time.correction_overdue": "Rättelse över tiden",
};

/**
 * Verbet raknas fram ur andelsen i stallet for att listas per action.
 *
 * Sjuttionio andelser med varsin handskriven svensk mening ar en lista som
 * slutar underhallas vid den attionde. Det som INTE gar att rakna fram far sta
 * som det ar — en lasbar engelsk andelse ar battre an en fel svensk.
 */
const VERB: Record<string, string> = {
  created: "skapad",
  updated: "ändrad",
  deleted: "raderad",
  removed: "borttagen",
  added: "tillagd",
  set: "satt",
  closed: "stängd",
  granted: "tilldelad",
  revoked: "återkallad",
  published: "publicerad",
  archived: "arkiverad",
  unarchived: "återställd",
  drafted: "sparad som utkast",
  issued: "utfärdad",
  withdrawn: "tillbakadragen",
  approved: "godkänd",
  rejected: "avslagen",
  cancelled: "makulerad",
  resolved: "avslutad",
  escalated: "eskalerad",
  assigned: "tilldelad",
  suggested: "föreslagen",
  confirmed: "bekräftad",
  registered: "registrerad",
  requested: "ansökt",
  submitted: "inlämnad",
  acked: "kvitterad",
  reviewed: "granskad",
  certified: "certifierad",
  exported: "exporterad",
  viewed: "öppnad",
  paid: "betald",
  generated: "framtagen",
  entered: "inmatad",
  hired: "anställd",
  calculated: "beräknad",
  status_changed: "statusändrad",
  org_changed: "flyttad i organisationen",
};

function beskriv(action: string): string {
  const fardig = HELA_MENINGAR[action];
  if (fardig) return fardig;

  const andelse = action.split(".").slice(1).join(".");
  const modul = modulNamn(action);
  const verb = VERB[andelse];

  if (verb) return `${modul} ${verb}`;
  return `${modul} · ${andelse.replace(/_/g, " ")}`;
}

export default async function Logg({
  searchParams,
}: {
  searchParams: Promise<{ typ?: string }>;
}) {
  const { typ } = await searchParams;
  const valdTyp = TYPER.includes(typ as Handelsetyp) ? (typ as Handelsetyp) : null;

  const supabase = await supabaseServer();

  // En vag, inte tva. Ingen av fragorna behover svaret fran den andra.
  const [{ data: rader }, { data: personer }] = await Promise.all([
    supabase
      .from("audit_log")
      .select("id, action, object_type, object_id, ts, reason, meta, actor_id")
      .order("ts", { ascending: false })
      .limit(400),
    supabase.from("employee").select("id, first_name, last_name"),
  ]);

  const namnPer = new Map((personer ?? []).map((p) => [p.id, fullName(p)]));

  /**
   * Filtret raknas i minnet och inte i fragan.
   *
   * Typen finns inte som kolumn — den ar en tolkning av `action`, och den
   * tolkningen bor pa ETT stalle. Ett `like`-filter i SQL:en hade blivit ett
   * andra svar pa samma fraga, och det ar alltid det slappare som overlever
   * nar de glider isar.
   */
  const alla = (rader ?? []).map((r) => ({ ...r, typ: typFor(r.action) }));
  const visade = valdTyp ? alla.filter((r) => r.typ === valdTyp) : alla;

  const antalPerTyp = new Map<Handelsetyp, number>();
  for (const r of alla) if (r.typ) antalPerTyp.set(r.typ, (antalPerTyp.get(r.typ) ?? 0) + 1);

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <h1 className="text-display text-ink-900">Händelselogg</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Sju typer av händelser: inloggning, behörighet, nytt registrerat, ändring, radering,
          utlämnande och systemhändelser. Loggen skrivs av systemet och kan inte ändras i efterhand.
        </p>
      </div>

      {/* Filtret star som lankar och inte som en klientkomponent: en logg ska
          ga att djuplanka till och skicka vidare. */}
      <nav aria-label="Filtrera på händelsetyp" className="flex flex-wrap gap-2">
        <Filterlank href="/logg" aktiv={valdTyp === null} text={`Alla (${alla.length})`} />
        {TYPER.map((t) => (
          <Filterlank
            key={t}
            href={`/logg?typ=${t}`}
            aktiv={valdTyp === t}
            text={`${TYP_ETIKETT[t].rubrik} (${antalPerTyp.get(t) ?? 0})`}
          />
        ))}
      </nav>

      {valdTyp && (
        <p className="max-w-[70ch] text-small text-ink-500">{TYP_ETIKETT[valdTyp].beskrivning}</p>
      )}

      <Card className="p-0 md:p-0">
        {visade.length === 0 ? (
          <div className="p-6">
            <EmptyState
              rubrik={valdTyp ? "Inget loggat av den typen" : "Inget loggat än"}
              text={
                valdTyp
                  ? "Ingen händelse av den här typen finns bland de senaste raderna."
                  : "Så fort någon loggar in, läggs upp, får en roll eller avslutas hamnar det här."
              }
            />
          </div>
        ) : (
          <ul className="flex flex-col">
            {visade.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-canvas px-6 py-4 last:border-0"
              >
                <time className="tnum w-40 shrink-0 text-small text-ink-500">
                  {new Date(r.ts).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })}
                </time>
                <Badge ton={r.typ ? TON[r.typ] : "neutral"}>{beskriv(r.action)}</Badge>
                <span className="flex-1 text-small text-ink-700">
                  {namnPer.get(String(r.object_id)) ?? r.object_id}
                  {r.meta && typeof r.meta === "object" && "roll" in r.meta
                    ? ` · ${(r.meta as { roll: string }).roll}`
                    : ""}
                </span>
                <span className="text-small text-ink-500">
                  av {r.actor_id ? (namnPer.get(r.actor_id) ?? "okänd") : "systemet"}
                </span>
                {r.reason && <p className="w-full text-small text-ink-500">Motivering: {r.reason}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Filterlank({ href, aktiv, text }: { href: string; aktiv: boolean; text: string }) {
  return (
    <Link
      href={href}
      aria-current={aktiv ? "page" : undefined}
      className={
        aktiv
          ? "rounded-sm bg-brand-600 px-3 py-1.5 text-small text-white"
          : "rounded-sm bg-surface-alt px-3 py-1.5 text-small text-ink-700 transition-colors duration-fast hover:text-brand-700"
      }
    >
      {text}
    </Link>
  );
}
