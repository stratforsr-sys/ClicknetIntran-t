import { notFound } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notis } from "@/components/ui/Notis";
import { supabaseServer } from "@/lib/supabase/server";
import { fullName } from "@/lib/auth";
import {
  BEDOMDA_STEG,
  STEG_ETIKETT,
  arOppen,
  dagarSedan,
  liggetid,
  nastaSteg,
  type Steg,
} from "@/lib/rekrytering";
import { flyttaSteg, registreraNoShow, sattTalangpool } from "../actions";
import { Scorecardformular } from "./Scorecardformular";

export const dynamic = "force-dynamic";

const REKOMMENDATION: Record<string, { text: string; ton: "ok" | "warn" | "danger" }> = {
  yes: { text: "Ja", ton: "ok" },
  maybe: { text: "Tveksam", ton: "warn" },
  no: { text: "Nej", ton: "danger" },
};

/**
 * E10. En kandidat.
 *
 * Knapparna ritas ur `nastaSteg()`, men det ar triggern `candidate_stegbyte` i
 * 0030 som avgor. Skulle de glida isar far anvandaren ett felmeddelande i
 * stallet for ett steg som inte borde ga — det ar ratt hall att fela at.
 */
export default async function Kandidatsida({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();

  const { data: k } = await supabase
    .from("candidate")
    // EN strang, inte tva hopslagna med +. Supabase harleder radens typ ur
    // select-litteralen, och en uttryckssats gar den inte att lasa — resultatet
    // blir `GenericStringError` och varje faltatkomst ett typfel.
    .select("id, first_name, last_name, email, phone, role_title, source_slug, stage, stage_at, applied_at, closed_at, rejected_reason, no_show_count, talent_pool, talent_pool_consent, gdpr_purge_at, hired_employee_id")
    .eq("id", id)
    .single();

  // Noll rader betyder antingen "finns inte" eller "du far inte se den". Det ar
  // med flit samma svar (0030) — annars gar det att lista ut vem som sokt jobb
  // genom att prova id:n.
  if (!k) notFound();

  const [{ data: scorecards }, { data: logg }, { data: kallor }, { data: personer }] =
    await Promise.all([
      supabase
        .from("interview_scorecard")
        .select("id, stage, interviewer_id, recommendation, strengths, concerns, created_at")
        .eq("candidate_id", id)
        .order("created_at"),
      supabase
        .from("candidate_stage_event")
        .select("id, from_stage, to_stage, at, by_employee")
        .eq("candidate_id", id)
        .order("at"),
      supabase.from("recruitment_source").select("slug, label"),
      supabase.from("employee").select("id, first_name, last_name"),
    ]);

  const namnPer = new Map((personer ?? []).map((p) => [p.id, fullName(p)]));
  const kallnamn = new Map((kallor ?? []).map((s) => [s.slug, s.label])).get(k.source_slug);
  const steg = k.stage as Steg;
  const vidare = nastaSteg(steg).filter((s) => s !== "rejected" && s !== "hired");
  const kanAvsla = nastaSteg(steg).includes("rejected");
  const dagar = liggetid(k.stage_at);
  const harScorecard = (scorecards ?? []).length > 0;

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <h1 className="text-display text-ink-900">
          {k.first_name} {k.last_name}
        </h1>
        <p className="mt-1 text-body text-ink-500">
          {k.role_title} · {kallnamn ?? k.source_slug} · sökte för{" "}
          {dagarSedan(k.applied_at) ?? 0} dagar sedan
        </p>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <Badge ton={arOppen(steg) ? "info" : steg === "hired" ? "ok" : "neutral"}>
            {STEG_ETIKETT[steg]}
          </Badge>
          {dagar !== null && arOppen(steg) && (
            <span className="text-small text-ink-500">
              på steget i {dagar} {dagar === 1 ? "dag" : "dagar"}
            </span>
          )}
          {k.no_show_count > 0 && (
            <Badge ton="danger">
              Uteblev {k.no_show_count} {k.no_show_count === 1 ? "gång" : "gånger"}
            </Badge>
          )}
          {k.talent_pool && <Badge ton="brand">Talangpool</Badge>}
        </div>

        <dl className="mt-4 flex flex-wrap gap-x-10 gap-y-3 text-small">
          <div>
            <dt className="text-ink-500">E-post</dt>
            <dd className="text-ink-900">{k.email}</dd>
          </div>
          {k.phone && (
            <div>
              <dt className="text-ink-500">Telefon</dt>
              <dd className="tnum text-ink-900">{k.phone}</dd>
            </div>
          )}
        </dl>

        {k.rejected_reason && (
          <p className="mt-4 text-small text-ink-700">Skäl till avslag: {k.rejected_reason}</p>
        )}

        {arOppen(steg) && (
          <div className="mt-6 flex flex-wrap items-center gap-2">
            {vidare.map((till) => (
              <form key={till} action={flyttaSteg}>
                <input type="hidden" name="id" value={k.id} />
                <input type="hidden" name="fran" value={steg} />
                <input type="hidden" name="till" value={till} />
                <Button type="submit">Flytta till {STEG_ETIKETT[till].toLowerCase()}</Button>
              </form>
            ))}

            {/* AC-7.6. Knappen ritas inte forran villkoret gar att uppfylla —
                men det ar triggern som avgor, inte den har raden. */}
            {nastaSteg(steg).includes("offer") && harScorecard && (
              <form action={flyttaSteg}>
                <input type="hidden" name="id" value={k.id} />
                <input type="hidden" name="fran" value={steg} />
                <input type="hidden" name="till" value="offer" />
                <Button type="submit">Ge erbjudande</Button>
              </form>
            )}

            <form action={registreraNoShow}>
              <input type="hidden" name="id" value={k.id} />
              <Button type="submit" variant="sekundar">
                Uteblev från intervju
              </Button>
            </form>

            {kanAvsla && (
              <form action={flyttaSteg} className="flex items-center gap-2">
                <input type="hidden" name="id" value={k.id} />
                <input type="hidden" name="fran" value={steg} />
                <input type="hidden" name="till" value="rejected" />
                <input
                  type="text"
                  name="skal"
                  placeholder="Skäl (valfritt)"
                  className="rounded-sm bg-surface px-3 py-2 text-small text-ink-900 shadow-elev-1 focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
                <Button type="submit" variant="destruktiv">
                  Ge avslag
                </Button>
              </form>
            )}
          </div>
        )}

        {nastaSteg(steg).includes("offer") && !harScorecard && (
          <div className="mt-4">
            <Notis ton="info">
              Ett erbjudande kräver minst en ifylld scorecard (AC-7.6). Fyll i en nedan.
            </Notis>
          </div>
        )}

        {/* E10.9. Steget `hired` gar inte harifran utan flodet — triggern i 0030
            nekar det utan en employee-rad att peka pa. Darfor en lank och ingen
            knapp: det ar en sida med val pa, inte en atgard. */}
        {steg === "offer" && (
          <div className="mt-6">
            <ButtonLink href={`/rekrytering/${k.id}/anstall`} variant="primar">
              Anställ {k.first_name}
            </ButtonLink>
            <p className="mt-2 text-small text-ink-500">
              Konto, roll, rutiner, kurser, avtalsutkast och onboarding-checklista i ett steg.
            </p>
          </div>
        )}

        {steg === "hired" && k.hired_employee_id && (
          <div className="mt-6">
            <ButtonLink href={`/personal/${k.hired_employee_id}`}>Öppna personalkortet</ButtonLink>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-h2 text-ink-900">Scorecards</h2>
        <p className="mt-1 max-w-[70ch] text-small text-ink-500">
          Ett omdöme per intervjuare och steg. Två omdömen som går isär är mer värda än ett
          medelvärde — därför tre lägen och ingen skala.
        </p>

        {(scorecards ?? []).length === 0 ? (
          <div className="mt-4">
            <EmptyState rubrik="Ingen scorecard än" text="Fyll i en efter intervjun." />
          </div>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {(scorecards ?? []).map((s) => {
              const r = REKOMMENDATION[s.recommendation] ?? { text: s.recommendation, ton: "warn" as const };
              return (
                <li key={s.id} className="border-b border-canvas pb-3 last:border-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge ton={r.ton}>{r.text}</Badge>
                    <span className="text-small text-ink-700">
                      {STEG_ETIKETT[s.stage as Steg]}
                    </span>
                    <span className="text-small text-ink-500">
                      {namnPer.get(s.interviewer_id) ?? "okänd"}
                    </span>
                  </div>
                  {s.strengths && <p className="mt-1 text-small text-ink-700">Styrkor: {s.strengths}</p>}
                  {s.concerns && <p className="text-small text-ink-700">Tveksamt: {s.concerns}</p>}
                </li>
              );
            })}
          </ul>
        )}

        {arOppen(steg) && BEDOMDA_STEG.includes(steg) && (
          <div className="mt-6">
            <Scorecardformular id={k.id} steg={steg} />
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-h2 text-ink-900">Talangpool och gallring</h2>
        <p className="mt-1 max-w-[70ch] text-small text-ink-500">
          {k.gdpr_purge_at
            ? `Uppgifterna gallras ${new Date(k.gdpr_purge_at).toLocaleDateString("sv-SE")}.`
            : k.talent_pool
              ? "Kandidaten står i talangpoolen och undantas från gallring (AC-7.8)."
              : "Ingen gallringsfrist är satt. Den är konfiguration och har inte beslutats än — ett påhittat värde hade raderat uppgifter enligt en gissning."}
        </p>

        <form action={sattTalangpool} className="mt-4">
          <input type="hidden" name="id" value={k.id} />
          <input type="hidden" name="pa" value={k.talent_pool ? "0" : "1"} />
          <Button type="submit" variant="sekundar">
            {k.talent_pool ? "Ta ur talangpoolen" : "Lägg i talangpoolen med samtycke"}
          </Button>
        </form>
      </Card>

      <Card className="p-0 md:p-0">
        <div className="px-6 pt-6">
          <h2 className="text-h2 text-ink-900">Stegen</h2>
          <p className="mt-1 text-small text-ink-500">
            Skrivs av databasen vid varje byte och går inte att ändra i efterhand (AC-7.3).
          </p>
        </div>
        <ul className="mt-4 flex flex-col">
          {(logg ?? []).map((h) => (
            <li
              key={h.id}
              className="flex flex-wrap items-center gap-x-4 border-b border-canvas px-6 py-3 last:border-0"
            >
              <time className="tnum w-40 shrink-0 text-small text-ink-500">
                {new Date(h.at).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })}
              </time>
              <span className="flex-1 text-small text-ink-700">
                {h.from_stage
                  ? `${STEG_ETIKETT[h.from_stage as Steg]} → ${STEG_ETIKETT[h.to_stage as Steg]}`
                  : "Kandidaten lades upp"}
              </span>
              <span className="text-small text-ink-500">
                {h.by_employee ? (namnPer.get(h.by_employee) ?? "okänd") : "systemet"}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
