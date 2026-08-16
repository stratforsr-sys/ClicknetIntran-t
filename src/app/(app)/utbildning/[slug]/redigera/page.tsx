import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { skrivFragor } from "@/lib/utbildning";
import { Redaktor } from "./Redaktor";
import type { Modul } from "./ModulForm";

export const dynamic = "force-dynamic";

export default async function RedigeraKurs({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");

  // Service role: redaktorn behover se ratt svar, och de ar med flit osynliga
  // for varje klientroll. Behorigheten kontrolleras explicit direkt nedan.
  const db = supabaseAdmin();
  const { data: kurs } = await db
    .from("course")
    .select(
      `id, slug, title, description_md, status, audience_roles,
       pass_threshold, retry_wait_hours, valid_months, due_days, owner_id`,
    )
    .eq("slug", slug)
    .maybeSingle();

  if (!kurs) notFound();

  const farRedigera =
    hasRole(user, "sales_manager", "admin") || kurs.owner_id === user.employee.id;
  if (!farRedigera) redirect(`/utbildning/${slug}`);

  const { data: rader } = await db
    .from("course_module")
    .select("id, sort, title, body_md, kind, quiz_question(sort, prompt, quiz_option(sort, label, is_correct))")
    .eq("course_id", kurs.id)
    .order("sort");

  const moduler: Modul[] = (rader ?? []).map((m) => ({
    id: m.id,
    sort: m.sort,
    title: m.title,
    body_md: m.body_md,
    kind: m.kind,
    fragor: skrivFragor(
      [...m.quiz_question]
        .sort((a, b) => a.sort - b.sort)
        .map((f) => ({
          prompt: f.prompt,
          alternativ: [...f.quiz_option]
            .sort((a, b) => a.sort - b.sort)
            .map((a) => ({ label: a.label, ratt: a.is_correct })),
        })),
    ),
  }));

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href={`/utbildning/${kurs.slug}`}
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        {kurs.title}
      </Link>

      <div>
        <h1 className="text-display text-ink-900">Redigera kurs</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Deltagaren tar modulerna i ordning. Ett prov rättas på servern — rätt svar lämnar
          aldrig databasen.
        </p>
      </div>

      <Redaktor kurs={kurs} moduler={moduler} />
    </div>
  );
}
