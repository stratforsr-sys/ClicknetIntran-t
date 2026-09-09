"use client";

import { createContext, useContext } from "react";
import type { Panellage } from "./sidopanel";

/**
 * Sidopanelens lage, atkomligt utanfor skalet.
 *
 * Laget ar `useState` i Skal och en kaka i webblasaren (se sidopanel.ts).
 * Utseendesektionen i installningarna staller om samma sak, och den ritas pa
 * TVA stallen: i dialogen och pa /profil. Ett eget tillstand dar hade betytt
 * tre kallor som kan saga olika saker — panelen hopfalld och reglaget utfallt.
 *
 * Sammanhanget loser det utan att flytta nagot: Skal renderar `{children}`, sa
 * providern ligger over bade dialogen och sidan under den.
 *
 * Sedan 2026-09-09 ar laget TRE varden och inte en vaxel. Det ar darfor
 * `valjLage(lage)` och inte `vaxla()`: en vaxel over tre lagen tvingar den som
 * vill komma fran hopfalld till utfalld att passera hovra, och en installning
 * man klickar sig runt i ar en installning man klickar fel i.
 */
export type PanelLage = {
  lage: Panellage;
  valjLage: (lage: Panellage) => void;
};

const Sammanhang = createContext<PanelLage | null>(null);

export const PanelLageProvider = Sammanhang.Provider;

export function usePanelLage(): PanelLage {
  const lage = useContext(Sammanhang);
  // Kastar hellre an returnerar ett tyst standardvarde: ett reglage som ser ut
  // att fungera men inte staller om nagot ar varre an ett fel i bygget.
  if (!lage) throw new Error("usePanelLage anvands utanfor Skal");
  return lage;
}
