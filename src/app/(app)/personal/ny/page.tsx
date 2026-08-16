import { redirect } from "next/navigation";
import { getCurrentUser, canManageEmployees } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Formular } from "./Formular";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lägg upp anställd — Clicknet Nav" };

export default async function NyAnstalldSida() {
  const user = await getCurrentUser();
  if (!canManageEmployees(user)) redirect("/personal");

  const supabase = await supabaseServer();
  const { data: team } = await supabase.from("team").select("id, name").order("name");

  return <Formular team={team ?? []} />;
}
