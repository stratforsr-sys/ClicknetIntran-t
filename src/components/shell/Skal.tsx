"use client";

import { useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { Bottennav } from "./Bottennav";
import { SIDOPANEL_KAKA } from "./sidopanel";
import type { NavItem } from "./nav-items";
import type { Notis } from "@/lib/notiser";

export function Skal({
  items,
  namn,
  roll,
  stamplingPa,
  hopfalldFranStart,
  notiser,
  children,
}: {
  items: NavItem[];
  namn: string;
  roll: string;
  stamplingPa: boolean;
  hopfalldFranStart: boolean;
  notiser: Notis[];
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
    <div className="min-h-dvh">
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
        <Topbar oppnaMeny={() => setOppen(true)} notiser={notiser} />
        {/* Innehallsyta maximalt 1440 px, centrerad (UI-PRD §6).
            Under 768 px ligger bottenraden over sidans nederkant, sa
            innehallet behover en botten som ar hogre an raden ar. */}
        <main className="mx-auto max-w-[1440px] pb-28 md:pb-16">{children}</main>
      </div>
      <Bottennav stamplingPa={stamplingPa} oppnaMeny={() => setOppen(true)} />
    </div>
  );
}
