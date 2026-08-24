import { notFound } from "next/navigation";
import { KontoSektion, SakerhetSektion } from "@/app/(app)/profil/Sektioner";
import { Utseende } from "@/components/shell/Utseende";

/**
 * De tre egna panelerna. Samma komponenter som helsidan /profil staplar.
 *
 * Optional catch-all i stallet for tre filer med en rad i var: panelerna
 * skiljer sig bara at i vilken sektion de visar, och tre nastan identiska
 * `page.tsx` ar tre stallen att glomma nagot pa.
 */
export default async function ProfilPanel({
  params,
}: {
  params: Promise<{ del?: string[] }>;
}) {
  const { del } = await params;
  if (del && del.length > 1) notFound();

  switch (del?.[0] ?? "konto") {
    case "konto":
      return <KontoSektion />;
    case "sakerhet":
      return <SakerhetSektion />;
    case "utseende":
      return <Utseende />;
    default:
      notFound();
  }
}
