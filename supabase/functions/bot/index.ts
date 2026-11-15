// In-app assistant: talks Hebrew with the agent and updates the app's data with tools.
// Runs as a Supabase Edge Function. Uses the caller's own login (RLS applies), and the
// ANTHROPIC_API_KEY secret that the owner set in the Supabase dashboard.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const MODEL = "claude-sonnet-5-5";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const TOOLS = [
  { name: "list_players", description: "כל השחקנים הפעילים: id, שם, סוג (mine/tracked), קבוצה, ליגה, עמדה, רגל, תאריכי לידה.", input_schema: { type: "object", properties: {} } },
  { name: "add_player", description: "הוספת שחקן חדש לפי קישור לפרופיל באתר ההתאחדות או player_id. השרת ימשוך את כל הנתונים שלו (כולל עונות קודמות) תוך כ-10–20 דקות.",
    input_schema: { type: "object", properties: { ifa: { type: "string", description: "קישור או מספר player_id" }, kind: { type: "string", enum: ["mine", "tracked"] } }, required: ["ifa", "kind"] } },
  { name: "update_player", description: "עדכון פרטים ידניים של שחקן. תאריכים בפורמט YYYY-MM-DD. kind מעביר בין 'שחקנים שלי' ל'במעקב'.",
    input_schema: { type: "object", properties: { player_id: { type: "integer" }, position: { type: "string" }, strong_foot: { type: "string", enum: ["ימין", "שמאל", "שתיהן"] }, birth_date: { type: "string" }, coach_birth_date: { type: "string" }, kind: { type: "string", enum: ["mine", "tracked"] } }, required: ["player_id"] } },
  { name: "remove_player", description: "הסרת שחקן מהאפליקציה (מפסיק מעקב, הנתונים נשמרים). רק אחרי שהסוכן אישר במפורש בשיחה.",
    input_schema: { type: "object", properties: { player_id: { type: "integer" }, confirmed_by_user: { type: "boolean" } }, required: ["player_id", "confirmed_by_user"] } },
  { name: "find_games", description: "משחקי הקבוצה של השחקן בעונה (ברירת מחדל: הנוכחית, 28). אפשר לסנן לפי יריב (חלק מהשם) או תאריך YYYY-MM-DD. מחזיר game_id, תאריך, קבוצות, תוצאה, ומה השחקן עשה (סטטוס, דקות, שערים, בישולים, לא נספר).",
    input_schema: { type: "object", properties: { player_id: { type: "integer" }, season_id: { type: "integer" }, opponent: { type: "string" }, date: { type: "string" } }, required: ["player_id"] } },
  { name: "update_game_player", description: "עדכון ידני לשחקן במשחק: בישולים, ו/או סימון 'לא לספור בחישוב דקות החוזה' (פציעה, נבחרת, הרחקה).",
    input_schema: { type: "object", properties: { player_id: { type: "integer" }, game_id: { type: "integer" }, assists: { type: "integer" }, excluded_from_contract: { type: "boolean" } }, required: ["player_id", "game_id"] } },
  { name: "add_note", description: "הוספת הערה לשחקן. from_who = מי נתן את ההערה, to_who = למי.",
    input_schema: { type: "object", properties: { player_id: { type: "integer" }, from_who: { type: "string" }, to_who: { type: "string" }, body: { type: "string" }, note_date: { type: "string" } }, required: ["player_id", "from_who", "to_who", "body"] } },
  { name: "add_contact", description: "הוספת איש קשר לשחקן (אבא, אמא, השחקן, מאמן, אחר).",
    input_schema: { type: "object", properties: { player_id: { type: "integer" }, role: { type: "string" }, name: { type: "string" }, phone: { type: "string" } }, required: ["player_id", "role"] } },
  { name: "attach_media", description: "שיוך סרטון/תמונה שהסוכן צירף בהודעה לשחקן. file_path מגיע מרשימת הקבצים המצורפים.",
    input_schema: { type: "object", properties: { player_id: { type: "integer" }, file_path: { type: "string" }, media_type: { type: "string", enum: ["video", "photo"] }, game_description: { type: "string" }, action_type: { type: "string", description: "שער, בישול, דריבל, פעולת הגנה, מסירה, אחר" }, taken_on: { type: "string" } }, required: ["player_id", "file_path", "media_type"] } },
  { name: "propose_contract", description: "הצעת נתוני חוזה שחולצו מקובץ שצורף. לא נשמר! הסוכן יראה טופס ויאשר בעצמו. שדה שלא מופיע בחוזה – להשמיט.",
    input_schema: { type: "object", properties: { player_id: { type: "integer" }, contract_type: { type: "string", enum: ["agent", "club"] }, file_path: { type: "string" }, start_date: { type: "string" }, end_date: { type: "string" }, minutes_commitment_pct: { type: "number" }, discounts: { type: "string" }, travel_allowance: { type: "string" }, salary: { type: "string" }, release_clause: { type: "string" }, extension_option: { type: "string" }, agent_fee: { type: "string" } }, required: ["player_id", "contract_type"] } },
];

const SYSTEM = (today: string) => `אתה העוזר באפליקציה SAFA FARRAJ של ספא פראג', סוכן שחקני כדורגל בישראל. היום ${today}.
ענה תמיד בעברית, קצר וענייני. בצע את מה שהסוכן מבקש בעזרת הכלים.
- כשמוזכר שחקן בשם, השתמש ב-list_players כדי למצוא את ה-id. אם יש ספק לאיזה שחקן הכוונה – שאל.
- כשמוזכר משחק ("המשחק נגד X", "שבת שעברה") – מצא אותו עם find_games לפני עדכון.
- קבצים מצורפים: סרטון/תמונה → attach_media (שאל לאיזה שחקן אם לא ברור; את מהות הפעולה והמשחק אפשר להשמיט אם לא נאמרו). חוזה (PDF/תמונה של מסמך) → קרא אותו וקרא ל-propose_contract עם השדות שמופיעים בו; הסוכן יאשר בטופס.
- הסרת שחקן רק אחרי אישור מפורש בשיחה.
- אל תמציא נתונים. נתוני משחקים, דקות, שערים וכרטיסים מגיעים אוטומטית מאתר ההתאחדות ולא מתעדכנים ידנית (חוץ מבישולים וסימון 'לא נספר').
- בסוף כל פעולה אמור בשורה מה עשית.`;

type Att = { path: string; bucket: string; name: string; type: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ reply: "הבוט עוד לא הופעל: חסר מפתח ANTHROPIC_API_KEY בהגדרות Supabase." });
  const auth = req.headers.get("Authorization") || "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY") || "sb_publishable_L6cOYyrPJLlkVc045WG6Bg_wFXjEYoh", { global: { headers: { Authorization: auth } } });
  const { data: ok } = await sb.rpc("is_app_user");
  if (!ok) return json({ error: "unauthorized" }, 401);

  const { history = [], text = "", attachments = [] } = await req.json() as { history: { role: string; text: string }[]; text: string; attachments: Att[] };
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jerusalem" });

  // current user turn: text + attachments (documents/images are shown to the model, videos only by name)
  const content: unknown[] = [];
  for (const a of attachments.slice(0, 5)) {
    const isDoc = a.type === "application/pdf", isImg = /^image\/(jpeg|png|gif|webp)$/.test(a.type);
    if (isDoc || isImg) {
      const { data } = await sb.storage.from(a.bucket).download(a.path);
      if (data && data.size < (isDoc ? 8_000_000 : 4_500_000)) {
        const b64 = btoa(Array.from(new Uint8Array(await data.arrayBuffer()), (c) => String.fromCharCode(c)).join(""));
        content.push(isDoc ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
          : { type: "image", source: { type: "base64", media_type: a.type, data: b64 } });
      }
    }
  }
  const attList = attachments.length ? "\n\nקבצים מצורפים:\n" + attachments.map((a) => `- ${a.name} (${a.type}) file_path=${a.path} bucket=${a.bucket}`).join("\n") : "";
  content.push({ type: "text", text: (text || "(ללא טקסט)") + attList });

  const messages: any[] = history.slice(-12).filter((m) => m.text).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.text }));
  while (messages.length && messages[0].role !== "user") messages.shift();
  messages.push({ role: "user", content });

  const actions: unknown[] = [];
  let changed = false;

  const run = async (name: string, i: any): Promise<unknown> => {
    switch (name) {
      case "list_players": {
        const { data } = await sb.from("players").select("id,name,kind,team_name,league_name,age_group,position,strong_foot,birth_date,birth_month_year,coach_name,coach_birth_date,shirt_number,ifa_player_id").eq("active", true).order("id");
        return data;
      }
      case "add_player": {
        const m = String(i.ifa).match(/player_id=(\d+)/) || String(i.ifa).match(/^\s*(\d{4,})\s*$/);
        if (!m) return { error: "לא נמצא player_id בקישור" };
        const ifaId = +m[1];
        const { data: ex } = await sb.from("players").select("id,name,active,kind").eq("ifa_player_id", ifaId).maybeSingle();
        if (ex) {
          await sb.from("players").update({ active: true, kind: i.kind }).eq("id", ex.id);
          changed = true;
          return { ok: true, existing: true, player_id: ex.id, name: ex.name };
        }
        const { data, error } = await sb.from("players").insert({ ifa_player_id: ifaId, kind: i.kind, name: "שחקן חדש (בטעינה)", active: true }).select("id").single();
        if (error) return { error: error.message };
        changed = true;
        return { ok: true, player_id: data.id, note: "הנתונים ייטענו אוטומטית מאתר ההתאחדות בסבב הסנכרון הקרוב (עד ~20 דקות)." };
      }
      case "update_player": {
        const { player_id, ...v } = i;
        const { error } = await sb.from("players").update(v).eq("id", player_id);
        if (!error) changed = true;
        return error ? { error: error.message } : { ok: true };
      }
      case "remove_player": {
        if (!i.confirmed_by_user) return { error: "צריך אישור מפורש מהסוכן" };
        const { error } = await sb.from("players").update({ active: false }).eq("id", i.player_id);
        if (!error) changed = true;
        return error ? { error: error.message } : { ok: true };
      }
      case "find_games": {
        const { data: p } = await sb.from("players").select("id,ifa_team_id,current_season_id").eq("id", i.player_id).single();
        if (!p) return { error: "שחקן לא נמצא" };
        const sid = i.season_id || p.current_season_id || 28;
        let teamId = p.ifa_team_id;
        if (sid !== p.current_season_id) {
          const { data: ps } = await sb.from("player_seasons").select("ifa_team_id").eq("player_id", p.id).eq("season_id", sid).maybeSingle();
          teamId = ps?.ifa_team_id;
        }
        let q = sb.from("games").select("id,game_date,kickoff_time,competition,home_team,away_team,home_score,away_score,status,game_players(player_id,status,minutes,goals,assists,excluded_from_contract)").eq("season_id", sid).eq("ifa_team_id", teamId).order("game_date");
        if (i.date) q = q.eq("game_date", i.date);
        const { data } = await q;
        let rows = (data || []).map((g: any) => ({ ...g, me: (g.game_players || []).find((x: any) => x.player_id === p.id) || null, game_players: undefined }));
        if (i.opponent) rows = rows.filter((g: any) => (g.home_team + " " + g.away_team).includes(i.opponent));
        return rows.slice(-25).map(({ id, ...g }: any) => ({ game_id: id, ...g }));
      }
      case "update_game_player": {
        const v: Record<string, unknown> = {};
        if (i.assists != null) v.assists = i.assists;
        if (i.excluded_from_contract != null) v.excluded_from_contract = i.excluded_from_contract;
        const { data, error } = await sb.from("game_players").update(v).eq("game_id", i.game_id).eq("player_id", i.player_id).select("id");
        if (error) return { error: error.message };
        if (!data?.length) return { error: "אין לשחקן רישום במשחק הזה (ההרכב עוד לא פורסם?)" };
        changed = true;
        return { ok: true };
      }
      case "add_note": {
        const { error } = await sb.from("notes").insert({ ...i, note_date: i.note_date || today });
        if (!error) changed = true;
        return error ? { error: error.message } : { ok: true };
      }
      case "add_contact": {
        const { error } = await sb.from("contacts").insert(i);
        if (!error) changed = true;
        return error ? { error: error.message } : { ok: true };
      }
      case "attach_media": {
        const { error } = await sb.from("media").insert({ ...i, taken_on: i.taken_on || today });
        if (!error) changed = true;
        return error ? { error: error.message } : { ok: true };
      }
      case "propose_contract": {
        const att = attachments.find((a) => a.path === i.file_path);
        if (att && att.bucket !== "contracts") {  // keep contract files in the contracts bucket
          const { data } = await sb.storage.from(att.bucket).download(att.path);
          if (data) {
            const to = `${i.player_id}/${i.contract_type}-${Date.now()}-${att.name.replace(/[^\w.]+/g, "_")}`;
            const up = await sb.storage.from("contracts").upload(to, data, { contentType: att.type });
            if (!up.error) { await sb.storage.from(att.bucket).remove([att.path]); i.file_path = to; }
          }
        }
        actions.push({ type: "contract", fields: i });
        return { ok: true, note: "הטופס מוצג לסוכן לאישור" };
      }
    }
    return { error: "unknown tool" };
  };

  for (let step = 0; step < 8; step++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, system: SYSTEM(today), tools: TOOLS, messages }),
    });
    if (!r.ok) {
      const t = await r.text();
      console.error("anthropic", r.status, t.slice(0, 300));
      const msg = r.status === 401 ? "המפתח של Claude לא תקין." : /credit|billing/i.test(t) ? "נגמר הקרדיט בחשבון Claude API. אפשר להטעין ב-console.anthropic.com." : "שגיאה בחיבור ל-Claude. נסה שוב בעוד רגע.";
      return json({ reply: msg, actions, changed });
    }
    const out = await r.json();
    messages.push({ role: "assistant", content: out.content });
    if (out.stop_reason !== "tool_use") {
      const reply = out.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();
      return json({ reply: reply || "בוצע.", actions, changed });
    }
    const results = [];
    for (const c of out.content) if (c.type === "tool_use") {
      let res: unknown;
      try { res = await run(c.name, c.input); } catch (e) { res = { error: String(e) }; }
      results.push({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify(res).slice(0, 20000) });
    }
    messages.push({ role: "user", content: results });
  }
  return json({ reply: "הבקשה ארוכה מדי, נסה לפצל אותה.", actions, changed });
});
