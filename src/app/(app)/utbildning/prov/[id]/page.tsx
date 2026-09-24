import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Notis } from "@/components/ui/Notis";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser, fullName, hasRole } from "@/lib/auth";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { ordrakning } from "@/lib/prov";
import { Rattning, type Rattningsfraga } from "./Rattning";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rätta prov — Clicknet Nav" };

/**
 * 0067: ett prov, fraga for fraga.
 *
 * RATTARSTODET (`essay_question.guidance`) LASES MED SERVICE ROLE och skickas
 * bara hit — till den som rattar. Det ar samma kolumn som ar osynlig for den
 * som skriver provet, och skalet ar att den sager vad ett fullpoangssvar
 * innehaller. Tabellen ar stangd for varje klientroll; det ar servern som
 * avgor vem som far se vad, inte vyn.
 */
export default async function Rattasida({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");
  if (!hasRole(user, "sales_manager", "team_lead", "admin", "ceo")) redirect("/utbildning");

  const supabase = await supabaseServer();
  const db = supabaseAdmin();

  const { data: inlamning } = await supabase
    .from("essay_submission")
    .select(
      `id, module_id, course_id, employee_id, status, submitted_at, graded_at, graded_by, attempt_id,
       course_module(title),
       course(title, slug, pass_threshold)`,
    )
    .eq("id", id)
    .maybeSingle();

  // Den som inte far se provet far 404 och inte "nekad" — samma monster som
  // resten av M6.
  if (!inlamning) notFound();

  const kurs = inlamning.course as unknown as { title: string; slug: string; pass_threshold: number } | null;
  const modul = inlamning.course_module as unknown as { title: string } | null;

  const [{ data: fragor }, { data: svaren }, { data: returer }, { data: person }] =
    await Promise.all([
      db
        .from("essay_question")
        .select("id, sort, prompt, guidance, max_points")
        .eq("module_id", inlamning.module_id)
        .order("sort"),
      supabase
        .from("essay_answer")
        .select("question_id, body, points, comment")
        .eq("submission_id", inlamning.id),
      supabase
        .from("essay_return")
        .select("note, returned_at, returned_by")
        .eq("submission_id", inlamning.id)
        .order("returned_at", { ascending: false }),
      db
        .from("employee")
        .select("id, first_name, last_name")
        .eq("id", inlamning.employee_id)
        .maybeSingle(),
    ]);

  const { data: attempt } = inlamning.attempt_id
    ? await supabase
        .from("course_attempt")
        .select("score, passed, note, created_at")
        .eq("id", inlamning.attempt_id)
        .maybeSingle()
    : { data: null };

  const svarPer = new Map((svaren ?? []).map((s) => [s.question_id, s]));

  const rader: Rattningsfraga[] = (fragor ?? []).map((f) => {
    const s = svarPer.get(f.id);
    return {
      id: f.id,
      sort: f.sort,
      prompt: f.prompt,
      guidance: f.guidance,
      max_points: f.max_points,
      svar: s?.body ?? "",
      poang: s?.points ?? null,
      kommentar: s?.comment ?? null,
    };
  });

  const egetProv = inlamning.employee_id === user.employee.id;
  const rattad = inlamning.status === "rattad";
  const ord = rader.reduce((s, r) => s + ordrakning(r.svar), 0);

  return (
    <div className="flex max-w-[64rem] flex-col gap-4 pt-2">
      <Link
        href="/utbildning/prov"
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        Alla skriftliga prov
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-micro uppercase text-ink-500">
            {kurs?.title ?? "Kurs"} · {modul?.title ?? "Modul"}
          </p>
          <h1 className="mt-1 text-display text-ink-900">
            {person ? fullName(person) : "Okänd"}
          </h1>
          <p className="mt-1 text-small text-ink-500">
            {inlamning.submitted_at
              ? `Inlämnat ${inlamning.submitted_at.slice(0, 10)}`
              : "Inte inlämnat"}{" "}
            · {rader.length} frågor · {ord} ord
          </p>
        </div>
        {rattad && attempt ? (
          <div className="flex items-center gap-2">
            <span className="tnum text-h2 text-ink-900">{attempt.score} %</span>
            <Badge ton={attempt.passed ? "ok" : "danger"}>
              {attempt.passed ? "Godkänt" : "Underkänt"}
            </Badge>
          </div>
        ) : (
          <Badge ton={inlamning.status === "retur" ? "neutral" : "warn"}>
            {inlamning.status === "retur" ? "Hos säljaren" : "Att rätta"}
          </Badge>
        )}
      </div>

      {egetProv && !rattad && (
        <Notis ton="info">
          Det här är ditt eget prov. Du kan läsa det, men någon annan i säljledningen sätter
          betyget — ett prov man rättat själv säger ingenting om någon annan än en själv.
        </Notis>
      )}

      {(returer ?? []).length > 0 && (
        <Card>
          <h2 className="text-h2 text-ink-900">Skickat tillbaka tidigare</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {(returer ?? []).map((r) => (
              <li key={r.returned_at} className="border-l-[3px] border-l-warn pl-3">
                <p className="text-micro uppercase text-ink-500">{r.returned_at.slice(0, 10)}</p>
                <p className="mt-1 whitespace-pre-line text-small text-ink-700">{r.note}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-small text-ink-500">
            Svaren som stod i provet vid varje retur ligger kvar i databasen — det säljaren skrev
            först skrivs aldrig över.
          </p>
        </Card>
      )}

      {rattad ? (
        /* `attempt` KAN vara null pa en rattad rad: `course_attempt` far
           `on delete set null`, sa ett rensat forsok lamnar inlamningen kvar.
           Vyn ska da visa svaren och poangen anda — inte falla tillbaka till
           rattningsformularet, som hade bjudit in till att satta betyg en gang
           till pa nagot som redan ar bokfort. */
        <Fardigrattat
          rader={rader}
          aterkoppling={attempt?.note ?? null}
          grans={kurs?.pass_threshold ?? 80}
        />
      ) : inlamning.status === "retur" ? (
        <Card>
          <Notis ton="info">
            Provet ligger hos säljaren för komplettering. Det kommer tillbaka till kön när han
            lämnat in det igen — dina kommentarer står kvar vid varje fråga så länge.
          </Notis>
          <div className="mt-4">
            <Fardigrattat rader={rader} aterkoppling={null} grans={kurs?.pass_threshold ?? 80} />
          </div>
        </Card>
      ) : egetProv ? (
        /* EGET PROV = LASLAGE, inte ett utgraat formular.
           Forsta versionen renderade rattningsvyn med varenda knapp och varje
           kommentarfalt `disabled`. Det ar det samsta av tva varldar: sidan ser
           ut att vara till for en, och svarar inte. Ett formular som inte gar
           att anvanda ska inte ritas — beskedet ovanfor ar hela svaret. */
        <Fardigrattat rader={rader} aterkoppling={null} grans={kurs?.pass_threshold ?? 80} />
      ) : (
        <Rattning id={inlamning.id} fragor={rader} grans={kurs?.pass_threshold ?? 80} />
      )}
    </div>
  );
}

/** Ett rattat (eller returnerat) prov: svaren, poangen och kommentarerna. */
function Fardigrattat({
  rader,
  aterkoppling,
  grans,
}: {
  rader: Rattningsfraga[];
  aterkoppling: string | null;
  grans: number;
}) {
  return (
    <div className="flex flex-col gap-3">
      {aterkoppling && (
        <Card status="info">
          <h2 className="text-h2 text-ink-900">Återkopplingen</h2>
          <p className="mt-2 whitespace-pre-line text-body text-ink-700">{aterkoppling}</p>
          <p className="mt-2 text-small text-ink-500">Godkäntgränsen är {grans} %.</p>
        </Card>
      )}

      {rader.map((r) => (
        <Card key={r.id}>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-canvas text-micro font-semibold text-ink-500">
              {r.sort}
            </span>
            <p className="min-w-0 flex-1 text-body font-semibold text-ink-900">{r.prompt}</p>
            {r.poang != null && (
              <Badge ton={r.poang === r.max_points ? "ok" : r.poang === 0 ? "danger" : "warn"}>
                {r.poang} av {r.max_points} p
              </Badge>
            )}
          </div>

          <p className="mt-3 whitespace-pre-line rounded-sm bg-canvas px-3 py-2.5 text-body text-ink-700">
            {r.svar || <span className="text-ink-300">Inget svar.</span>}
          </p>

          {r.kommentar && (
            <p className="mt-2 rounded-sm bg-warn-tint px-3 py-2 text-small text-warn-ink">
              <span className="font-semibold">Din kommentar:</span>{" "}
              <span className="whitespace-pre-line">{r.kommentar}</span>
            </p>
          )}
        </Card>
      ))}
    </div>
  );
}
