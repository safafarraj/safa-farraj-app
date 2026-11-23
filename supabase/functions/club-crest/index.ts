// Finds a football club's crest on Hebrew Wikipedia (infobox image) and stores its URL in club_crests.
// Called by the app right after a contact / opening is saved. Runs with the caller's JWT, so RLS applies.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const WIKI = "https://he.wikipedia.org/w/api.php";
const UA = "safa-farraj-app/1.0 (club crest lookup)";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const ABBR: Record<string, string> = {
  'ק"ש': "קרית שמונה", 'ב"ש': "באר שבע", 'ת"א': "תל אביב", 'פ"ת': "פתח תקווה", 'ר"ג': "רמת גן",
  'ראשל"צ': "ראשון לציון", 'ק"ג': "קרית גת", 'ק"א': "קרית אתא", 'ק"ב': "קרית ביאליק", 'ק"מ': "קרית מוצקין",
  'ק"י': "קרית ים", 'נ"צ': "נס ציונה", 'מ"א': "מעלה אדומים", 'כ"ס': "כפר סבא", 'ה"ש': "הוד השרון", 'ר"ה': "רמת השרון",
};
// club names as the agent types them -> a clean name
export function cleanClub(s: string): string {
  s = (s || "").replace(/[״“”]/g, '"').replace(/[׳’]/g, "'").replace(/\s+/g, " ").trim();
  s = s.replace(/"?צו פיוס"?/g, " ");
  for (const [k, v] of Object.entries(ABBR)) s = s.replace(new RegExp(`(^|\\s)${k.replace(/"/g, '"')}(?=\\s|$)`, "g"), `$1${v}`);
  s = s.replace(/(^|\s)הפ'\s*/g, "$1הפועל ").replace(/(^|\s)מכ'\s*/g, "$1מכבי ");
  s = s.replace(/(^|\s)(מ\.ס\.|מ\.כ\.|מ\.כדורגל|מועדון ספורט|מועדון כדורגל|F\.?C\.?)(?=\s|$)/g, " ");
  return s.replace(/קריית/g, "קרית").replace(/\s+/g, " ").trim();
}
export const keyOf = (club: string) => cleanClub(club).replace(/["'.\-–]/g, "").replace(/\s+/g, " ").trim();

const PREFIX = new Set(["הפועל", "מכבי", "בני", "בית\"ר", "ביתר", "עירוני", "הכח", "אחי", "אחווה", "מ", "ס", "כ", "fc", "f", "c"]);
const norm = (s: string) => s.replace(/[״"׳'.\-–()]/g, " ").replace(/קריית/g, "קרית").replace(/\s+/g, " ").trim();
// the distinctive words of the club name (city / name), all must appear in the page title
function coreWords(club: string): string[] {
  const w = norm(cleanClub(club)).split(" ").filter((x) => x && !PREFIX.has(x) && !/^\d+$/.test(x));
  return w.length ? w : norm(cleanClub(club)).split(" ").filter(Boolean);
}

async function wiki(params: Record<string, string>) {
  const u = new URL(WIKI);
  for (const [k, v] of Object.entries({ format: "json", formatversion: "2", origin: "*", ...params })) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`wiki ${r.status}`);
  return await r.json();
}

async function infoboxImage(title: string): Promise<{ url: string; title: string } | null> {
  const p = await wiki({ action: "parse", page: title, prop: "text|categories", section: "0", redirects: "1" });
  const html: string = p?.parse?.text || "";
  const cats: string = (p?.parse?.categories || []).map((c: any) => c.category).join(" ");
  if (!/כדורגל/.test(html + cats)) return null;
  const box = html.match(/<table[^>]*class="[^"]*infobox[^"]*"[\s\S]*?<\/table>/);
  if (!box) return null;
  for (const m of box[0].matchAll(/<img[^>]*src="([^"]+)"[^>]*>/g)) {
    const tag = m[0];
    const w = +(tag.match(/width="(\d+)"/)?.[1] || 0);
    if (w && w < 50) continue; // flags / icons
    let src = m[1];
    if (src.startsWith("//")) src = "https:" + src;
    if (!/wikimedia\.org\//.test(src) || /Flag_of|Disambig|Edit-clear/i.test(src)) continue;
    src = src.replace(/&amp;/g, "&").split("?")[0].replace(/\/(\d+)px-/, "/120px-");
    return { url: src, title: p.parse.title };
  }
  return null;
}

async function findCrest(club: string): Promise<{ url: string; title: string } | null> {
  const name = cleanClub(club);
  const core = coreWords(club);
  const seen = new Set<string>();
  for (const q of [`${name} כדורגל`, name]) {
    const s = await wiki({ action: "query", list: "search", srsearch: q, srlimit: "6", srnamespace: "0" });
    for (const hit of s?.query?.search || []) {
      const t: string = hit.title;
      if (seen.has(t)) continue;
      seen.add(t);
      const nt = norm(t);
      if (!core.every((w) => nt.includes(w))) continue;
      const img = await infoboxImage(t);
      if (img) return img;
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  let club = "";
  try { club = String((await req.json()).club || "").slice(0, 80); } catch { /* empty */ }
  if (!club.trim()) return json({ error: "club required" }, 400);
  const key = keyOf(club);
  const rest = (path: string, init: RequestInit = {}) =>
    fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: ANON, Authorization: auth, "Content-Type": "application/json", ...(init.headers || {}) } });

  // already known (found, or searched and not found)
  const have = await rest(`club_crests?key=eq.${encodeURIComponent(key)}&select=*`);
  if (!have.ok) return json({ error: "forbidden" }, 403);
  const rows = await have.json();
  if (rows.length) return json(rows[0]);

  let found: { url: string; title: string } | null = null;
  try { found = await findCrest(club); } catch (e) { return json({ error: String(e) }, 502); }
  const row = { key, club: club.trim(), image_url: found?.url ?? null, page_title: found?.title ?? null };
  const ins = await rest("club_crests?on_conflict=key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(row) });
  if (!ins.ok) return json({ error: "save failed" }, 500);
  return json((await ins.json())[0] ?? row);
});
