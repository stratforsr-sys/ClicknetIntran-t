"use client";

/**
 * Tavlans källa (spec §8): hämtar ögonblicksbilden när ringklockan ringer, och
 * ändå med jämna mellanrum.
 *
 * - Den prenumererar på den publika broadcast-kanalen `salesboard` med
 *   supabase-js och anonnyckeln, utan auth-session. Signalen bär ingen data; en
 *   fejkad signal ger bara en extra hämtning.
 * - En ringning hämtar nu och en gång till 2,3 s senare, när serverns cache inte
 *   längre kan ge en gammal bild (beslut R24). Hämtningarna slås ihop till högst en
 *   per 1,5 s (hamtning.ts).
 * - Kanalen uppe: en hämtning var 60:e sekund ändå. Kanalen nere: var 8:e sekund
 *   under arbetsdagen och var 60:e annars. Nätet tillbaka: en hämtning direkt.
 * - En hämtning som inte svarat på 10 s avbryts och räknas som ett fel, så att en
 *   hängande uppkoppling aldrig fryser tavlan.
 * - Klockans förskjutning mot servern är den största som mätts de senaste minuterna:
 *   bilden kan komma ur serverns cache och vara upp till 2 s gammal.
 * - Bara ett riktigt 401 med en JSON-kropp betyder "inte parad" eller "inte
 *   inloggad", och då anropas `vid401` (tavlan väljer: en inloggad går till
 *   inloggningen, bara en skärm visar parningen). Allt annat som inte är en
 *   bild med status 200 är tillfälligt: en omdirigering (mellanvarans steg två
 *   eller lösenordsbyte), ett svar som inte är JSON eller inte en hel bild, 503,
 *   5xx, ett nätfel eller en tidsgräns. Då står den senaste bilden kvar, och efter
 *   två minuter står det offline.
 *
 * Källan beslutar ingenting om omladdning vid fel eller nytt bygge. Den
 * rapporterar (`Kallstatus`), och tavlan avgör, eftersom bara tavlan vet om
 * ett firande pågår.
 *
 * Får aldrig importera parning.ts, tavlan.ts eller atkomst.ts: de är
 * serverkod.
 */

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";
import { inomArbetsdag } from "@/lib/salesboard/regler";
import type { Ogonblick } from "@/lib/salesboard/typer";
import { TIDSGRANS_MS, VERKLIG_TID, hamtaInom, lasBild, nyForskjutning, nyHamtare } from "./hamtning.ts";

export type Kallstatus = {
  /** Ringklockans kanal är uppe. */
  live: boolean;
  /** När den senaste lyckade hämtningen kom (webbläsarens klocka, ms), eller null. */
  senast: number | null;
  /** Serverns klocka minus webbläsarens, ms. */
  offset: number;
  /** Misslyckade hämtningar i rad. */
  fel: number;
};

export type Kalla = (h: { bild: (b: Ogonblick) => void; status: (s: Kallstatus) => void }) => () => void;

const MED_KANAL_MS = 60_000;
const UTAN_KANAL_DAG_MS = 8_000;
const UTAN_KANAL_NATT_MS = 60_000;

/** Källan mot navet: `/salesboard/data` och kanalen `salesboard`. */
export function natkalla(o: { vid401?: () => void } = {}): Kalla {
  const vid401 = o.vid401 ?? (() => window.location.reload());
  return ({ bild, status }) => {
    let stoppad = false;
    let live = false;
    let senast: number | null = null;
    let offset = 0;
    let fel = 0;
    let arbetsdag = { fran: "08:00", till: "18:00" };
    let intervall: ReturnType<typeof setTimeout> | null = null;
    const forskjutning = nyForskjutning();

    const meddela = () => {
      if (!stoppad) status({ live, senast, offset, fel });
    };

    async function hamta(): Promise<void> {
      if (stoppad) return;
      try {
        const fore = Date.now();
        // Tidsgränsen gäller hela hämtningen, också kroppen: en server som stannar mitt i svaret är ett fel.
        const svar = await hamtaInom(VERKLIG_TID, TIDSGRANS_MS, (signal) =>
          fetch("/salesboard/data", {
            cache: "no-store",
            credentials: "same-origin",
            // En omdirigering följs inte: den blir ett ogenomskinligt svar, och det är ett tillfälligt fel.
            redirect: "manual",
            headers: { accept: "application/json" },
            signal,
          }),
        );
        if (svar.status === 401 && svar.arJson) {
          const kropp = svar.kropp;
          if (typeof kropp === "object" && kropp !== null && "fel" in kropp) {
            // Bortkopplad eller utloggad. Tavlan avgör vart sidan går.
            stoppad = true;
            vid401();
            return;
          }
        }
        if (svar.type === "opaqueredirect" || svar.redirected || svar.status !== 200 || !svar.arJson) {
          throw new Error(`tillfälligt: ${svar.status} ${svar.type}`);
        }
        const b = lasBild(svar.kropp);
        if (!b) throw new Error("tillfälligt: inte en hel ögonblicksbild");
        const efter = Date.now();
        if (stoppad) return;
        offset = forskjutning.lagg(efter, Date.parse(b.nu) - (fore + efter) / 2);
        senast = efter;
        fel = 0;
        arbetsdag = b.installningar.arbetsdag;
        bild(b);
      } catch {
        fel++;
      } finally {
        meddela();
      }
    }

    const hamtare = nyHamtare(VERKLIG_TID, hamta);

    /** Nästa hämtning utan signal: tätare när kanalen är nere och det är arbetsdag. Aldrig glesare än 60 s. */
    function nastaVanliga(): void {
      if (stoppad) return;
      const dag = inomArbetsdag(new Date(Date.now() + offset).toISOString(), arbetsdag);
      const vanta = live ? MED_KANAL_MS : dag ? UTAN_KANAL_DAG_MS : UTAN_KANAL_NATT_MS;
      intervall = setTimeout(() => {
        hamtare.begar();
        nastaVanliga();
      }, vanta);
    }

    let kanal: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;
    let klient: ReturnType<typeof createClient> | null = null;
    try {
      if (SUPABASE_URL && SUPABASE_ANON_KEY) {
        klient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        });
        kanal = klient
          .channel("salesboard")
          .on("broadcast", { event: "ping" }, () => hamtare.ring())
          .subscribe((s) => {
            const uppe = s === "SUBSCRIBED";
            if (uppe === live) return;
            live = uppe;
            meddela();
            // Kanalen kom upp: hämta direkt, en signal kan ha gått förlorad medan den var nere.
            if (uppe) hamtare.begar();
            if (intervall) clearTimeout(intervall);
            nastaVanliga();
          });
      }
    } catch {
      // Utan kanal går tavlan på hämtningarna var 8:e sekund.
      kanal = null;
    }

    const natetTillbaka = () => hamtare.begar();
    window.addEventListener("online", natetTillbaka);

    hamtare.begar();
    nastaVanliga();

    return () => {
      stoppad = true;
      hamtare.stoppa();
      window.removeEventListener("online", natetTillbaka);
      if (intervall) clearTimeout(intervall);
      if (kanal && klient) void klient.removeChannel(kanal).catch(() => undefined);
    };
  };
}
