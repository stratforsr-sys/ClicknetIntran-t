import { notFound } from "next/navigation";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { Redaktor } from "../Redaktor";

export const dynamic = "force-dynamic";

export default async function NyMall() {
  const user = await getCurrentUser();
  if (!hasRole(user, "sales_manager", "ceo", "admin")) notFound();
  return <Redaktor />;
}
