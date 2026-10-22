"use client";

import { useSyncExternalStore } from "react";

/**
 * Nätläget som bandets lampa visar och formuläret läser.
 *
 *   kollar   första frågan är på väg
 *   uppe     inloggningstjänsten svarade
 *   langsam  den svarade, men långsamt (över 1,5 s från servern)
 *   nere     navet svarade, men inloggningstjänsten gjorde det inte
 *   kontakt  navet självt svarade inte (en handling eller frågan föll)
 *   offline  webbläsaren säger att den saknar nät
 *
 * Ett enda ställe, så att lampan och formuläret aldrig säger olika saker.
 */
export type Lage = "kollar" | "uppe" | "langsam" | "nere" | "kontakt" | "offline";
export type Natlage = { lage: Lage; ms: number | null };

const START: Natlage = { lage: "kollar", ms: null };

let nu: Natlage = START;
const lyssnare = new Set<() => void>();

function satt(n: Natlage) {
  if (n.lage === nu.lage && n.ms === nu.ms) return;
  nu = n;
  lyssnare.forEach((f) => f());
}

function prenumerera(f: () => void) {
  lyssnare.add(f);
  return () => {
    lyssnare.delete(f);
  };
}

export function useNatlage(): Natlage {
  return useSyncExternalStore(prenumerera, () => nu, () => START);
}

const utanNat = () => typeof navigator !== "undefined" && navigator.onLine === false;

let pagar: Promise<void> | null = null;

/** Frågar /logga-in/halsa. Samtidiga anrop delar på samma fråga. */
export function kolla(): Promise<void> {
  if (pagar) return pagar;
  pagar = (async () => {
    if (utanNat()) {
      satt({ lage: "offline", ms: null });
      return;
    }
    try {
      const r = await fetch("/logga-in/halsa", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const d = (await r.json()) as Natlage;
      satt({ lage: d.lage, ms: d.ms ?? null });
    } catch {
      satt({ lage: utanNat() ? "offline" : "kontakt", ms: null });
    }
  })().finally(() => {
    pagar = null;
  });
  return pagar;
}

/** En handling fick inget svar. Lampan säger det, och frågar igen om fem sekunder. */
export function rapporteraNatfel() {
  satt({ lage: utanNat() ? "offline" : "kontakt", ms: null });
  window.setTimeout(() => void kolla(), 5000);
}

/** Vad formuläret säger när en handling inte nådde fram. */
export function natfelText(): string {
  return utanNat()
    ? "Ingen anslutning till internet. Anslut och försök igen."
    : "Ingen kontakt med navet. Kontrollera nätet och försök igen.";
}

/**
 * En server action som inte når fram kastar, och ett kast i en action hamnar
 * i global-error.tsx: hela sidan byts mot ett felblad och det man skrivit är
 * borta. Omslaget fångar kastet, tänder lampan och ger formuläret ett vanligt
 * fel i stället. Utan nät försöker det inte ens.
 *
 * Läggs på modulnivå (en gång per action), inte i komponenten: useActionState
 * vill ha samma funktion vid varje rendering.
 */
export function skyddad<S>(
  action: (forra: S, form: FormData) => Promise<S>,
  vidNatfel: (text: string, forra: S, form: FormData) => S,
): (forra: S, form: FormData) => Promise<S> {
  return async (forra, form) => {
    if (utanNat()) {
      satt({ lage: "offline", ms: null });
      return vidNatfel(natfelText(), forra, form);
    }
    try {
      return await action(forra, form);
    } catch {
      rapporteraNatfel();
      return vidNatfel(natfelText(), forra, form);
    }
  };
}
