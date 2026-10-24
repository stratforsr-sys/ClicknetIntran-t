import { useId } from "react";
import { svenskaMinuter } from "@/lib/klocka";
import type { TavlansInstallningar } from "@/lib/salesboard/typer";
import { Brytare, Klockslag, Kort, Rad, Spela, klockslag, ljudlage, useNu, useUtkast, type Granser, type Lyssna, type Spara } from "../delar";
import { LJUD_LICENS } from "../../ljud";
import type { Kvitto } from "../skrivvag";

/**
 * 04 Ljud: på eller av, volymen, ljudtiden, helgerna, dygnet som en remsa och
 * "Lyssna" på den här datorn. Klientkod.
 */

export function Ljudkort({
  i,
  granser,
  k,
  spara,
  ljud,
}: {
  i: TavlansInstallningar;
  granser: Granser;
  k: Record<string, Kvitto>;
  spara: Spara;
  ljud: Lyssna;
}) {
  // Läget ("Låter nu", "Tyst nu") ändras med klockan, men inte fortare än så här.
  const nu = useNu(30_000);
  const lage = ljudlage(i, nu);
  const [volym, setVolym] = useUtkast(i.ljud.volym, (v) => void spara("volym", "Volymen", { ljud: { volym: v } }), 350);
  const volymId = useId();

  return (
    <Kort
      nr="05"
      rubrik="Ljud"
      text="Inspelade ljud: en kassa och ett horn för varje order, trumvirvel och smäll för en stor affär, fanfar och arena när målet nås. Gäller direkt på alla skärmar som spelar ljud."
      lage={<span className={lage.pa ? "si-ok" : "si-neutral"}>{lage.pa ? "Låter nu" : lage.kort}</span>}
    >
      <Rad titel="Ljud på" hjalp={lage.lang} k={k.pa}>
        <Brytare pa={i.ljud.pa} etikett="Ljud på" onChange={(pa) => void spara("pa", "Ljudet", { ljud: { pa } })} />
      </Rad>

      <Rad titel={<label htmlFor={volymId}>Volym</label>} hjalp="Målet nått är starkast, en vanlig order svagast." k={k.volym} bred>
        <span className="si-volym">
          <input
            id={volymId}
            type="range"
            min={granser.volym.min}
            max={granser.volym.max}
            step={1}
            value={volym}
            onChange={(e) => setVolym(Number(e.target.value))}
          />
          <output className="si-mono" htmlFor={volymId}>
            {volym}
          </output>
        </span>
      </Rad>

      <Rad titel="Ljudtid" hjalp="Tavlan låter bara inom ljudtiden. Den får gå över midnatt." k={k.ljudtid} bred>
        <span className="si-tidspar">
          <Klockslag etikett="Ljudtiden börjar" varde={i.ljud.fran} onSpara={(v) => void spara("ljudtid", "Ljudtiden", { ljud: { fran: v } })} />
          <span aria-hidden="true">–</span>
          <Klockslag etikett="Ljudtiden slutar" varde={i.ljud.till} onSpara={(v) => void spara("ljudtid", "Ljudtiden", { ljud: { till: v } })} />
        </span>
      </Rad>

      <Rad titel="Tyst på helger" hjalp="Lördag, söndag och röda dagar, som julafton." k={k.helgTyst}>
        <Brytare pa={i.ljud.helgTyst} etikett="Tyst på helger" onChange={(pa) => void spara("helgTyst", "Tyst på helger", { ljud: { helgTyst: pa } })} />
      </Rad>

      <div className="si-dygnrad">
        <Dygn arbetsdag={i.arbetsdag} ljud={i.ljud} nu={nu} />
      </div>

      <div className="si-lyssna">
        <button
          type="button"
          className="si-knapp"
          aria-pressed={ljud.spelar === "prov" || undefined}
          onClick={() =>
            void ljud.spela("prov", volym, 2600, (m, t) => {
              // En ny order som på tavlan: svischet, kassans "ching" när värdet landar, och hornet.
              m.spela("svisch", t, { styrka: 0.45, fran: 0.18 });
              m.spela("kassa", t + 1.07, { styrka: 1 });
              m.spela("horn", t + 1.54, { styrka: 0.5 });
            })
          }
        >
          <Spela />
          {ljud.spelar === "prov" ? "Spelar…" : "Lyssna"}
        </button>
        <span className="si-hjalptext">
          {ljud.lage === "blockerat" || ljud.lage === "saknas"
            ? "Webbläsaren släppte inte fram ljudet. Klicka en gång till, eller prova en annan webbläsare."
            : volym <= 0
              ? "Volymen är 0, så det hörs inget."
              : "En ny order, på den här datorn och i vald volym."}
        </span>
      </div>
      <p className="si-hjalptext si-licens">{LJUD_LICENS}</p>
    </Kort>
  );
}

/** Dygnet som en remsa: arbetsdagen och ljudtiden, och ett streck där klockan står. */
function Dygn({ arbetsdag, ljud, nu }: { arbetsdag: TavlansInstallningar["arbetsdag"]; ljud: TavlansInstallningar["ljud"]; nu: number }) {
  const minut = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };
  const spann = (fran: string, till: string): [number, number][] => {
    const a = minut(fran);
    const b = minut(till);
    if (a === b) return [];
    return a < b ? [[a, b]] : [[a, 1440], [0, b]];
  };
  const andel = (m: number) => `${(m / 1440) * 100}%`;
  const nuMin = svenskaMinuter(new Date(nu));
  const lanes: [string, [number, number][], string][] = [
    ["Arbetsdag", spann(arbetsdag.fran, arbetsdag.till), "si-dygn-arbete"],
    ["Ljudtid", ljud.pa ? spann(ljud.fran, ljud.till) : [], "si-dygn-ljud"],
  ];
  return (
    <figure className="si-dygn" aria-label={`Arbetsdag ${arbetsdag.fran}–${arbetsdag.till}, ljudtid ${ljud.fran}–${ljud.till}, klockan ${klockslag(nu)}`}>
      {lanes.map(([namn, delar, klass]) => (
        <div className="si-dygn-rad" key={namn}>
          <span className="si-etikett">{namn}</span>
          <span className="si-dygn-spar">
            {delar.map(([a, b]) => (
              <i key={a} className={klass} style={{ left: andel(a), width: andel(b - a) }} />
            ))}
            <b className="si-dygn-nu" style={{ left: andel(nuMin) }} />
          </span>
        </div>
      ))}
      <div className="si-dygn-rad si-dygn-skala" aria-hidden="true">
        <span className="si-dygn-nutext">
          <i />
          {klockslag(nu)}
        </span>
        <span className="si-dygn-spar">
          {[0, 6, 12, 18, 24].map((h) => (
            <span key={h} style={{ left: andel(h * 60) }}>
              {String(h).padStart(2, "0")}
            </span>
          ))}
        </span>
      </div>
    </figure>
  );
}
