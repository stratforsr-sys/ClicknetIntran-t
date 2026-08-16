import { Card } from "@/components/ui/Card";

/** Tydligt besked i stallet for en kraschad sida nar env saknas. */
export function EjKonfigurerad() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-12">
      <Card status="warn" className="w-full max-w-[34rem]">
        <h1 className="text-h1 text-ink-900">Navet saknar databaskoppling</h1>
        <p className="mt-3 text-body text-ink-500">
          Miljövariablerna <code className="tnum text-ink-700">NEXT_PUBLIC_SUPABASE_URL</code> och{" "}
          <code className="tnum text-ink-700">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> är inte satta i
          den här miljön. Lägg in dem i Vercel och deploya om.
        </p>
      </Card>
    </main>
  );
}
