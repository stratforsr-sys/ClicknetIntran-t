import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Notis } from "@/components/ui/Notis";
import { Ikon } from "@/components/shell/Ikon";
import { Markdown } from "@/components/Markdown";
import { getCurrentUser } from "@/lib/auth";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { sparrTill, tidkvar } from "@/lib/utbildning";
import { klarModul } from "../../../actions";
import { Quiz } from "./Quiz";

export const dynamic = "force-dynamic";

export default async function ModulSida({
  params,
}: {
  params: Promise<{ slug: string; sort: string }>;
}) {
  const { slug, sort } = await params;
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");

  const supabase = await supabaseServer();
  const { data: kurs } = await supabase
    .from("course")
    .select("id, slug, title, status, pass_threshold, retry_wait_hours")
    .eq("slug", slug)
    .maybeSingle();
  if (!kurs) notFound();

  const { data: moduler } = await supabase
    .from("course_module")
    .select("id, sort, title, body_md, kind")
    .eq("course_id", kurs.id)
    .order("sort");

  const lista = moduler ?? [];
  const modul = lista.find((m) => String(m.sort) === sort);
  if (!modul) notFound();

  const { data: klara } = await supabase
    .from("module_progress")
    .select("module_id")
    .eq("employee_id", user.employee.id);
  const klaraSet = new Set((klara ?? []).map((k) => k.module_id));

  // AC-6.1: modulerna tas i ordning. Sparren finns aven i server actionen —
  // den har hindrar bara att nagon star framfor en sida hon inte kan anvanda.
  const foregaende = lista.filter((m) => m.sort < modul.sort);
  if (!foregaende.every((m) => klaraSet.has(m.id))) {
    redirect(`/utbildning/${kurs.slug}`);
  }

  const klar = klaraSet.has(modul.id);
  const index = lista.findIndex((m) => m.id === modul.id);
  const nasta = lista[index + 1];
  const nastaHref = nasta
    ? `/utbildning/${kurs.slug}/modul/${nasta.sort}`
    : `/utbildning/${kurs.slug}`;

  // Fragorna lases med service role for att kunna plocka fram alternativen
  // UTAN facit. quiz_option ar stangd for klientrollerna, sa RLS-vagen ger
  // noll rader — och att skicka med is_correct hit vore att lagga svaret i
  // sidkallan.
  let fragor: { id: string; prompt: string; alternativ: { id: string; label: string }[] }[] = [];
  let sparr: Date | null = null;

  if (modul.kind === "quiz") {
    const admin = supabaseAdmin();
    const { data: rader } = await admin
      .from("quiz_question")
      .select("id, sort, prompt, quiz_option(id, sort, label)")
      .eq("module_id", modul.id)
      .order("sort");

    fragor = (rader ?? []).map((f) => ({
      id: f.id,
      prompt: f.prompt,
      alternativ: [...f.quiz_option]
        .sort((a, b) => a.sort - b.sort)
        .map((a) => ({ id: a.id, label: a.label })),
    }));

    const { data: senaste } = await supabase
      .from("course_attempt")
      .select("created_at, passed")
      .eq("employee_id", user.employee.id)
      .eq("module_id", modul.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (senaste && !senaste.passed) sparr = sparrTill(senaste.created_at, kurs.retry_wait_hours);
  }

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href={`/utbildning/${kurs.slug}`}
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        {kurs.title}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-micro uppercase text-ink-500">
            Modul {index + 1} av {lista.length}
          </p>
          <h1 className="mt-1 text-display text-ink-900">{modul.title}</h1>
        </div>
        {klar && <Badge ton="ok">Klar</Badge>}
      </div>

      <Card className="max-w-[70ch]">
        {modul.body_md ? (
          <div className="prosa">
            <Markdown text={modul.body_md} />
          </div>
        ) : (
          <p className="text-small text-ink-500">Modulen har inget innehåll än.</p>
        )}
      </Card>

      {modul.kind === "quiz" ? (
        <Card className="max-w-[70ch]">
          <h2 className="mb-1 text-h2 text-ink-900">Prov</h2>
          <p className="mb-5 text-small text-ink-500">
            {fragor.length} {fragor.length === 1 ? "fråga" : "frågor"} · godkänt vid{" "}
            {kurs.pass_threshold} %
          </p>

          {sparr ? (
            <Notis ton="warn">
              Nästa försök går att göra om {tidkvar(sparr)} — {sparr.toLocaleString("sv-SE")}.
            </Notis>
          ) : fragor.length === 0 ? (
            <p className="text-small text-ink-500">Provet har inga frågor än.</p>
          ) : (
            <Quiz
              kursId={kurs.id}
              modulId={modul.id}
              fragor={fragor}
              nastaHref={nastaHref}
            />
          )}
        </Card>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {klar ? (
            <Link href={nastaHref}>
              <Button variant="sekundar">{nasta ? "Nästa modul" : "Till kursen"}</Button>
            </Link>
          ) : (
            <form action={klarModul}>
              <input type="hidden" name="kurs_id" value={kurs.id} />
              <input type="hidden" name="modul_id" value={modul.id} />
              <Button type="submit">Jag har läst — markera som klar</Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
