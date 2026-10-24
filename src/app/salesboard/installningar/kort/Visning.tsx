import { useId } from "react";
import { inomArbetsdag, visningsnamn } from "@/lib/salesboard/regler";
import type { Namnform, Ordning, TavlansInstallningar } from "@/lib/salesboard/typer";
import type { Saljare } from "@/lib/salesboard/skrivning";
import { Klockslag, Kort, Rad, Segment, useNu, type Lag, type Spara } from "../delar";
import type { Kvitto } from "../skrivvag";

/**
 * 03 Visning: laget, namnformen, topplistans ordning, arbetsdagen och rörelsen.
 * Klientkod.
 */

export function Visningskort({
  i,
  lagen,
  personer,
  k,
  spara,
}: {
  i: TavlansInstallningar;
  lagen: Lag[];
  /** Alla som tavlan kan visa i laget, eller null när de inte gick att läsa om efter ett byte av lag. */
  personer: Saljare[] | null;
  k: Record<string, Kvitto>;
  spara: Spara;
}) {
  const lagId = useId();
  const lagFinns = i.lag === null || lagen.some((l) => l.id === i.lag);
  // Exemplet i namnformerna: en riktig säljare som visas med namn.
  const exempel = (personer ?? []).find((s) => s.visning === "namn" && s.fornamn && s.efternamn) ?? null;
  const namnform = (form: Namnform) => (exempel ? visningsnamn(exempel.fornamn, exempel.efternamn, form, "namn") : undefined);
  const antal = personer?.length ?? null;

  return (
    <Kort nr="03" rubrik="Visning" text="Vilka tavlan visar och hur. Ändringar syns på alla skärmar inom några sekunder.">
      <Rad
        titel={<label htmlFor={lagId}>Laget</label>}
        hjalp={
          !lagFinns
            ? "Det valda laget finns inte längre. Tavlan visar alla."
            : antal === null
              ? "Lagets säljare gick inte att läsa om. Ladda om sidan."
              : `${antal} ${antal === 1 ? "person" : "personer"} kan synas på tavlan${i.lag ? " i laget" : ""}: säljarna och den som sålt nyss.`
        }
        k={k.lag}
        bred
      >
        <select
          id={lagId}
          className="si-falt si-val"
          value={lagFinns ? (i.lag ?? "") : ""}
          onChange={(e) => {
            const v = e.target.value || null;
            const namn = lagen.find((l) => l.id === v)?.namn ?? "Alla lag";
            void spara("lag", `Laget, ${namn}`, { lag: v });
          }}
        >
          <option value="">Alla lag</option>
          {lagen.map((l) => (
            <option key={l.id} value={l.id}>
              {l.namn}
            </option>
          ))}
        </select>
      </Rad>

      <Rad titel="Namn" hjalp="Gäller dem som visas med namn. Den som valt initialer eller att vara dold påverkas inte." k={k.namn} bred>
        <Segment<Namnform>
          etikett="Namn på tavlan"
          lista
          varde={i.namn}
          onChange={(v) => void spara("namn", "Namnen", { namn: v })}
          alternativ={[
            { v: "fornamn", etikett: "Förnamn", under: namnform("fornamn") },
            { v: "fornamn_e", etikett: "Förnamn E.", under: namnform("fornamn_e") },
            { v: "hela", etikett: "Hela namnet", under: namnform("hela") },
          ]}
        />
      </Rad>

      <Rad
        titel="Topplistan"
        hjalp="Vad som avgör ordningen. Månadsmålet är alltid ordervärde. Tangenten V växlar på en skärm utan att spara här."
        k={k.ordning}
        bred
      >
        <Segment<Ordning>
          etikett="Topplistans ordning"
          varde={i.ordning}
          onChange={(v) => void spara("ordning", "Topplistans ordning", { ordning: v })}
          alternativ={[
            { v: "varde", etikett: "Ordervärde" },
            { v: "antal", etikett: "Antal order" },
          ]}
        />
      </Rad>

      <Rad
        titel="Arbetsdagen"
        hjalp={
          <>
            Utanför arbetsdagen vilar tavlan i 55 %, så att den inte lyser upp ett tomt kontor. <Arbetsdag arbetsdag={i.arbetsdag} />
          </>
        }
        k={k.arbetsdag}
        bred
      >
        <span className="si-tidspar">
          <Klockslag etikett="Arbetsdagen börjar" varde={i.arbetsdag.fran} onSpara={(v) => void spara("arbetsdag", "Arbetsdagen", { arbetsdag: { fran: v } })} />
          <span aria-hidden="true">–</span>
          <Klockslag etikett="Arbetsdagen slutar" varde={i.arbetsdag.till} onSpara={(v) => void spara("arbetsdag", "Arbetsdagen", { arbetsdag: { till: v } })} />
        </span>
      </Rad>

      <Rad
        titel="Rörelse"
        hjalp="Lugn: firandet står still och tonas in och ut, utan svep och räkneverk. Ljudet är detsamma. En skärm som ber om mindre rörelse får lugn ändå."
        k={k.rorelse}
        bred
      >
        <Segment<TavlansInstallningar["rorelse"]>
          etikett="Rörelse"
          varde={i.rorelse}
          onChange={(v) => void spara("rorelse", "Rörelsen", { rorelse: v })}
          alternativ={[
            { v: "full", etikett: "Full" },
            { v: "lugn", etikett: "Lugn" },
          ]}
        />
      </Rad>
    </Kort>
  );
}

/** "Arbetsdag nu." eller "Vilar nu.", med tavlans egen regel (`inomArbetsdag`), omräknat var 30:e sekund. */
function Arbetsdag({ arbetsdag }: { arbetsdag: TavlansInstallningar["arbetsdag"] }) {
  const nu = useNu(30_000);
  const arbetar = inomArbetsdag(new Date(nu).toISOString(), arbetsdag);
  return <span className={arbetar ? "si-ok" : "si-neutral"}>{arbetar ? "Arbetsdag nu." : "Vilar nu."}</span>;
}
