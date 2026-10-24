"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { uppdatera } from "@/lib/salesboard/installningar";
import type { TavlansInstallningar, Testtyp } from "@/lib/salesboard/typer";
// Bara typer: skrivning.ts drar in node:crypto genom parning.ts, och `import type`
// försvinner i bygget. Gränserna kommer som props från sidan.
import type { Delar, Saljare, Skarm, Troskel } from "@/lib/salesboard/skrivning";
import { Lampa, Pil, ansluten, ljudlage, useLyssna, useNu, type Granser, type Lag } from "./delar";
import { Firandekort } from "./kort/Firande";
import { Ljudkort } from "./kort/Ljud";
import { Malkort } from "./kort/Mal";
import { Saljarkort, type PersonOp } from "./kort/Saljarna";
import { Skarmkort } from "./kort/Skarmar";
import { Testkort } from "./kort/Testa";
import { Visningskort } from "./kort/Visning";
import { TEXT, hamtaSkarmar, useForslag, useKvitton, useSkrivning, type Utfall } from "./skrivvag";

/**
 * Säljtavlans inställningar (spec §7): sex kort i en kolumn, i specens ordning.
 * Skärmar, visning, firande, ljud, säljarna och testet. Här hålls tillståndet och
 * skrivningarna; korten står i `kort/`, byggstenarna i `delar.tsx` och skrivvägen
 * i `skrivvag.ts`.
 *
 * ===========================================================================
 * VARJE KONTROLL SPARAR DIREKT, OCH SÄGER DET.
 *
 * Ingen spara-knapp att glömma. En brytare och ett val sparas när de ändras, ett
 * tal och ett klockslag när fältet lämnas, och ett reglage när det stannat.
 * Ändringen syns på en gång och kvitteras med "Sparat" i 1,5 s bredvid det som
 * ändrades. Säger rutten nej står felet där i stället, och kontrollen går
 * tillbaka till det som faktiskt gäller.
 * ===========================================================================
 *
 * LJUDET. En `Ljudmotor` för hela sidan, som aldrig stängs. Den låses upp i
 * klicket på "Lyssna" och spelar sedan på den här datorn, i vald volym.
 *
 * SKÄRMARNAS LÄGE. Bara listan läses om, med `GET /salesboard/skriv`: var 30:e
 * sekund medan fliken syns, och var tredje medan en nyss parad TV hämtar sin
 * token. Sidan byggs aldrig om i bakgrunden, så en dålig läsning kan aldrig byta
 * ut den mot ett fel: den gamla listan står kvar, med en rad om att den inte
 * kunde uppdateras. Tiden räknas på serverns klocka (`forskjutning`).
 */

type Props = {
  installningar: TavlansInstallningar;
  lagen: Lag[];
  /** Finns 0250:s tabeller? Utan dem är skärmarna, säljarnas val och testet avstängda. */
  installerad: boolean;
  skarmar: Skarm[];
  /** Alla som tavlan kan visa i laget, med sina val. */
  personer: Saljare[];
  /** Tröskeln i läget auto just nu, eller null när den inte gick att räkna. */
  troskel: Troskel | null;
  granser: Granser;
  /** "clicknet-nav.vercel.app/salesboard" */
  adress: string;
  /** Serverns klocka när sidan byggdes. */
  serverNu: string;
};

type SkarmOp = { typ: "namn"; id: string; namn: string } | { typ: "ljud"; id: string; ljud: boolean } | { typ: "bort"; id: string };

const laggSkarm = (lista: Skarm[], op: SkarmOp): Skarm[] =>
  op.typ === "bort"
    ? lista.filter((s) => s.id !== op.id)
    : lista.map((s) => (s.id !== op.id ? s : op.typ === "namn" ? { ...s, namn: op.namn } : { ...s, ljud: op.ljud }));

const laggPerson = (lista: Saljare[], op: PersonOp): Saljare[] =>
  lista.map((s) => (s.id === op.id ? { ...s, visning: op.visning } : s));

const laggInstallning = (nu: TavlansInstallningar, delar: Delar): TavlansInstallningar => uppdatera(nu, delar);

/** Skärmlistan läses om så här ofta, och så här ofta medan en nyss parad TV hämtar sin nyckel. */
const OMLASNING_MS = 30_000;
const OMLASNING_PARAD_MS = 3_000;

export default function Installningar(p: Props) {
  const skriv = useSkrivning();
  const kvitton = useKvitton();
  const ljud = useLyssna();
  const [utloggad, setUtloggad] = useState(false);

  const inst = useForslag<TavlansInstallningar, Delar>(p.installningar, laggInstallning);
  const skarmar = useForslag<Skarm[], SkarmOp>(p.skarmar, laggSkarm);
  const personer = useForslag<Saljare[], PersonOp>(p.personer, laggPerson);
  const [personerInaktuella, setPersonerInaktuella] = useState(false);
  const [troskel, setTroskel] = useState(p.troskel);
  const [nyast, setNyast] = useState<string | null>(null);
  const [vantaPa, setVantaPa] = useState<{ id: string; till: number } | null>(null);
  const [forskjutning, setForskjutning] = useState(() => Date.parse(p.serverNu) - Date.now() || 0);
  const [uppdateringsfel, setUppdateringsfel] = useState<number | null>(null);

  const i = inst.visad;
  const k = kvitton.alla;

  const nej = useCallback(
    (id: string, u: Extract<Utfall, { ok: false }>) => {
      if (u.utloggad) setUtloggad(true);
      kvitton.fel(id, u.fel);
    },
    [kvitton],
  );

  // --- Skärmarna läses om medan sidan står öppen ------------------------------
  // En läsning som startade före en ändring av skärmarna kan bära den gamla
  // listan. Den tas bara när ingen skärm ändrats sedan den skickades.
  const skarmandringar = useRef(0);
  const { setBas: sattSkarmar, vantar: skarmarVantar } = skarmar;
  const vantar = useRef(skarmarVantar);
  vantar.current = skarmarVantar;
  const harSkarmar = skarmar.visad.length > 0;

  useEffect(() => {
    if (!p.installerad || (!harSkarmar && !vantaPa)) return;
    let stangd = false;
    const las = async () => {
      if (document.visibilityState !== "visible") return;
      const fore = skarmandringar.current;
      const u = await hamtaSkarmar();
      if (stangd) return;
      if (!u.ok) {
        if (u.utloggad) setUtloggad(true);
        setUppdateringsfel(Date.now());
        return;
      }
      setUppdateringsfel(null);
      if (u.svar.nu) setForskjutning(Date.parse(u.svar.nu) - Date.now() || 0);
      if (u.svar.skarmar && fore === skarmandringar.current && !vantar.current) sattSkarmar(u.svar.skarmar);
    };
    const t = setInterval(las, vantaPa ? OMLASNING_PARAD_MS : OMLASNING_MS);
    const synlig = () => {
      if (document.visibilityState === "visible") void las();
    };
    document.addEventListener("visibilitychange", synlig);
    return () => {
      stangd = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", synlig);
    };
  }, [p.installerad, harSkarmar, vantaPa, sattSkarmar]);

  // Den snabba omläsningen slutar när TV:n hämtat sin nyckel, eller efter 90 s.
  useEffect(() => {
    if (!vantaPa) return;
    const s = skarmar.visad.find((x) => x.id === vantaPa.id);
    if (!s || s.parad) {
      setVantaPa(null);
      return;
    }
    const t = setTimeout(() => setVantaPa(null), Math.max(0, vantaPa.till - Date.now()));
    return () => clearTimeout(t);
  }, [skarmar.visad, vantaPa]);

  // --- Skrivningarna -----------------------------------------------------------

  async function sparaInst(kontroll: string, vad: string, delar: Delar) {
    const forslag = inst.foresla(delar);
    kvitton.borjar(kontroll);
    const u = await skriv({ handling: "spara", delar });
    if (!u) return forslag.nej();
    if (!u.ok) {
      forslag.nej();
      return nej(kontroll, u);
    }
    forslag.ok(u.svar.installningar);
    if (u.svar.personer) {
      personer.setBas(u.svar.personer);
      setPersonerInaktuella(false);
    }
    if (u.svar.personerInaktuella) setPersonerInaktuella(true);
    if (u.svar.troskel !== undefined) setTroskel(u.svar.troskel);
    kvitton.klart(kontroll, vad);
  }

  async function andraSkarm(op: SkarmOp, kropp: object, kontroll: string, vad: string, klart = "Sparat") {
    const forslag = skarmar.foresla(op);
    kvitton.borjar(kontroll);
    const u = await skriv(kropp);
    skarmandringar.current++;
    if (!u || !u.ok) {
      forslag.nej();
      return u && nej(kontroll, u);
    }
    forslag.ok(u.svar.skarmar);
    kvitton.klart(kontroll, vad, klart);
  }

  async function para(kod: string, namn: string): Promise<boolean> {
    kvitton.borjar("para");
    const u = await skriv({ handling: "para", kod, namn }, { engang: true });
    if (!u) return false;
    skarmandringar.current++;
    if (!u.ok) {
      nej("para", u);
      return false;
    }
    if (u.svar.skarmar) skarmar.setBas(u.svar.skarmar);
    if (u.svar.ny) {
      setNyast(u.svar.ny);
      setVantaPa({ id: u.svar.ny, till: Date.now() + 90_000 });
    }
    kvitton.klart("para", namn, "Parad");
    return true;
  }

  async function sattPerson(s: Saljare, andring: Partial<Omit<PersonOp, "id">>) {
    const op: PersonOp = { id: s.id, visning: andring.visning ?? s.visning };
    const kontroll = `person:${s.id}`;
    const forslag = personer.foresla(op);
    kvitton.borjar(kontroll);
    // Bara visningen skickas (R33): en sida som stått öppen länge skriver aldrig över något annat.
    const u = await skriv({ handling: "person", id: s.id, display: op.visning });
    if (!u || !u.ok) {
      forslag.nej();
      return u && nej(kontroll, u);
    }
    forslag.ok();
    kvitton.klart(kontroll, `${s.fornamn} ${s.efternamn}`.trim());
  }

  async function testa(typ: Testtyp, etikett: string) {
    const kontroll = `test:${typ}`;
    kvitton.borjar(kontroll);
    const u = await skriv({ handling: "testa", typ }, { engang: true });
    if (!u) return;
    if (!u.ok) return nej(kontroll, u);
    kvitton.klart(kontroll, etikett, "Skickat");
  }

  const lista = personerInaktuella ? null : personer.visad;

  return (
    <main className="si-yta">
      <header className="si-topp">
        <p className="si-spar">
          <a href="/nav2">Nav</a>
          <span aria-hidden="true">/</span>
          <span>Säljtavlan</span>
        </p>
        <h1>Inställningar</h1>
        <Lagesrad
          installerad={p.installerad}
          skarmar={skarmar.visad}
          forskjutning={forskjutning}
          i={i}
          lag={p.lagen.find((l) => l.id === i.lag)?.namn ?? "Alla lag"}
        />
      </header>

      {utloggad ? (
        <div className="si-utloggad" role="alert">
          <span>{TEXT.utloggad}</span>
          <a className="si-knapp" href="/logga-in?nasta=/salesboard/installningar" target="_blank" rel="noopener">
            Logga in <Pil />
          </a>
        </div>
      ) : null}

      <Skarmkort
        installerad={p.installerad}
        skarmar={skarmar.visad}
        forskjutning={forskjutning}
        uppdateringsfel={uppdateringsfel}
        nyast={nyast}
        granser={p.granser}
        adress={p.adress}
        k={k}
        onPara={para}
        onNamn={(s, namn) => andraSkarm({ typ: "namn", id: s.id, namn }, { handling: "byt_namn", id: s.id, namn }, `skarm:${s.id}`, s.namn)}
        onLjud={(s, pa) => andraSkarm({ typ: "ljud", id: s.id, ljud: pa }, { handling: "ljud_skarm", id: s.id, ljud: pa }, `skarm:${s.id}`, s.namn)}
        onBort={(s) => andraSkarm({ typ: "bort", id: s.id }, { handling: "koppla_bort", id: s.id }, "skarmar", s.namn, "Bortkopplad")}
      />
      <Malkort i={i} granser={p.granser} k={k} spara={sparaInst} />
      <Visningskort i={i} lagen={p.lagen} personer={lista} k={k} spara={sparaInst} />
      <Firandekort i={i} troskel={troskel} granser={p.granser} k={k} spara={sparaInst} />
      <Ljudkort i={i} granser={p.granser} k={k} spara={sparaInst} ljud={ljud} />
      <Saljarkort installerad={p.installerad} i={i} personer={lista} lagen={p.lagen} k={k} onAndra={sattPerson} />
      <Testkort installerad={p.installerad} skarmar={skarmar.visad} forskjutning={forskjutning} k={k} onTesta={testa} />

      <p className="si-sr" role="status" aria-live="polite">
        <span key={kvitton.meddelande.n}>{kvitton.meddelande.text}</span>
      </p>
    </main>
  );
}

/** Tavlan i en rad: skärmarna, ljudet och laget. Omräknad var tionde sekund. */
function Lagesrad({ installerad, skarmar, forskjutning, i, lag }: { installerad: boolean; skarmar: Skarm[]; forskjutning: number; i: TavlansInstallningar; lag: string }) {
  const nu = useNu(10_000, forskjutning);
  const anslutna = skarmar.filter((s) => ansluten(s, nu)).length;
  return (
    <p className="si-lagesrad">
      <Lampa lage={anslutna > 0 ? "live" : "borta"} />
      <span>{skarmlage(installerad, skarmar.length, anslutna)}</span>
      <span aria-hidden="true">·</span>
      <span>{ljudlage(i, nu).kort}</span>
      <span aria-hidden="true">·</span>
      <span>{lag}</span>
    </p>
  );
}

/** "2 av 3 skärmar anslutna nu", som en lägesrad. */
function skarmlage(installerad: boolean, antal: number, anslutna: number): string {
  if (!installerad) return "Inga skärmar än";
  if (antal === 0) return "Ingen skärm parad";
  if (antal === 1) return anslutna ? "Skärmen är ansluten nu" : "Skärmen är inte ansluten nu";
  return `${anslutna} av ${antal} skärmar anslutna nu`;
}
