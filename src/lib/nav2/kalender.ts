import "server-only";

import type { CurrentUser } from "@/lib/auth";
import { svensktDatum } from "@/lib/klocka";
import { hamtaDelningar } from "@/lib/kalender-server";
import { hamtaHandelsedetalj, hamtaLeveranskalender } from "@/lib/leveranskalender-server";
import { intervallForVy, overlamning, regeltext, type Post, type Vy } from "@/lib/leveranskalender";

/**
 * Nav 2.0: Kalendern, med samma funktioner som /kalender.
 *
 * Grunden är `hamtaLeveranskalender` — samma som sidan anropar — för den
 * inloggades egen kalender i månadens rutor. Kollegornas kalendrar och andra
 * månader hämtas när utkastet bläddrar dit eller kryssar i en kollega, via
 * `/nav2/kalender` (samma funktion, bara läsning). Delningsnivån avgör vad som
 * syns: en post med rubrik `null` är "Upptagen", som i navet.
 *
 * Förhandsvisningens plats, agenda och deltagarnas svar är `hamtaHandelsedetalj`,
 * också den med läsarens egen token.
 */

export type NdKalposter = { fran: string; till: string; poster: Post[] };

export type NdKalender = NdKalposter & {
  mig: string;
  personer: { id: string; namn: string; grupp: "salj" | "lev" | "ovr"; farg: number; niva: string }[];
  /** Obesvarade inbjudningar från i dag och framåt. */
  vantar: number;
  /** Vem jag delar min kalender med, och på vilken nivå. */
  delning: { id: string; namn: string; niva: string }[];
  /** Leveranskön, för projektledare, leverans och säljchef. */
  lev: {
    farSe: boolean;
    ko: { orderId: string; kund: string; paket: string | null; saljare: string | null; due: string | null; over: number; av: number }[];
  };
  arChef: boolean;
};

export async function hamtaKalposter(user: CurrentUser, vy: Vy, dag: string, visa: string[]): Promise<NdKalposter | null> {
  const data = await hamtaLeveranskalender(user, vy, dag, visa, svensktDatum());
  if (!data) return null;
  const { fran, till } = intervallForVy(vy, dag);
  return { fran, till, poster: data.poster };
}

export async function byggKalender(user: CurrentUser): Promise<NdKalender | null> {
  const idag = svensktDatum();
  const [data, delningar] = await Promise.all([hamtaLeveranskalender(user, "manad", idag, [], idag), hamtaDelningar(user)]);
  if (!data) return null;
  const { fran, till } = intervallForVy("manad", idag);
  return {
    fran,
    till,
    poster: data.poster,
    mig: data.mig,
    personer: data.personer.filter((p) => p.id !== data.mig).map((p) => ({ id: p.id, namn: p.namn, grupp: p.grupp, farg: p.farg, niva: p.niva })),
    vantar: data.vantar,
    delning: delningar.utat.map((d) => ({ id: d.employee_id, namn: d.namn, niva: d.niva })),
    lev: {
      farSe: data.lev.farSe,
      ko: data.lev.ko.map((k) => {
        const o = overlamning({ kontakt: k.kontakt, telefon: k.telefon, mal: k.mal, lovat: k.lovat, basta_tid: k.bastaTid, risker: k.risker });
        return { orderId: k.orderId, kund: k.kund, paket: k.paket, saljare: k.saljare, due: k.due, over: o.har, av: o.av };
      }),
    },
    arChef: data.arChef,
  };
}

/** En händelse för förhandsvisningen: plats, agenda och deltagarnas svar. */
export async function kalDetalj(user: CurrentUser, id: string) {
  const d = await hamtaHandelsedetalj(user, id);
  if (!d) return null;
  return {
    plats: d.plats,
    online: d.onlineUrl,
    agenda: d.agenda,
    organisator: d.organisator,
    deltagare: d.deltagare.map((x) => ({ id: x.id, svar: x.svar })),
    serieText: d.serie ? regeltext(d.serie) : null,
    paminnelse: d.paminnelse,
  };
}
