"use client";

import { useEffect, useState } from "react";
import { klockslag } from "@/lib/inloggning";
import { kolla, useNatlage, type Lage } from "./natlage";

/**
 * Kortets mörka band: lampan och klockan. Samma ton som stämpelraden på
 * Nav 2.0:s startsida, där läget och tiden också står i bandet.
 */

/** Den korta texten står på telefonen; den långa läses ändå upp. */
const LAMPA: Record<Lage, { lang: string; kort: string }> = {
  kollar: { lang: "Kontrollerar…", kort: "Kollar…" },
  uppe: { lang: "Navet svarar", kort: "Svarar" },
  langsam: { lang: "Svarar långsamt", kort: "Långsamt" },
  nere: { lang: "Inloggningen svarar inte", kort: "Svarar inte" },
  kontakt: { lang: "Ingen kontakt", kort: "Ingen kontakt" },
  offline: { lang: "Ingen anslutning", kort: "Offline" },
};

/** Så ofta lampan frågar igen medan sidan syns. Servern minns svaret i 15 s. */
const VARV_MS = 60_000;

/**
 * Svarar inloggningstjänsten? Den som inte kommer in vill veta om det är
 * lösenordet eller navet, och lampan svarar innan man ens försökt.
 *
 * Ingen live-region: lampan byter läge av sig själv, och en skärmläsare som
 * läste upp "Kontrollerar…" och "Navet svarar" vid varje sidladdning vore
 * bara brus. När något är fel säger formuläret det i stället, med ord.
 */
export function Lampa() {
  const { lage, ms } = useNatlage();

  useEffect(() => {
    void kolla();
    const syns = () => document.visibilityState === "visible";
    const varv = window.setInterval(() => {
      if (syns()) void kolla();
    }, VARV_MS);
    const tillbaka = () => {
      if (syns()) void kolla();
    };
    const natet = () => void kolla();
    document.addEventListener("visibilitychange", tillbaka);
    window.addEventListener("online", natet);
    window.addEventListener("offline", natet);
    return () => {
      window.clearInterval(varv);
      document.removeEventListener("visibilitychange", tillbaka);
      window.removeEventListener("online", natet);
      window.removeEventListener("offline", natet);
    };
  }, []);

  const text = LAMPA[lage];
  return (
    <span
      className="in-lampa"
      data-lage={lage}
      title={ms !== null ? `Inloggningen svarade på ${ms} ms` : undefined}
    >
      {/* Ny nyckel per läge: pricken pulserar tre gånger när läget byts, inte för evigt. */}
      <i key={lage} aria-hidden="true" />
      <span className="in-lampa-lang">{text.lang}</span>
      <span className="in-lampa-kort" aria-hidden="true">
        {text.kort}
      </span>
    </span>
  );
}

/**
 * Klockan, i svensk tid. Servern ritar minuten den svarade i (`start`), så
 * att första bilden har en tid och inget hoppar; sedan byter den på
 * minutslaget och direkt när fliken syns igen.
 */
export function Klocka({ start }: { start: string }) {
  const [nu, setNu] = useState<Date | null>(null);

  useEffect(() => {
    let t = 0;
    const slag = () => {
      const d = new Date();
      setNu(d);
      window.clearTimeout(t);
      t = window.setTimeout(slag, 60_000 - (d.getTime() % 60_000) + 50);
    };
    const tillbaka = () => {
      if (document.visibilityState === "visible") slag();
    };
    slag();
    document.addEventListener("visibilitychange", tillbaka);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("visibilitychange", tillbaka);
    };
  }, []);

  return (
    <time className="in-klocka" title="Svensk tid">
      {nu ? klockslag(nu) : start}
    </time>
  );
}
