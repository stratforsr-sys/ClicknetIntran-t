import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Utseende } from "@/components/shell/Utseende";
import {
  KontoSektion,
  SakerhetSektion,
  AdministrationSektion,
  harAdministration,
} from "../Sektioner";

export const metadata = { title: "Inställningar — Clicknet Nav" };

const DELAR = ["sakerhet", "utseende"];

/**
 * Installningarna som egen sida.
 *
 * Den normala vagen ar rutan man far av profilbilden i sidopanelen. Den har
 * sidan ar vad samma adress ritar nar det INTE finns nagon sida att lagga
 * rutan ovanpa: en full laddning, en omladdning, eller en delad lank.
 *
 * Den staplar alla sektioner i stallet for att visa den som adressen pekar
 * pa. Skalet ar att sidan da svarar likadant pa /profil, /profil/sakerhet och
 * /profil/utseende — den som laddar om mitt i ett losenordsbyte ska hitta
 * formularet, inte en sida som ser tom ut for att den valt en annan flik.
 * Sektionerna bar `id`, sa lanken gar att peka mot ratt stalle.
 */
export default async function InstallningsSida({
  params,
}: {
  params: Promise<{ del?: string[] }>;
}) {
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");

  const { del } = await params;
  if (del && (del.length > 1 || !DELAR.includes(del[0]))) notFound();

  return (
    <div className="flex flex-col gap-8 pt-2">
      <div>
        <h1 className="text-display text-ink-900">Inställningar</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Dina uppgifter, din inloggning och hur navet ser ut för dig. Samma innehåll som
          rutan du får när du klickar på din profilbild nere till vänster.
        </p>
      </div>

      <Avsnitt id="konto" titel="Konto">
        <KontoSektion />
      </Avsnitt>

      <Avsnitt id="sakerhet" titel="Säkerhet">
        <SakerhetSektion />
      </Avsnitt>

      <Avsnitt id="utseende" titel="Utseende">
        <Utseende />
      </Avsnitt>

      {harAdministration(user) && (
        <Avsnitt id="administration" titel="Administration">
          <AdministrationSektion />
        </Avsnitt>
      )}
    </div>
  );
}

function Avsnitt({ id, titel, children }: { id: string; titel: string; children: ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-20 flex-col gap-4">
      <h2 className="text-micro uppercase text-ink-500">{titel}</h2>
      {children}
    </section>
  );
}
