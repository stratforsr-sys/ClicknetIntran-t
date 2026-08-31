import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notis } from "@/components/ui/Notis";
import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentUser, fullName, hasRole } from "@/lib/auth";
import {
  SORT_ETIKETT,
  STATUS_ETIKETT,
  rubrikFor,
  sorteraKo,
  type Felsort,
  type Felstatus,
} from "@/lib/fel";
import { hamtaDrift, type Drift } from "@/lib/jobb/drift-server";
import { DRIFT_ETIKETT, MAX_TIMMAR } from "@/lib/jobb/larm";
import { sattStatus } from "./actions";
import { GuideVard } from "@/components/guide/GuideVard";

export const dynamic = "force-dynamic";

const STATUSTON: Record<Felstatus, "danger" | "warn" | "ok"> = {
  new: "danger",
  ack: "warn",
  closed: "ok",
};

/**
 * E0.6. Kon.
 *
 * RLS avgor vad som syns (0026): sales_manager, ceo och admin ser allt, och
 * alla andra ser sina egna rapporter. Sidan har darfor INGET eget
 * rollfilter pa fragan — det hade blivit ett andra svar pa samma fraga, och
 * det ar alltid det slappare som overlever nar de glider isar.
 *
 * Det som beror rollen ar bara vad sidan HETER och vilka knappar som ritas.
 */
/**
 * E0.7. Driftkortet.
 *
 * ===========================================================================
 * VARFOR KONTROLLEN INTE AR EN ANDRA CRON
 *
 * En cron som vaktar cron dor samma dod. Det var precis det som hande: tre
 * cron-poster deklarerades, planen tar tva, ingen av dem kordes, och en
 * instampling stod oppen i tva dygn utan att nagon markte det. En vaktpost hade
 * varit tyst genom hela det forloppet — den hade inte kort heller.
 *
 * Den enda observator som ar oberoende av att cron fungerar ar en manniska som
 * oppnar en sida. Darfor sitter kontrollen har och pa startsidan, och darfor
 * anvands INTE den lediga cron-slotten. `vercel.json` ror vi inte.
 *
 * Kon ar larmets naturliga hem. Tomma laget pa den har sidan sager redan
 * "kontrollera att felrapporteringen fungerar innan du litar pa tystnaden" —
 * kortet ar svaret pa den meningen.
 * ===========================================================================
 */
function Driftkort({ drift }: { drift: Drift }) {
  const { besked, kvitto } = drift;
  const gront = besked.lage === "ok" && (kvitto?.helt ?? false);

  return (
    <Card status={besked.lage === "ok" ? (gront ? "ok" : "warn") : "danger"}>
      <CardHeader
        titel="Nattjobbet"
        beskrivning="Körs 02:30 och lämnar ett kvitto i händelseloggen. Kortet läser kvittot — det är ingen körning."
        handling={
          <Badge ton={gront ? "ok" : besked.lage === "ok" ? "warn" : "danger"}>
            {gront ? "Grönt" : besked.lage === "ok" ? "Kördes, men inte helt" : "Larmar"}
          </Badge>
        }
      />

      <p className="text-body text-ink-900">{DRIFT_ETIKETT[besked.lage]}</p>

      {kvitto ? (
        <dl className="mt-4 flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-small text-ink-500">Senast kört</dt>
            <dd className="tnum text-body text-ink-900">
              {new Date(kvitto.ts).toLocaleString("sv-SE", {
                dateStyle: "short",
                timeStyle: "short",
              })}
              {besked.timmar !== null && (
                <span className="text-ink-500"> · för {besked.timmar} timmar sedan</span>
              )}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-small text-ink-500">Stegen</dt>
            <dd className="text-body text-ink-900">
              {kvitto.fallnaSteg.length === 0
                ? "Alla sex gick igenom"
                : `${kvitto.fallnaSteg.length} föll: ${kvitto.fallnaSteg.join(", ")}`}
            </dd>
          </div>
          {kvitto.sekunder !== null && (
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-small text-ink-500">Körtid</dt>
              <dd className="tnum text-body text-ink-900">{kvitto.sekunder} s</dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="mt-3 max-w-[70ch] text-small text-ink-500">
          Det finns inget kvitto alls i händelseloggen. Antingen har jobbet aldrig kört, eller så
          kör cron-posten inte. Kontrollera <code className="rounded-sm bg-surface-alt px-1.5 py-0.5">vercel.json</code> och
          körningarna i Vercels panel.
        </p>
      )}

      {besked.lage === "forsenat" && (
        <p className="mt-4 max-w-[70ch] text-small text-ink-700">
          Gränsen är {MAX_TIMMAR} timmar: ett dygn mellan körningarna plus två timmars slack. Att
          den passerats betyder att minst en natt hoppats över — stämplingar har inte stängts,
          ärenden inte eskalerats och sena ankomster inte registrerats för den natten.
        </p>
      )}

      {gront && (
        <p className="mt-4 max-w-[70ch] text-small text-ink-500">
          Jobbet larmar självt om ett steg faller, och de larmen hamnar i kön nedan. Kortet finns
          för det jobbet inte kan säga något om: att det inte kört alls.
        </p>
      )}
    </Card>
  );
}

export default async function Felkon({
  searchParams,
}: {
  searchParams: Promise<{ tack?: string }>;
}) {
  const { tack } = await searchParams;
  const user = await getCurrentUser();
  const hanterar = hasRole(user, "sales_manager", "ceo", "admin");

  const supabase = await supabaseServer();

  // En vag, inte tre. Ingen av fragorna behover svaret fran nagon annan.
  const [{ data: rader }, { data: personer }, drift] = await Promise.all([
    supabase
      .from("error_report")
      // En enda strang och inte hopfogad med +: PostgREST-typerna lases ur
      // literalen, och en hopfogning gor att TypeScript tappar hela radtypen.
      .select(
        "id, kind, digest, path, message, body, blocking, occurrences, first_seen_at, last_seen_at, status, reporter_id, handled_by, release, resolution",
      )
      .order("last_seen_at", { ascending: false })
      .limit(200),

    supabase.from("employee").select("id, first_name, last_name"),

    /**
     * E0.7 driftkortet. Med anvandarens EGEN token — `audit_log_read` slapper
     * in sales_manager, ceo och admin, alltsa exakt kretsen `hanterar`.
     *
     * Fragan stalls bara for den kretsen, och det ar inte ett andra
     * rollfilter: RLS ger noll rader at alla andra anda. Skalet ar att noll
     * rader annars betyder tva olika saker — "jobbet har aldrig kort" och "du
     * far inte se handelseloggen" — och saljaren hade fatt se det forsta
     * beskedet nar det andra var sant.
     */
    hanterar ? hamtaDrift(supabase) : Promise.resolve(null),
  ]);

  const namnPer = new Map((personer ?? []).map((p) => [p.id, fullName(p)]));

  const ko = sorteraKo(
    (rader ?? []).map((r) => ({
      ...r,
      kind: r.kind as Felsort,
      status: r.status as Felstatus,
    })),
  );

  const oatgardade = ko.filter((r) => r.status !== "closed").length;

  return (
    <div className="flex flex-col gap-4 pt-2">
      <GuideVard slug="rapportera-fel" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div data-guide="fel.rubrik">
          <h1 className="text-display text-ink-900">{hanterar ? "Fel och rapporter" : "Mina felrapporter"}</h1>
          <p className="mt-1 max-w-[70ch] text-body text-ink-500">
            {hanterar
              ? "Det navet fångat självt och det människor skrivit in. Ett fel som träffat flera personer är en rad med en räknare, inte en rad per gång."
              : "Det du rapporterat, och vad som hänt med det sedan."}
          </p>
        </div>
        <div data-guide="fel.rapportera">
          <ButtonLink href="/fel/nytt" variant="primar">
            Rapportera fel
          </ButtonLink>
        </div>
      </div>

      {tack && (
        <Notis ton="ok">
          Tack. Rapporten ligger i kön och du ser den nedan så länge den är öppen.
        </Notis>
      )}

      {drift && <Driftkort drift={drift} />}

      {hanterar && oatgardade > 0 && (
        <p className="text-small text-ink-500">
          {oatgardade} {oatgardade === 1 ? "rad" : "rader"} är inte avslutade.
        </p>
      )}

      <Card className="p-0 md:p-0">
        {ko.length === 0 ? (
          <div className="p-6">
            <EmptyState
              rubrik={hanterar ? "Inga fel registrerade" : "Du har inte rapporterat något"}
              text={
                hanterar
                  ? "Navet skriver hit själv när en sida går sönder. Tomt är i det här fallet ett gott tecken — men kontrollera att felrapporteringen fungerar innan du litar på tystnaden."
                  : "Stöter du på något som inte fungerar är det här du berättar det."
              }
              handling={<ButtonLink href="/fel/nytt">Rapportera fel</ButtonLink>}
            />
          </div>
        ) : (
          <ul className="flex flex-col">
            {ko.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 border-b border-canvas px-6 py-4 last:border-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Badge ton={STATUSTON[r.status]}>{STATUS_ETIKETT[r.status]}</Badge>
                  <Badge ton={r.kind === "manual" ? "brand" : "neutral"}>
                    {SORT_ETIKETT[r.kind]}
                  </Badge>
                  {r.blocking && <Badge ton="danger">Stoppade arbetet</Badge>}
                  {r.occurrences > 1 && (
                    <span className="tnum text-small text-ink-500">{r.occurrences} gånger</span>
                  )}
                  <time className="tnum ml-auto text-small text-ink-500">
                    {new Date(r.last_seen_at).toLocaleString("sv-SE", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </time>
                </div>

                <p className="text-body text-ink-900">{rubrikFor(r)}</p>

                <p className="flex flex-wrap gap-x-4 text-small text-ink-500">
                  <span>
                    <code className="rounded-sm bg-surface-alt px-2 py-0.5">{r.path}</code>
                  </span>
                  {r.reporter_id && <span>{namnPer.get(r.reporter_id) ?? "okänd"}</span>}
                  {r.digest && <span className="tnum">felkod {r.digest.slice(0, 12)}</span>}
                  {r.release && <span className="tnum">version {r.release}</span>}
                </p>

                {/*
                  Den maskerade feltexten visas bara for den som ska laga den.
                  Rapportoren ser sin egen text ovan och behover inte se navets
                  innanmate — det ar inte hemligt, det ar bara inte till henne.
                */}
                {hanterar && r.kind === "manual" && r.body && (
                  <p className="max-w-[80ch] whitespace-pre-wrap text-small text-ink-700">{r.body}</p>
                )}
                {hanterar && r.message && (
                  <pre className="max-w-full overflow-x-auto rounded-sm bg-surface-alt p-3 text-micro text-ink-700">
                    {r.message}
                  </pre>
                )}

                {r.resolution && (
                  <p className="text-small text-ink-700">
                    Svar: {r.resolution}
                    {r.handled_by && ` — ${namnPer.get(r.handled_by) ?? "okänd"}`}
                  </p>
                )}

                {hanterar && (
                  <div className="mt-1 flex flex-wrap gap-2">
                    {r.status !== "ack" && (
                      <form action={sattStatus}>
                        <input type="hidden" name="fel_id" value={r.id} />
                        <input type="hidden" name="status" value="ack" />
                        <Button type="submit" variant="sekundar" size="sm">
                          Tittar på den
                        </Button>
                      </form>
                    )}
                    {r.status !== "closed" && (
                      <form action={sattStatus}>
                        <input type="hidden" name="fel_id" value={r.id} />
                        <input type="hidden" name="status" value="closed" />
                        <Button type="submit" variant="sekundar" size="sm">
                          Avsluta
                        </Button>
                      </form>
                    )}
                    {r.status === "closed" && (
                      <form action={sattStatus}>
                        <input type="hidden" name="fel_id" value={r.id} />
                        <input type="hidden" name="status" value="new" />
                        <Button type="submit" variant="diskret" size="sm">
                          Öppna igen
                        </Button>
                      </form>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
