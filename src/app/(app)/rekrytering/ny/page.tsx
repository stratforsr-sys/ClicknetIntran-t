import { supabaseServer } from "@/lib/supabase/server";
import { Nykandidatformular } from "./Nykandidatformular";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ny kandidat — Clicknet Nav" };

/**
 * E10.2, tills ansokningssidan pa clicknet.se finns: kandidaten laggs upp for
 * hand av den som rekryterar.
 *
 * Kallorna lases med anvandarens egen token. Far hen inte se dem far hen inte
 * rekrytera heller (0030), och da ar listan tom — vilket formularet sager rakt
 * ut i stallet for att visa en tom rullgardin.
 */
export default async function NyKandidat() {
  const supabase = await supabaseServer();
  const { data: kallor } = await supabase
    .from("recruitment_source")
    .select("slug, label")
    .eq("active", true)
    .order("sort");

  return <Nykandidatformular kallor={kallor ?? []} />;
}
