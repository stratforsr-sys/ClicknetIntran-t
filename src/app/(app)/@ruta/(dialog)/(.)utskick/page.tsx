import { UtskickAdminSektion } from "@/app/(app)/profil/Sektioner";

/** Samma innehåll som helsidan /utskick, utan sidhuvudet. Sektionen släpper bara in superadmin. */
export default function Panel() {
  return <UtskickAdminSektion />;
}
