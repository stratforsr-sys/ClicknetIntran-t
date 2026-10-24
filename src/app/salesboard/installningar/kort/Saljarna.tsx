import { arDold, initialerFor, visningsnamn } from "@/lib/salesboard/regler";
import type { TavlansInstallningar, Visning } from "@/lib/salesboard/typer";
import type { Saljare } from "@/lib/salesboard/skrivning";
import { Felrad, Kort, Kvittens, Lugn, Segment, type Alternativ, type Lag } from "../delar";
import type { Kvitto } from "../skrivvag";

/**
 * 06 Säljarna: alla som tavlan kan visa i laget, med visning (namn, initialer
 * eller dold). Klientkod.
 *
 * Listan är tavlans (R28, R30): de aktiva vars roll kan sälja, också de som inte
 * sålt något än, och alla som står i lagets order på
 * tavlan, som chefen som säljer själv och den som sålt och sedan slutat. Varje
 * namn tavlan kan visa går alltså att dölja här. Den som inte är säljare står med
 * sin roll eller "Slutat", så att det syns varför hen är med.
 */

/** Ändringen av en säljare: bara visningen (R33). */
export type PersonOp = { id: string; visning: Visning };

const VISNINGAR: Alternativ<Visning>[] = [
  { v: "namn", etikett: "Namn" },
  { v: "initialer", etikett: "Initialer" },
  { v: "dold", etikett: "Dold" },
];

export function Saljarkort({
  installerad,
  i,
  personer,
  lagen,
  k,
  onAndra,
}: {
  installerad: boolean;
  i: TavlansInstallningar;
  /** Null efter ett byte av lag vars säljare inte gick att läsa om. Då visas ingen lista, aldrig det förra lagets. */
  personer: Saljare[] | null;
  lagen: Lag[];
  k: Record<string, Kvitto>;
  onAndra: (s: Saljare, andring: Partial<Omit<PersonOp, "id">>) => void;
}) {
  const lista = personer ?? [];
  const dolda = lista.filter((s) => arDold(s.visning)).length;
  const lagnamn = new Map(lagen.map((l) => [l.id, l.namn]));
  const flera = i.lag === null && new Set(lista.map((s) => s.lag)).size > 1;
  return (
    <Kort
      nr="06"
      rubrik="Säljarna"
      text="Alla som kan synas på tavlan: säljarna, säljchefen och VD:n, och den som sålt nyss. Ändras bara på deras egen begäran. Dold står inte i topplistan och firas som ”En säljare”."
      lage={
        installerad && lista.length > 0 ? (
          <span className="si-tal-lage">
            <b>{lista.length}</b> {lista.length === 1 ? "person" : "personer"}
            {dolda ? ` · ${dolda} dold${dolda === 1 ? "" : "a"}` : ""}
          </span>
        ) : null
      }
    >
      {!installerad ? (
        <Lugn />
      ) : personer === null ? (
        <Lugn>
          Säljarna i det nya laget gick inte att läsa. <a href="/salesboard/installningar">Ladda om sidan</a> för att se dem.
        </Lugn>
      ) : lista.length === 0 ? (
        <Lugn>Ingen kan synas på tavlan {i.lag ? "i laget" : ""} än.</Lugn>
      ) : (
        <ul className="si-personer">
          {lista.map((s) => (
            <Personrad
              key={s.id}
              s={s}
              i={i}
              lag={flera && s.lag ? (lagnamn.get(s.lag) ?? null) : null}
              k={k[`person:${s.id}`]}
              onAndra={onAndra}
            />
          ))}
        </ul>
      )}
    </Kort>
  );
}

function Personrad({
  s,
  i,
  lag,
  k,
  onAndra,
}: {
  s: Saljare;
  i: TavlansInstallningar;
  lag: string | null;
  k: Kvitto | undefined;
  onAndra: (s: Saljare, andring: Partial<Omit<PersonOp, "id">>) => void;
}) {
  // Som på tavlan: `arDold` avgör.
  const dold = arDold(s.visning);
  const pa = visningsnamn(s.fornamn, s.efternamn, i.namn, s.visning);
  const fullt = `${s.fornamn} ${s.efternamn}`.trim();

  return (
    <li className="si-person" data-dold={dold || undefined}>
      <span className="si-monogram" aria-hidden="true">
        {initialerFor(s.fornamn, s.efternamn, s.visning)}
      </span>
      <div className="si-person-text">
        <div className="si-rad-titel">
          <b>{fullt || "Utan namn"}</b>
          {s.varfor ? <span className="si-tagg" data-slutat={s.varfor === "Slutat" || undefined}>{s.varfor}</span> : null}
          {lag ? <span className="si-tagg">{lag}</span> : null}
          <Kvittens k={k} />
        </div>
        <p className="si-hjalptext">
          På tavlan: <span className="si-patavlan">{pa}</span>
          {dold ? " · inte i topplistan, inget personligt i firandet" : null}
        </p>
        <Felrad k={k} />
      </div>
      <div className="si-person-kontroller">
        <Segment<Visning> etikett={`Visning för ${fullt}`} varde={s.visning} alternativ={VISNINGAR} onChange={(v) => onAndra(s, { visning: v })} />
      </div>
    </li>
  );
}
