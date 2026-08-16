import { redirect } from "next/navigation";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { redaktorsunderlag } from "@/lib/rutiner-data";
import { arstalDatum } from "@/lib/dokument";
import { Redaktor } from "../Redaktor";
import { skapaDokument } from "../actions";

export const dynamic = "force-dynamic";

export default async function NyttDokument() {
  const user = await getCurrentUser();
  // Alla som kan aga ett dokument far skapa ett. Publiceringen ar det som
  // styrs — ett utkast utan malgrupp syns anda bara for agaren.
  if (!user?.employee) redirect("/logga-in?nasta=/rutiner/ny");
  if (!hasRole(user, "sales_manager", "admin", "ceo", "team_lead")) redirect("/rutiner");

  const { agare, kategorier } = await redaktorsunderlag();

  return (
    <Redaktor
      action={skapaDokument}
      agare={agare}
      aktivAgare={user.employee.id}
      kategorier={kategorier}
      utkast={{
        title: "",
        category_path: "",
        body_md: "",
        doc_type: "routine",
        review_due: arstalDatum(12),
        requires_ack: true,
        audience_roles: [],
      }}
    />
  );
}
