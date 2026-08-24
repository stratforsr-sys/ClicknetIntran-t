"use client";

import { createContext, useContext } from "react";

/**
 * Sidopanelens hopfallda lage, atkomligt utanfor skalet.
 *
 * Laget ar `useState` i Skal och en kaka i webblasaren (se sidopanel.ts).
 * Utseendesektionen i installningarna staller om samma sak, och den ritas pa
 * TVA stallen: i dialogen och pa /profil. Ett eget tillstand dar hade betytt
 * tre kallor som kan saga olika saker — panelen hopfalld och reglaget utfallt.
 *
 * Sammanhanget loser det utan att flytta nagot: Skal renderar `{children}`, sa
 * providern ligger over bade dialogen och sidan under den.
 */
export type PanelLage = {
  hopfalld: boolean;
  vaxlaHopfalld: () => void;
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
