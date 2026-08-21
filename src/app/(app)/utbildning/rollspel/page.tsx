import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser, fullName, hasRole } from "@/lib/auth";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { storlek } from "@/lib/filer";
import { Bedomning } from "./Bedomning";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rollspel att bedöma — Clicknet Nav" };

/**
 * E8.7 / AC-6.7: kön av inlämnade rollspel.
 *
 * Listan läses med användarens EGEN token. `roleplay_submission` visar egna
 * rader plus dem man leder (0024), så en säljare som hittar hit ser sina egna
 * inlämningar och ingen annans — sidan behöver inte kunna någonting om vem som
 * leder vem.
 */
export default async function Rollspelsko() {
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");

  const supabase = await supabaseServer();
  const db = supabaseAdmin();

  const { data: rader } = await supabase
    .from("roleplay_submission")
    .select(
      `id, module_id, course_id, employee_id, file_id, submitted_at, graded_at,
       file_object(size_bytes),
       course_module(title),
       course(title, slug, pass_threshold)`,
    )
    .is("graded_at", null)
    .order("submitted_at");

  const lista = (rader ?? []).filter((r) => r.employee_id !== user.employee!.id);

  // Namnen slas upp med service role, som pa sjuksidan: `employee` ar inte
  // lasbar for varje roll, och en ko med uuid:n gar inte att arbeta i.
  const namnIds = [...new Set(lista.map((r) => r.employee_id))];
  const { data: personer } = namnIds.length
    ? await db.from("employee").select("id, first_name, last_name").in("id", namnIds)
    : { data: [] };
  const namn = new Map((personer ?? []).map((p) => [p.id, fullName(p)]));

  const modulIds = [...new Set(lista.map((r) => r.module_id))];
  const { data: kriterier } = modulIds.length
    ? await supabase
        .from("roleplay_criterion")
        .select("id, module_id, sort, label, guidance, max_points")
        .in("module_id", modulIds)
        .order("sort")
    : { data: [] };

  const perModul = new Map<string, typeof kriterier>();
  for (const k of kriterier ?? []) {
    perModul.set(k.module_id, [...(perModul.get(k.module_id) ?? []), k]);
  }

  const egen = (rader ?? []).filter((r) => r.employee_id === user.employee!.id);

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href="/utbildning"
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        Tillbaka till utbildning
      </Link>

      <div>
        <h1 className="text-display text-ink-900">Rollspel att bedöma</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Inspelade testsamtal från dem du leder. Varje öppning av en inspelning loggas och syns
          för säljaren — och en bedömning går inte att spara från någon som inte öppnat filen.
        </p>
      </div>

      {lista.length === 0 ? (
        <Card>
          <EmptyState
            rubrik="Inget väntar"
            text={
              hasRole(user, "sales_manager", "ceo", "team_lead")
                ? "Inlämnade rollspel från dem du leder hamnar här."
                : "Du leder ingen än, så det finns inget att bedöma."
            }
          />
        </Card>
      ) : (
        lista.map((r) => {
          const kurs = r.course as unknown as { title: string; slug: string } | null;
          const modul = r.course_module as unknown as { title: string } | null;
          const fil = r.file_object as unknown as { size_bytes: number } | null;

          return (
            <Card key={r.id}>
              <CardHeader
                titel={namn.get(r.employee_id) ?? "Okänd"}
                beskrivning={`${kurs?.title ?? "Kurs"} · ${modul?.title ?? "Modul"} · inlämnat ${r.submitted_at.slice(0, 10)}${fil ? ` · ${storlek(fil.size_bytes)}` : ""}`}
              />
              <Bedomning
                id={r.id}
                fileId={r.file_id}
                kriterier={(perModul.get(r.module_id) ?? []).map((k) => ({
                  id: k.id,
                  label: k.label,
                  guidance: k.guidance,
                  max_points: k.max_points,
                }))}
              />
            </Card>
          );
        })
      )}

      {egen.length > 0 && (
        <Card>
          <CardHeader
            titel="Dina egna, som väntar"
            beskrivning="Du bedömer inte ditt eget rollspel. De ligger hos den som leder dig."
          />
          <ul className="flex flex-col">
            {egen.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-baseline gap-x-3 border-b border-canvas py-2.5 last:border-0"
              >
                <span className="text-body text-ink-900">
                  {(r.course as unknown as { title: string } | null)?.title ?? "Kurs"}
                </span>
                <span className="text-small text-ink-500">{r.submitted_at.slice(0, 10)}</span>
                <Badge ton="warn">Väntar</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
