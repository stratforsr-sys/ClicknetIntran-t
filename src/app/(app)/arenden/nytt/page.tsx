import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { NyttArende } from "./NyttArende";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nytt ärende — Clicknet Nav" };

export default async function NyttArendeSida() {
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");

  const supabase = await supabaseServer();
  const { data: kategorier } = await supabase
    .from("case_category")
    .select("id, label, sla_hours, default_confidential")
    .order("sort");

  return <NyttArende kategorier={kategorier ?? []} />;
}
