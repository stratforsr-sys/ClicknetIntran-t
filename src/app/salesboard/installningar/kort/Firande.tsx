import { MINSTA_UNDERLAG } from "@/lib/salesboard/regler";
import type { TavlansInstallningar } from "@/lib/salesboard/typer";
import type { Delar, Troskel } from "@/lib/salesboard/skrivning";
import { Belopp, Brytare, Kort, Rad, Segment, kr, useUtkast, type Granser, type Spara } from "../delar";
import type { Kvitto } from "../skrivvag";

/**
 * 04 Firande: stor affär med tröskeln som gäller just nu, brytarna för varje
 * ögonblick och efterregistrerade order. Klientkod.
 */

const BRYTARE_FIRANDE: { nyckel: keyof Omit<TavlansInstallningar["firande"], "storAffar" | "efterregistreradDagar">; titel: string; hjalp: string }[] = [
  { nyckel: "forstaOrdern", titel: "Första ordern", hjalp: "Säljarens första godkända order någonsin: ”Första ordern”, ”Välkommen till tavlan” och fanfaren i stället för hornet." },
  { nyckel: "dagensForsta", titel: "Dagens första", hjalp: "Lagets första order i dag får pillret ”Dagens första”." },
  { nyckel: "personbasta", titel: "Personbästa", hjalp: "Fler order i dag än säljarens bästa dag hittills, från två. Ett amber piller." },
  { nyckel: "dagsrekord", titel: "Dagsrekord", hjalp: "Lagets bästa dag i månaden, från tre order. En gång per dag." },
  { nyckel: "halvvags", titel: "Halvvägs", hjalp: "Målkortet säger ”Halvvägs” i sex sekunder när ordervärdet passerar halva målet, och mitten får ett märke." },
  { nyckel: "maletNatt", titel: "Målet nått", hjalp: "Det stora ögonblicket när ordervärdet når månadens mål, en gång per månad och skärm." },
];

export function Firandekort({
  i,
  troskel,
  granser,
  k,
  spara,
}: {
  i: TavlansInstallningar;
  troskel: Troskel | null;
  granser: Granser;
  k: Record<string, Kvitto>;
  spara: Spara;
}) {
  const stor = i.firande.storAffar;
  const auto = stor.lage === "auto";
  const [dagar, setDagar] = useUtkast(
    i.firande.efterregistreradDagar,
    (v) => void spara("efterregistrerad", "Efterregistrerad", { firande: { efterregistreradDagar: v } }),
    450,
  );
  const g = granser.efterregistreradDagar;

  return (
    <Kort nr="04" rubrik="Firande" text="Vad som får ett eget ögonblick. En vanlig order firas alltid.">
      <Rad
        titel="Stor affär"
        hjalp="Bärnstensfärgad panel, större värde och ett mässingslager i ljudet."
        k={k.storAffar}
        bred
        fot={
          <p className="si-troskel">
            <span className="si-etikett">Stor affär från</span>
            {auto && !troskel ? (
              <span>Tröskeln gick inte att räkna just nu.</span>
            ) : (
              <>
                <b className="si-mono">{kr(auto && troskel ? troskel.auto : stor.belopp)}</b>
                <span>
                  {auto && troskel
                    ? troskel.percentil
                      ? `topp 10 % av ${troskel.underlag} order de senaste 90 dagarna`
                      : `tills det finns ${MINSTA_UNDERLAG} order att räkna topp 10 % på (${troskel.underlag} de senaste 90 dagarna)`
                    : troskel
                      ? `Auto hade gett ${kr(troskel.auto)}.`
                      : null}
                </span>
              </>
            )}
          </p>
        }
      >
        <div className="si-stor">
          <Segment<TavlansInstallningar["firande"]["storAffar"]["lage"]>
            etikett="Stor affär"
            varde={stor.lage}
            onChange={(v) => void spara("storAffar", "Stor affär", { firande: { storAffar: { lage: v } } })}
            alternativ={[
              { v: "auto", etikett: "Auto (topp 10 %)" },
              { v: "belopp", etikett: "Fast belopp" },
            ]}
          />
          {auto ? null : (
            <Belopp
              varde={stor.belopp}
              grans={granser.belopp}
              onSpara={(v) => void spara("storAffar", "Beloppet", { firande: { storAffar: { belopp: v } } })}
            />
          )}
        </div>
      </Rad>

      {BRYTARE_FIRANDE.map((b) => (
        <Rad key={b.nyckel} titel={b.titel} hjalp={b.hjalp} k={k[b.nyckel]}>
          <Brytare
            pa={i.firande[b.nyckel]}
            etikett={b.titel}
            onChange={(pa) => {
              const firande: NonNullable<Delar["firande"]> = { [b.nyckel]: pa };
              void spara(b.nyckel, b.titel, { firande });
            }}
          />
        </Rad>
      ))}

      <Rad
        titel="Efterregistrerad"
        hjalp={`En order som signerats mer än ${dagar} ${dagar === 1 ? "dag" : "dagar"} före godkännandet räknas men firas inte. Pappersarbete som tas igen ska inte fira i klump.`}
        k={k.efterregistrerad}
        bred
      >
        <span className="si-stegare" role="group" aria-label="Efterregistrerad efter antal dagar">
          <button type="button" className="si-steg" aria-label="En dag färre" disabled={dagar <= g.min} onClick={() => setDagar(Math.max(g.min, dagar - 1))}>
            −
          </button>
          <output className="si-mono" aria-live="polite">
            {dagar}
          </output>
          <button type="button" className="si-steg" aria-label="En dag fler" disabled={dagar >= g.max} onClick={() => setDagar(Math.min(g.max, dagar + 1))}>
            +
          </button>
          <span className="si-enhet">{dagar === 1 ? "dag" : "dagar"}</span>
        </span>
      </Rad>
    </Kort>
  );
}
