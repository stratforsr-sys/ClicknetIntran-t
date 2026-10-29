import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { arSuperadmin } from "@/lib/utskick-server";
import { UtskickAdminSektion } from "../profil/Sektioner";

export const dynamic = "force-dynamic";
export const metadata = { title: "Utskick — Clicknet Nav" };

/** Bara superadmin. Servern prövar det igen i varje sparande (`sparaUtskick`). */
export default async function Utskick() {
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");
  if (!arSuperadmin(user)) redirect("/");

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <h1 className="text-display text-ink-900">Utskick</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Vem som får vad, i klockan, mejlet, telefonen och morgonbrevet. Ändringen gäller i samma
          stund. Det en person stängt själv syns här men är hens val.
        </p>
      </div>

      <UtskickAdminSektion />
    </div>
  );
}
