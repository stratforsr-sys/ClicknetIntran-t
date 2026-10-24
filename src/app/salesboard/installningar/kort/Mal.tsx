import { svensktDatum } from "@/lib/klocka";
import { malFor } from "@/lib/salesboard/installningar";
import type { TavlansInstallningar } from "@/lib/salesboard/typer";
import { Belopp, Kort, Rad, type Granser, type Spara } from "../delar";
import type { Kvitto } from "../skrivvag";

/**
 * 02 Månadsmål: målet i ordervärde (R35), för den här månaden och nästa. Ett mål
 * gäller tills ett nytt sätts, så ett tomt fält visar det som ärvs. Klientkod.
 */

const MANADER = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
const TAL = new Intl.NumberFormat("sv-SE");

/** "2026-10" för i dag, och månaden efter. */
function manaderNu(): [string, string] {
  const idag = svensktDatum(new Date());
  const ar = Number(idag.slice(0, 4));
  const m = Number(idag.slice(5, 7));
  const nasta = m === 12 ? `${ar + 1}-01` : `${ar}-${String(m + 1).padStart(2, "0")}`;
  return [idag.slice(0, 7), nasta];
}

const namnFor = (manad: string): string => MANADER[Number(manad.slice(5, 7)) - 1] ?? manad;

export function Malkort({ i, granser, k, spara }: { i: TavlansInstallningar; granser: Granser; k: Record<string, Kvitto>; spara: Spara }) {
  const [denna, nasta] = manaderNu();
  const rad = (manad: string, forst: boolean) => {
    const eget = Object.hasOwn(i.mal, manad) ? i.mal[manad] : null;
    const arvt = malFor(i.mal, manad);
    const namn = namnFor(manad);
    const Namn = namn.charAt(0).toUpperCase() + namn.slice(1);
    return (
      <Rad
        key={manad}
        titel={Namn}
        hjalp={
          eget !== null
            ? forst
              ? "Månadens eget mål. Töm fältet för att låta månaden ärva det som gällde före."
              : `Gäller från 1 ${namn}.`
            : arvt !== null
              ? `Inget eget mål: ${TAL.format(arvt)} kr gäller, från månaden före.`
              : forst
                ? "Inget mål. Tavlan visar månadens ordervärde utan takt och utan firande när målet nås."
                : "Inget mål än. Utan ett eget mål ärvs månaden före."
        }
        k={k[`mal:${manad}`]}
        bred
      >
        <Belopp
          varde={eget}
          grans={granser.mal}
          etikett={`Målet för ${namn}, i kronor`}
          tomText={arvt !== null ? TAL.format(arvt) : "Inget mål"}
          onSpara={(v) => void spara(`mal:${manad}`, `Målet för ${namn}, ${TAL.format(v)} kr`, { mal: { [manad]: v } })}
          onTom={() => void spara(`mal:${manad}`, `Målet för ${namn}, ärvt`, { mal: { [manad]: null } })}
        />
      </Rad>
    );
  };
  return (
    <Kort
      nr="02"
      rubrik="Månadsmål"
      text="Lagets mål i ordervärde. Antal order visas som statistik, utan eget mål. Ett mål gäller tills ett nytt sätts."
    >
      {rad(denna, true)}
      {rad(nasta, false)}
    </Kort>
  );
}
