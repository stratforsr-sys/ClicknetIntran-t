import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { kursLage, LAGE_ETIKETT, LAGE_TON, forfallodag } from "@/lib/utbildning";

export const dynamic = "force-dynamic";
export const metadata = { title: "Utbildning — Clicknet Nav" };

export default async function UtbildningSida() {
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");

  const supabase = await supabaseServer();
  const farRedigera = hasRole(user, "sales_manager", "admin", "ceo", "team_lead");
  const farSeAlla = hasRole(user, "sales_manager", "admin", "ceo", "team_lead");

  // RLS filtrerar pa malgrupp. Utkast syns bara for den som far redigera.
  const [{ data: kurser }, { data: moduler }, { data: klara }, { data: certifikat }] =
    await Promise.all([
      supabase
        .from("course")
        .select("id, slug, title, description_md, status, valid_months, due_days")
        .order("title"),
      supabase.from("course_module").select("id, course_id"),
      supabase
        .from("module_progress")
        .select("module_id")
        .eq("employee_id", user.employee.id),
      supabase
        .from("certification")
        .select("course_id, issued_at, expires_at")
        .eq("employee_id", user.employee.id)
        .order("issued_at", { ascending: false }),
    ]);

  const modulerPer = new Map<string, string[]>();
  for (const m of moduler ?? []) {
    modulerPer.set(m.course_id, [...(modulerPer.get(m.course_id) ?? []), m.id]);
  }
  const klaraSet = new Set((klara ?? []).map((k) => k.module_id));
  const certPer = new Map<string, { issued_at: string; expires_at: string | null }>();
  for (const c of certifikat ?? []) if (!certPer.has(c.course_id)) certPer.set(c.course_id, c);

  const lista = (kurser ?? []).map((k) => {
    const mina = modulerPer.get(k.id) ?? [];
    return {
      ...k,
      antalModuler: mina.length,
      klaraModuler: mina.filter((id) => klaraSet.has(id)).length,
      lage: kursLage({
        certifikat: certPer.get(k.id) ?? null,
        klaraModuler: mina.filter((id) => klaraSet.has(id)).length,
        antalModuler: mina.length,
        startDatum: user.employee!.start_date,
        fristDagar: k.due_days,
      }),
      forfaller: forfallodag(user.employee!.start_date, k.due_days),
    };
  });

  const mina = lista.filter((k) => k.status === "published");
  const utkast = lista.filter((k) => k.status !== "published");
  const kvar = mina.filter((k) => k.lage !== "certifierad");

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display text-ink-900">Utbildning</h1>
          <p className="mt-1 text-body text-ink-500">
            {kvar.length === 0
              ? mina.length === 0
                ? "Inga kurser är riktade till dig än."
                : "Allt klart. Inga kurser väntar på dig."
              : `${kvar.length} av ${mina.length} kvar att göra.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {farSeAlla && (
            <ButtonLink href="/utbildning/oversikt" variant="sekundar">
              Progress
            </ButtonLink>
          )}
          {farRedigera && (
            <ButtonLink href="/utbildning/ny" variant="primar">
              Ny kurs
            </ButtonLink>
          )}
        </div>
      </div>

      {mina.length === 0 && utkast.length === 0 ? (
        <Card>
          <EmptyState
            rubrik="Inga kurser än"
            text="En kurs består av moduler i ordning och avslutas med ett quiz. Godkänt ger ett certifikat."
            handling={
              farRedigera ? (
                <ButtonLink href="/utbildning/ny" variant="primar">
                  Skapa den första kursen
                </ButtonLink>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {[...mina, ...utkast].map((k) => (
            <li key={k.id}>
              <Link href={`/utbildning/${k.slug}`} className="block h-full">
                <Card
                  klickbart
                  status={k.lage === "forsenad" || k.lage === "utgangen" ? "danger" : undefined}
                  className="h-full"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-h2 text-ink-900">{k.title}</h2>
                    {k.status === "published" ? (
                      <Badge ton={LAGE_TON[k.lage]}>{LAGE_ETIKETT[k.lage]}</Badge>
                    ) : (
                      <Badge ton="neutral">Utkast</Badge>
                    )}
                  </div>

                  {k.description_md && (
                    <p className="mt-2 line-clamp-2 text-small text-ink-500">
                      {k.description_md.replace(/[#*_`>]/g, "").slice(0, 160)}
                    </p>
                  )}

                  <p className="mt-3 text-small text-ink-500">
                    {k.antalModuler === 0
                      ? "Inga moduler än"
                      : `${k.klaraModuler} av ${k.antalModuler} moduler klara`}
                    {k.forfaller && k.lage !== "certifierad" && (
                      <> · senast {k.forfaller.toISOString().slice(0, 10)}</>
                    )}
                    {k.valid_months && k.lage === "certifierad" && (
                      <> · certifikat i {k.valid_months} mån</>
                    )}
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
