import type { Metadata } from "next";
import { headers } from "next/headers";
import localFont from "next/font/local";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { tavlansAdmin } from "@/lib/salesboard/atkomst";
import { normalisera } from "@/lib/salesboard/installningar";
import { lasSaljareOchTroskel, lasSkarmar, loggaSaknad } from "@/lib/salesboard/installningsdata";
import { KODALFABET, KODLANGD, KOD_GILTIG_MS } from "@/lib/salesboard/parning";
import { FEL, GRANSER, NAMN_MAX, installationslage, sidansVag, type Atkomstlage } from "@/lib/salesboard/skrivning";
import Installningar from "./Installningar";
import "./installningar.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Säljtavlan · inställningar" };

/**
 * Säljtavlans inställningar (spec §7), för admin och superadmin.
 *
 * Bara ett säkert svar styr vart man hamnar (`sidansVag`). Utan session skickas
 * man till inloggningen och tillbaka hit, och den som inte når admin får en rad
 * om vem som gör det. Går det inte att veta (`tavlansAdmin` kastar när databasen
 * inte svarar) står det att tavlan inte svarar just nu: aldrig en inloggning och
 * aldrig ett nej på en gissning.
 *
 * Annars läses allt korten visar, med service role efter `tavlansAdmin`:
 * inställningarna, lagen, skärmarna som inte kopplats bort, alla som tavlan kan
 * visa i sitt lag med sina val, och tröskeln för stor affär som tavlan räknar
 * den just nu. Säljarna och tröskeln läses som skrivrutten läser dem
 * (`installningsdata.ts`).
 *
 * 0250 BEHÖVER INTE VARA KÖRD. Inställningarna ligger i `nav_setting`, som
 * finns, så visningen, firandet och ljudet går att ändra ändå. Skärmarna,
 * säljarnas val och testet kräver 0250:s tabeller, och deras kort säger då att
 * tabellerna inte är installerade än. Men "saknas" gäller bara före 0250
 * (`installationslage`): svarar en av tabellerna och inte den andra är det ett
 * fel, och då visas inga säljare med ett val som kanske inte stämmer.
 *
 * Skärmarnas "sedd för …" läses sedan om av klienten, var för sig
 * (`GET /salesboard/skriv`), så att sidan aldrig byggs om i bakgrunden.
 *
 * Typsnitten är Nav 2.0:s egna, genom next/font som i `logga-in/Skal.tsx`:
 * /nav2/fonts kräver inloggning i mellanvaran, /_next/static gör det inte.
 */

const brodtext = localFont({
  src: "../../../../public/nav2/fonts/geist.woff2",
  weight: "100 900",
  variable: "--si-f-body",
  display: "swap",
});

const rubrik = localFont({
  src: "../../../../public/nav2/fonts/bricolage.woff2",
  weight: "200 800",
  variable: "--si-f-display",
  display: "swap",
});

const mono = localFont({
  src: "../../../../public/nav2/fonts/geist-mono.woff2",
  weight: "100 900",
  variable: "--si-f-mono",
  display: "swap",
});

/** Temat som valts i Nav 2.0 (`nav2-theme`) gäller också här, innan sidan ritas. Som i Skal.tsx. */
const TEMA = `try{var t=localStorage.getItem("nav2-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

/** En läsning som sidan inte klarar sig utan gick fel. */
function las(vad: string, fel: { code?: string; message?: string } | null | undefined): never {
  throw new Error(`Säljtavlans inställningar: ${vad} gick inte att läsa: ${fel?.code ?? ""} ${fel?.message ?? "okänt fel"}`);
}

function Ram({ nonce, children }: { nonce: string | undefined; children: React.ReactNode }) {
  return (
    <div className={`si-sida ${brodtext.variable} ${rubrik.variable} ${mono.variable}`}>
      <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: TEMA }} />
      {children}
    </div>
  );
}

/** En rad i stället för korten: den som inte får ändra, eller en tavla som inte svarar. */
function Besked({ rubrik, text, lank }: { rubrik: string; text: string; lank: { href: string; text: string } }) {
  return (
    <main className="si-nej">
      <p className="si-etikett">Säljtavlan</p>
      <h1>{rubrik}</h1>
      <p>{text}</p>
      <a className="si-knapp" href={lank.href}>
        {lank.text}
      </a>
    </main>
  );
}

const SVARAR_INTE = (
  <Besked
    rubrik={FEL.svararInte}
    text="Inställningarna gick inte att läsa. Skärmarna går vidare med det de har, och ingenting har ändrats."
    lank={{ href: "/salesboard/installningar", text: "Försök igen" }}
  />
);

/** Allt korten visar. Kastar när en läsning som sidan inte klarar sig utan går fel. */
async function lasAllt() {
  const db = supabaseAdmin();
  const [installningSvar, lagSvar, skarmar] = await Promise.all([
    db.from("nav_setting").select("value").eq("key", "salesboard").maybeSingle(),
    db.from("team").select("id, name").order("name"),
    lasSkarmar(db),
  ]);
  if (installningSvar.error) las("inställningarna", installningSvar.error);
  if (lagSvar.error) las("lagen", lagSvar.error);

  const installningar = normalisera((installningSvar.data as { value?: unknown } | null)?.value);
  const lagen = ((lagSvar.data ?? []) as { id: string; name: string }[]).map((l) => ({ id: l.id, namn: l.name }));

  // Laget tavlan faktiskt visar: ett lag som inte finns längre räknas som alla, som i `byggTavlan`.
  const lag = installningar.lag !== null && lagen.some((l) => l.id === installningar.lag) ? installningar.lag : null;
  const saljare = await lasSaljareOchTroskel(db, lag, [skarmar.lasning]);

  const lage = installationslage(skarmar.lasning, saljare.val, saljare.statistik);
  if (lage === "fel") las("säljtavlans tabeller (någon saknas fast resten av 0250 svarar)", skarmar.fel);
  if (saljare.personer === null) las("säljarna", null);
  if (lage === "ej") loggaSaknad("salesboard_screen");

  return {
    installningar,
    lagen,
    installerad: lage === "installerad",
    skarmar: lage === "installerad" ? skarmar.skarmar : [],
    personer: saljare.personer,
    troskel: saljare.troskel,
    serverNu: new Date().toISOString(),
  };
}

export default async function Sida() {
  const h = await headers();
  const nonce = h.get("x-nonce") ?? undefined;

  let lage: Atkomstlage;
  try {
    const user = await getCurrentUser();
    const admin = user ? await tavlansAdmin() : null;
    lage = admin?.employee ? { typ: "admin", id: admin.employee.id } : { typ: "nej", session: user !== null };
  } catch (e) {
    console.error("Säljtavlans inställningar: åtkomsten:", e instanceof Error ? e.message : e);
    lage = { typ: "oklart" };
  }

  const vag = sidansVag(lage);
  // Utanför try: redirect kastar, och det ska inte fångas som ett fel.
  if (vag === "inloggning") redirect("/logga-in?nasta=/salesboard/installningar");
  if (vag === "stopp") return <Ram nonce={nonce}>{SVARAR_INTE}</Ram>;
  if (vag === "nej") {
    return (
      <Ram nonce={nonce}>
        <Besked
          rubrik={FEL.inteAdmin}
          text="Säljchefer, teamledare och administratörer når inställningarna. Tavlan själv finns på /salesboard."
          lank={{ href: "/salesboard", text: "Till tavlan" }}
        />
      </Ram>
    );
  }

  let data: Awaited<ReturnType<typeof lasAllt>>;
  try {
    data = await lasAllt();
  } catch (e) {
    console.error("Säljtavlans inställningar:", e instanceof Error ? e.message : e);
    return <Ram nonce={nonce}>{SVARAR_INTE}</Ram>;
  }

  const vard = h.get("x-forwarded-host") ?? h.get("host") ?? "clicknet-nav.vercel.app";
  return (
    <Ram nonce={nonce}>
      <Installningar
        {...data}
        granser={{ ...GRANSER, namn: NAMN_MAX, kod: { alfabet: KODALFABET, langd: KODLANGD, giltigMs: KOD_GILTIG_MS } }}
        adress={`${vard}/salesboard`}
      />
    </Ram>
  );
}
