"use client";

import { useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { Bottennav } from "./Bottennav";
import { PanelLageProvider } from "./panellage";
import { SIDOPANEL_KAKA } from "./sidopanel";
import type { NavItem } from "./nav-items";
import type { Kvitto } from "@/lib/toast";
import { Toast } from "@/components/ui/Toast";

export function Skal({
  items,
  namn,
  roll,
  stamplingPa,
  hopfalldFranStart,
  klocka,
  kvitto,
  ruta,
  children,
}: {
  items: NavItem[];
  namn: string;
  roll: string;
  stamplingPa: boolean;
  hopfalldFranStart: boolean;
  klocka: ReactNode;
  kvitto: Kvitto | null;
  /**
   * Installningsrutan, fran den parallella rutten `@ruta`. Tom pa de flesta
   * sidvisningar. Den ritas HAR INNE och inte bredvid skalet, eftersom
   * utseendepanelen laser sidopanelens lage ur sammanhanget nedan.
   */
  ruta: ReactNode;
  children: ReactNode;
}) {
  const [oppen, setOppen] = useState(false);

  /**
   * UI-PRD §5.1: laget ska sparas.
   *
   * Det ligger i en kaka och inte i localStorage, och skalet ar vad man ser
   * forsta halvsekunden. localStorage gar bara att lasa efter att sidan
   * ritats, sa en hopfalld panel hade hunnit ritas utfalld och sedan slagit
   * ihop sig vid varje sidladdning. Kakan foljer med i requesten, sa servern
   * vet det redan innan den skickar nagot.
   *
   * Kakan skrivs harifran i stallet for med en server action: laget ar en
   * vy-installning utan foljder, och en rundtur till servern for att fa
   * tillbaka samma sida vore att betala for ingenting.
   */
  const [hopfalld, setHopfalld] = useState(hopfalldFranStart);

  function vaxlaHopfalld() {
    const nytt = !hopfalld;
    setHopfalld(nytt);
    document.cookie = `${SIDOPANEL_KAKA}=${nytt ? "hopfalld" : "oppen"}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    /**
     * Laget delas nedat i stallet for att kopieras. Utseendesektionen i
     * installningarna staller om samma sak som knappen i panelen, och den
     * ritas bade i rutan och pa /profil — se shell/panellage.tsx.
     */
    <PanelLageProvider value={{ hopfalld, vaxlaHopfalld }}>
      <div className="min-h-dvh">
        {/*
          X1 / WCAG 2.4.1 Bypass Blocks (niva A).
          =====================================================================
          Sidopanelen bar upp till sjutton lankar, och de star fore innehallet i
          traden pa VARJE sida. Utan den har lanken maste den som navigerar med
          tangentbord — eller med en skarmlasare, eller med en switch — tabba
          igenom hela menyn igen for att komma at det hen faktiskt oppnade
          sidan for. Sjutton tryck per sidbyte ar inte en olagenhet, det ar
          skalet att nagon slutar anvanda navet.

          Lanken ar forst i traden och syns bara nar den har fokus. Den ska
          INTE goras permanent synlig "for tydlighetens skull" — den ar riktad
          till den som tabbar, och for alla andra ar den brus.

          `sr-only` med `focus:not-sr-only` ar monstret; det som ofta gloms ar
          `focus:absolute` med ett z-index over sidopanelen, annars ritas
          lanken bakom den och far fokus utan att synas.
        */}
        <a
          href="#innehall"
          className="sr-only rounded-sm bg-brand-600 px-4 py-2 text-small font-semibold text-ink-inv focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50"
        >
          Hoppa till innehållet
        </a>
        <Sidebar
          items={items}
          namn={namn}
          roll={roll}
          oppen={oppen}
          stang={() => setOppen(false)}
          hopfalld={hopfalld}
          vaxlaHopfalld={vaxlaHopfalld}
        />
        <div
          className={
            hopfalld
              ? "px-4 lg:pl-[6.5rem] transition-[padding] duration-base ease-brand"
              : "px-4 lg:pl-[18rem] transition-[padding] duration-base ease-brand"
          }
        >
          <Topbar oppnaMeny={() => setOppen(true)} klocka={klocka} />
          {/* Innehallsyta maximalt 1440 px, centrerad (UI-PRD §6).
              Under 768 px ligger bottenraden over sidans nederkant, sa
              innehallet behover en botten som ar hogre an raden ar. */}
          {/* `tabIndex={-1}` gor att malet gar att FLYTTA FOKUS till. Utan det
              hoppar sidan dit visuellt medan tangentbordsfokus star kvar i
              menyn, och nasta tabb fortsatter i lank arton — alltsa exakt det
              lanken skulle losa. */}
          <main id="innehall" tabIndex={-1} className="mx-auto max-w-[1440px] pb-28 md:pb-16">
            {children}
          </main>
        </div>
        <Bottennav stamplingPa={stamplingPa} oppnaMeny={() => setOppen(true)} />
        {/* Sist i trädet och `fixed`: kvittot ligger over allt annat och ska
            inte kunna hamna under bottenraden pa en telefon. */}
        <Toast kvitto={kvitto} />
        {ruta}
      </div>
    </PanelLageProvider>
  );
}
