import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Utseende } from "@/components/shell/Utseende";
import {
  KontoSektion,
  SakerhetSektion,
  AdministrationSektion,
  harAdministration,
} from "./Sektioner";

export const metadata = { title: "Inställningar — Clicknet Nav" };

/**
 * E1.14: var och en ser sina egna uppgifter och skoter sin egen inloggning.
 *
 * Sidan ar samma installningar som rutan man far genom att klicka pa
 * profilbilden i sidopanelen, fast under varandra. Rutan ar den normala vagen;
 * den har finns for djuplankar, bokmarken och den som hellre laser allt pa en
 * gang. Sektionerna ar SAMMA komponenter — se Sektioner.tsx.
 */
export default async function InstallningsSida() {
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");

  return (
    <div className="flex flex-col gap-8 pt-2">
      <div>
        <h1 className="text-display text-ink-900">Inställningar</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Dina uppgifter, din inloggning och hur navet ser ut för dig. Samma innehåll som
          rutan du får när du klickar på din profilbild nere till vänster.
        </p>
      </div>

      <Avsnitt titel="Konto">
        <KontoSektion />
      </Avsnitt>

      <Avsnitt titel="Säkerhet">
        <SakerhetSektion />
      </Avsnitt>

      <Avsnitt titel="Utseende">
        <Utseende />
      </Avsnitt>

      {harAdministration(user) && (
        <Avsnitt titel="Administration">
          <AdministrationSektion />
        </Avsnitt>
      )}
    </div>
  );
}

function Avsnitt({ titel, children }: { titel: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-micro uppercase text-ink-500">{titel}</h2>
      {children}
    </section>
  );
}
