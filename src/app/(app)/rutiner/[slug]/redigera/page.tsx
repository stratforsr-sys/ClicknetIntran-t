import { notFound, redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { redaktorsunderlag } from "@/lib/rutiner-data";
import type { Role } from "@/lib/roles";
import type { DocType } from "@/lib/dokument";
import { Redaktor } from "../../Redaktor";
import { sparaDokument } from "../../actions";

export const dynamic = "force-dynamic";

export default async function RedigeraDokument({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user?.employee) redirect(`/logga-in?nasta=/rutiner/${slug}/redigera`);

  const { data: d } = await supabaseAdmin()
    .from("document")
    .select(
      `id, slug, title, category_path, body_md, doc_type, review_due, requires_ack,
       audience_roles, owner_id, status, version`,
    )
    .eq("slug", slug)
    .maybeSingle();

  if (!d) notFound();

  const farRedigera = hasRole(user, "sales_manager", "admin") || d.owner_id === user.employee.id;
  // Samma resonemang som i lasvyn: den som inte far redigera ska mota
  // dokumentet, inte ett avslag som bekraftar att det finns en redigeringsvy.
  if (!farRedigera) redirect(`/rutiner/${slug}`);

  const { agare, kategorier } = await redaktorsunderlag();

  return (
    <Redaktor
      action={sparaDokument}
      agare={agare}
      aktivAgare={d.owner_id}
      kategorier={kategorier}
      utkast={{
        id: d.id,
        slug: d.slug,
        title: d.title,
        category_path: d.category_path ?? "",
        body_md: d.body_md ?? "",
        doc_type: d.doc_type as DocType,
        review_due: d.review_due,
        requires_ack: d.requires_ack,
        audience_roles: (d.audience_roles ?? []) as Role[],
        status: d.status,
        version: d.version,
      }}
    />
  );
}
