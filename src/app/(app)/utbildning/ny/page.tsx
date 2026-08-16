import { redirect } from "next/navigation";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { NyKurs } from "./NyKurs";

export const metadata = { title: "Ny kurs — Clicknet Nav" };

export default async function NyKursSida() {
  const user = await getCurrentUser();
  if (!hasRole(user, "sales_manager", "admin", "ceo", "team_lead")) redirect("/utbildning");
  return <NyKurs />;
}
