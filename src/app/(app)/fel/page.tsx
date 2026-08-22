import { Card } from "@/components/ui/Card";
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
import { sattStatus } from "./actions";

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
export default async function Felkon({
  searchParams,
}: {
  searchParams: Promise<{ tack?: string }>;
}) {
  const { tack } = await searchParams;
  const user = await getCurrentUser();
  const hanterar = hasRole(user, "sales_manager", "ceo", "admin");

  const supabase = await supabaseServer();
  const { data: rader } = await supabase
    .from("error_report")
    // En enda strang och inte hopfogad med +: PostgREST-typerna lases ur
    // literalen, och en hopfogning gor att TypeScript tappar hela radtypen.
    .select(
      "id, kind, digest, path, message, body, blocking, occurrences, first_seen_at, last_seen_at, status, reporter_id, handled_by, release, resolution",
    )
    .order("last_seen_at", { ascending: false })
    .limit(200);

  const { data: personer } = await supabase.from("employee").select("id, first_name, last_name");
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-display text-ink-900">{hanterar ? "Fel och rapporter" : "Mina felrapporter"}</h1>
          <p className="mt-1 max-w-[70ch] text-body text-ink-500">
            {hanterar
              ? "Det navet fångat självt och det människor skrivit in. Ett fel som träffat flera personer är en rad med en räknare, inte en rad per gång."
              : "Det du rapporterat, och vad som hänt med det sedan."}
          </p>
        </div>
        <ButtonLink href="/fel/nytt" variant="primar">
          Rapportera fel
        </ButtonLink>
      </div>

      {tack && (
        <Notis ton="ok">
          Tack. Rapporten ligger i kön och du ser den nedan så länge den är öppen.
        </Notis>
      )}

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
