import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Notis } from "@/components/ui/Notis";
import { Ikon } from "@/components/shell/Ikon";
import { Markdown } from "@/components/Markdown";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { ROLE_LABEL, type Role } from "@/lib/roles";
import { kursLage, LAGE_ETIKETT, LAGE_TON, forfallodag } from "@/lib/utbildning";

export const dynamic = "force-dynamic";

export default async function KursSida({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");

  const supabase = await supabaseServer();
  const { data: kurs } = await supabase
    .from("course")
    .select(
      `id, slug, title, description_md, status, audience_roles,
       pass_threshold, retry_wait_hours, valid_months, due_days, owner_id`,
    )
    .eq("slug", slug)
    .maybeSingle();

  // Samma monster som M5: den som inte far se kursen far 404, inte "nekad".
  if (!kurs) notFound();

  const [{ data: moduler }, { data: klara }, { data: cert }, { data: forsok }] = await Promise.all([
    supabase
      .from("course_module")
      .select("id, sort, title, kind")
      .eq("course_id", kurs.id)
      .order("sort"),
    supabase.from("module_progress").select("module_id").eq("employee_id", user.employee.id),
    supabase
      .from("certification")
      .select("issued_at, expires_at")
      .eq("employee_id", user.employee.id)
      .eq("course_id", kurs.id)
      .order("issued_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("course_attempt")
      .select("module_id, score, passed, created_at")
      .eq("employee_id", user.employee.id)
      .eq("course_id", kurs.id)
      .order("created_at", { ascending: false }),
  ]);

  const lista = moduler ?? [];
  const klaraSet = new Set((klara ?? []).map((k) => k.module_id));
  const antalKlara = lista.filter((m) => klaraSet.has(m.id)).length;

  const lage = kursLage({
    certifikat: cert ?? null,
    klaraModuler: antalKlara,
    antalModuler: lista.length,
    startDatum: user.employee.start_date,
    fristDagar: kurs.due_days,
  });

  const forfaller = forfallodag(user.employee.start_date, kurs.due_days);
  const nasta = lista.find((m) => !klaraSet.has(m.id));
  const farRedigera =
    hasRole(user, "sales_manager", "admin") || kurs.owner_id === user.employee.id;

  const bastaForsok = new Map<string, number>();
  for (const f of forsok ?? []) {
    if (f.module_id) bastaForsok.set(f.module_id, Math.max(bastaForsok.get(f.module_id) ?? 0, f.score));
  }

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href="/utbildning"
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        Tillbaka till utbildning
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-display text-ink-900">{kurs.title}</h1>
          <p className="mt-1 text-body text-ink-500">
            {lista.length} {lista.length === 1 ? "modul" : "moduler"} · godkänt vid{" "}
            {kurs.pass_threshold} %
            {kurs.valid_months && <> · certifikat giltigt {kurs.valid_months} mån</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {kurs.status !== "published" && <Badge ton="neutral">Utkast</Badge>}
          <Badge ton={LAGE_TON[lage]}>{LAGE_ETIKETT[lage]}</Badge>
        </div>
      </div>

      {lage === "utgangen" && (
        <Notis ton="danger">
          Certifikatet gick ut {cert?.expires_at?.slice(0, 10)}. Gör om kursen för att förnya det.
        </Notis>
      )}
      {lage === "forsenad" && forfaller && (
        <Notis ton="danger">
          Kursen skulle varit klar {forfaller.toISOString().slice(0, 10)}.
        </Notis>
      )}
      {lage === "certifierad" && cert && (
        <Notis ton="ok">
          Klar {cert.issued_at.slice(0, 10)}
          {cert.expires_at ? `. Giltigt till ${cert.expires_at.slice(0, 10)}.` : " och gäller tills vidare."}
        </Notis>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex flex-col gap-4">
          {kurs.description_md && (
            <Card>
              <div className="prosa">
                <Markdown text={kurs.description_md} />
              </div>
            </Card>
          )}

          <Card>
            <CardHeader
              titel="Innehåll"
              beskrivning="Modulerna tas i ordning. Nästa öppnas när den föregående är klar."
            />
            {lista.length === 0 ? (
              <p className="text-small text-ink-500">Kursen har inga moduler än.</p>
            ) : (
              <ol className="flex flex-col gap-1">
                {lista.map((m, i) => {
                  const klar = klaraSet.has(m.id);
                  const oppen = klar || m.id === nasta?.id;
                  const rad = (
                    <>
                      <span
                        className={`grid size-6 shrink-0 place-items-center rounded-full text-micro ${
                          klar
                            ? "bg-ok text-ink-inv"
                            : oppen
                              ? "bg-brand-600 text-ink-inv"
                              : "bg-canvas text-ink-500"
                        }`}
                      >
                        {klar ? <Ikon namn="kontroll" className="size-3.5" /> : i + 1}
                      </span>
                      <span className="flex-1">{m.title}</span>
                      {m.kind === "quiz" && (
                        <span className="text-micro uppercase text-ink-500">Quiz</span>
                      )}
                      {bastaForsok.has(m.id) && (
                        <span className="text-small text-ink-500">{bastaForsok.get(m.id)} %</span>
                      )}
                    </>
                  );

                  return (
                    <li key={m.id}>
                      {oppen ? (
                        <Link
                          href={`/utbildning/${kurs.slug}/modul/${m.sort}`}
                          className="flex min-h-11 items-center gap-3 rounded-sm px-3 text-body text-ink-700 transition-colors duration-fast hover:bg-surface-alt hover:text-ink-900"
                        >
                          {rad}
                        </Link>
                      ) : (
                        <div className="flex min-h-11 items-center gap-3 rounded-sm px-3 text-body text-ink-300">
                          {rad}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card className="h-fit">
            <CardHeader titel="Om kursen" />
            <dl className="flex flex-col gap-3">
              <div>
                <dt className="text-micro uppercase text-ink-500">Målgrupp</dt>
                <dd className="mt-1.5 flex flex-wrap gap-1.5">
                  {kurs.audience_roles.length === 0 ? (
                    <Badge ton="neutral">Alla</Badge>
                  ) : (
                    kurs.audience_roles.map((r: string) => (
                      <Badge key={r} ton="brand">
                        {ROLE_LABEL[r as Role] ?? r}
                      </Badge>
                    ))
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-micro uppercase text-ink-500">Omtag</dt>
                <dd className="mt-0.5 text-body text-ink-900">
                  {kurs.retry_wait_hours === 0
                    ? "Direkt"
                    : `Efter ${kurs.retry_wait_hours} timmar`}
                </dd>
              </div>
              {forfaller && (
                <div>
                  <dt className="text-micro uppercase text-ink-500">Ska vara klar</dt>
                  <dd className="tnum mt-0.5 text-body text-ink-900">
                    {forfaller.toISOString().slice(0, 10)}
                  </dd>
                </div>
              )}
            </dl>

            <div className="mt-4 flex flex-col gap-2">
              {nasta && lista.length > 0 && (
                <ButtonLink href={`/utbildning/${kurs.slug}/modul/${nasta.sort}`} variant="primar">
                  {antalKlara === 0 ? "Börja kursen" : "Fortsätt"}
                </ButtonLink>
              )}
              {farRedigera && (
                <ButtonLink href={`/utbildning/${kurs.slug}/redigera`} variant="sekundar">
                  Redigera
                </ButtonLink>
              )}
            </div>
          </Card>

          {(forsok ?? []).length > 0 && (
            <Card className="h-fit">
              <CardHeader titel="Mina försök" />
              <ul className="flex flex-col gap-2">
                {(forsok ?? []).slice(0, 8).map((f, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 text-small">
                    <span className="tnum text-ink-500">{f.created_at.slice(0, 10)}</span>
                    <span className="text-ink-700">{f.score} %</span>
                    <Badge ton={f.passed ? "ok" : "danger"}>
                      {f.passed ? "Godkänt" : "Underkänt"}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
