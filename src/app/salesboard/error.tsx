"use client";

/**
 * Ett fel som når hit (ett kast i ritningen som inget skydd i tavlan fångade) får
 * aldrig lämna en TV på en felsida som någon måste gå fram och klicka bort. Sidan
 * visar samma lugna besked som när navet inte nås, och laddar om sig själv efter en
 * halv minut (`Avbrott`). Skärmens kaka rörs inte.
 */

import { useEffect } from "react";
import { Avbrott } from "./Parning";

export default function Fel({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("salesboard: ritningen föll", error.digest ?? error.message);
  }, [error]);
  return <Avbrott />;
}
