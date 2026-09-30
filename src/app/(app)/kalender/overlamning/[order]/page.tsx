import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hamtaKund } from "@/lib/leveranskalender-server";
import { overlamning } from "@/lib/leveranskalender";
import { Overlamningsformular } from "./Overlamningsformular";
import "../../leveranskalender.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Överlämning" };

/**
 * Säljarens överlämning till leveransen (0071): kundens mål, vad som lovades,
 * bästa tid att ringa och riskerna. Kontaktperson och telefon står på ordern
 * och ändras där.
 *
 * `leverans_kunder()` avgör vem som ser sidan: säljaren för sina egna kunder,
 * och leveransen och säljchefen för alla. Alla andra får 404 — en sida som
 * säger "du får inte se den här kunden" har redan berättat att kunden finns.
 */
export default async function Overlamningssidan({ params }: { params: Promise<{ order: string }> }) {
  const { order } = await params;
  const user = await getCurrentUser();
  if (!user?.employee || !/^[0-9a-f-]{36}$/.test(order)) notFound();
  const k = await hamtaKund(order);
  if (!k) notFound();
  const h = overlamning({ kontakt: k.kontakt, telefon: k.telefon, mal: k.mal, lovat: k.lovat, basta_tid: k.bastaTid, risker: k.risker });

  return (
    <div className="flex flex-col gap-3 pt-2">
      <div className="lk proto" style={{ maxWidth: 640, padding: "18px 20px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <span className="eyebrow">Överlämning till leveransen</span>
          <h3 style={{ fontSize: 19 }}>{k.kund}</h3>
          <span className={`hs ${h.saknas.length ? "part" : "full"}`}>
            Överlämning {h.har}/{h.av}
          </span>
          <dl className="kv">
            <dt>Kontakt</dt>
            <dd>{k.kontakt || <span className="missing">Saknas</span>}</dd>
            <dt>Telefon</dt>
            <dd className="mono">{k.telefon || <span className="missing">Saknas</span>}</dd>
          </dl>
          <p className="hint">Kontaktperson och telefon står på ordern och ändras där.</p>
          <Overlamningsformular
            orderId={k.orderId}
            start={{ mal: k.mal ?? "", lovat: k.lovat ?? "", bastaTid: k.bastaTid ?? "", risker: k.risker ?? "" }}
          />
        </div>
      </div>
    </div>
  );
}
