/**
 * Namnet pa kakan som bar sidopanelens lage (UI-PRD §5.1).
 *
 * Egen fil for att bade layouten pa servern och skalet i webblasaren ska lasa
 * samma strang. Ett stavfel pa ena stallet hade betytt att laget aldrig
 * sparades — och det ar en sorts fel som ingen anmaler, man bara slutar falla
 * ihop panelen.
 *
 * Kakan foljer webblasaren, inte kontot. Pa en delad kioskdator far alltsa
 * nasta person foregaende persons lage. Det ar en vy-installning utan
 * personuppgifter, sa priset ar en kolumn och en fraga per sidvisning som
 * ingen far tillbaka nagot for.
 *
 * Filen ar avsiktligt fri fran importer. Den lases av en serverkomponent
 * (layouten), av en klientkomponent (skalet) och av installningarna, och den
 * dagen den drar in nagot av `@/lib/auth` foljer halva serverkoden med ner i
 * webblasarens paket.
 */
export const SIDOPANEL_KAKA = "nav_sidopanel";

/**
 * Panelens tre lägen.
 *
 * `hovra` är det som tillkom 2026-09-09. Panelen står smal och tar bara sina
 * 4,5 rem av bredden, men fälls ut så fort musen är över den och åker in igen
 * när den lämnar. Det ger hopfällt lägets plats utan hopfällt läges pris —
 * man behöver inte längre välja mellan att se etiketterna och att ha ytan.
 *
 * Det ersätter inte `hopfalld`, och det var ett val. Den som arbetar på en
 * pekskärm, eller som råkar dra musen förbi kanten hela dagen, vill ha en
 * panel som ligger still. Ett läge som rör sig av misstag är värre än ett som
 * står stilla.
 */
export const PANELLAGEN = ["utfalld", "hopfalld", "hovra"] as const;
export type Panellage = (typeof PANELLAGEN)[number];

/**
 * Etiketterna. Bor har och inte i komponenterna: bade panelens egen vaxel och
 * utseendesektionen i installningarna staller om samma sak, och tva
 * beskrivningar av samma lage blir forr eller senare tva olika loften.
 */
export const PANELLAGE_TEXT: Record<Panellage, { namn: string; ikon: string; hjalp: string }> = {
  utfalld: {
    namn: "Utfälld",
    ikon: "panel-ut",
    hjalp: "Panelen står kvar med både ikoner och text.",
  },
  hopfalld: {
    namn: "Hopfälld",
    ikon: "panel-ihop",
    hjalp: "Bara ikoner. Mest plats åt innehållet, och panelen ligger still.",
  },
  hovra: {
    namn: "Hovra",
    ikon: "panel-hovra",
    hjalp: "Smal tills du för musen över den — då fälls den ut över innehållet.",
  },
};

/**
 * Kakans varde, tolkat.
 *
 * `"oppen"` ar det gamla vardet fran tiden da laget var ett ja eller nej. Det
 * ligger kvar i webblasaren hos alla som nagon gang fallt ut panelen, och
 * mappas till `utfalld` — annars hade uppgraderingen sett ut som att
 * instaellningen nollstalldes.
 */
export function lasPanellage(varde: string | undefined): Panellage {
  return (PANELLAGEN as readonly string[]).includes(varde ?? "")
    ? (varde as Panellage)
    : "utfalld";
}

/**
 * Ar posten den sida man star pa?
 *
 * Star har och inte i `nav-items.ts` for att bade panelen och vypanelen behover
 * den, och bada ar klientkomponenter. `nav-items.ts` importerar `@/lib/auth`.
 *
 * `/` provas exakt. Utan undantaget ar startsidan aktiv pa varje adress i
 * navet, eftersom allt borjar med snedstreck.
 */
export function arAktiv(path: string, href: string): boolean {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}
