import { notFound, redirect } from "next/navigation";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Anstallningsformular } from "./Anstallningsformular";

export const dynamic = "force-dynamic";
export const metadata = { title: "Anställ kandidat — Clicknet Nav" };

/**
 * E10.9 / AC-7.9. Sidan som gor en kandidat till en anstalld.
 *
 * Kandidaten hamtas med ANVANDARENS EGEN TOKEN. Far hen inte se raden blir
 * svaret noll rader och sidan en 404 — samma svar som en kandidat som inte
 * finns, med flit (se 0030): annars gar det att lista ut vem som sokt jobb
 * genom att prova id:n.
 *
 * MALLARNA HAMTAS BARA AT DEN SOM FAR HANTERA AVTAL. Kretsen ar smalare an
 * rekryterarkretsen — se rubriken i src/lib/avtal-server.ts — och en tom
 * mallvaljare hade sett ut som "det finns inga mallar" i stallet for "det ar
 * inte din uppgift".
 */
export default async function Anstallsida({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const farHanteraAvtal = hasRole(user, "sales_manager", "ceo", "admin");

  const supabase = await supabaseServer();
  const { data: k } = await supabase
    .from("candidate")
    .select("id, first_name, last_name, email, phone, role_title, stage, hired_employee_id")
    .eq("id", id)
    .maybeSingle();

  if (!k) notFound();

  // Steget kontrolleras aven i actionen och i triggern. Har ar det bara for att
  // slippa visa ett formular som anda inte gar att skicka.
  if (k.stage === "hired" && k.hired_employee_id) redirect(`/personal/${k.hired_employee_id}`);
  if (k.stage !== "offer") redirect(`/rekrytering/${id}`);

  const [{ data: team }, { data: mallar }] = await Promise.all([
    supabase.from("team").select("id, name").order("name"),
    farHanteraAvtal
      ? supabase
          .from("contract_template")
          .select("id, title, body_md")
          .eq("status", "published")
          .order("title")
      : Promise.resolve({ data: [] as { id: string; title: string; body_md: string }[] }),
  ]);

  return (
    <Anstallningsformular
      kandidat={{
        id: k.id,
        fornamn: k.first_name,
        efternamn: k.last_name,
        epost: k.email,
        befattning: k.role_title,
      }}
      team={team ?? []}
      mallar={mallar ?? []}
      farHanteraAvtal={farHanteraAvtal}
    />
  );
}
