import { redirect } from "next/navigation";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Redaktor } from "../Redaktor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nytt inlägg — Clicknet Nav" };

export default async function NyttInlagg() {
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/logga-in?nasta=/nyheter/nytt");
  if (!hasRole(user, "sales_manager", "ceo", "admin")) redirect("/nyheter");

  const supabase = await supabaseServer();
  const { data: team } = await supabase.from("team").select("id, name").order("name");

  return <Redaktor team={team ?? []} />;
}
