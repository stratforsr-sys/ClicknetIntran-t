"use client";

/**
 * Duken: 1920×1080 skalad till fönstret och centrerad (spec §4), så att tavlan ser
 * likadan ut på en 1080p-TV, en 4K-TV och en laptop. Tavlan, parningen och avbrottet
 * använder samma skala.
 */

import { useLayoutEffect, useState } from "react";

export type Dukskala = { s: number; x: number; y: number };

/** Skalan för fönstret just nu, eller null innan den räknats (duken visas inte förrän då). */
export function useDukskala(): Dukskala | null {
  const [skala, settSkala] = useState<Dukskala | null>(null);
  useLayoutEffect(() => {
    const satt = () => {
      const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
      settSkala({ s, x: (window.innerWidth - 1920 * s) / 2, y: (window.innerHeight - 1080 * s) / 2 });
    };
    satt();
    window.addEventListener("resize", satt);
    return () => window.removeEventListener("resize", satt);
  }, []);
  return skala;
}

/** Dukens stil för en skala: transform eller, före första mätningen, dold. */
export const dukstil = (skala: Dukskala | null): { className: string; style?: { transform: string } } =>
  skala
    ? { className: "sb-duk", style: { transform: `translate(${skala.x}px, ${skala.y}px) scale(${skala.s})` } }
    : { className: "sb-duk sb-duk-dold" };
