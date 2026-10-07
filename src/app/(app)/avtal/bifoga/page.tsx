import Link from "next/link";
import { notFound } from "next/navigation";
import { Ikon } from "@/components/shell/Ikon";
import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentUser, fullName, hasRole } from "@/lib/auth";
import { Bifoga } from "./Bifoga";

export const dynamic = "force-dynamic";

/**
 * 0073. Bifoga ett påskrivet anställningsavtal.
 *
 * Samma krets som får skapa avtal ur en mall (`far_hantera_avtal()` i 0028).
 * Kommer man från personens sida står hen redan vald — `?person=<id>`.
 */
export default async function BifogaAvtal({
  searchParams,
}: {
  searchParams: Promise<{ person?: string }>;
}) {
  const { person } = await searchParams;
  const user = await getCurrentUser();
  if (!hasRole(user, "sales_manager", "ceo", "admin")) notFound();

  const supabase = await supabaseServer();
  const { data: personer } = await supabase
    .from("employee")
    .select("id, first_name, last_name")
    .neq("status", "offboarded")
    .is("removed_at", null)
    .order("first_name");

  const lista = (personer ?? []).map((p) => ({ id: p.id, namn: fullName(p) }));
  const forvald = lista.some((p) => p.id === person) ? person! : "";

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href={forvald ? `/personal/${forvald}` : "/avtal"}
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        {forvald ? "Tillbaka till personen" : "Tillbaka till avtalen"}
      </Link>

      <div>
        <h1 className="text-display text-ink-900">Bifoga anställningsavtal</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Ladda upp det påskrivna avtalet som PDF eller bild. Det syns direkt
          under Mitt avtal för den det gäller, som kan ladda ner det därifrån.
          Blir det fel fil drar du tillbaka avtalet och laddar upp ett nytt.
        </p>
      </div>

      <Bifoga personer={lista} forvald={forvald} />
    </div>
  );
}
