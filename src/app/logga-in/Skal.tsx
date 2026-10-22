import { headers } from "next/headers";
import localFont from "next/font/local";
import { iStockholm, klockslag } from "@/lib/inloggning";
import { Klocka, Lampa } from "./band";
import { Navmarke } from "./Navmarke";
import { Urtavla } from "./Urtavla";
import "./inloggning.css";

/**
 * Skalet runt inloggningens sidor: /logga-in, /logga-in/verifiera,
 * /byt-losenord och /uppstart. Samma märke, typsnitt och teman som Nav 2.0,
 * så att det man loggar in på ser ut som det man kommer till.
 *
 * Kortet har Nav 2.0:s mörka band överst, med navmärket, lampan som säger om
 * inloggningstjänsten svarar och klockan. Under bandet ligger sidans eget
 * innehåll.
 *
 * På en bred skärm delas sidan i två. Formuläret står på den ljusa halvan,
 * och bandet flyttar ut på den mörka, där urtavlan står: navmärket i stort,
 * med dygnet, dagsljuset och året (Urtavla.tsx). Bandet är samma element i
 * båda fallen, så lampan och klockan finns bara en gång. På en smal skärm
 * står kortet överst, där tangentbordet inte når, och tavlan stiger upp under
 * det ur skärmens nederkant.
 *
 * Typsnitten är Nav 2.0:s egna filer i public/nav2/fonts, men laddas genom
 * next/font. Adressen /nav2/fonts kräver inloggning i mellanvaran, så en
 * utloggad webbläsare hade fått inloggningssidan tillbaka i stället för
 * typsnittet. next/font lägger dem under /_next/static, som mellanvaran
 * släpper förbi, och förladdar dem.
 */
const brodtext = localFont({
  src: "../../../public/nav2/fonts/geist.woff2",
  weight: "100 900",
  variable: "--in-f-body",
  display: "swap",
});

const rubrik = localFont({
  src: "../../../public/nav2/fonts/bricolage.woff2",
  weight: "200 800",
  variable: "--in-f-display",
  display: "swap",
});

const mono = localFont({
  src: "../../../public/nav2/fonts/geist-mono.woff2",
  weight: "100 900",
  variable: "--in-f-mono",
  display: "swap",
});

/**
 * Temat som valts i Nav 2.0 (Inställningar → Utseende, `nav2-theme`) gäller
 * också här. Skriptet körs innan kortet ritas, annars blinkar sidan ljus för
 * den som valt mörkt. Det kräver svarets nonce: CSP:n kör inga inline-skript
 * utan.
 */
const TEMA = `try{var t=localStorage.getItem("nav2-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export async function Skal({
  children,
  fot,
}: {
  children: React.ReactNode;
  /** Vänstra delen av foten. Saknas den står bara bygget där. */
  fot?: React.ReactNode;
}) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  // Bygget står där för den som ska felsöka ("vilket bygge körde du?").
  // Vercel sätter variabeln vid varje bygge; lokalt finns den inte.
  const bygge = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
  const nu = new Date();
  const idag = iStockholm(nu);

  return (
    <div className={`in-sida ${brodtext.variable} ${rubrik.variable} ${mono.variable}`}>
      <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: TEMA }} />
      <main className="in-mitt">
        <div className="in-kort">
          <header className="in-band">
            <div className="in-marke">
              <Navmarke />
              <div>
                <div className="in-wm">nav</div>
                <div className="in-under">Clicknet</div>
              </div>
            </div>
            <div className="in-status">
              <Lampa />
              <Klocka start={klockslag(nu)} />
            </div>
          </header>
          <div className="in-innehall">{children}</div>
        </div>
      </main>
      <footer className="in-fot">
        {/* En div och inte ett p: foten kan bära ett formulär (Logga ut). */}
        <div>{fot}</div>
        {bygge ? (
          <p className="in-mono" title="Bygget som körs. Bra att ange om något krånglar.">
            Bygge {bygge}
          </p>
        ) : null}
      </footer>
      {/* Sist i koden: tavlan är det minst viktiga på sidan, och knappen som
          stoppar den kommer efter formuläret och foten i tabbordningen. */}
      <aside className="in-panel" aria-label="Dagsljuset i Stockholm">
        <Urtavla start={{ ar: idag.ar, manad: idag.manad, dag: idag.dag }} />
      </aside>
    </div>
  );
}
