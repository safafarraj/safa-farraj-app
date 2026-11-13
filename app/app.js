// SAFA FARRAJ – player agent app (vanilla JS, Supabase backend)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = 'https://pwrtyfpvzhafkwtjxcji.supabase.co';
const SUPABASE_KEY = 'sb_publishable_L6cOYyrPJLlkVc045WG6Bg_wFXjEYoh'; // publishable (safe in the browser)
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const fmtDate = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}`; };
const dayName = (iso) => DAYS[new Date(iso + 'T12:00:00').getDay()];
const todayIso = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })).toISOString().slice(0, 10);
const crestUrl = (teamId) => `/crests/${teamId}.png`;

const ICON = {
  back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  bell: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  home: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/><circle cx="12" cy="12" r="3"/></svg>',
  cal: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>',
  gear: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  logo: '<svg width="34" height="34" viewBox="0 0 100 100" role="img" aria-label="SAFA FARRAJ"><rect width="100" height="100" rx="28" fill="#C8F03C"/><text x="35" y="80" text-anchor="middle" direction="ltr" font-family="Karantina, Rubik, sans-serif" font-weight="700" font-size="84" fill="#0C1712">S</text><path d="M58 20v62M58 22h28M58 50h18" stroke="#0C1712" stroke-width="8" stroke-linecap="round" fill="none"/><circle cx="80" cy="76" r="12.5" fill="#F2F5EE" stroke="#0C1712" stroke-width="3.5"/><path d="M80 71L84.76 74.45L82.94 80.05L77.06 80.05L75.24 74.45Z" fill="#0C1712"/><path d="M80 71V65M84.76 74.45L90.5 72.6M82.94 80.05L86.5 85M77.06 80.05L73.5 85M75.24 74.45L69.5 72.6" stroke="#0C1712" stroke-width="2.2" stroke-linecap="round"/></svg>',
  play: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
};

// ---------------------------------------------------------------- state
const S = { players: [], leagues: {}, games: [], gp: [], seasons: [], unread: 0, ui: {} };

async function loadCore() {
  const [p, l, g, gp, ps, n] = await Promise.all([
    sb.from('players').select('*').eq('active', true).order('id'),
    sb.from('leagues').select('*'),
    sb.from('games').select('*').order('game_date').order('kickoff_time', { nullsFirst: true }),
    sb.from('game_players').select('*'),
    sb.from('player_seasons').select('*').order('season_id', { ascending: false }),
    sb.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null),
  ]);
  for (const r of [p, l, g, gp, ps]) if (r.error) throw r.error;
  S.players = p.data; S.games = g.data; S.gp = gp.data; S.seasons = ps.data;
  S.leagues = Object.fromEntries(l.data.map((x) => [x.ifa_league_id, x]));
  S.unread = n.count || 0;
}

const playerById = (id) => S.players.find((p) => String(p.id) === String(id));
const gameLength = (p) => (S.leagues[p.ifa_league_id] || {}).game_length_min || 90;
const teamGames = (p) => S.games.filter((g) => g.ifa_team_id === p.ifa_team_id);

function perspective(p, g) {
  const home = g.home_team === p.team_name || (g.home_team && p.team_name && g.home_team.startsWith(p.team_name));
  const ours = home ? g.home_score : g.away_score, theirs = home ? g.away_score : g.home_score;
  const res = ours == null ? null : ours > theirs ? 'W' : ours < theirs ? 'L' : 'D';
  return { home, opp: home ? g.away_team : g.home_team, ours, theirs, res };
}

function roleText(gp) {
  if (!gp) return '';
  if (gp.status === 'starter') return gp.minute_out ? `פתח · יצא ${gp.minute_out}'` : 'פתח בהרכב';
  if (gp.status === 'sub_in') return `נכנס ${gp.minute_in}'`;
  if (gp.status === 'bench') return 'בסגל, לא שותף';
  return 'לא בסגל';
}

function stats(p) {
  const L = gameLength(p);
  const finals = teamGames(p).filter((g) => g.status === 'final');
  const rows = finals.map((g) => ({ g, gp: S.gp.find((x) => x.game_id === g.id && x.player_id === p.id) }));
  const counted = rows.filter((r) => !(r.gp && r.gp.excluded_from_contract));
  const played = counted.reduce((a, r) => a + (r.gp ? r.gp.minutes : 0), 0);
  const possible = counted.length * L;
  const sum = (k) => rows.reduce((a, r) => a + (r.gp ? r.gp[k] || 0 : 0), 0);
  return {
    L, rows, played, possible, pct: possible ? (100 * played) / possible : null,
    starts: rows.filter((r) => r.gp && r.gp.status === 'starter').length,
    subs: rows.filter((r) => r.gp && r.gp.status === 'sub_in').length,
    unused: rows.filter((r) => !r.gp || r.gp.status === 'bench' || r.gp.status === 'not_in_squad').length,
    games: rows.length, goals: sum('goals'), assists: sum('assists'), yellow: sum('yellow_cards'), red: sum('red_cards'),
  };
}

// ---------------------------------------------------------------- router
const routes = [];
const route = (re, fn) => routes.push([re, fn]);
function go(hash) { location.hash = hash; }
window.addEventListener('hashchange', render);

function shell(title, body, { back = false, tab = 'home' } = {}) {
  $app.innerHTML = `
  <header class="top">
    ${back ? `<button class="icon" aria-label="חזרה" data-act="back">${ICON.back}</button>` : ''}
    ${ICON.logo}
    <div class="title num ell">${esc(title)}</div>
    <button class="icon" aria-label="מרכז התראות" data-go="#/alerts">${ICON.bell}${S.unread ? `<span class="badge">${S.unread > 99 ? '99+' : S.unread}</span>` : ''}</button>
  </header>
  <main>${body}</main>
  <nav class="bottom">
    <button class="${tab === 'home' ? 'on' : ''}" data-go="#/">${ICON.home}<span>בית</span></button>
    <button class="${tab === 'schedule' ? 'on' : ''}" data-go="#/schedule">${ICON.cal}<span>לוח משחקים</span></button>
    <button class="${tab === 'settings' ? 'on' : ''}" data-go="#/settings">${ICON.gear}<span>הגדרות</span></button>
  </nav>`;
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-go],[data-act]');
  if (!el) return;
  if (el.dataset.go) { e.preventDefault(); go(el.dataset.go); return; }
  if (el.dataset.act === 'back') { history.length > 1 ? history.back() : go('#/'); return; }
  const fn = actions[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el); }
});
const actions = {};

function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function modal(html) {
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog">${html}</div>`;
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) bg.remove(); });
  document.body.appendChild(bg);
  return bg;
}

// ---------------------------------------------------------------- views
route(/^\/?$/, () => {
  const mine = S.players.filter((p) => p.kind === 'mine'), tracked = S.players.filter((p) => p.kind === 'tracked');
  const today = todayIso();
  const next = S.games.filter((g) => g.game_date >= today && S.players.some((p) => p.kind === 'mine' && p.ifa_team_id === g.ifa_team_id)).slice(0, 3);
  const nextHtml = next.map((g) => {
    const ps = S.players.filter((p) => p.ifa_team_id === g.ifa_team_id && p.kind === 'mine');
    const v = perspective(ps[0], g);
    return `<div class="card" style="padding:12px 14px;display:flex;gap:12px;align-items:center">
      <div style="width:48px;text-align:center"><div class="num" style="font-size:24px;color:var(--lime)">${fmtDate(g.game_date)}</div><div class="muted" style="font-size:11px">יום ${dayName(g.game_date)}</div></div>
      <div style="flex:1;min-width:0"><div style="font-weight:800;font-size:14px" class="ell">${esc(ps.map((x) => x.name).join(', '))}</div>
      <div class="muted ell" style="font-size:12px">נגד ${esc(v.opp)} (${v.home ? 'בית' : 'חוץ'}) · ${g.kickoff_time ? g.kickoff_time.slice(0, 5) : 'שעה טרם נקבעה'}</div></div></div>`;
  }).join('') || '<div class="card muted" style="padding:14px;font-size:14px">אין משחקים קרובים בלוח.</div>';
  const now = new Date();
  shell('SAFA FARRAJ', `
  <div class="stack">
    <div><div class="muted" style="font-size:13px">${now.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Jerusalem' })}</div>
    <div class="num" style="font-size:52px">${greeting()}</div></div>
    <div class="grid2">
      <button data-go="#/mine" style="text-align:right;border:0;border-radius:22px;background:var(--lime);color:var(--bg);padding:16px;height:168px;display:flex;flex-direction:column;justify-content:space-between">
        <span style="font-size:13px;font-weight:700">שחקנים שלי</span><span class="num" style="font-size:88px">${mine.length}</span><span style="font-size:12px;font-weight:600">לפי שנתונים ←</span></button>
      <button data-go="#/tracked" class="pitch" style="text-align:right;border:1px solid rgba(255,255,255,.1);border-radius:22px;padding:16px;height:168px;display:flex;flex-direction:column;justify-content:space-between">
        <span style="font-size:13px;font-weight:700">שחקנים במעקב</span><span class="num" style="font-size:88px;color:var(--lime)">${tracked.length}</span><span class="muted" style="font-size:12px;font-weight:600">כל השחקנים ←</span></button>
    </div>
    <p class="sec">המשחקים הקרובים</p>
    ${nextHtml}
    <p class="sec">היום</p>
    <div id="today" class="stack"><div class="spinner"></div></div>
  </div>`);
  loadToday();
});

function greeting() {
  const h = +new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem', hour: 'numeric', hour12: false });
  return h < 12 ? 'בוקר טוב' : h < 17 ? 'צהריים טובים' : h < 21 ? 'ערב טוב' : 'לילה טוב';
}

async function loadToday() {
  const { data } = await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(5);
  const el = document.getElementById('today'); if (!el) return;
  el.innerHTML = (data || []).map(alertCard).join('') || '<div class="card muted" style="padding:14px;font-size:14px">אין התראות חדשות.</div>';
}

route(/^\/mine$/, () => {
  const mine = S.players.filter((p) => p.kind === 'mine');
  const groups = [...new Set(mine.map((p) => p.age_group || 'אחר'))];
  const cur = S.ui.group && groups.includes(S.ui.group) ? S.ui.group : groups[0];
  shell('שחקנים שלי', `<div class="stack">
    <div class="scroll-x">${groups.map((g) => `<button class="chip ${g === cur ? 'on' : ''}" data-act="group" data-g="${esc(g)}">${esc(g)} · ${mine.filter((p) => (p.age_group || 'אחר') === g).length}</button>`).join('')}</div>
    ${mine.filter((p) => (p.age_group || 'אחר') === cur).map(playerCard).join('') || '<div class="muted">אין שחקנים.</div>'}
  </div>`, { back: true });
});
actions.group = (el) => { S.ui.group = el.dataset.g; render(); };

function playerCard(p) {
  return `<button class="card pitch" data-go="#/player/${p.id}/info" style="width:100%;text-align:right;padding:14px;display:flex;gap:14px;align-items:center">
    <img class="photo" src="${esc(p.photo_url || '')}" alt="" style="width:64px;height:76px;border-radius:16px;border:1px solid rgba(255,255,255,.12)" onerror="this.style.visibility='hidden'">
    <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px">
      <span style="font-size:17px;font-weight:800" class="ell">${esc(p.name)}</span>
      <span class="muted ell" style="font-size:13px">${esc(p.team_name || '')}</span>
      <span class="muted ell" style="font-size:12px">${esc(p.league_name || '')}</span></span>
    <span style="display:flex;align-items:center;gap:8px;flex-shrink:0">
      <span class="num" style="font-size:44px;color:var(--lime)">${esc(p.shirt_number || '')}</span>
      <img class="crest" src="${crestUrl(p.ifa_team_id)}" alt="סמל הקבוצה" style="width:46px;height:46px;padding:3px" onerror="this.remove()"></span>
  </button>`;
}

route(/^\/tracked$/, () => {
  const tr = S.players.filter((p) => p.kind === 'tracked');
  shell('שחקנים במעקב', `<div class="stack">
    ${tr.length ? `<div class="grid2">${tr.map((p) => `<div class="card" style="padding:10px;display:flex;flex-direction:column;gap:8px">
      <button data-act="quick" data-id="${p.id}" style="border:0;padding:0;background:none"><img class="photo" src="${esc(p.photo_url || '')}" alt="פרטים מהירים" style="width:100%;height:130px;border-radius:14px"></button>
      <div style="font-weight:800">${esc(p.name)}</div><div class="muted" style="font-size:12px">${esc(p.team_name || '')} · ${esc(p.league_name || '')}</div>
      <button class="btn2" data-go="#/player/${p.id}/games" style="height:38px;font-size:13px">לוח משחקים</button></div>`).join('')}</div>`
    : '<div class="card muted" style="padding:14px;font-size:14px">אין עדיין שחקנים במעקב. שלח ל-Claude קישור לפרופיל של שחקן באתר ההתאחדות, והוא יוסיף אותו.</div>'}
  </div>`, { back: true });
});
actions.quick = (el) => {
  const p = playerById(el.dataset.id); const s = stats(p); const today = todayIso();
  const next = teamGames(p).filter((g) => g.game_date >= today).slice(0, 3);
  modal(`<div class="num" style="font-size:30px">${esc(p.name)}</div>
    <div class="grid2"><div class="card" style="padding:12px;text-align:center"><div class="num" style="font-size:40px;color:var(--lime)">${s.goals}</div><div class="muted" style="font-size:12px">שערים</div></div>
    <div class="card" style="padding:12px;text-align:center"><div class="num" style="font-size:40px;color:var(--lime)">${s.assists}</div><div class="muted" style="font-size:12px">בישולים</div></div></div>
    <p class="sec">3 המשחקים הבאים</p>
    <div class="card">${next.map((g) => { const v = perspective(p, g); return `<div class="row"><span>יום ${dayName(g.game_date)} ${fmtDate(g.game_date)}</span><span class="muted">נגד ${esc(v.opp)} · ${v.home ? 'בית' : 'חוץ'}${g.venue ? ' · ' + esc(g.venue) : ''}</span></div>`; }).join('') || '<div class="row muted">אין משחקים בלוח</div>'}</div>
    <button class="btn2" data-close>סגירה</button>`);
};

// ---------------------------------------------------------------- player profile
const TABS = [['info', 'מידע כללי'], ['games', 'לוח משחקים'], ['stats', 'נתונים'], ['contracts', 'חוזים'], ['media', 'סרטונים ותמונות'], ['notes', 'הערות']];

route(/^\/player\/(\d+)(?:\/(\w+))?$/, async (m) => {
  const p = playerById(m[1]); if (!p) return go('#/');
  const tab = m[2] || 'info';
  shell(p.name, `<div class="stack">
    <div class="pitch" style="border-radius:24px;padding:18px;display:flex;gap:16px;align-items:flex-end;position:relative;overflow:hidden;min-height:132px">
      <div style="position:absolute;left:16px;top:16px;display:flex;align-items:center;gap:10px">
        <span class="num" style="font-size:72px;color:var(--lime)">${esc(p.shirt_number || '')}</span>
        <img class="crest" src="${crestUrl(p.ifa_team_id)}" alt="סמל הקבוצה" style="width:58px;height:58px;padding:4px" onerror="this.remove()"></div>
      <img class="photo" src="${esc(p.photo_url || '')}" alt="" style="width:84px;height:104px;border-radius:18px;border:2px solid var(--lime);position:relative">
      <div style="display:flex;flex-direction:column;gap:4px;position:relative;min-width:0">
        <div class="num" style="font-size:40px">${esc(p.name)}</div>
        <div style="font-size:14px;font-weight:600">${esc(p.team_name || '')}</div>
        <div class="muted" style="font-size:12px">${esc(p.league_name || '')}</div></div>
    </div>
    <div class="scroll-x" style="margin:0 -16px;padding:0 16px">${TABS.map(([k, l]) => `<button class="chip ${k === tab ? 'on' : ''}" data-go="#/player/${p.id}/${k}">${l}</button>`).join('')}</div>
    <div id="tab"><div class="spinner"></div></div>
  </div>`, { back: true });
  const el = document.getElementById('tab');
  el.innerHTML = await ({ info: tabInfo, games: tabGames, stats: tabStats, contracts: tabContracts, media: tabMedia, notes: tabNotes }[tab] || tabInfo)(p);
});

function seasonSelect(p) {
  const opts = S.seasons.filter((s) => s.player_id === p.id);
  const cur = S.ui.season || opts[0]?.season_id;
  return `<label class="lbl" style="flex-direction:row;align-items:center">עונה
    <select class="field" data-season style="flex:1">${opts.map((s) => `<option value="${s.season_id}" ${s.season_id == cur ? 'selected' : ''}>${esc(s.season_label || s.season_id)}</option>`).join('')}</select></label>`;
}
document.addEventListener('change', (e) => { if (e.target.matches('[data-season]')) { S.ui.season = +e.target.value; render(); } });
const isCurrentSeason = (p) => !S.ui.season || S.ui.season === p.current_season_id;

async function tabInfo(p) {
  const { data: contacts } = await sb.from('contacts').select('*').eq('player_id', p.id);
  const hist = S.seasons.find((s) => s.player_id === p.id && s.season_id === (S.ui.season || p.current_season_id));
  const manual = (v) => v ? `<span style="font-weight:600">${esc(v)}</span>` : '<span style="color:var(--amber);font-weight:600">להזנה</span>';
  return `<div class="stack">
    <div class="card">
      <div class="row"><span class="muted">שנת לידה</span><b>${esc(p.birth_month_year || '')}</b></div>
      <div class="row"><span class="muted">תאריך לידה מלא</span>${manual(p.birth_date && p.birth_date.split('-').reverse().join('/'))}</div>
      <div class="row"><span class="muted">קבוצה</span><b>${esc(p.team_name || '')}</b></div>
      <div class="row"><span class="muted">ליגה</span><b>${esc(p.league_name || '')}</b></div>
      <div class="row"><span class="muted">מאמן</span><b>${esc(p.coach_name || '')}</b></div>
      <div class="row"><span class="muted">עמדה</span>${manual(p.position)}</div>
      <div class="row"><span class="muted">רגל חזקה</span>${manual(p.strong_foot)}</div>
      <div class="row"><span class="muted">מספר חולצה</span><b>${esc(p.shirt_number || '')}</b></div>
      <div class="row"><span class="muted">אזרחות</span><b>${esc(p.citizenship || '')}</b></div>
    </div>
    <button class="btn2" data-act="editInfo" data-id="${p.id}">עריכת פרטים ידניים</button>
    <div class="card" style="padding:14px;display:flex;flex-direction:column;gap:10px">${seasonSelect(p)}
      <div style="font-size:14px;line-height:1.5"><span class="muted">נתוני השחקן בקבוצה: </span><b>${esc(hist ? `${hist.team_name} (${hist.league_name})` : '')}</b>${hist && hist.goals != null ? ` · ${hist.goals} שערים` : ''}</div></div>
    <p class="sec">אנשי קשר</p>
    <div class="card">${(contacts || []).map((c) => `<div class="row"><span>${esc(c.role)} · ${esc(c.name || '')}</span><span style="display:flex;gap:6px">
      ${c.phone ? `<a class="btn2" style="display:flex;align-items:center;text-decoration:none;color:inherit" href="tel:${esc(c.phone)}">חיוג</a><a class="btn2" style="display:flex;align-items:center;text-decoration:none;color:inherit" href="https://wa.me/${esc(c.phone.replace(/\D/g, '').replace(/^0/, '972'))}">וואטסאפ</a>` : ''}</span></div>`).join('') || '<div class="row muted">אין אנשי קשר</div>'}</div>
    <button class="btn2" data-act="addContact" data-id="${p.id}">הוספת איש קשר</button>
  </div>`;
}

actions.editInfo = (el) => {
  const p = playerById(el.dataset.id);
  const m = modal(`<div class="num" style="font-size:30px">פרטים ידניים</div>
    <label class="lbl">עמדה<input class="field" name="position" value="${esc(p.position || '')}" placeholder="למשל: בלם"></label>
    <label class="lbl">רגל חזקה<select class="field" name="strong_foot"><option value=""></option>${['ימין', 'שמאל', 'שתיהן'].map((f) => `<option ${p.strong_foot === f ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
    <label class="lbl">תאריך לידה מלא<input class="field" type="date" name="birth_date" value="${esc(p.birth_date || '')}"></label>
    <label class="lbl">יום הולדת של המאמן<input class="field" type="date" name="coach_birth_date" value="${esc(p.coach_birth_date || '')}"></label>
    <button class="btn" data-save>שמירה</button><button class="btn2" data-close>ביטול</button>`);
  m.querySelector('[data-save]').onclick = async () => {
    const v = Object.fromEntries([...m.querySelectorAll('[name]')].map((i) => [i.name, i.value || null]));
    const { error } = await sb.from('players').update(v).eq('id', p.id);
    if (error) return toast('שגיאה בשמירה'); Object.assign(p, v); m.remove(); toast('נשמר'); render();
  };
};
actions.addContact = (el) => {
  const m = modal(`<div class="num" style="font-size:30px">איש קשר</div>
    <label class="lbl">תפקיד<select class="field" name="role"><option>אבא</option><option>אמא</option><option>השחקן</option><option>מאמן</option><option>אחר</option></select></label>
    <label class="lbl">שם<input class="field" name="name"></label>
    <label class="lbl">טלפון<input class="field" name="phone" type="tel" inputmode="tel"></label>
    <button class="btn" data-save>שמירה</button><button class="btn2" data-close>ביטול</button>`);
  m.querySelector('[data-save]').onclick = async () => {
    const v = Object.fromEntries([...m.querySelectorAll('[name]')].map((i) => [i.name, i.value || null]));
    const { error } = await sb.from('contacts').insert({ ...v, player_id: +el.dataset.id });
    if (error) return toast('שגיאה בשמירה'); m.remove(); render();
  };
};

function gameTile(p, g, gp) {
  const v = perspective(p, g), up = g.status !== 'final';
  const comp = g.competition === 'cup' ? 'גביע' : 'ליגה';
  return `<button class="card" data-act="game" data-p="${p.id}" data-g="${g.id}" style="width:100%;text-align:right;padding:6px 8px;display:flex;flex-direction:column;gap:2px;border-radius:10px;${up ? 'border-style:dashed;border-color:rgba(200,240,60,.35);background:transparent' : ''}">
    <div style="display:flex;justify-content:space-between;gap:4px;font-size:12px"><span class="ell" style="font-weight:700">${esc(v.opp)}</span><span class="muted" style="font-size:11px;flex-shrink:0">יום ${dayName(g.game_date)} ${fmtDate(g.game_date)}</span></div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:4px">
      ${up ? `<span class="pill up">${g.kickoff_time ? g.kickoff_time.slice(0, 5) : 'קרוב'}</span>` : `<span class="pill ${v.res}">${v.ours}:${v.theirs}</span>`}
      <span class="muted ell" style="font-size:10px">${v.home ? 'ב' : 'ח'} · ${up ? (g.kickoff_time ? 'נקבע' : 'שעה טרם נקבעה') : roleText(gp)}${S.ui.allView ? ' · ' + comp : ''}</span>
      <span class="num" style="font-size:18px;flex-shrink:0">${up || !gp ? '' : gp.minutes + '′'}</span></div></button>`;
}

async function tabGames(p) {
  if (!isCurrentSeason(p)) {
    const h = S.seasons.find((s) => s.player_id === p.id && s.season_id === S.ui.season);
    return `<div class="stack">${seasonSelect(p)}<div class="card muted" style="padding:16px;font-size:14px">בעונת ${esc(h?.season_label)}: ${esc(h?.team_name)} (${esc(h?.league_name)}). לוח המשחקים של עונות קודמות יתווסף בהמשך.</div></div>`;
  }
  const gs = teamGames(p).map((g) => ({ g, gp: S.gp.find((x) => x.game_id === g.id && x.player_id === p.id) }));
  const league = gs.filter((x) => x.g.competition !== 'cup'), cup = gs.filter((x) => x.g.competition === 'cup');
  const col = (title, list) => `<div style="display:flex;flex-direction:column;gap:4px"><p class="sec">${title}</p>${list.map((x) => gameTile(p, x.g, x.gp)).join('') || '<div class="muted" style="font-size:12px">אין משחקים</div>'}</div>`;
  return `<div class="stack">${seasonSelect(p)}
    <button class="btn" data-act="table" data-id="${p.id}">טבלת הליגה</button>
    <button class="btn2" data-act="toggleView">${S.ui.allView ? 'ליגה וגביע בנפרד' : 'תצוגה מאוחדת'}</button>
    <div class="muted" style="font-size:11px">משחקים קרובים מסומנים במסגרת מקווקוות · לחיצה על משחק לפרטים</div>
    ${S.ui.allView ? `<div style="display:flex;flex-direction:column;gap:4px">${gs.map((x) => gameTile(p, x.g, x.gp)).join('')}</div>`
      : `<div class="grid2" style="gap:6px;align-items:start">${col('ליגה', league)}${col('גביע', cup)}</div>`}
  </div>`;
}
actions.toggleView = () => { S.ui.allView = !S.ui.allView; render(); };
actions.table = (el) => {
  const p = playerById(el.dataset.id); const lg = S.leagues[p.ifa_league_id] || {};
  const rows = lg.standings || [];
  modal(`<div class="num" style="font-size:30px">טבלת הליגה</div><div class="muted" style="font-size:13px">לחיצה על שם קבוצה פותחת את דף הקבוצה בהתאחדות<br>${esc(lg.name || p.league_name)} · עודכן ${lg.updated_at ? new Date(lg.updated_at).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short' }) : ''}</div>
    <div class="card" style="font-size:13px;overflow:hidden">
      <div style="display:grid;grid-template-columns:24px 1fr 30px 48px 30px;gap:4px;padding:8px 10px;background:var(--bg);font-weight:700" class="muted"><span>#</span><span>קבוצה</span><span>מש׳</span><span>שע׳</span><span>נק׳</span></div>
      ${rows.map((r) => `<div style="display:grid;grid-template-columns:24px 1fr 30px 48px 30px;gap:4px;padding:8px 10px;border-top:1px solid var(--line);${r.team && p.team_name && r.team.startsWith(p.team_name) ? 'background:rgba(200,240,60,.14);color:var(--lime);font-weight:700' : ''}"><span>${r.pos}</span>${r.team_id ? `<a class="ell" href="https://www.football.org.il/team-details/?team_id=${r.team_id}&season_id=${lg.season_id || 28}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline;text-decoration-color:rgba(255,255,255,.25)">${esc(r.team)}</a>` : `<span class="ell">${esc(r.team)}</span>`}<span>${r.played}</span><span>${esc(r.goals)}</span><b>${r.points}</b></div>`).join('')}
    </div><button class="btn2" data-close>סגירה</button>`);
};
actions.game = (el) => {
  const p = playerById(el.dataset.p); const g = S.games.find((x) => String(x.id) === el.dataset.g);
  const gp = S.gp.find((x) => x.game_id === g.id && x.player_id === p.id); const v = perspective(p, g);
  const m = modal(`<div class="num" style="font-size:28px">${esc(g.home_team)} – ${esc(g.away_team)}</div>
    <div class="card">
      <div class="row"><span class="muted">מסגרת</span><span>${esc(g.competition_name || (g.competition === 'cup' ? 'גביע' : 'ליגה'))}</span></div>
      <div class="row"><span class="muted">מועד</span><span>יום ${dayName(g.game_date)} ${fmtDate(g.game_date)} · ${g.kickoff_time ? g.kickoff_time.slice(0, 5) : 'שעה טרם נקבעה'}</span></div>
      <div class="row"><span class="muted">מגרש</span><span>${esc(g.venue || 'טרם נקבע')}</span></div>
      ${g.status === 'final' ? `<div class="row"><span class="muted">תוצאה</span><span class="pill ${v.res}">${v.ours}:${v.theirs}</span></div>` : ''}
      ${gp ? `<div class="row"><span class="muted">הרכב</span><b>${gp.status === 'starter' ? 'פתח בהרכב' : gp.status === 'sub_in' ? 'נכנס כמחליף' : gp.status === 'bench' ? 'בסגל, לא שותף' : 'לא בסגל'}</b></div>
        ${gp.status === 'sub_in' ? `<div class="row"><span class="muted">נכנס בדקה</span><b>${gp.minute_in ?? '-'}</b></div>` : ''}
        ${gp.minute_out ? `<div class="row"><span class="muted">יצא בחילוף בדקה</span><b>${gp.minute_out}</b></div>` : ''}
        <div class="row"><span class="muted">דקות משחק</span><b>${gp.minutes}</b></div>
        <div class="row"><span class="muted">שערים / בישולים</span><b>${gp.goals || 0} / ${gp.assists || 0}</b></div>
        ${gp.yellow_cards || gp.red_cards ? `<div class="row"><span class="muted">כרטיסים</span><b>${gp.yellow_cards ? '🟨'.repeat(gp.yellow_cards) : ''}${gp.red_cards ? '🟥' : ''}</b></div>` : ''}` : ''}
    </div>
    ${gp ? `<label class="lbl">בישולים (ידני)<input class="field" type="number" min="0" name="assists" value="${gp.assists || 0}"></label>
    <label class="lbl" style="flex-direction:row;align-items:center;gap:10px;color:var(--ink)"><input type="checkbox" name="excluded_from_contract" ${gp.excluded_from_contract ? 'checked' : ''} style="width:22px;height:22px">לא לספור את המשחק בחישוב דקות החוזה (פציעה, נבחרת...)</label>
    <button class="btn" data-save>שמירה</button>` : ''}
    ${g.status !== 'final' ? `<a class="btn2" style="display:flex;align-items:center;justify-content:center;text-decoration:none;color:inherit" href="${icsHref(p, g)}" download="game.ics">+ הוספה ליומן</a>` : ''}
    <button class="btn2" data-close>סגירה</button>`);
  const save = m.querySelector('[data-save]');
  if (save) save.onclick = async () => {
    const vals = { assists: +m.querySelector('[name=assists]').value || 0, excluded_from_contract: m.querySelector('[name=excluded_from_contract]').checked };
    const { error } = await sb.from('game_players').update(vals).eq('id', gp.id);
    if (error) return toast('שגיאה בשמירה'); Object.assign(gp, vals); m.remove(); toast('נשמר'); render();
  };
};

function icsHref(p, g) {
  const v = perspective(p, g);
  const d = g.game_date.replace(/-/g, '');
  const t = g.kickoff_time ? g.kickoff_time.slice(0, 5).replace(':', '') + '00' : null;
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SAFA FARRAJ//HE', 'BEGIN:VEVENT', `UID:${g.id}-${p.id}@safafarraj`,
    t ? `DTSTART;TZID=Asia/Jerusalem:${d}T${t}` : `DTSTART;VALUE=DATE:${d}`,
    t ? `DURATION:PT2H` : `DTEND;VALUE=DATE:${d}`,
    `SUMMARY:${p.name} – ${p.team_name} נגד ${v.opp}`, `LOCATION:${g.venue || ''}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
}

async function tabStats(p) {
  const s = stats(p);
  const { data: cs } = await sb.from('contracts').select('*').eq('player_id', p.id).eq('contract_type', 'club').order('end_date', { ascending: false }).limit(1);
  const c = cs && cs[0]; const commit = c && c.minutes_commitment_pct != null ? +c.minutes_commitment_pct : null;
  const ok = commit == null ? null : s.pct >= commit;
  const color = ok == null ? 'var(--ink)' : ok ? 'var(--green)' : 'var(--red)';
  const gap = commit == null ? '' : ok ? `עוד ${Math.floor(s.played - commit / 100 * s.possible)} דק׳ עד אדום` : `חסרות ${Math.ceil(commit / 100 * s.possible - s.played)} דק׳ לירוק`;
  const bars = s.rows.map((r) => { const mins = r.gp ? r.gp.minutes : 0; return `<button data-act="game" data-p="${p.id}" data-g="${r.g.id}" aria-label="פרטי המשחק" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:2px;border:0;background:transparent;padding:0;min-width:0"><span class="num" style="font-size:14px">${mins}</span><div style="width:100%;max-width:24px;border-radius:4px 4px 0 0;height:${Math.max(2, Math.round(mins / s.L * 110))}px;background:${mins ? 'var(--lime)' : 'rgba(255,255,255,.18)'}"></div></button>`; }).join('');
  const box = (v, l, c2 = 'var(--ink)') => `<div class="card" style="padding:12px 6px;text-align:center"><div class="num" style="font-size:40px;color:${c2}">${v}</div><div class="muted" style="font-size:12px">${l}</div></div>`;
  return `<div class="stack">${seasonSelect(p)}
    ${isCurrentSeason(p) ? '' : '<div class="card muted" style="padding:14px;font-size:14px">נתוני עונות קודמות יתווספו בהמשך. מוצגת העונה הנוכחית.</div>'}
    <div class="card pitch" style="padding:18px;display:flex;flex-direction:column;gap:10px">
      <div class="sec">דקות משחק · ליגה + גביע</div>
      <div style="display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap"><span class="num" style="font-size:64px;color:${color}">${s.pct == null ? '–' : s.pct.toFixed(1) + '%'}</span><span class="muted" style="font-size:14px;padding-bottom:10px">${s.played} / ${s.possible} דק׳</span></div>
      ${commit == null ? '<div class="muted" style="font-size:13px">אין עדיין חוזה מועדון עם התחייבות לדקות. הצבע יופיע אחרי הזנת החוזה.</div>'
      : `<div style="font-weight:700;font-size:14px;color:${color}">${ok ? 'עומד בהתחייבות החוזה' : 'לא עומד בהתחייבות החוזה'} (${gap})</div>
        <div style="height:12px;border-radius:6px;background:rgba(255,255,255,.08);position:relative;overflow:hidden"><div style="position:absolute;top:0;bottom:0;right:0;width:${Math.min(100, s.pct || 0)}%;background:${color}"></div><div style="position:absolute;top:0;bottom:0;right:${commit}%;width:2px;background:var(--ink)"></div></div>
        <div class="muted" style="font-size:12px">הקו הלבן = התחייבות בחוזה (${commit}%)</div>`}
    </div>
    <div class="grid3">${box(s.starts, 'פתח בהרכב', 'var(--lime)')}${box(s.subs, 'נכנס כמחליף')}${box(s.unused, 'לא שותף')}</div>
    <div class="muted" style="font-size:12px;margin-top:-4px">מתוך ${s.games} משחקי הקבוצה ששוחקו · ${s.L} דק׳ למשחק</div>
    <div class="grid4">${box(s.goals, 'שערים')}${box(s.assists, 'בישולים*')}${box(s.yellow, 'צהובים', '#FFD43B')}${box(s.red, 'אדומים', 'var(--red)')}</div>
    <div class="muted" style="font-size:12px;margin-top:-4px">* בישולים מוזנים ידנית (לחיצה על משחק בלוח המשחקים)</div>
    <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:10px"><div class="sec">דקות לפי משחק · לחיצה על עמודה לפרטי המשחק</div>
      <div style="position:relative;height:130px;display:flex;align-items:flex-end;gap:4px;border-bottom:1px solid rgba(255,255,255,.14)">${bars}</div>
      <div style="display:flex;gap:4px">${s.rows.map((r) => `<span class="muted" style="flex:1;font-size:9px;text-align:center">${fmtDate(r.g.game_date)}</span>`).join('')}</div></div>
  </div>`;
}

async function tabContracts(p) {
  const { data } = await sb.from('contracts').select('*').eq('player_id', p.id).order('created_at', { ascending: false });
  const type = S.ui.ctype || 'club';
  const c = (data || []).find((x) => x.contract_type === type);
  const dash = (v) => (v == null || v === '' ? '-' : esc(v));
  const days = c && c.end_date ? Math.round((new Date(c.end_date) - new Date(todayIso())) / 864e5) : null;
  const sched = type === 'agent' ? '4 חודשים · חודשיים · חודש · שבוע · יום לפני' : 'חצי שנה · 3 חודשים · חודש · שבוע · יום לפני';
  return `<div class="stack">
    <div class="seg"><button class="${type === 'agent' ? 'on' : ''}" data-act="ctype" data-t="agent">חוזה עם הסוכן</button><button class="${type === 'club' ? 'on' : ''}" data-act="ctype" data-t="club">חוזה עם המועדון</button></div>
    ${c ? `
      ${!c.confirmed ? '<div style="background:rgba(255,181,71,.12);color:var(--amber);border-radius:12px;padding:10px 12px;font-size:13px">הנתונים ממתינים לאישורך</div>' : ''}
      <div class="card pitch" style="padding:18px;display:flex;align-items:center;gap:14px">
        <div style="text-align:center"><div class="num" style="font-size:64px;color:var(--lime)">${days ?? '–'}</div><div class="muted" style="font-size:12px">ימים לסיום</div></div>
        <div class="muted" style="font-size:13px">התראות: ${sched}</div></div>
      ${c.file_path ? `<button class="btn2" data-act="openFile" data-bucket="contracts" data-path="${esc(c.file_path)}">פתיחת קובץ החוזה</button>` : ''}
      <div class="card">
        <div class="row"><span class="muted">מועד תחילה</span><b>${dash(c.start_date && c.start_date.split('-').reverse().join('/'))}</b></div>
        <div class="row"><span class="muted">מועד סיום</span><b>${dash(c.end_date && c.end_date.split('-').reverse().join('/'))}</b></div>
        ${type === 'club' ? `<div class="row"><span class="muted">התחייבות לדקות משחק</span><b>${c.minutes_commitment_pct != null ? c.minutes_commitment_pct + '%' : '-'}</b></div>
        <div class="row"><span class="muted">הנחות</span><b>${dash(c.discounts)}</b></div>
        <div class="row"><span class="muted">דמי נסיעות</span><b>${dash(c.travel_allowance)}</b></div>
        <div class="row"><span class="muted">שכר</span><b>${dash(c.salary)}</b></div>
        <div class="row"><span class="muted">סעיף שחרור</span><b>${dash(c.release_clause)}</b></div>
        <div class="row"><span class="muted">אופציה להארכה</span><b>${dash(c.extension_option)}</b></div>` : `<div class="row"><span class="muted">עמלת סוכן</span><b>${dash(c.agent_fee)}</b></div>`}
      </div>
      <button class="btn2" data-act="editContract" data-p="${p.id}" data-t="${type}" data-id="${c.id}">עריכה ${!c.confirmed ? 'ואישור' : ''}</button>`
    : `<div class="card muted" style="padding:14px;font-size:14px">אין עדיין ${type === 'agent' ? 'חוזה עם הסוכן' : 'חוזה עם המועדון'}. אפשר להעלות את הקובץ כאן, או לשלוח אותו ל-Claude בשיחה והוא ימלא את הפרטים בשבילך לאישורך.</div>`}
    <button class="btn" data-act="editContract" data-p="${p.id}" data-t="${type}">העלאת חוזה חדש</button>
  </div>`;
}
actions.ctype = (el) => { S.ui.ctype = el.dataset.t; render(); };
actions.openFile = async (el) => {
  const { data, error } = await sb.storage.from(el.dataset.bucket).createSignedUrl(el.dataset.path, 600);
  if (error) return toast('לא ניתן לפתוח את הקובץ'); window.open(data.signedUrl, '_blank');
};
actions.editContract = async (el) => {
  let c = {};
  if (el.dataset.id) c = (await sb.from('contracts').select('*').eq('id', el.dataset.id).single()).data || {};
  const club = el.dataset.t === 'club';
  const f = (name, label, type = 'text') => `<label class="lbl">${label}<input class="field" type="${type}" name="${name}" value="${esc(c[name] ?? '')}"></label>`;
  const m = modal(`<div class="num" style="font-size:30px">${club ? 'חוזה עם המועדון' : 'חוזה עם הסוכן'}</div>
    <label class="lbl">קובץ החוזה (PDF / תמונה)<input class="field" type="file" name="file" accept=".pdf,image/*" style="padding-top:10px"></label>
    ${f('start_date', 'מועד תחילה', 'date')}${f('end_date', 'מועד סיום', 'date')}
    ${club ? f('minutes_commitment_pct', 'התחייבות לדקות משחק (%)', 'number') + f('discounts', 'הנחות') + f('travel_allowance', 'דמי נסיעות') + f('salary', 'שכר') + f('release_clause', 'סעיף שחרור') + f('extension_option', 'אופציה להארכה') : f('agent_fee', 'עמלת סוכן')}
    <button class="btn" data-save>שמירה ואישור</button><button class="btn2" data-close>ביטול</button>`);
  m.querySelector('[data-save]').onclick = async (ev) => {
    ev.target.disabled = true;
    const vals = { player_id: +el.dataset.p, contract_type: el.dataset.t, confirmed: true, updated_at: new Date().toISOString() };
    m.querySelectorAll('input[name]:not([type=file])').forEach((i) => { vals[i.name] = i.value === '' ? null : i.value; });
    const file = m.querySelector('[name=file]').files[0];
    if (file) {
      const path = `${el.dataset.p}/${el.dataset.t}-${Date.now()}-${file.name.replace(/[^\w.]+/g, '_')}`;
      const up = await sb.storage.from('contracts').upload(path, file);
      if (up.error) { ev.target.disabled = false; return toast('שגיאה בהעלאת הקובץ'); }
      vals.file_path = path;
    }
    const r = c.id ? await sb.from('contracts').update(vals).eq('id', c.id) : await sb.from('contracts').insert(vals);
    if (r.error) { ev.target.disabled = false; return toast('שגיאה בשמירה'); }
    m.remove(); toast('החוזה נשמר'); render();
  };
};

async function tabMedia(p) {
  const { data } = await sb.from('media').select('*').eq('player_id', p.id).order('taken_on', { ascending: false });
  const items = data || [];
  const urls = await Promise.all(items.map((x) => sb.storage.from('media').createSignedUrl(x.file_path, 3600).then((r) => r.data?.signedUrl)));
  S.ui.mediaUrls = Object.fromEntries(items.map((x, i) => [x.id, urls[i]]));
  return `<div class="stack">
    ${items.length ? `<div class="grid2">${items.map((x) => `<button data-act="openMedia" data-id="${x.id}" class="pitch" style="border:1px solid rgba(255,255,255,.08);border-radius:18px;height:128px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;overflow:hidden;position:relative;padding:0">
      ${x.media_type === 'photo' ? `<img src="${esc(S.ui.mediaUrls[x.id] || '')}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">` : `<span style="width:44px;height:44px;border-radius:22px;background:var(--lime);color:var(--bg);display:flex;align-items:center;justify-content:center">${ICON.play}</span>`}
      <span style="font-size:13px;font-weight:600;position:relative;background:rgba(12,23,18,.7);padding:2px 8px;border-radius:6px">${esc(x.action_type || '')}</span></button>`).join('')}</div>`
    : '<div class="card muted" style="padding:14px;font-size:14px">אין עדיין סרטונים או תמונות.</div>'}
    <button class="btn" data-act="addMedia" data-id="${p.id}">העלאת סרטון / תמונה</button></div>`;
}
actions.openMedia = async (el) => {
  const { data: x } = await sb.from('media').select('*').eq('id', el.dataset.id).single();
  const url = S.ui.mediaUrls[x.id];
  const m = modal(`${x.media_type === 'video' ? `<video src="${esc(url)}" controls playsinline style="width:100%;border-radius:14px;max-height:50vh;background:#000"></video>` : `<img src="${esc(url)}" alt="" style="width:100%;border-radius:14px">`}
    <div class="card"><div class="row"><span class="muted">משחק</span><span>${esc(x.game_description || '-')}</span></div>
    <div class="row"><span class="muted">מהות הפעולה</span><span>${esc(x.action_type || '-')}</span></div>
    <div class="row"><span class="muted">תאריך צילום</span><span>${x.taken_on ? x.taken_on.split('-').reverse().join('/') : '-'}</span></div></div>
    <div class="grid2"><button class="btn2" data-share>שמירה לתמונות</button><button class="btn" data-share>שיתוף בוואטסאפ</button></div>
    <button class="btn2" data-close>סגירה</button>`);
  // On iPhone the share sheet offers both "Save to Photos" and WhatsApp.
  m.querySelectorAll('[data-share]').forEach((b) => b.onclick = async () => {
    try {
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], x.file_path.split('/').pop(), { type: blob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: x.action_type || '' });
      else window.open(url, '_blank');
    } catch (e) { /* user cancelled */ }
  });
};
actions.addMedia = (el) => {
  const m = modal(`<div class="num" style="font-size:30px">סרטון / תמונה</div>
    <label class="lbl">קובץ<input class="field" type="file" name="file" accept="video/*,image/*" style="padding-top:10px"></label>
    <label class="lbl">משחק בו צולם<input class="field" name="game_description" placeholder="למשל: בני סכנין נגד בית״ר חיפה"></label>
    <label class="lbl">מהות הפעולה<select class="field" name="action_type"><option>שער</option><option>בישול</option><option>דריבל</option><option>פעולת הגנה</option><option>מסירה</option><option>אחר</option></select></label>
    <label class="lbl">תאריך צילום<input class="field" type="date" name="taken_on" value="${todayIso()}"></label>
    <button class="btn" data-save>העלאה</button><button class="btn2" data-close>ביטול</button>`);
  m.querySelector('[data-save]').onclick = async (ev) => {
    const file = m.querySelector('[name=file]').files[0]; if (!file) return toast('בחר קובץ');
    ev.target.disabled = true; ev.target.textContent = 'מעלה…';
    const path = `${el.dataset.id}/${Date.now()}-${file.name.replace(/[^\w.]+/g, '_')}`;
    const up = await sb.storage.from('media').upload(path, file);
    if (up.error) { ev.target.disabled = false; ev.target.textContent = 'העלאה'; return toast('שגיאה בהעלאה (קובץ גדול מדי?)'); }
    const vals = Object.fromEntries([...m.querySelectorAll('[name]:not([type=file])')].map((i) => [i.name, i.value || null]));
    await sb.from('media').insert({ ...vals, player_id: +el.dataset.id, file_path: path, media_type: file.type.startsWith('video') ? 'video' : 'photo' });
    m.remove(); toast('הועלה'); render();
  };
};

async function tabNotes(p) {
  const { data } = await sb.from('notes').select('*').eq('player_id', p.id).order('note_date', { ascending: false });
  return `<div class="stack">${(data || []).map((n) => `<div class="card" style="padding:14px;display:flex;flex-direction:column;gap:6px">
      <div style="display:flex;justify-content:space-between;font-size:12px" class="muted"><b style="color:var(--lime)">${esc(n.from_who)} ← ${esc(n.to_who)}</b><span>${n.note_date.split('-').reverse().join('/')}</span></div>
      <div style="font-size:14px;line-height:1.5;white-space:pre-line">${esc(n.body)}</div></div>`).join('') || '<div class="card muted" style="padding:14px;font-size:14px">אין עדיין הערות.</div>'}
    <button class="btn" data-act="addNote" data-id="${p.id}">הוספת הערה</button></div>`;
}
actions.addNote = (el) => {
  const opts = ['השחקן', 'המאמן', 'הסוכן', 'ההורים'].map((o) => `<option>${o}</option>`).join('');
  const m = modal(`<div class="num" style="font-size:30px">הערה חדשה</div>
    <div class="grid2"><label class="lbl">מי נתן<select class="field" name="from_who">${opts}</select></label><label class="lbl">למי<select class="field" name="to_who"><option>הסוכן</option><option>השחקן</option><option>המאמן</option><option>ההורים</option></select></label></div>
    <label class="lbl">תאריך<input class="field" type="date" name="note_date" value="${todayIso()}"></label>
    <label class="lbl">ההערה<textarea class="field" name="body"></textarea></label>
    <button class="btn" data-save>שמירה</button><button class="btn2" data-close>ביטול</button>`);
  m.querySelector('[data-save]').onclick = async () => {
    const v = Object.fromEntries([...m.querySelectorAll('[name]')].map((i) => [i.name, i.value]));
    if (!v.body.trim()) return toast('ההערה ריקה');
    const { error } = await sb.from('notes').insert({ ...v, player_id: +el.dataset.id });
    if (error) return toast('שגיאה בשמירה'); m.remove(); render();
  };
};

// ---------------------------------------------------------------- schedule
route(/^\/schedule(?:\?aud=(\w+))?$/, (m) => {
  const aud = m[1] || S.ui.aud || 'mine'; S.ui.aud = aud;
  const today = todayIso();
  const ps = S.players.filter((p) => p.kind === aud);
  const items = [];
  for (const p of ps) for (const g of teamGames(p)) if (g.game_date >= today) items.push({ p, g });
  items.sort((a, b) => (a.g.game_date + (a.g.kickoff_time || '')).localeCompare(b.g.game_date + (b.g.kickoff_time || '')));
  // the coming weekend (Fri–Sat)
  const d = new Date(today + 'T12:00:00'); const fri = new Date(d); fri.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7));
  const sat = new Date(fri); sat.setDate(fri.getDate() + 1);
  const iso = (x) => x.toISOString().slice(0, 10);
  const weekend = items.filter((x) => x.g.game_date >= iso(fri) && x.g.game_date <= iso(sat));
  const row = ({ p, g }) => { const v = perspective(p, g); return `<button class="row" data-act="game" data-p="${p.id}" data-g="${g.id}" style="width:100%;text-align:right;background:none;border-left:0;border-right:0;border-top:0">
      <div style="width:44px;text-align:center;flex-shrink:0"><div class="num" style="font-size:22px;color:var(--lime)">${fmtDate(g.game_date)}</div><div class="muted" style="font-size:10px">יום ${dayName(g.game_date)}</div></div>
      <div style="flex:1;min-width:0"><div class="ell" style="font-size:13px;font-weight:800">${esc(p.name)} · נגד ${esc(v.opp)} (${v.home ? 'בית' : 'חוץ'})</div>
      <div class="muted ell" style="font-size:11px">${g.competition === 'cup' ? 'גביע' : 'ליגה'} · ${g.kickoff_time ? g.kickoff_time.slice(0, 5) : 'שעה טרם נקבעה'} · ${esc(g.venue || 'מגרש טרם נקבע')}</div></div></button>`; };
  shell('לוח משחקים', `<div class="stack">
    <div class="seg"><button class="${aud === 'mine' ? 'on' : ''}" data-go="#/schedule?aud=mine">שחקנים שלי</button><button class="${aud === 'tracked' ? 'on' : ''}" data-go="#/schedule?aud=tracked">שחקנים במעקב</button></div>
    <div class="card" style="padding:12px 14px;font-size:14px">סוף השבוע ${fmtDate(iso(fri))}–${fmtDate(iso(sat))}: ${weekend.length ? `<b style="color:var(--lime)">${weekend.length} משחקים</b>` : '<b style="color:var(--lime)">אין משחקים</b>'}</div>
    ${weekend.length ? `<div class="card" style="overflow:hidden">${weekend.map(row).join('')}</div>` : ''}
    <p class="sec">המשחקים הקרובים</p>
    <div class="card" style="overflow:hidden">${items.slice(0, 12).map(row).join('') || '<div class="row muted">אין משחקים בלוח</div>'}</div>
  </div>`, { tab: 'schedule' });
});

// ---------------------------------------------------------------- alerts
function alertCard(n) {
  const color = { report: n.payload?.result === 'ניצחון' ? 'var(--green)' : n.payload?.result === 'הפסד' ? 'var(--red)' : 'var(--muted)', event: 'var(--lime)', coach_change: 'var(--amber)', team_change: 'var(--amber)', minutes_color: 'var(--red)', contract: 'var(--amber)' }[n.kind] || 'var(--lime)';
  const when = new Date(n.created_at).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return `<button class="card" data-go="#${esc(n.url || '/')}" style="width:100%;text-align:right;padding:12px 14px;display:flex;gap:10px;${n.read_at ? 'opacity:.75' : ''}">
    <span class="dot" style="background:${color}"></span>
    <span style="flex:1;display:flex;flex-direction:column;gap:3px"><span style="display:flex;justify-content:space-between;font-size:12px" class="muted"><b>${esc(n.title)}</b><span>${when}</span></span>
    <span style="font-size:14px;line-height:1.45;white-space:pre-line">${esc(n.body || '')}</span></span></button>`;
}

const POLICY = [
  ['לוח משחקים לסוף השבוע', 'כל רביעי ב־20:00 – שתי התראות נפרדות (שחקנים שלי / במעקב): "לוח המשחקים לסופ״ש הקרוב מוכן".'],
  ['לפני משחק', 'חצי שעה לפני: שחקן, יריב, שעה, מקום והאם בהרכב. התראה מיידית כשההרכב מתפרסם.'],
  ['במהלך המשחק', 'שער, חילוף, צהוב, אדום – ברגע שמופיע באתר ההתאחדות (בדיקה כל 10 דקות בזמן משחק).'],
  ['דוח משחק', 'רק דוח מלא, ברגע שכל הפרטים באתר: תוצאה (ניצחון בירוק, הפסד באדום), הרכב, דקות, שערים.'],
  ['דוחות מוכנים', 'שישי ושבת ב־20:00.'],
  ['חוזה עם הסוכן', '4 חודשים, חודשיים, חודש, שבוע ויום לפני הסיום.'],
  ['חוזה עם המועדון', 'חצי שנה, 3 חודשים, חודש, שבוע ויום לפני הסיום.'],
  ['צבע דקות משחק', 'בכל מעבר מאדום לירוק או מירוק לאדום.'],
  ['ימי הולדת', '08:00 בבוקר – שחקן או המאמן שלו.'],
  ['החלפת קבוצה', 'לפי רישום ההתאחדות.'],
  ['החלפת מאמן', 'בקבוצה של אחד השחקנים.'],
  ['לא שותף פעמיים ברצף', 'שני משחקים רצופים בלי לשחק.'],
  ['סיכום שבועי', 'ראשון בבוקר: דקות, שערים, תוצאות ויריבים.'],
];

route(/^\/alerts$/, async () => {
  const pol = S.ui.alertsTab === 'policy';
  shell('מרכז התראות', `<div class="stack">
    <div class="seg"><button class="${pol ? '' : 'on'}" data-act="alertsTab" data-t="list">התראות</button><button class="${pol ? 'on' : ''}" data-act="alertsTab" data-t="policy">מדיניות התראות</button></div>
    <div id="alist" class="stack">${pol ? `<div class="card">${POLICY.map(([t, d], i) => `<div class="row" style="align-items:flex-start;justify-content:flex-start"><span class="num" style="width:28px;font-size:30px;color:var(--lime);text-align:center;flex-shrink:0">${i + 1}</span><div><div style="font-weight:700">${t}</div><div class="muted" style="font-size:13px;line-height:1.45">${d}</div></div></div>`).join('')}</div>` : '<div class="spinner"></div>'}</div>
  </div>`, { back: true });
  if (pol) return;
  const { data } = await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(100);
  document.getElementById('alist').innerHTML = (data || []).map(alertCard).join('') || '<div class="card muted" style="padding:14px;font-size:14px">אין עדיין התראות. הן יתחילו להגיע מהמשחק הבא.</div>';
  if (S.unread) { await sb.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null); S.unread = 0; }
});
actions.alertsTab = (el) => { S.ui.alertsTab = el.dataset.t; render(); };

// ---------------------------------------------------------------- settings & push
route(/^\/settings$/, async () => {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const { data: subs } = await sb.from('push_subscriptions').select('id,device_label,created_at');
  const { data: last } = await sb.from('app_state').select('value').eq('key', 'last_sync').maybeSingle();
  shell('הגדרות', `<div class="stack">
    <p class="sec">התראות לטלפון</p>
    ${!standalone ? `<div class="card" style="padding:14px;font-size:14px;line-height:1.6">כדי לקבל התראות באייפון, צריך קודם להתקין את האפליקציה:<br>1. בספארי, לחץ על כפתור <b>השיתוף</b> (ריבוע עם חץ).<br>2. בחר <b>"הוספה למסך הבית"</b>.<br>3. פתח את האפליקציה מהאייקון החדש, וחזור לכאן.</div>`
    : `<div class="card" style="padding:14px;font-size:14px">${perm === 'granted' && subs?.length ? '✅ ההתראות פעילות במכשיר הזה.' : 'ההתראות עדיין לא הופעלו במכשיר הזה.'}</div>
       <button class="btn" data-act="enablePush">${perm === 'granted' && subs?.length ? 'הפעלה מחדש' : 'הפעלת התראות'}</button>`}
    <div class="muted" style="font-size:12px">מכשירים רשומים: ${subs?.length || 0}</div>
    <p class="sec">סנכרון מול ההתאחדות</p>
    <div class="card" style="padding:14px;font-size:14px">עדכון אחרון: ${last?.value?.at ? new Date(last.value.at + 'Z').toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' }) : '-'}<br><span class="muted" style="font-size:12px">הנתונים מתעדכנים אוטומטית כל 10 דקות.</span></div>
    <button class="btn2" data-act="logout">התנתקות</button>
  </div>`, { tab: 'settings' });
});

function b64ToUint8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
actions.enablePush = async () => {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return toast('ההרשאה לא ניתנה. אפשר לשנות בהגדרות האייפון.');
    const { data } = await sb.from('app_state').select('value').eq('key', 'vapid_public_key').maybeSingle();
    if (!data?.value) return toast('השרת עוד מכין את ההתראות – נסה שוב בעוד 10 דקות');
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(data.value) });
    const j = sub.toJSON();
    const { error } = await sb.from('push_subscriptions').upsert({ endpoint: j.endpoint, keys: j.keys, device_label: navigator.userAgent.includes('iPhone') ? 'iPhone' : 'דפדפן' }, { onConflict: 'endpoint' });
    if (error) throw error;
    toast('ההתראות הופעלו ✅'); render();
  } catch (e) { toast('לא הצלחתי להפעיל התראות'); console.error(e); }
};
actions.logout = async () => { await sb.auth.signOut(); location.hash = '#/'; location.reload(); };

// ---------------------------------------------------------------- login
function loginView() {
  $app.innerHTML = `<main style="padding-top:calc(var(--safe-top) + 60px)"><div class="stack" style="align-items:stretch">
    <div style="display:flex;justify-content:center">${ICON.logo.replace('width="34" height="34"', 'width="96" height="96"')}</div>
    <div class="num" style="font-size:56px;text-align:center">SAFA FARRAJ</div>
    <div class="muted" style="text-align:center;margin-top:-6px">סוכן שחקנים</div>
    <label class="lbl">מייל<input class="field" id="em" type="email" autocomplete="username" inputmode="email"></label>
    <label class="lbl">סיסמה<input class="field" id="pw" type="password" autocomplete="current-password"></label>
    <button class="btn" id="signin">כניסה</button>
    <button class="btn2" id="signup">פתיחת חשבון (פעם ראשונה בלבד)</button>
    <div id="msg" class="muted" style="font-size:13px;text-align:center"></div></div></main>`;
  const em = () => document.getElementById('em').value.trim(), pw = () => document.getElementById('pw').value;
  const msg = (t) => { document.getElementById('msg').textContent = t; };
  document.getElementById('signin').onclick = async () => {
    const { error } = await sb.auth.signInWithPassword({ email: em(), password: pw() });
    if (error) return msg('מייל או סיסמה שגויים'); boot();
  };
  document.getElementById('signup').onclick = async () => {
    if (pw().length < 8) return msg('בחר סיסמה של 8 תווים לפחות');
    const { data, error } = await sb.auth.signUp({ email: em(), password: pw() });
    if (error) return msg('לא הצלחתי לפתוח חשבון: ' + error.message);
    if (!data.session) return msg('נשלח אליך מייל אישור. לחץ על הקישור שבו, ואז חזור לכאן והיכנס.');
    boot();
  };
}

// ---------------------------------------------------------------- boot
async function render() {
  const path = (location.hash || '#/').slice(1) || '/';
  for (const [re, fn] of routes) { const m = path.match(re); if (m) { try { await fn(m); } catch (e) { console.error(e); } return; } }
  go('#/');
}

async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return loginView();
  $app.innerHTML = '<div class="spinner"></div>';
  try {
    const { data: me } = await sb.from('app_users').select('user_id').maybeSingle();
    if (!me) { $app.innerHTML = '<main><div class="card" style="padding:16px;margin-top:80px">לחשבון הזה אין הרשאה לאפליקציה.</div><button class="btn2" data-act="logout">התנתקות</button></main>'; return; }
    await loadCore();
  } catch (e) { console.error(e); $app.innerHTML = '<main><div class="card" style="padding:16px;margin-top:80px">שגיאה בטעינת הנתונים. נסה לרענן.</div></main>'; return; }
  render();
}
sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') loginView(); });
boot();
