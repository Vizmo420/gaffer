import { SAMPLE_SQUAD, SAMPLE_YOUTH, SAMPLE_MATCHES, SAMPLE_TRANSFERS, SAMPLE_CHRONICLE, SAMPLE_SCOUT } from './sample-squad.js';
import {
  FORMATIONS,
  POSITION_LABEL,
  TRAINING_TYPES,
  SPECIALTY,
  specialtyName,
  bestLineup,
  bestFormation,
  eligiblePlayers,
  ratePlayerForSlot,
  trainingEffect,
  skillColor,
  skillVal,
  topSkills,
  youthPotential,
  detectYouthStar,
  SKILL_KEYS,
  SKILL_LABEL,
  WEIGHTS,
  DEFAULT_WEIGHTS,
  setWeights,
  resetWeights,
  sectorRatings,
  playerSectorContribution,
  isSuspended,
  recommendSetPieceTaker,
  recommendCaptain,
  staminaFadeMinute,
  suggestSubs,
  counterScore,
  suggestManMarker,
  loyaltyBonus,
  positionsTrainingSkill,
  calibrateWeights,
  explainRating,
  squadDepth,
  closeCalls,
  squadGrades,
  ageStructureScore,
  marginalGain,
} from './optimizer.js';
import {
  PRIMARY_TRAINED_SKILL,
  weeksToNextLevel,
  projectSkillAfter,
  projectSkillSeries,
  trainingEfficiency,
  wageJumpRisk,
  trainingRoi,
} from './training-calc.js';

// ------------------------- stan -------------------------

const state = {
  squad: structuredClone(SAMPLE_SQUAD),
  youth: structuredClone(SAMPLE_YOUTH),
  matches: structuredClone(SAMPLE_MATCHES),
  sortKey: 'tsi',
  sortDir: 'desc',
  locks: {},
  youthLocks: {},
  lineupA: null,
  lineupB: null,
  lineupY: null,
  showing: 'A',
  youthStarId: null,
  changes: null,
  changesYouth: null,
  chronicle: structuredClone(SAMPLE_CHRONICLE),
  transfers: structuredClone(SAMPLE_TRANSFERS),
  scout: structuredClone(SAMPLE_SCOUT),
  team: null,
};

const $ = (s) => document.querySelector(s);
const fmt = (n) => (Number.isFinite(n) ? n.toFixed(2) : '—');
const fullName = (p) => `${p.firstName} ${p.lastName}`.trim() || p.nickName || `#${p.id}`;

// ------------------------- trwałe pola ręczne (localStorage) -------------------------

const lsKey = () => `gaffer:manual:${state.squad.teamId ?? 0}`;

function loadManual() {
  try {
    return JSON.parse(localStorage.getItem(lsKey()) || '{}');
  } catch {
    return {};
  }
}
function saveManual() {
  const out = {};
  for (const p of state.squad.players) {
    out[p.id] = {
      trained: !!p.trained,
      motherClubManual: !!p.motherClubManual,
      daysAtClub: p.daysAtClub ?? null,
      manualRating: p.manualRating ?? null,
    };
  }
  try {
    localStorage.setItem(lsKey(), JSON.stringify(out));
  } catch {
    /* tryb prywatny / brak dostępu — trudno */
  }
}
function applyManual() {
  const m = loadManual();
  for (const p of state.squad.players) {
    const saved = m[p.id];
    if (!saved) continue;
    p.trained = !!saved.trained;
    p.motherClubManual = !!saved.motherClubManual;
    p.daysAtClub = saved.daysAtClub ?? p.daysAtClub ?? null;
    p.manualRating = saved.manualRating ?? null;
  }
}

// ------------------------- oceny -------------------------

function avgOfRecent(p) {
  const r = (p.recentRatings || []).map((x) => x.stars).filter((n) => Number.isFinite(n));
  return r.length ? r.reduce((a, b) => a + b, 0) / r.length : null;
}
// Ustawia p.avgRating (ręczna nadpisuje średnią) — używane przez tryb "wg ocen".
function refreshRatings(players) {
  for (const p of players) {
    p.avgRating = p.manualRating ?? avgOfRecent(p);
  }
}

// ------------------------- szacunkowa wartość (orientacyjnie) -------------------------

// Bardzo zgrubny szacunek: skalujemy TSI współczynnikiem wieku (młodsi = premia,
// po ~28 spadek). To NIE jest wycena rynkowa, tylko punkt odniesienia.
function estValue(p) {
  if (!p.tsi) return null;
  const age = p.ageYears || 25;
  let f = 1;
  if (age <= 20) f = 1.35;
  else if (age <= 24) f = 1.15;
  else if (age <= 27) f = 1.0;
  else if (age <= 30) f = 0.75;
  else f = 0.45;
  const v = p.tsi * 12 * f; // ~rząd wielkości ceny w zł
  return Math.round(v / 1000) * 1000;
}

// ------------------------- wczytywanie -------------------------

async function fetchJson(path) {
  try {
    const r = await fetch(path, { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

async function loadFromServer() {
  const [squad, youth, matches, changes, team, transfers, chronicle, changesY, scout] = await Promise.all([
    fetchJson('data/squad.json'),
    fetchJson('data/youth-squad.json'),
    fetchJson('data/matches.json'),
    fetchJson('data/changes.json'),
    fetchJson('data/team.json'),
    fetchJson('data/transfers.json'),
    fetchJson('data/chronicle.json'),
    fetchJson('data/changes-youth.json'),
    fetchJson('data/scout.json'),
  ]);
  if (scout) state.scout = scout;
  if (squad) applySquad(squad);
  if (youth) applyYouth(youth);
  if (matches) {
    state.matches = matches.matches ?? matches;
    renderMatches();
  }
  if (changes) {
    state.changes = changes;
    renderChanges();
  }
  if (changesY) {
    state.changesYouth = changesY;
    renderYouthChanges();
  }
  if (team?.team) {
    state.team = team.team;
    applyTeamData(team.team);
  }
  if (transfers) {
    state.transfers = transfers.transfers ?? transfers;
    renderCompareControls();
    renderTransfersView();
  }
  renderTransfersView();
  if (chronicle) {
    state.chronicle = chronicle;
    renderChronicle();
  }
  const any = squad || youth || matches || changes || team || transfers || chronicle;
  const stamps = [squad?.fetchedAt, youth?.fetchedAt, matches?.fetchedAt, team?.fetchedAt, chronicle?.fetchedAt].filter(Boolean);
  renderFreshness(stamps, !!any);
  return !!any;
}

function renderFreshness(stamps, hasData) {
  const box = $('#freshness');
  if (!hasData) {
    box.className = 'freshness sample';
    box.textContent = 'Tryb przykładowy — brak danych z CHPP. Uruchom „node cli.js sync" i „npm run web".';
    return;
  }
  const newest = stamps.map((s) => new Date(s)).sort((a, b) => b - a)[0];
  if (!newest || isNaN(newest)) {
    box.textContent = '';
    box.className = 'freshness';
    return;
  }
  const days = Math.floor((Date.now() - newest.getTime()) / 86400000);
  const label =
    days <= 0 ? 'dzisiaj' : days === 1 ? 'wczoraj' : `${days} dni temu`;
  box.className = 'freshness' + (days >= 4 ? ' stale' : '');
  box.textContent =
    `Dane z CHPP: ${label} (${newest.toLocaleString('pl-PL')})` +
    (days >= 4 ? ' — rozważ „node cli.js sync"' : '');
}

function applySquad(json) {
  const players = (json.players ?? json).map((p) => ({
    trained: false,
    motherClubManual: false,
    daysAtClub: null,
    manualRating: null,
    recentRatings: [],
    ...p,
  }));
  state.squad = {
    teamName: json.teamName ?? 'Wczytana kadra',
    teamId: json.teamId ?? 0,
    players,
  };
  state.locks = {};
  state.lineupA = state.lineupB = null;
  applyManual();
  $('#teamInfo').textContent = `${state.squad.teamName} — ${players.length} zawodników`;
  renderSquadTable();
  renderSkillMap();
  renderRatingMap();
  renderEconomy();
  renderHistory();
  optimize();
}

function applyYouth(json) {
  const players = (json.players ?? json).map((p) => ({
    isYouth: true,
    recentRatings: [],
    ...p,
  }));
  state.youth = {
    teamName: json.teamName ?? 'Młodzieżówka',
    players,
    sourceFile: json.sourceFile,
    matches: json.matches ?? [],
  };
  state.youthLocks = {};
  state.youthStarId = detectYouthStar(players);
  renderYouthControls();
  renderYouthTable();
  renderYouthSkillMap();
  renderYouthRatingMap();
  renderYouthMatches();
  renderYouthChanges();
  renderYouthPlanner();
  youthOptimize();
}

$('#btnReload').addEventListener('click', async () => {
  const ok = await loadFromServer();
  if (!ok) alert('Nie znaleziono plików w data/. Uruchom np. "node cli.js squad" i serwuj przez "npm run web".');
});

$('#fileImport').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const json = JSON.parse(reader.result);
      if (json.sourceFile || /youth/i.test(file.name)) applyYouth(json);
      else applySquad(json);
    } catch (err) {
      alert('Nieprawidłowy JSON: ' + err.message);
    }
  };
  reader.readAsText(file);
});

// ------------------------- nawigacja / powłoka -------------------------

const NAV_BTNS = document.querySelectorAll('.sidenav button');
NAV_BTNS.forEach((btn) => {
  btn.addEventListener('click', () => {
    NAV_BTNS.forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    $('#tab-' + btn.dataset.tab).classList.add('active');
    $('#viewTitle').textContent = btn.dataset.title || btn.textContent;
    closeNav();
    document.querySelector('main').scrollTo?.(0, 0);
    window.scrollTo(0, 0);
  });
});
function showTab(name) {
  document.querySelector(`.sidenav button[data-tab="${name}"]`)?.click();
}

// mobilna szuflada
function closeNav() {
  $('#sidebar').classList.remove('open');
  $('#scrim').classList.remove('show');
}
$('#navToggle')?.addEventListener('click', () => {
  const open = $('#sidebar').classList.toggle('open');
  $('#scrim').classList.toggle('show', open);
});
$('#scrim')?.addEventListener('click', closeNav);

// motyw: brak wpisu = wg systemu; przełącznik ustawia jawnie light/dark
const THEME_KEY = 'gaffer:theme';
function currentTheme() {
  return (
    document.documentElement.dataset.theme ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  );
}
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
try {
  applyTheme(localStorage.getItem(THEME_KEY));
} catch {
  /* ignore */
}
$('#themeToggle')?.addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* ignore */
  }
});

// ------------------------- KADRA -------------------------

const SQUAD_COLS = [
  { key: 'number', label: 'Nr', get: (p) => p.number ?? '' },
  { key: 'name', label: 'Zawodnik', cls: 'name', get: fullName },
  { key: 'ageYears', label: 'Wiek', get: (p) => p.ageYears },
  { key: 'specialty', label: 'Specjalność', cls: 'name', get: (p) => specialtyName(p.specialty) },
  { key: 'form', label: 'Fm', edit: 'form' },
  { key: 'stamina', label: 'Kon', edit: 'stamina' },
  { key: 'keeper', label: 'GK', edit: 'keeper' },
  { key: 'defending', label: 'DF', edit: 'defending' },
  { key: 'playmaking', label: 'PM', edit: 'playmaking' },
  { key: 'winger', label: 'WG', edit: 'winger' },
  { key: 'passing', label: 'PS', edit: 'passing' },
  { key: 'scoring', label: 'SC', edit: 'scoring' },
  { key: 'setPieces', label: 'SP', edit: 'setPieces' },
  { key: 'tsi', label: 'TSI', get: (p) => p.tsi },
  { key: 'estValue', label: 'Szac. wartość', cls: 'val', get: (p) => (estValue(p) ?? '—').toLocaleString('pl-PL') },
  { key: 'avgRating', label: 'Śr. ocena', editRating: true },
  { key: 'trained', label: 'Tren.', check: 'trained' },
  { key: 'motherClubManual', label: 'Wych.', check: 'motherClubManual' },
  { key: 'daysAtClub', label: 'Dni', editText: 'daysAtClub' },
  { key: 'weeksSinceLastMatch', label: 'BezMeczu', get: (p) => p.weeksSinceLastMatch ?? '—' },
  { key: 'yellowCards', label: 'Ż', get: (p) => `${p.yellowCards ?? 0}${isSuspended(p) ? ' ⚠' : ''}` },
];

function sortedPlayers() {
  const col = SQUAD_COLS.find((c) => c.key === state.sortKey);
  const val = (p) => {
    if (state.sortKey === 'estValue') return estValue(p) ?? 0;
    if (state.sortKey === 'avgRating') return p.manualRating ?? avgOfRecent(p) ?? 0;
    return col?.get ? col.get(p) : p[state.sortKey];
  };
  return [...state.squad.players].sort((a, b) => {
    const x = val(a), y = val(b);
    const cmp = typeof x === 'string' ? String(x).localeCompare(String(y)) : (x || 0) - (y || 0);
    return state.sortDir === 'asc' ? cmp : -cmp;
  });
}

function renderSquadTable() {
  const thead = $('#squadTable thead');
  const tbody = $('#squadTable tbody');
  thead.innerHTML =
    '<tr>' +
    SQUAD_COLS.map((c) => {
      const s = state.sortKey === c.key ? ' sorted' + (state.sortDir === 'asc' ? ' asc' : '') : '';
      return `<th class="${c.cls ?? ''}${s}" data-key="${c.key}">${c.label}</th>`;
    }).join('') +
    '</tr>';
  thead.querySelectorAll('th').forEach((th) => {
    th.addEventListener('click', () => {
      const k = th.dataset.key;
      if (state.sortKey === k) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else {
        state.sortKey = k;
        state.sortDir = 'desc';
      }
      renderSquadTable();
    });
  });

  tbody.innerHTML = '';
  for (const p of sortedPlayers()) {
    const tr = document.createElement('tr');
    if (p.injuryLevel > 0) tr.classList.add('injured');
    if (isSuspended(p)) tr.classList.add('suspended');
    for (const c of SQUAD_COLS) {
      const td = document.createElement('td');
      if (c.cls) td.className = c.cls;
      if (c.edit) {
        td.className = 'skill';
        const inp = Object.assign(document.createElement('input'), { type: 'number', min: 0, max: 25, value: p[c.edit] ?? 0 });
        inp.addEventListener('change', () => {
          p[c.edit] = Number(inp.value);
          renderSkillMap();
          optimize();
        });
        td.append(inp);
      } else if (c.editText) {
        const inp = Object.assign(document.createElement('input'), { type: 'text', value: p[c.editText] ?? '' });
        inp.addEventListener('change', () => {
          p[c.editText] = inp.value === '' ? null : Number(inp.value);
          saveManual();
        });
        td.append(inp);
      } else if (c.editRating) {
        td.className = 'rating';
        const cur = p.manualRating ?? avgOfRecent(p);
        const inp = Object.assign(document.createElement('input'), {
          type: 'number', min: 0, max: 5, step: 0.1,
          value: cur == null ? '' : Number(cur.toFixed(2)),
          placeholder: '—',
        });
        if (p.manualRating != null) inp.style.color = 'var(--accent)';
        inp.addEventListener('change', () => {
          p.manualRating = inp.value === '' ? null : Number(inp.value);
          saveManual();
          renderRatingMap();
          optimize();
        });
        td.append(inp);
      } else if (c.check) {
        const inp = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !!p[c.check] });
        inp.addEventListener('change', () => {
          p[c.check] = inp.checked;
          saveManual();
          optimize();
        });
        td.style.textAlign = 'center';
        td.append(inp);
      } else {
        td.textContent = c.get(p);
        if (c.key === 'weeksSinceLastMatch' && p.weeksSinceLastMatch >= 4) td.classList.add('idle-flag');
      }
      tr.append(td);
    }
    tbody.append(tr);
  }
}

// ------------------------- MAPA UMIEJĘTNOŚCI -------------------------

function renderSkillMap() {
  const thead = $('#skillMap thead');
  const tbody = $('#skillMap tbody');
  const showLoy = $('#skillMapLoyalty')?.checked;
  thead.innerHTML =
    '<tr><th class="name">Zawodnik</th>' +
    SKILL_KEYS.map((k) => `<th>${SKILL_LABEL[k]}</th>`).join('') +
    (showLoy ? '<th>+Loj.</th>' : '') +
    '</tr>';
  tbody.innerHTML = '';
  for (const p of sortedPlayers()) {
    const tops = topSkills(p, 2);
    const maxVal = Math.max(...SKILL_KEYS.filter((k) => k !== 'form').map((k) => p[k] || 0));
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td class="name">${fullName(p)} <span style="color:var(--muted)">(${p.tsi})</span></td>` +
      SKILL_KEYS.map((k) => {
        const v = p[k] || 0;
        const bold = tops.includes(k) ? 'font-weight:700;' : '';
        const star = v === maxVal && v > 0 && k !== 'form' ? ' ★' : '';
        return `<td class="skill" style="background:${skillColor(v)};${bold}">${v}${star}</td>`;
      }).join('') +
      (showLoy ? `<td class="rating">${loyaltyBonus(p) ? '+' + loyaltyBonus(p).toFixed(2) : '—'}</td>` : '');
    tbody.append(tr);
  }
}

// ------------------------- krycie (podpowiedź) -------------------------

function renderMarkAdvice() {
  const box = $('#markAdvice');
  if (!box) return;
  const pos = $('#markPos').value;
  if (!pos) return (box.innerHTML = '');
  const marks = suggestManMarker(state.squad.players, pos, currentOpts());
  box.innerHTML =
    'Najlepsi do krycia: ' +
    marks.map((m) => `${fullName(m.player)} (${fmt(m.score)})`).join(' · ');
}

// ------------------------- znajdź podobnych -------------------------

function renderSimilarControls() {
  const sel = $('#similarPlayer');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— wybierz —</option>';
  for (const p of [...state.squad.players].sort((a, b) => b.tsi - a.tsi))
    sel.append(new Option(`${fullName(p)} (TSI ${p.tsi.toLocaleString('pl-PL')})`, p.id));
  sel.value = cur;
  renderSimilar(Number(sel.value) || null);
}

function renderSimilar(playerId) {
  const t = $('#similarTable');
  if (!t) return;
  const target = state.squad.players.find((p) => p.id === playerId);
  const src = state.transfers || [];
  t.querySelector('thead').innerHTML =
    '<tr><th class="name">Zawodnik z historii transferów</th><th>TSI</th><th>Δ%</th><th>Cena</th><th class="name">Data</th></tr>';
  if (!target) {
    t.querySelector('tbody').innerHTML = '<tr><td class="name" colspan="5">Wybierz zawodnika powyżej.</td></tr>';
    return;
  }
  if (!src.length) {
    t.querySelector('tbody').innerHTML =
      '<tr><td class="name" colspan="5">Brak danych. Uruchom <code>node cli.js transfers</code>.</td></tr>';
    return;
  }
  const rows = src
    .filter((x) => x.tsi > 0)
    .map((x) => ({ ...x, d: Math.abs(x.tsi - target.tsi) / target.tsi }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 15);
  t.querySelector('tbody').innerHTML = rows
    .map(
      (x) =>
        `<tr><td class="name">${x.playerName}</td><td>${(x.tsi || 0).toLocaleString('pl-PL')}</td><td class="rating">${(x.d * 100).toFixed(1)}</td><td>${(x.price || 0).toLocaleString('pl-PL')}</td><td class="name">${(x.date || '').slice(0, 10)}</td></tr>`,
    )
    .join('');
}

// ------------------------- TRANSFERY: skaner rynku + historia -------------------------

function buildScoutCmd() {
  const parts = ['node cli.js scout'];
  if ($('#scPos').value) parts.push(`--pos=${$('#scPos').value}`);
  if ($('#scSkill').value && $('#scMin').value) parts.push(`--skill=${$('#scSkill').value} --min=${$('#scMin').value}`);
  if ($('#scAge').value) parts.push(`--ageMax=${$('#scAge').value}`);
  if ($('#scPrice').value) parts.push(`--priceMax=${$('#scPrice').value}`);
  if ($('#scTsi').value) parts.push(`--tsiMax=${$('#scTsi').value}`);
  const cmd = parts.join(' ');
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(cmd).then(() => alert('Skopiowano:\n' + cmd), () => prompt('Komenda:', cmd));
  else prompt('Komenda:', cmd);
}

function renderScout() {
  const t = $('#scoutTable');
  if (!t) return;
  const data = state.scout;
  const pos = $('#scPos')?.value || data?.criteria?.pos || 'IM';
  const opts = { allowInjured: true, allowSuspended: true };
  t.querySelector('thead').innerHTML =
    `<tr><th class="name">Zawodnik</th><th>Wiek</th><th>GK</th><th>DF</th><th>PM</th><th>WG</th><th>PS</th><th>SC</th><th>TSI</th><th>Cena</th><th>Ocena ${POSITION_LABEL[pos] || pos}</th><th>Σ-zysk</th><th>Zł/Σ</th></tr>`;
  const results = data?.results || [];
  if (!results.length) {
    t.querySelector('tbody').innerHTML =
      '<tr><td class="name" colspan="13">Brak danych. Ustaw kryteria, „Kopiuj komendę", odpal <code>node cli.js scout …</code>.</td></tr>';
    return;
  }
  const rows = results
    .map((p) => {
      const rate = ratePlayerForSlot(p, pos, opts);
      const mg = marginalGain(state.squad.players, p, currentOpts());
      const zlPerSigma = mg.gain > 0 ? Math.round(p.askingPrice / mg.gain) : null;
      return { p, rate, gain: mg.gain, slot: mg.slot, zlPerSigma };
    })
    .sort((a, b) => b.gain - a.gain);
  t.querySelector('tbody').innerHTML = rows
    .map(
      ({ p, rate, gain, zlPerSigma }) =>
        `<tr><td class="name">${fullName(p)}</td><td>${p.ageYears}</td>` +
        `<td class="rating">${p.keeper}</td><td class="rating">${p.defending}</td><td class="rating">${p.playmaking}</td>` +
        `<td class="rating">${p.winger}</td><td class="rating">${p.passing}</td><td class="rating">${p.scoring}</td>` +
        `<td class="rating">${(p.tsi || 0).toLocaleString('pl-PL')}</td>` +
        `<td class="rating">${(p.askingPrice || 0).toLocaleString('pl-PL')}</td>` +
        `<td class="rating">${fmt(rate)}</td>` +
        `<td class="rating ${gain > 0 ? 'cmp-hi' : ''}">${gain > 0 ? '+' + gain.toFixed(2) : gain.toFixed(2)}</td>` +
        `<td class="rating">${zlPerSigma ? zlPerSigma.toLocaleString('pl-PL') : '—'}</td></tr>`,
    )
    .join('');
}

function renderTransferHistory() {
  const t = $('#transferHist');
  if (!t) return;
  const tr = state.transfers || [];
  const spent = tr.filter((x) => x.type === 'B').reduce((s, x) => s + (x.price || 0), 0);
  const earned = tr.filter((x) => x.type === 'S').reduce((s, x) => s + (x.price || 0), 0);
  $('#transferPnl').innerHTML =
    ecoCard('Wydano (kupno)', pl(spent)) +
    ecoCard('Zarobiono (sprzedaż)', pl(earned)) +
    ecoCard('Netto', (earned - spent >= 0 ? '+' : '') + pl(earned - spent)) +
    ecoCard('Transakcji', String(tr.length));
  t.querySelector('thead').innerHTML =
    '<tr><th class="name">Data</th><th class="name">Zawodnik</th><th>TSI</th><th>Cena</th><th class="name">Typ</th></tr>';
  t.querySelector('tbody').innerHTML = tr.length
    ? [...tr]
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .map(
          (x) =>
            `<tr><td class="name">${(x.date || '').slice(0, 10)}</td><td class="name">${x.playerName}</td><td class="rating">${(x.tsi || 0).toLocaleString('pl-PL')}</td><td class="rating">${(x.price || 0).toLocaleString('pl-PL')}</td><td class="name">${x.type === 'B' ? 'kupno' : x.type === 'S' ? 'sprzedaż' : x.type || '—'}</td></tr>`,
        )
        .join('')
    : '<tr><td class="name" colspan="5">Brak. Uruchom <code>node cli.js transfers</code>.</td></tr>';
}

function renderTransfersView() {
  renderScout();
  renderTransferHistory();
  renderSimilarControls();
}

// ------------------------- porównanie zawodników -------------------------

const CMP_ROWS = [
  { k: 'ageYears', label: 'Wiek' },
  { k: 'form', label: 'Forma', skill: true },
  { k: 'stamina', label: 'Kondycja', skill: true },
  { k: 'keeper', label: 'Bramkarstwo', skill: true },
  { k: 'defending', label: 'Obrona', skill: true },
  { k: 'playmaking', label: 'Rozgrywanie', skill: true },
  { k: 'winger', label: 'Skrzydła', skill: true },
  { k: 'passing', label: 'Podania', skill: true },
  { k: 'scoring', label: 'Wykończenie', skill: true },
  { k: 'setPieces', label: 'Stałe fragmenty', skill: true },
  { k: 'tsi', label: 'TSI', fmt: (v) => (v || 0).toLocaleString('pl-PL') },
  { k: 'salary', label: 'Pensja', fmt: (v) => (v || 0).toLocaleString('pl-PL') },
  { k: 'specialty', label: 'Specjalność', fmt: (v) => specialtyName(v) },
  { k: '_value', label: 'Szac. wartość', fmt: (v) => (v ?? '—').toLocaleString('pl-PL') },
  { k: '_rating', label: 'Śr. ocena', fmt: (v) => (v == null ? '—' : v.toFixed(2)) },
  { k: '_bestpos', label: 'Najlepsza pozycja', fmt: (v) => v },
  { k: 'weeksSinceLastMatch', label: 'Tyg. bez meczu', fmt: (v) => v ?? '—' },
];

function bestPositionOf(p) {
  const opts = { allowInjured: true, allowSuspended: true };
  const ranked = ['GK', 'CD', 'WB', 'WI', 'IM', 'FW']
    .map((s) => ({ s, v: ratePlayerForSlot(p, s, opts) }))
    .sort((a, b) => b.v - a.v)[0];
  return `${POSITION_LABEL[ranked.s]} (${fmt(ranked.v)})`;
}

function renderCompareControls() {
  const opts =
    '<option value="">— zawodnik —</option>' +
    [...state.squad.players]
      .sort((a, b) => b.tsi - a.tsi)
      .map((p) => `<option value="${p.id}">${fullName(p)}</option>`)
      .join('');
  ['#cmp1', '#cmp2', '#cmp3'].forEach((sel, i) => {
    const el = $(sel);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = opts;
    el.value = cur || (i < 2 ? String([...state.squad.players].sort((a, b) => b.tsi - a.tsi)[i]?.id ?? '') : '');
  });
  renderCompare();
}

function renderCompare() {
  const t = $('#compareTable');
  if (!t) return;
  const ids = ['#cmp1', '#cmp2', '#cmp3'].map((s) => Number($(s)?.value) || null).filter(Boolean);
  const picks = ids.map((id) => state.squad.players.find((p) => p.id === id)).filter(Boolean);
  if (picks.length < 2) {
    t.querySelector('thead').innerHTML = '';
    t.querySelector('tbody').innerHTML = '<tr><td class="name">Wybierz co najmniej 2 zawodników.</td></tr>';
    return;
  }
  refreshRatings(state.squad.players);
  const val = (p, r) => {
    if (r.k === '_value') return estValue(p);
    if (r.k === '_rating') return p.manualRating ?? avgOfRecent(p);
    if (r.k === '_bestpos') return bestPositionOf(p);
    return p[r.k];
  };
  t.querySelector('thead').innerHTML =
    '<tr><th class="name">Atrybut</th>' + picks.map((p) => `<th class="name">${fullName(p)}</th>`).join('') + '</tr>';
  t.querySelector('tbody').innerHTML = CMP_ROWS.map((r) => {
    const vals = picks.map((p) => val(p, r));
    const nums = r.skill ? vals.map((v) => Number(v) || 0) : null;
    const max = nums ? Math.max(...nums) : null;
    const min = nums ? Math.min(...nums) : null;
    const cells = picks
      .map((p, i) => {
        const raw = vals[i];
        const disp = r.fmt ? r.fmt(raw) : raw;
        let cls = r.skill ? 'rating' : 'name';
        if (nums && max !== min) {
          if (nums[i] === max) cls += ' cmp-hi';
          else if (nums[i] === min) cls += ' cmp-lo';
        }
        return `<td class="${cls}">${disp ?? '—'}</td>`;
      })
      .join('');
    return `<tr><td class="name">${r.label}</td>${cells}</tr>`;
  }).join('');
}

// ------------------------- KRONIKA KLUBU -------------------------

const CHRON_METRICS = [
  ['powerRating', 'PowerRating'],
  ['rankings', 'Rankingi (global/liga/region)'],
  ['league', 'Tabela ligi (miejsce/pkt/bilans)'],
  ['form', 'Ostatnie wyniki'],
  ['tsi', 'TSI (łączne / top 11)'],
  ['trainer', 'Trener'],
  ['fanclub', 'Klub kibica'],
  ['arena', 'Stadion'],
];
const CMKEY = 'gaffer:chron-metrics';
function chronEnabled() {
  try {
    return JSON.parse(localStorage.getItem(CMKEY)) || CHRON_METRICS.map(([k]) => k);
  } catch {
    return CHRON_METRICS.map(([k]) => k);
  }
}
function renderChronMetricToggles() {
  const box = $('#chronMetrics');
  if (!box) return;
  const on = new Set(chronEnabled());
  box.innerHTML = CHRON_METRICS.map(
    ([k, label]) =>
      `<label class="row check"><input type="checkbox" data-m="${k}" ${on.has(k) ? 'checked' : ''}/><span>${label}</span></label>`,
  ).join('');
  box.querySelectorAll('input').forEach((inp) =>
    inp.addEventListener('change', () => {
      const sel = [...box.querySelectorAll('input:checked')].map((i) => i.dataset.m);
      try {
        localStorage.setItem(CMKEY, JSON.stringify(sel));
      } catch {
        /* ignore */
      }
      renderChronicle();
    }),
  );
}

function chronFormStr(rec, teamName) {
  return (rec || [])
    .slice(0, 5)
    .map((m) => {
      const home = m.homeTeamName === teamName;
      const us = home ? m.homeGoals : m.awayGoals;
      const th = home ? m.awayGoals : m.homeGoals;
      return us > th ? 'W' : us < th ? 'P' : 'R';
    })
    .join(' ');
}

function renderChronicle() {
  const box = $('#chronicleBox');
  if (!box) return;
  renderChronMetricToggles();
  const teams = state.chronicle?.teams || [];
  if (!teams.length) {
    box.innerHTML =
      '<p class="hint">Brak śledzonych drużyn. Dodaj: <code>node cli.js watch add &lt;teamId&gt;</code>, potem <code>node cli.js chronicle</code>.</p>';
    return;
  }
  const on = new Set(chronEnabled());
  const delta = (cur, prev) => {
    if (prev == null || cur == null || cur === prev) return '';
    const d = cur - prev;
    return ` <span class="${d > 0 ? 'full' : 'none'}">(${d > 0 ? '+' : ''}${d})</span>`;
  };
  box.innerHTML = teams
    .map((t) => {
      const p = t.previous || {};
      const rows = [];
      if (on.has('powerRating')) rows.push(`PowerRating: <b>${t.powerRating || '—'}</b>${delta(t.powerRating, p.powerRating)}`);
      if (on.has('rankings'))
        rows.push(`Rankingi: G ${t.globalRanking || '—'} · L ${t.leagueRanking || '—'} · R ${t.regionRanking || '—'}`);
      if (on.has('league') && t.league)
        rows.push(
          `Liga: miejsce <b>${t.league.position}</b>${delta(p.league?.position, t.league?.position)} · ${t.league.points} pkt · ${t.league.won}-${t.league.draws}-${t.league.lost} · ${t.league.goalsFor}:${t.league.goalsAgainst}`,
        );
      if (on.has('form')) rows.push(`Forma: ${chronFormStr(t.recent, t.name) || '—'}`);
      if (on.has('tsi'))
        rows.push(`TSI: ${(t.totalTsi || 0).toLocaleString('pl-PL')} (top11 ${(t.top11Tsi || 0).toLocaleString('pl-PL')})${delta(t.totalTsi, p.totalTsi)}`);
      if (on.has('trainer')) rows.push(`Trener: ${t.trainerName || '—'}`);
      if (on.has('fanclub')) rows.push(`Klub kibica: ${(t.fanClubSize || 0).toLocaleString('pl-PL')}${delta(t.fanClubSize, p.fanClubSize)}`);
      if (on.has('arena'))
        rows.push(
          `Stadion: ${t.arenaName || '—'} · ${(t.arenaSize || 0).toLocaleString('pl-PL')}${t.arenaExpansion ? ` → ${(t.arenaExpanded || 0).toLocaleString('pl-PL')} (rozbudowa)` : ''}`,
        );
      return `<div class="chron-card"><div class="ecl">${t.name} — ${t.leagueUnitName || ''}</div>${rows.map((r) => `<div class="chron-row">${r}</div>`).join('')}</div>`;
    })
    .join('');
  renderThreatRadar();
}

// ------------------------- MŁODZIEŻ: tabela / oceny / mecze / zmiany -------------------------

let youthSort = { key: 'pot', dir: 'desc' };
function youthPotOf(p) {
  return youthPotential(p);
}
function renderYouthTable() {
  const t = $('#youthTable');
  if (!t) return;
  const cols = [
    { key: 'name', label: 'Zawodnik', cls: 'name', get: fullName },
    { key: 'ageYears', label: 'Wiek', get: (p) => p.ageYears },
    { key: 'specialty', label: 'Specjalność', cls: 'name', get: (p) => specialtyName(p.specialty) },
    { key: 'pot', label: 'Potencjał', get: youthPotOf },
    { key: 'keeperMax', label: 'GKm', get: (p) => dashN(p.keeperMax) },
    { key: 'defendingMax', label: 'DFm', get: (p) => dashN(p.defendingMax) },
    { key: 'playmakingMax', label: 'PMm', get: (p) => dashN(p.playmakingMax) },
    { key: 'wingerMax', label: 'WGm', get: (p) => dashN(p.wingerMax) },
    { key: 'passingMax', label: 'PSm', get: (p) => dashN(p.passingMax) },
    { key: 'scoringMax', label: 'SCm', get: (p) => dashN(p.scoringMax) },
    { key: 'canBePromotedInDays', label: 'Awans za', get: (p) => (p.canBePromotedInDays ?? '—') },
    { key: 'lastRating', label: 'Ost. ocena', get: (p) => (p.lastRating != null ? p.lastRating.toFixed(1) : '—') },
  ];
  t.querySelector('thead').innerHTML =
    '<tr>' +
    cols
      .map((c) => {
        const s = youthSort.key === c.key ? ' sorted' + (youthSort.dir === 'asc' ? ' asc' : '') : '';
        return `<th class="${c.cls || ''}${s}" data-k="${c.key}">${c.label}</th>`;
      })
      .join('') +
    '</tr>';
  t.querySelectorAll('thead th').forEach((th) =>
    th.addEventListener('click', () => {
      const k = th.dataset.k;
      if (youthSort.key === k) youthSort.dir = youthSort.dir === 'asc' ? 'desc' : 'asc';
      else youthSort = { key: k, dir: 'desc' };
      renderYouthTable();
    }),
  );
  const val = (p) => (youthSort.key === 'pot' ? youthPotOf(p) : cols.find((c) => c.key === youthSort.key)?.get(p) ?? p[youthSort.key]);
  const rows = [...state.youth.players].sort((a, b) => {
    const x = val(a), y = val(b);
    const n = typeof x === 'string' ? String(x).localeCompare(String(y)) : (Number(x) || 0) - (Number(y) || 0);
    return youthSort.dir === 'asc' ? n : -n;
  });
  t.querySelector('tbody').innerHTML = rows
    .map(
      (p) =>
        `<tr${p.id === state.youthStarId ? ' class="star-row"' : ''}>` +
        cols.map((c) => `<td class="${c.cls || 'rating'}">${c.get(p)}</td>`).join('') +
        '</tr>',
    )
    .join('');
}
const dashN = (v) => (v == null || v < 0 ? '—' : v);

function renderYouthRatingMap() {
  const t = $('#youthRatingMap');
  if (!t) return;
  const seen = new Map();
  for (const p of state.youth.players) for (const r of p.recentRatings || []) seen.set(r.matchId, r.date);
  const cols = [...seen.entries()].sort((a, b) => new Date(b[1]) - new Date(a[1])).slice(0, 8);
  t.querySelector('thead').innerHTML =
    '<tr><th class="name">Zawodnik</th>' + cols.map(([, d]) => `<th>${(d || '').slice(5, 10)}</th>`).join('') + '<th>Śr.</th></tr>';
  if (!cols.length) {
    t.querySelector('tbody').innerHTML =
      '<tr><td class="name" colspan="2">Brak ocen. Pojawią się po <code>node cli.js youth</code> (zbiera oceny z meczów młodzieży).</td></tr>';
    return;
  }
  t.querySelector('tbody').innerHTML = [...state.youth.players]
    .map((p) => {
      const bm = new Map((p.recentRatings || []).map((r) => [r.matchId, r.stars]));
      const vals = (p.recentRatings || []).map((r) => r.stars);
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      return (
        `<tr><td class="name">${fullName(p)}</td>` +
        cols
          .map(([mid]) => {
            const s = bm.get(mid);
            return s == null ? '<td class="rating" style="color:var(--muted)">·</td>' : `<td class="rating" style="background:${ratingColor(s)}">${s.toFixed(1)}</td>`;
          })
          .join('') +
        `<td class="rating">${avg == null ? '—' : avg.toFixed(2)}</td></tr>`
      );
    })
    .join('');
}

function renderYouthMatches() {
  const t = $('#youthMatchTable');
  if (!t) return;
  const list = (state.youth.matches || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  t.querySelector('thead').innerHTML =
    '<tr><th class="name">Data</th><th class="name">Status</th><th class="name">Gospodarz</th><th class="name">Gość</th><th>Wynik</th></tr>';
  t.querySelector('tbody').innerHTML = list.length
    ? list
        .map(
          (m) =>
            `<tr><td class="name">${(m.date || '').replace('T', ' ').slice(0, 16)}</td><td class="name">${m.status || ''}</td><td class="name">${m.homeTeamName || ''}</td><td class="name">${m.awayTeamName || ''}</td><td>${m.homeGoals == null ? '' : `${m.homeGoals}:${m.awayGoals}`}</td></tr>`,
        )
        .join('')
    : '<tr><td class="name" colspan="5">Brak meczów młodzieży w danych.</td></tr>';
}

function renderYouthChanges() {
  const box = $('#youthChangesBox');
  if (!box) return;
  const c = state.changesYouth;
  if (!c || !c.enough) {
    box.innerHTML = '<p class="hint">Brak. Uruchom <code>node cli.js youth</code> dwa razy w odstępie, potem <code>node cli.js changes --youth</code>.</p>';
    return;
  }
  const ups = (c.changed || [])
    .map((x) => `<li>${x.name}: ${x.deltas.map((d) => `<span class="${d.diff > 0 ? 'full' : 'none'}">${d.skill} ${d.from}→${d.to}</span>`).join(', ')}</li>`)
    .join('');
  box.innerHTML =
    `<p class="hint">Migawki: ${(c.prevAt || '').slice(0, 16)} → ${(c.currAt || '').slice(0, 16)}</p>` +
    `<p class="hint">Nowi: ${(c.added || []).map((x) => x.name).join(', ') || '—'} · Odeszli: ${(c.removed || []).map((x) => x.name).join(', ') || '—'}</p>` +
    (ups ? `<ul class="chg">${ups}</ul>` : '<p class="hint">Brak zmian umiejętności.</p>');
}

// ------------------------- start -------------------------

// ------------------------- MAPA OCEN -------------------------

function ratingColor(stars) {
  return skillColor((stars || 0) * 4); // 0..5 -> 0..20 skala koloru
}

function renderRatingMap() {
  refreshRatings(state.squad.players);
  // wspólny zestaw ostatnich meczów (po dacie), max 8
  const seen = new Map();
  for (const p of state.squad.players)
    for (const r of p.recentRatings || []) seen.set(r.matchId, r.date);
  const matchCols = [...seen.entries()].sort((a, b) => new Date(b[1]) - new Date(a[1])).slice(0, 8);

  const thead = $('#ratingMap thead');
  const tbody = $('#ratingMap tbody');
  thead.innerHTML =
    '<tr><th class="name">Zawodnik</th>' +
    matchCols.map(([, d]) => `<th>${(d || '').slice(5, 10)}</th>`).join('') +
    '<th>Śr.</th></tr>';
  if (!matchCols.length) {
    tbody.innerHTML =
      '<tr><td class="name" colspan="2">Brak ocen z meczów. Pojawią się po „node cli.js squad" (zbiera RatingStars z ostatnich meczów). Możesz też wpisać ręczną średnią w zakładce Kadra.</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  for (const p of sortedPlayers()) {
    const byMatch = new Map((p.recentRatings || []).map((r) => [r.matchId, r.stars]));
    const avg = p.manualRating ?? avgOfRecent(p);
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td class="name">${fullName(p)}</td>` +
      matchCols
        .map(([mid]) => {
          const s = byMatch.get(mid);
          return s == null
            ? '<td class="rating" style="color:var(--muted)">·</td>'
            : `<td class="rating" style="background:${ratingColor(s)}">${s.toFixed(1)}</td>`;
        })
        .join('') +
      `<td class="rating" style="${p.manualRating != null ? 'color:var(--accent);font-weight:700' : ''}">${avg == null ? '—' : avg.toFixed(2)}</td>`;
    tbody.append(tr);
  }
}

// ------------------------- MECZE -------------------------

function renderMatches() {
  const list = (state.matches || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));
  const thead = $('#matchTable thead');
  const tbody = $('#matchTable tbody');
  thead.innerHTML =
    '<tr><th class="name">Data</th><th class="name">Status</th><th class="name">Gospodarz</th><th class="name">Gość</th><th>Wynik</th><th></th></tr>';
  tbody.innerHTML = '';
  for (const m of list) {
    const upcoming = m.status === 'UPCOMING' || m.status === 'ONGOING';
    const tr = document.createElement('tr');
    tr.className = upcoming ? 'match-upcoming' : 'match-done';
    tr.innerHTML =
      `<td class="name">${(m.date || '').replace('T', ' ').slice(0, 16)}</td>` +
      `<td class="name">${m.status || ''}</td>` +
      `<td class="name">${m.homeTeamName || ''}</td>` +
      `<td class="name">${m.awayTeamName || ''}</td>` +
      `<td>${m.homeGoals == null ? '' : `${m.homeGoals}:${m.awayGoals}`}</td>` +
      `<td>${upcoming ? '<button class="linkish">Ustaw skład</button>' : ''}</td>`;
    const btn = tr.querySelector('button');
    if (btn) btn.addEventListener('click', () => { showTab('optimizer'); optimize(); });
    tbody.append(tr);
  }
}

// ------------------------- OPTYMALIZATOR (seniorzy) -------------------------

function initOptimizerControls() {
  for (const name of Object.keys(FORMATIONS)) {
    $('#formation').append(new Option(name, name));
    $('#youthFormation').append(new Option(name, name));
  }
  for (const name of Object.keys(TRAINING_TYPES)) $('#trainingType').append(new Option(name, name));
  for (const name of Object.keys(PRIMARY_TRAINED_SKILL)) $('#trType').append(new Option(name, name));
  $('#trType').value = 'Rozgrywanie';
  $('#trainingWeight').addEventListener('input', (e) => ($('#trainingWeightOut').textContent = e.target.value));

  ['#optMode', '#formation', '#useLoyalty', '#allowInjured', '#allowSuspended', '#extraTime', '#idleOn', '#idleWeeks', '#trainingType', '#trainingWeight'].forEach(
    (sel) => $(sel).addEventListener('change', () => { state.locks = {}; optimize(); }),
  );
  $('#markPos').addEventListener('change', renderMarkAdvice);
  $('#skillMapLoyalty').addEventListener('change', renderSkillMap);
  $('#similarPlayer').addEventListener('change', (e) => renderSimilar(Number(e.target.value) || null));
  ['#cmp1', '#cmp2', '#cmp3'].forEach((s) => $(s)?.addEventListener('change', renderCompare));
  $('#btnScoutCmd')?.addEventListener('click', buildScoutCmd);
  ['#scPos', '#scSkill'].forEach((s) => $(s)?.addEventListener('change', renderScout));
  $('#btnOptimize').addEventListener('click', () => { state.showing = 'A'; optimize(); });
  $('#btnSquadB').addEventListener('click', squadB);
  $('#btnClearLocks').addEventListener('click', () => { pushLockHistory(); state.locks = {}; optimize(); });
  $('#btnUndo').addEventListener('click', undoLock);
  $('#pickerClose').addEventListener('click', () => $('#picker').classList.add('hidden'));
  $('#btnExportLineup').addEventListener('click', exportLineup);
  $('#btnReport').addEventListener('click', exportReport);
  $('#btnCalibrate').addEventListener('click', runCalibration);

  // drużyna / pogoda
  const tc = loadTeamCfg();
  if (tc.spirit) $('#teamSpirit').value = tc.spirit;
  if (tc.confidence) $('#teamConfidence').value = tc.confidence;
  ['#teamSpirit', '#teamConfidence'].forEach((s) =>
    $(s).addEventListener('change', () => { saveTeamCfg(); renderSectors(state.lineupA); }),
  );
  $('#weather').addEventListener('change', renderWeatherImpact);

  // wagi pozycji
  loadWeights();
  buildWeightSliders();
  $('#btnResetWeights').addEventListener('click', () => {
    resetWeights();
    persistWeights();
    buildWeightSliders();
    optimize();
  });

  // presety
  refreshPresetSelect();
  $('#btnPresetSave').addEventListener('click', () => {
    const name = prompt('Nazwa presetu:');
    if (!name) return;
    const all = loadPresets();
    all[name] = currentPreset();
    savePresets(all);
    refreshPresetSelect();
    $('#presetSel').value = name;
  });
  $('#btnPresetDelete').addEventListener('click', () => {
    const name = $('#presetSel').value;
    if (!name) return;
    const all = loadPresets();
    delete all[name];
    savePresets(all);
    refreshPresetSelect();
  });
  $('#presetSel').addEventListener('change', (e) => {
    const p = loadPresets()[e.target.value];
    if (p) applyPreset(p);
  });

  // trening
  ['#trType', '#trIntensity', '#trStamina', '#trCoach', '#trAssist'].forEach((s) =>
    $(s).addEventListener('change', renderTraining),
  );
  // kontr-ustawienie
  ['#oppDef', '#oppMid', '#oppAtt'].forEach((s) =>
    $(s).addEventListener('input', () => renderCounter(state.lastSectors)),
  );

  $('#youthMode').addEventListener('change', youthOptimize);
  $('#youthFormation').addEventListener('change', youthOptimize);
  $('#youthRevealedOnly').addEventListener('change', () => { renderYouthSkillMap(); youthOptimize(); });
  $('#youthStar').addEventListener('change', (e) => { state.youthStarId = Number(e.target.value) || null; youthOptimize(); });
  $('#btnYouthOptimize').addEventListener('click', youthOptimize);
}

// ------------------------- wagi pozycji (UI) -------------------------

const WKEY = 'gaffer:weights';
function loadWeights() {
  try {
    const w = JSON.parse(localStorage.getItem(WKEY));
    if (w) setWeights(w);
  } catch {
    /* brak / uszkodzone — zostają domyślne */
  }
}
function persistWeights() {
  try {
    localStorage.setItem(WKEY, JSON.stringify(WEIGHTS));
  } catch {
    /* tryb prywatny */
  }
}
function buildWeightSliders() {
  const box = $('#weightSliders');
  box.innerHTML = '';
  for (const pos of Object.keys(DEFAULT_WEIGHTS)) {
    const group = document.createElement('div');
    group.className = 'wgroup';
    group.innerHTML = `<div class="wgh">${POSITION_LABEL[pos]}</div>`;
    for (const sk of Object.keys(DEFAULT_WEIGHTS[pos])) {
      const row = document.createElement('label');
      row.className = 'row sub';
      const val = WEIGHTS[pos]?.[sk] ?? 0;
      row.innerHTML = `<span>${SKILL_LABEL[sk] ?? sk}</span>`;
      const inp = Object.assign(document.createElement('input'), {
        type: 'range', min: 0, max: 1, step: 0.02, value: val,
      });
      const out = document.createElement('output');
      out.textContent = val.toFixed(2);
      inp.addEventListener('input', () => {
        WEIGHTS[pos][sk] = Number(inp.value);
        out.textContent = Number(inp.value).toFixed(2);
      });
      inp.addEventListener('change', () => {
        persistWeights();
        optimize();
      });
      row.append(inp, out);
      group.append(row);
    }
    box.append(group);
  }
}

// ------------------------- presety -------------------------

const PKEY = 'gaffer:presets';
const loadPresets = () => {
  try {
    return JSON.parse(localStorage.getItem(PKEY)) || {};
  } catch {
    return {};
  }
};
const savePresets = (o) => {
  try {
    localStorage.setItem(PKEY, JSON.stringify(o));
  } catch {
    /* ignore */
  }
};
function refreshPresetSelect() {
  const sel = $('#presetSel');
  const cur = sel.value;
  sel.innerHTML = '<option value="">— wybierz —</option>';
  for (const name of Object.keys(loadPresets())) sel.append(new Option(name, name));
  sel.value = cur;
}
function currentPreset() {
  return {
    optMode: $('#optMode').value,
    formation: $('#formation').value,
    useLoyalty: $('#useLoyalty').checked,
    allowInjured: $('#allowInjured').checked,
    idleOn: $('#idleOn').checked,
    idleWeeks: $('#idleWeeks').value,
    trainingType: $('#trainingType').value,
    trainingWeight: $('#trainingWeight').value,
    locks: { ...state.locks },
  };
}
function applyPreset(p) {
  $('#optMode').value = p.optMode ?? 'skill';
  $('#formation').value = p.formation ?? 'auto';
  $('#useLoyalty').checked = !!p.useLoyalty;
  $('#allowInjured').checked = !!p.allowInjured;
  $('#idleOn').checked = !!p.idleOn;
  $('#idleWeeks').value = p.idleWeeks ?? 4;
  $('#trainingType').value = p.trainingType ?? '';
  $('#trainingWeight').value = p.trainingWeight ?? 1;
  $('#trainingWeightOut').textContent = p.trainingWeight ?? 1;
  state.locks = { ...(p.locks || {}) };
  optimize();
}

// ------------------------- eksport składu (tekst) -------------------------

function exportLineup() {
  const lu = state.showing === 'B' ? state.lineupB : state.lineupA;
  if (!lu) return;
  const head = `${state.showing === 'B' ? 'Skład B' : 'Skład A'} — ${lu.name} (Σ ${fmt(lu.result.total)})`;
  const body = lu.result.slots
    .map((s) => `${POSITION_LABEL[s.slot]}: ${s.player ? fullName(s.player) : '—'}${s.player ? ` (${fmt(s.score)})` : ''}`)
    .join('\n');
  const txt = head + '\n' + body;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(txt).then(
      () => alert('Skopiowano skład do schowka.'),
      () => prompt('Skopiuj ręcznie:', txt),
    );
  } else {
    prompt('Skopiuj ręcznie:', txt);
  }
}

// ------------------------- TRENING (projekcja) -------------------------

function trCfg() {
  return {
    type: $('#trType').value,
    intensity: Number($('#trIntensity').value),
    staminaShare: Number($('#trStamina').value),
    coachLevel: Number($('#trCoach').value),
    assistants: Number($('#trAssist').value),
  };
}
function coverageMap(trainType) {
  const map = TRAINING_TYPES[trainType] || { full: [], partial: [] };
  const out = {};
  for (const s of state.lineupA?.result.slots || []) {
    if (!s.player) continue;
    out[s.player.id] = map.full.includes(s.slot) ? 'full' : map.partial.includes(s.slot) ? 'partial' : 'none';
  }
  return out;
}
function renderTraining() {
  const cfg = trCfg();
  const cov = coverageMap(cfg.type);
  const inXI = new Set((state.lineupA?.result.slots || []).map((s) => s.player?.id).filter(Boolean));
  const skillName = PRIMARY_TRAINED_SKILL[cfg.type];
  const skLabel = SKILL_LABEL[skillName] ?? skillName;

  const proj = $('#trProjection');
  proj.querySelector('thead').innerHTML =
    '<tr><th class="name">Zawodnik</th><th>Wiek</th><th class="name">Umiej.</th><th>Poziom</th><th>~tyg.</th><th>+13 tyg</th><th>Wartość +</th><th>Pensja +</th><th>Zwrot</th><th class="name"></th></tr>';
  const trained = state.squad.players.filter((p) => p.trained);
  proj.querySelector('tbody').innerHTML = trained.length
    ? trained
        .map((p) => {
          const c = { ...cfg, coverage: cov[p.id] ?? 'none' };
          const w = weeksToNextLevel(p, c);
          const series = projectSkillSeries(p, c, [13]);
          const roi = trainingRoi(p, c, estValue);
          const risk = wageJumpRisk(p, c);
          return `<tr>
            <td class="name">${fullName(p)}</td>
            <td>${p.ageYears}</td>
            <td class="name">${skLabel}</td>
            <td class="rating">${skillName ? p[skillName] : '—'}</td>
            <td class="rating">${w.weeks == null ? '— ' + (w.note || '') : w.weeks}</td>
            <td class="rating">${series ? series[0].level : '—'}</td>
            <td class="rating">${roi ? '+' + roi.valueGain.toLocaleString('pl-PL') : '—'}</td>
            <td class="rating">${roi ? '+' + roi.wageIncrease.toLocaleString('pl-PL') : '—'}</td>
            <td class="rating">${roi && roi.paybackWeeks ? roi.paybackWeeks + ' tyg' : '—'}</td>
            <td class="name">${risk ? `<span class="wage-warn">⚠ skok pensji ~${risk.weeks} tyg</span>` : ''}</td>
          </tr>`;
        })
        .join('')
    : '<tr><td class="name" colspan="10">Nikt nie oznaczony jako trenowany (kolumna „Tren." w Kadrze).</td></tr>';

  const rank = $('#trRanking');
  rank.querySelector('thead').innerHTML =
    '<tr><th class="name">Zawodnik</th><th>Wiek</th><th class="name">Umiej.</th><th>Poziom</th><th class="name">Pokrycie</th><th>Efektywność</th><th>~tyg./poziom</th></tr>';
  const rows = state.squad.players
    .map((p) => ({
      p,
      eff: trainingEfficiency(p, cfg, { coverage: cov[p.id] ?? 'none', inSquad: inXI.has(p.id) }),
      cov: cov[p.id] ?? 'none',
      w: weeksToNextLevel(p, { ...cfg, coverage: 'full' }),
    }))
    .sort((a, b) => b.eff - a.eff)
    .slice(0, 18);
  rank.querySelector('tbody').innerHTML = rows
    .map(
      (r) => `<tr>
        <td class="name">${fullName(r.p)}</td>
        <td>${r.p.ageYears}</td>
        <td class="name">${skLabel}</td>
        <td class="rating">${skillName ? r.p[skillName] : '—'}</td>
        <td class="name">${r.cov}</td>
        <td class="rating">${r.eff}</td>
        <td class="rating">${r.w.weeks == null ? '—' : r.w.weeks}</td>
      </tr>`,
    )
    .join('');
}

// ------------------------- EKONOMIA -------------------------

const ecoCard = (label, val) => `<div class="eco-card"><div class="ecl">${label}</div><div class="ecv">${val}</div></div>`;
const pl = (n) => (n || 0).toLocaleString('pl-PL');

function renderEconomy() {
  const ps = state.squad.players;
  if (!ps.length) return;
  const totalWage = ps.reduce((s, p) => s + (p.salary || 0), 0);
  const top11 = [...ps].sort((a, b) => b.tsi - a.tsi).slice(0, 11);
  const wage11 = top11.reduce((s, p) => s + (p.salary || 0), 0);
  const totalTsi = ps.reduce((s, p) => s + (p.tsi || 0), 0);
  const avgWage = totalWage / ps.length;
  $('#ecoCards').innerHTML =
    ecoCard('Pensje / tydzień', pl(totalWage)) +
    ecoCard('Pensje najlepszej 11', pl(wage11)) +
    ecoCard('TSI łączne', pl(totalTsi)) +
    ecoCard('TSI / pensja', (totalTsi / Math.max(1, totalWage)).toFixed(2));

  const t = $('#ecoTable');
  t.querySelector('thead').innerHTML =
    '<tr><th class="name">Zawodnik</th><th>Wiek</th><th>TSI</th><th>Pensja</th><th>TSI/pensja</th><th>BezMeczu</th></tr>';
  t.querySelector('tbody').innerHTML = [...ps]
    .sort((a, b) => b.salary - a.salary)
    .map(
      (p) => `<tr>
        <td class="name">${fullName(p)}</td><td>${p.ageYears}</td><td>${pl(p.tsi)}</td>
        <td>${pl(p.salary)}</td>
        <td class="rating">${((p.tsi || 0) / Math.max(1, p.salary || 1)).toFixed(2)}</td>
        <td>${p.weeksSinceLastMatch ?? '—'}</td></tr>`,
    )
    .join('');

  const dead = ps
    .filter((p) => (p.salary || 0) > avgWage && (p.weeksSinceLastMatch ?? 0) >= 3 && (p.ageYears || 0) >= 28)
    .sort((a, b) => b.salary - a.salary);
  const d = $('#ecoDead');
  d.querySelector('thead').innerHTML =
    '<tr><th class="name">Zawodnik</th><th>Wiek</th><th>Pensja</th><th>BezMeczu</th></tr>';
  d.querySelector('tbody').innerHTML = dead.length
    ? dead
        .map((p) => `<tr><td class="name">${fullName(p)}</td><td>${p.ageYears}</td><td>${pl(p.salary)}</td><td>${p.weeksSinceLastMatch}</td></tr>`)
        .join('')
    : '<tr><td class="name" colspan="4">Brak oczywistych kandydatów.</td></tr>';

  renderAgePyramid();
}

// ------------------------- HISTORIA -------------------------

function sparkline(vals) {
  if (vals.length < 2) return '';
  const w = 80, h = 18;
  const min = Math.min(...vals), max = Math.max(...vals), rng = max - min || 1;
  const pts = vals
    .map((v, i) => `${((i / (vals.length - 1)) * w).toFixed(1)},${(h - ((v - min) / rng) * h).toFixed(1)}`)
    .join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.5"/></svg>`;
}

function renderHistory() {
  const ourName = state.squad.teamName;
  const ms = (state.matches || []).filter((m) => m.status === 'FINISHED' && m.homeGoals != null);
  let w = 0, d = 0, l = 0, gf = 0, ga = 0;
  const rows = ms
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .map((m) => {
      const home = m.homeTeamName === ourName;
      const us = home ? m.homeGoals : m.awayGoals;
      const them = home ? m.awayGoals : m.homeGoals;
      const r = us > them ? 'W' : us < them ? 'P' : 'R';
      if (r === 'W') w++;
      else if (r === 'P') l++;
      else d++;
      gf += us;
      ga += them;
      return { date: m.date, opp: home ? m.awayTeamName : m.homeTeamName, ha: home ? 'dom' : 'wyj', score: `${us}:${them}`, r };
    });

  $('#histCards').innerHTML =
    ecoCard(`Bilans (ost. ${ms.length})`, `${w}-${d}-${l}`) +
    ecoCard('Bramki', `${gf}:${ga}`) +
    ecoCard('Śr. zdobyte', ms.length ? (gf / ms.length).toFixed(2) : '—') +
    ecoCard('Śr. stracone', ms.length ? (ga / ms.length).toFixed(2) : '—');

  const f = $('#histForm');
  f.querySelector('thead').innerHTML =
    '<tr><th class="name">Data</th><th class="name">Przeciwnik</th><th class="name">Miejsce</th><th>Wynik</th><th>Rez.</th></tr>';
  f.querySelector('tbody').innerHTML = rows.length
    ? rows
        .map(
          (x) =>
            `<tr><td class="name">${(x.date || '').slice(0, 10)}</td><td class="name">${x.opp}</td><td class="name">${x.ha}</td><td>${x.score}</td><td class="name ${x.r === 'W' ? 'full' : x.r === 'P' ? 'none' : 'partial'}">${x.r}</td></tr>`,
        )
        .join('')
    : '<tr><td class="name" colspan="5">Brak rozegranych meczów w danych.</td></tr>';

  refreshRatings(state.squad.players);
  const withR = state.squad.players
    .map((p) => ({
      p,
      r: (p.recentRatings || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date)).map((x) => x.stars),
    }))
    .filter((x) => x.r.length);
  const tr = $('#histTrends');
  tr.querySelector('thead').innerHTML =
    '<tr><th class="name">Zawodnik</th><th class="name">Oceny</th><th>Trend</th><th>Δ</th><th>Śr.</th></tr>';
  tr.querySelector('tbody').innerHTML = withR.length
    ? withR
        .sort((a, b) => (avgOfRecent(b.p) ?? 0) - (avgOfRecent(a.p) ?? 0))
        .map(({ p, r }) => {
          const delta = r.length > 1 ? r[r.length - 1] - r[0] : 0;
          return `<tr><td class="name">${fullName(p)}</td><td class="name">${r.map((v) => v.toFixed(1)).join(' · ')}</td><td>${sparkline(r)}</td><td class="rating ${delta > 0 ? 'full' : delta < 0 ? 'none' : ''}">${delta > 0 ? '+' : ''}${delta.toFixed(1)}</td><td class="rating">${(avgOfRecent(p) ?? 0).toFixed(2)}</td></tr>`;
        })
        .join('')
    : '<tr><td class="name" colspan="5">Brak ocen z meczów.</td></tr>';

  const best = withR.map(({ p }) => ({ p, a: avgOfRecent(p) ?? 0 })).sort((a, b) => b.a - a.a)[0];
  if (best && best.a > 0) $('#histCards').innerHTML += ecoCard('Zawodnik okresu', `${fullName(best.p)} (${best.a.toFixed(2)})`);
}

// ------------------------- sektory + kontra -------------------------

function renderSectors(lineup) {
  const box = $('#sectors');
  if (!lineup) {
    box.innerHTML = '';
    $('#spCaptain').innerHTML = '';
    $('#sectorContrib').innerHTML = '';
    $('#fatigue').innerHTML = '';
    return;
  }
  const raw = sectorRatings(lineup.result.slots);
  const f = teamFactors();
  const s = { def: raw.def, mid: raw.mid * f.mid, att: raw.att * f.att };
  state.lastSectors = s;
  const mx = Math.max(s.def, s.mid, s.att, 1);
  const bar = (v) => `<div class="sbar"><i style="width:${Math.min(100, (v / mx) * 100).toFixed(0)}%"></i></div>`;
  const adj = f.mid !== 1 || f.att !== 1 ? ' (z nastrojem/pewnością)' : '';
  box.innerHTML =
    `<div class="srow"><span>Obrona</span>${bar(s.def)}<b>${s.def.toFixed(1)}</b></div>` +
    `<div class="srow"><span>Pomoc</span>${bar(s.mid)}<b>${s.mid.toFixed(1)}</b></div>` +
    `<div class="srow"><span>Atak</span>${bar(s.att)}<b>${s.att.toFixed(1)}</b></div>` +
    `<p class="hint small">Wartości względne${adj} — nie oficjalne oceny HT.</p>`;
  renderCounter(s);
  renderSpCaptain();
  renderSectorContrib(lineup);
  renderFatigue(lineup);
  renderWeatherImpact();
  renderMarkAdvice();
}

function renderCounter(myS) {
  const box = $('#counterAdvice');
  const d = Number($('#oppDef').value), m = Number($('#oppMid').value), a = Number($('#oppAtt').value);
  if (!d && !m && !a) {
    box.innerHTML = '';
    return;
  }
  const opp = [['obronę', d], ['pomoc', m], ['atak', a]].filter((x) => x[1] > 0);
  const weakest = opp.slice().sort((x, y) => x[1] - y[1])[0];
  const tips = [];
  if (weakest) tips.push(`Kieruj grę w ich <b>${weakest[0]}</b> — najsłabszy sektor rywala.`);
  if (a > 0 && a >= m && a >= d) tips.push('Ich atak jest najmocniejszy — rozważ nastawienie defensywne / PIC i wzmocnienie obrony.');
  if (m > 0 && m <= Math.min(d || 99, a || 99)) tips.push('Ich środek pola jest słaby — normalne lub ofensywne nastawienie, walcz o posiadanie.');
  if (myS) {
    if (a > 0 && myS.def * 1.4 < a) tips.push('Twoja obrona wygląda słabiej niż ich atak — dołóż obrońcę lub graj zachowawczo.');
    if (d > 0 && myS.att > d * 1.4) tips.push('Twój atak przewyższa ich obronę — możesz podkręcić ofensywę.');
  }
  box.innerHTML = '<strong>Kontra:</strong><ul>' + tips.map((t) => `<li>${t}</li>`).join('') + '</ul>';
}

function currentOpts() {
  const idleOn = $('#idleOn').checked;
  const tType = $('#trainingType').value;
  const od = Number($('#oppDef').value), om = Number($('#oppMid').value), oa = Number($('#oppAtt').value);
  return {
    mode: $('#optMode').value,
    useLoyalty: $('#useLoyalty').checked,
    allowInjured: $('#allowInjured').checked,
    allowSuspended: $('#allowSuspended').checked,
    extraTime: $('#extraTime').checked,
    maxWeeksIdle: idleOn ? Number($('#idleWeeks').value) : null,
    training: tType ? { type: tType, weight: Number($('#trainingWeight').value) } : null,
    opponent: od || om || oa ? { def: od, mid: om, att: oa } : null,
  };
}

function optimize() {
  const opts = currentOpts();
  refreshRatings(state.squad.players);
  const pool = eligiblePlayers(state.squad.players, opts);
  const choice = $('#formation').value;

  let name, slots, result;
  if (choice !== 'auto') {
    name = choice;
    slots = FORMATIONS[choice];
    result = bestLineup(pool, slots, opts, state.locks);
  } else {
    const bf = bestFormation(pool, opts, state.locks);
    if (bf) ({ name, slots, result } = bf);
  }

  if (!result) {
    $('#pitch').innerHTML =
      '<p class="hint">Za mało zawodników spełnia kryteria' +
      (opts.mode === 'rating' ? ' (tryb „wg ocen" wymaga ocen — dodaj je w Kadrze / Mapie ocen).' : ' (sprawdź filtry).') +
      '</p>';
    $('#pitchTotal').textContent = '';
    $('#trainingReport').innerHTML = '';
    $('#sectors').innerHTML = '';
    return;
  }
  state.lineupA = { name, slots, result };
  state.showing = 'A';
  const ctx = seniorCtx(opts);
  renderPitch('#pitch', '#pitchTitle', '#pitchTotal', state.lineupA, opts, { label: 'Skład A', dnd: true, senior: true, ctx });
  renderSectors(state.lineupA);
  renderTraining();
  renderCloseCalls(pool, result, opts);
  renderDepth();
  renderReportCard();
}

function seniorCtx(opts) {
  return {
    players: state.squad.players,
    opts: opts || currentOpts(),
    locks: state.locks,
    rerun: optimize,
    lineup: () => (state.showing === 'B' ? state.lineupB : state.lineupA),
    withHistory: true,
  };
}

function squadB() {
  if (!state.lineupA) return optimize();
  const opts = currentOpts();
  const used = new Set(state.lineupA.result.slots.map((s) => s.player?.id).filter(Boolean));
  const pool = eligiblePlayers(state.squad.players, opts).filter((p) => !used.has(p.id));
  const result = bestLineup(pool, state.lineupA.slots, opts, {});
  if (!result) return alert('Za mało zawodników na Skład B.');
  state.lineupB = { name: state.lineupA.name, slots: state.lineupA.slots, result };
  state.showing = 'B';
  renderPitch('#pitch', '#pitchTitle', '#pitchTotal', state.lineupB, opts, { label: 'Skład B', dnd: false, senior: true });
  renderSectors(state.lineupB);
}

// grupowanie slotów w linie boiska (tył -> przód)
const RANK = { GK: 0, CD: 1, WB: 1, WI: 2, IM: 2, FW: 3 };

function renderPitch(pitchSel, titleSel, totalSel, lineup, opts, cfg) {
  const { result } = lineup;
  $(titleSel).textContent = `${cfg.label} — ${lineup.name}`;
  $(totalSel).textContent = 'Σ ' + fmt(result.total);
  const ctx = cfg.ctx;

  if (cfg.senior) {
    $('#lockHint').textContent = Object.keys(state.locks).length
      ? `Zablokowane sloty: ${Object.keys(state.locks).length}.`
      : 'Klik = ranking i blokada. Przeciągnij = zamiana dwóch slotów.';
  }

  const pitch = $(pitchSel);
  pitch.innerHTML = '';
  for (const rank of [3, 2, 1, 0]) {
    const line = result.slots.filter((s) => RANK[s.slot] === rank);
    if (!line.length) continue;
    const div = document.createElement('div');
    div.className = 'line';
    for (const s of line) {
      const locked = ctx && ctx.locks[s.index] != null;
      const trained = s.player?.trained && opts.training?.type;
      const isStar = cfg.youth && s.player && s.player.id === state.youthStarId;
      const el = document.createElement('div');
      el.className =
        'slot' +
        (s.player ? '' : ' empty') +
        (locked ? ' locked' : '') +
        (trained ? ' trained' : '') +
        (isStar ? ' star' : '');
      el.innerHTML =
        `<div class="pos">${POSITION_LABEL[s.slot]}${isStar ? ' ★' : ''}</div>` +
        `<div class="pname">${s.player ? fullName(s.player) : '—'}</div>` +
        `<div class="pscore">${s.player ? fmt(s.score) : ''}</div>`;

      if (ctx) {
        el.addEventListener('click', (ev) => {
          if (s.player && ev.target.closest('.pscore')) openExplain(s.player, s.slot, opts);
          else openPicker(s.index, s.slot, ctx);
        });
        if (cfg.dnd && s.player) enableDrag(el, s.index, s.slot, ctx);
      }
      div.append(el);
    }
    pitch.append(div);
  }

  if (cfg.senior) renderTrainingReport(result, opts);
}

function renderTrainingReport(result, opts) {
  const box = $('#trainingReport');
  if (!opts.training?.type) return (box.innerHTML = '');
  const trained = result.slots.filter((s) => s.player?.trained);
  if (!trained.length) return (box.innerHTML = 'Brak trenowanych zawodników w składzie.');
  box.innerHTML =
    `<strong>Efekt treningu „${opts.training.type}":</strong>` +
    '<table><thead><tr><th class="name">Zawodnik</th><th class="name">Pozycja</th><th class="name">Efekt</th></tr></thead><tbody>' +
    trained
      .map((s) => {
        const eff = trainingEffect(s.player, s.slot, opts.training.type);
        const cls = eff === 'pełny' ? 'full' : eff === 'częściowy' ? 'partial' : 'none';
        return `<tr><td class="name">${fullName(s.player)}</td><td class="name">${POSITION_LABEL[s.slot]}</td><td class="name ${cls}">${eff}</td></tr>`;
      })
      .join('') +
    '</tbody></table>';
}

// ------------------------- drag & drop (zamiana dwóch slotów) -------------------------

let dragFrom = null; // { index, playerId }

function enableDrag(el, slotIndex, slotType, ctx) {
  const player = ctx.lineup().result.slots[slotIndex].player;
  el.setAttribute('draggable', 'true');
  el.addEventListener('dragstart', () => {
    dragFrom = { index: slotIndex, playerId: player.id };
  });
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    el.classList.add('dragover');
  });
  el.addEventListener('dragleave', () => el.classList.remove('dragover'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('dragover');
    if (!dragFrom || dragFrom.index === slotIndex) return;
    if (ctx.withHistory) pushLockHistory();
    const target = ctx.lineup().result.slots[slotIndex].player;
    ctx.locks[slotIndex] = dragFrom.playerId;
    if (target) ctx.locks[dragFrom.index] = target.id;
    else delete ctx.locks[dragFrom.index];
    dragFrom = null;
    ctx.rerun();
  });
}

// ------------------------- picker (blokada zawodnika na slot) -------------------------

function openPicker(slotIndex, slotType, ctx) {
  const { opts, players, locks, rerun } = ctx;
  const otherLocked = new Set(
    Object.entries(locks).filter(([i]) => Number(i) !== slotIndex).map(([, pid]) => pid),
  );
  const ranked = eligiblePlayers(players, opts)
    .filter((p) => !otherLocked.has(p.id))
    .map((p) => ({ p, s: ratePlayerForSlot(p, slotType, opts) }))
    .filter((x) => Number.isFinite(x.s))
    .sort((a, b) => b.s - a.s);

  $('#pickerTitle').textContent = `${POSITION_LABEL[slotType]} — wybierz zawodnika`;
  const ul = $('#pickerList');
  ul.innerHTML = '';
  const clr = document.createElement('li');
  clr.className = 'clear';
  clr.textContent = '↺ Bez blokady (algorytm decyduje)';
  clr.addEventListener('click', () => {
    if (ctx.withHistory) pushLockHistory();
    delete locks[slotIndex];
    $('#picker').classList.add('hidden');
    rerun();
  });
  ul.append(clr);
  for (const { p, s } of ranked) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${fullName(p)}${p.trained ? ' • tren.' : ''}</span><span class="s">${fmt(s)}</span>`;
    li.addEventListener('click', () => {
      if (ctx.withHistory) pushLockHistory();
      locks[slotIndex] = p.id;
      $('#picker').classList.add('hidden');
      rerun();
    });
    ul.append(li);
  }
  $('#picker').classList.remove('hidden');
}

// ------------------------- MŁODZIEŻ -------------------------

function renderYouthControls() {
  $('#youthSource').textContent = state.youth.sourceFile
    ? `Źródło: file=${state.youth.sourceFile} · ${state.youth.players.length} zawodników`
    : `Przykładowa młodzieżówka · ${state.youth.players.length} zawodników`;
  const sel = $('#youthStar');
  sel.innerHTML = '';
  for (const p of [...state.youth.players].sort((a, b) => youthPotential(b) - youthPotential(a))) {
    const o = new Option(`${fullName(p)} (pot. ${youthPotential(p)})`, p.id);
    if (p.id === state.youthStarId) o.selected = true;
    sel.append(o);
  }
}

const YOUTH_MODE_LABEL = {
  potential: 'Wg potencjału',
  current: 'Wg bieżących',
  rating: 'Wg ocen',
  star: 'Wokół gwiazdy',
};

function youthOpts() {
  const m = $('#youthMode').value;
  return {
    youth: true,
    usePotential: m === 'potential' || m === 'star',
    mode: m === 'rating' ? 'rating' : 'skill',
    allowInjured: false,
  };
}

function youthPool() {
  let pool = state.youth.players;
  if ($('#youthRevealedOnly').checked) {
    pool = pool.filter((p) =>
      ['keeper', 'defending', 'playmaking', 'winger', 'passing', 'scoring'].some((k) => (p[k] ?? -1) >= 0),
    );
  }
  return pool;
}

// „Wokół gwiazdy": znajdź w formacji slot, który trenuje główną umiejętność
// gwiazdy, i wymuś ją tam (tymczasowo, nie zapisując do youthLocks).
function starLockForSlots(slots) {
  const m = $('#youthMode').value;
  if (m !== 'star' || state.youthStarId == null) return {};
  const star = state.youth.players.find((p) => p.id === state.youthStarId);
  if (!star) return {};
  const primary = topSkills(star, 1, { usePotential: true })[0];
  const pos = positionsTrainingSkill(primary);
  const idx = slots.findIndex((s) => pos.full.includes(s));
  return idx >= 0 ? { [idx]: state.youthStarId } : {};
}

function youthOptimize() {
  const opts = youthOpts();
  if (opts.mode === 'rating') refreshRatings(state.youth.players);
  const pool = youthPool();
  const choice = $('#youthFormation').value;
  let name, slots, result;
  if (choice !== 'auto') {
    name = choice;
    slots = FORMATIONS[choice];
    result = bestLineup(pool, slots, opts, { ...state.youthLocks, ...starLockForSlots(slots) });
  } else {
    // dla trybu „wokół gwiazdy" liczymy każdą formację z jej własną blokadą gwiazdy
    let best = null;
    for (const [fn, fs] of Object.entries(FORMATIONS)) {
      const r = bestLineup(pool, fs, opts, { ...state.youthLocks, ...starLockForSlots(fs) });
      if (r && (!best || r.total > best.result.total)) best = { name: fn, slots: fs, result: r };
    }
    if (best) ({ name, slots, result } = best);
  }
  if (!result) {
    $('#youthPitch').innerHTML = '<p class="hint">Za mało zawodników (sprawdź filtr „tylko ujawnione").</p>';
    $('#youthPitchTotal').textContent = '';
    $('#youthTrainSlots').innerHTML = '';
    return;
  }
  state.lineupY = { name, slots, result };
  const ctx = {
    players: state.youth.players,
    opts,
    locks: state.youthLocks,
    rerun: youthOptimize,
    lineup: () => state.lineupY,
    withHistory: false,
  };
  renderPitch('#youthPitch', '#youthPitchTitle', '#youthPitchTotal', state.lineupY, opts, {
    label: YOUTH_MODE_LABEL[$('#youthMode').value] || 'Skład',
    youth: true,
    dnd: true,
    ctx,
  });
  renderYouthTrainSlots(result);
}

// Które pozycje w wygenerowanym składzie dostają trening (dla wybranej gwiazdy
// i jej 2 najlepszych umiejętności) — przybliżenie „reżimu treningowego".
function renderYouthTrainSlots(result) {
  const box = $('#youthTrainSlots');
  if (!box) return;
  const star = state.youth.players.find((p) => p.id === state.youthStarId);
  if (!star) return (box.innerHTML = '');
  const [prim, sec] = topSkills(star, 2, { usePotential: true });
  const covered = (skill) =>
    result.slots.filter((s) => s.player && positionsTrainingSkill(skill).full.includes(s.slot)).map((s) => fullName(s.player));
  box.innerHTML =
    `<p class="hint small">Gwiazda: <strong>${fullName(star)}</strong>. Trening pod jej umiejętności:</p>` +
    `<p class="hint small">• <strong>${YOUTH_SKILL_LABEL[prim] ?? prim}</strong> (podstawowa) trenuje: ${covered(prim).join(', ') || '— nikt na trenującej pozycji'}</p>` +
    (sec
      ? `<p class="hint small">• <strong>${YOUTH_SKILL_LABEL[sec] ?? sec}</strong> (dodatkowa) trenuje: ${covered(sec).join(', ') || '— nikt'}</p>`
      : '');
}

const YOUTH_SKILLS = ['keeper', 'defending', 'playmaking', 'winger', 'passing', 'scoring', 'setPieces'];
const YOUTH_SKILL_LABEL = { keeper: 'Bram', defending: 'Obr', playmaking: 'Rozgr', winger: 'Skrz', passing: 'Pod', scoring: 'Wyk', setPieces: 'StF' };

function renderYouthSkillMap() {
  const thead = $('#youthSkillMap thead');
  const tbody = $('#youthSkillMap tbody');
  thead.innerHTML =
    '<tr><th class="name">Zawodnik</th><th class="name">Specjalność</th><th>Pot.</th>' +
    YOUTH_SKILLS.map((k) => `<th>${YOUTH_SKILL_LABEL[k]}</th>`).join('') +
    '<th class="name">Awans za</th></tr>';
  tbody.innerHTML = '';
  const rows = [...state.youth.players].sort((a, b) => youthPotential(b) - youthPotential(a));
  for (const p of rows) {
    const tr = document.createElement('tr');
    if (p.id === state.youthStarId) tr.className = 'star-row';
    tr.innerHTML =
      `<td class="name">${fullName(p)}</td>` +
      `<td class="name">${specialtyName(p.specialty)}</td>` +
      `<td class="rating">${youthPotential(p)}</td>` +
      YOUTH_SKILLS.map((k) => {
        const cur = p[k];
        const mx = p[k + 'Max'];
        const known = cur != null && cur >= 0;
        const maxKnown = mx != null && mx >= 0;
        const reached = known && maxKnown && cur === mx;
        const bg = skillColor(maxKnown ? mx : known ? cur : 0);
        const txt = `${known ? cur : '—'}/${maxKnown ? mx : '—'}${reached ? ' ★' : ''}`;
        return `<td class="skill" style="background:${bg}">${txt}</td>`;
      }).join('') +
      `<td class="name">${p.canBePromotedInDays != null ? p.canBePromotedInDays + ' dni' : '—'}</td>`;
    tbody.append(tr);
  }
}

// ------------------------- MŁODZIEŻ: planer awansu -------------------------

// Bardzo zgrubny szacunek wartości seniora z potencjału (suma maks. umiejętności).
function youthValueEstimate(pot) {
  return Math.round(Math.pow(pot / 70, 3) * 200000 / 1000) * 1000;
}
const YMAX_KEYS = ['keeper', 'defending', 'playmaking', 'winger', 'passing', 'scoring', 'setPieces'];
// Rekomendacja na bazie najwyższej ZNANEJ maks. umiejętności (suma potencjału
// zaniża wartość, gdy skaut ujawnił dopiero 2–3 skille) + statusu gwiazdy.
function promotionAdvice(p, isStar) {
  const maxes = YMAX_KEYS.map((k) => p[k + 'Max']).filter((v) => v != null && v >= 0);
  const peak = maxes.length ? Math.max(...maxes) : 0;
  const promoDays = p.canBePromotedInDays;
  if (isStar || peak >= 14) return { txt: 'Awansuj / trzymaj — kluczowy zawodnik', cls: 'full' };
  if (peak >= 10) return { txt: 'Trzymaj — solidny potencjał', cls: 'partial' };
  if (peak === 0) return { txt: 'Za mało danych — poczekaj na skauta', cls: '' };
  if (promoDays != null && promoDays <= 21) return { txt: 'Decyzja wkrótce — raczej zwolnij', cls: 'none' };
  return { txt: 'Obserwuj / kandydat do zwolnienia', cls: '' };
}
function renderYouthPlanner() {
  const t = $('#youthPlanner');
  if (!t) return;
  t.querySelector('thead').innerHTML =
    '<tr><th class="name">Zawodnik</th><th>Wiek</th><th>Potencjał</th><th>Szac. wartość</th><th class="name">Awans za</th><th class="name">Skaut</th><th class="name">Rekomendacja</th></tr>';
  const rows = [...state.youth.players].sort((a, b) => youthPotential(b) - youthPotential(a));
  t.querySelector('tbody').innerHTML = rows
    .map((p) => {
      const pot = youthPotential(p);
      const adv = promotionAdvice(p, p.id === state.youthStarId);
      return `<tr${p.id === state.youthStarId ? ' class="star-row"' : ''}>
        <td class="name">${fullName(p)}</td>
        <td>${p.ageYears}</td>
        <td class="rating">${pot}</td>
        <td class="val">${youthValueEstimate(pot).toLocaleString('pl-PL')}</td>
        <td class="name">${p.canBePromotedInDays != null ? p.canBePromotedInDays + ' dni' : '—'}</td>
        <td class="name">${p.scoutComment ? p.scoutComment : '—'}</td>
        <td class="name ${adv.cls}">${adv.txt}</td>
      </tr>`;
    })
    .join('');
}

// ------------------------- podgląd rywali (Mecze) -------------------------

async function renderOpponentPreviews() {
  const box = $('#matchOpp');
  if (!box) return;
  const myName = state.squad.teamName;
  const upcoming = (state.matches || []).filter((m) => m.status === 'UPCOMING' || m.status === 'ONGOING');
  const cards = [];
  state.opponents = state.opponents || {};
  for (const m of upcoming) {
    const home = m.homeTeamName === myName;
    const oppId = home ? m.awayTeamId : m.homeTeamId;
    const oppName = home ? m.awayTeamName : m.homeTeamName;
    if (!oppId) continue;
    const data = await fetchJson(`data/opponent-${oppId}.json`);
    if (!data) continue;
    state.opponents[oppId] = data;
    const t = data.team || {};
    const form = (data.recent || [])
      .slice(0, 5)
      .map((r) => {
        const rh = r.homeTeamName === oppName;
        const us = rh ? r.homeGoals : r.awayGoals;
        const th = rh ? r.awayGoals : r.homeGoals;
        return us > th ? 'W' : us < th ? 'P' : 'R';
      })
      .join(' ');
    cards.push(
      `<div class="eco-card"><div class="ecl">${oppName}</div>` +
        `<div class="ecv">PR ${t.powerRating || '—'}</div>` +
        `<div class="hint small">${t.leagueUnitName || ''} · miejsce ${t.rank || '—'}<br>` +
        `ranking ligowy ${t.leagueRanking || '—'}<br>forma: ${form || '—'}</div></div>`,
    );
  }
  box.innerHTML = cards.length
    ? cards.join('')
    : '<p class="hint">Brak plików rywali. Wygeneruj: <code>node cli.js opponent &lt;teamId&gt;</code>.</p>';
  renderRotation();
}

// ------------------------- ZMIANY -------------------------

function renderChanges() {
  const box = $('#changesBox');
  const c = state.changes;
  if (!c || !c.enough) {
    box.innerHTML =
      '<p class="hint">Brak danych. Zrób dwie migawki w odstępie czasu: <code>node cli.js snapshot</code>, potem <code>node cli.js changes</code>.</p>';
    return;
  }
  const list = (title, arr2, sign) =>
    `<h3 class="section-h">${title} (${arr2.length})</h3>` +
    (arr2.length
      ? '<ul class="chg">' +
        arr2.map((p) => `<li>${sign} ${p.name}${p.tsi ? ` <span class="hint">TSI ${p.tsi.toLocaleString('pl-PL')}</span>` : ''}</li>`).join('') +
        '</ul>'
      : '<p class="hint">—</p>');
  const ups = (c.changed || [])
    .map(
      (x) =>
        `<li>${x.name}: ` +
        x.deltas
          .map((d) => `<span class="${d.diff > 0 ? 'full' : 'none'}">${d.skill} ${d.from}→${d.to}</span>`)
          .join(', ') +
        '</li>',
    )
    .join('');
  box.innerHTML =
    `<p class="hint">Porównanie migawek: ${(c.prevAt || '').slice(0, 16)} → ${(c.currAt || '').slice(0, 16)}</p>` +
    list('Nowi w kadrze', c.added || [], '+') +
    list('Odeszli', c.removed || [], '−') +
    `<h3 class="section-h">Zmiany umiejętności (${(c.changed || []).length})</h3>` +
    (ups ? `<ul class="chg">${ups}</ul>` : '<p class="hint">—</p>');
}

// ------------------------- drużyna: nastrój / pewność / pogoda -------------------------

const SPIRIT_LEVELS = ['bardzo zły', 'zły', 'obojętny', 'zadowalający', 'dobry', 'bardzo dobry', 'wspaniały', 'rajski'];
const CONF_LEVELS = ['żałosna', 'słaba', 'przyzwoita', 'silna', 'bardzo silna', 'rewelacyjna'];
const TKEY = 'gaffer:team';

function loadTeamCfg() {
  try {
    return JSON.parse(localStorage.getItem(TKEY)) || {};
  } catch {
    return {};
  }
}
function saveTeamCfg() {
  try {
    localStorage.setItem(TKEY, JSON.stringify({ spirit: $('#teamSpirit').value, confidence: $('#teamConfidence').value }));
  } catch {
    /* ignore */
  }
}
function applyTeamData(team) {
  // Jeśli CHPP zwrócił nastrój/pewność jako liczbę, zmapuj na etykietę.
  if (team.teamSpirit != null && SPIRIT_LEVELS[team.teamSpirit - 1]) $('#teamSpirit').value = SPIRIT_LEVELS[team.teamSpirit - 1];
  if (team.confidence != null && CONF_LEVELS[team.confidence - 1]) $('#teamConfidence').value = CONF_LEVELS[team.confidence - 1];
}
// Mnożniki do wyświetlanych sektorów: nastrój → pomoc, pewność siebie → atak.
function teamFactors() {
  const s = SPIRIT_LEVELS.indexOf($('#teamSpirit').value);
  const c = CONF_LEVELS.indexOf($('#teamConfidence').value);
  return {
    mid: s < 0 ? 1 : 0.9 + (s / (SPIRIT_LEVELS.length - 1)) * 0.2, // 0.9..1.1
    att: c < 0 ? 1 : 0.9 + (c / (CONF_LEVELS.length - 1)) * 0.2,
  };
}

const WEATHER_SPEC = {
  rain: { good: ['Regenerujący'], bad: ['Techniczny', 'Szybki'] },
  sun: { good: ['Techniczny'], bad: ['Mocarny'] },
  cloud: { good: [], bad: [] },
};
function renderWeatherImpact() {
  const w = $('#weather').value;
  const box = $('#weatherImpact');
  if (!w || !WEATHER_SPEC[w] || (!WEATHER_SPEC[w].good.length && !WEATHER_SPEC[w].bad.length)) {
    box.textContent = w ? 'Ta pogoda nie wpływa istotnie na specjalności.' : '';
    return;
  }
  const xi = (state.lineupA?.result.slots || []).map((s) => s.player).filter(Boolean);
  const hit = (names) => xi.filter((p) => names.includes(specialtyName(p.specialty))).map(fullName);
  const good = hit(WEATHER_SPEC[w].good);
  const bad = hit(WEATHER_SPEC[w].bad);
  box.innerHTML =
    (good.length ? `<span class="full">↑ ${good.join(', ')}</span><br>` : '') +
    (bad.length ? `<span class="none">↓ ${bad.join(', ')}</span>` : '') +
    (!good.length && !bad.length ? 'Brak w składzie zawodników, na których wpływa ta pogoda.' : '');
}

// ------------------------- SF / kapitan / wkład / zmęczenie -------------------------

function renderSpCaptain() {
  const sp = recommendSetPieceTaker(state.squad.players).slice(0, 3).map((x) => `${fullName(x.player)} (${x.player.setPieces})`);
  const cap = recommendCaptain(state.squad.players).slice(0, 3).map((x) => `${fullName(x.player)} (${x.player.leadership})`);
  $('#spCaptain').innerHTML = `<strong>Stałe fragmenty:</strong> ${sp.join(' · ') || '—'} &nbsp;|&nbsp; <strong>Kapitan:</strong> ${cap.join(' · ') || '—'}`;
}

function renderSectorContrib(lineup) {
  const box = $('#sectorContrib');
  if (!lineup) return (box.innerHTML = '');
  const rows = lineup.result.slots
    .filter((s) => s.player)
    .map((s) => {
      const c = playerSectorContribution(s.player, s.slot);
      return `<tr><td class="name">${fullName(s.player)}</td><td class="name">${POSITION_LABEL[s.slot]}</td><td class="rating">${c.def.toFixed(1)}</td><td class="rating">${c.mid.toFixed(1)}</td><td class="rating">${c.att.toFixed(1)}</td></tr>`;
    })
    .join('');
  box.innerHTML = `<table><thead><tr><th class="name">Zawodnik</th><th class="name">Poz.</th><th>Obr</th><th>Pom</th><th>Atk</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderFatigue(lineup) {
  const box = $('#fatigue');
  if (!lineup) return (box.innerHTML = '');
  const opts = currentOpts();
  const xiIds = new Set(lineup.result.slots.map((s) => s.player?.id).filter(Boolean));
  const bench = eligiblePlayers(state.squad.players, opts).filter((p) => !xiIds.has(p.id));
  const subs = suggestSubs(lineup.result.slots, bench, opts);
  const xiRows = lineup.result.slots
    .filter((s) => s.player)
    .sort((a, b) => staminaFadeMinute(a.player) - staminaFadeMinute(b.player))
    .slice(0, 6)
    .map((s) => `<tr><td class="name">${fullName(s.player)}</td><td>${s.player.stamina}</td><td class="rating">~${staminaFadeMinute(s.player)}'</td></tr>`)
    .join('');
  const subRows = subs
    .map(
      (x) =>
        `<tr><td class="name">${POSITION_LABEL[x.slot]}</td><td class="name">${fullName(x.out)} (~${x.outFade}')</td><td class="name">${x.in ? `→ ${fullName(x.in)}` : '— brak zejścia'}</td></tr>`,
    )
    .join('');
  box.innerHTML =
    '<p class="hint small">Najszybciej gasnący w XI (przybliżona minuta spadku formy):</p>' +
    `<table><thead><tr><th class="name">Zawodnik</th><th>Kon</th><th>Gaśnie</th></tr></thead><tbody>${xiRows}</tbody></table>` +
    '<p class="hint small">Sugerowane 3 zmiany:</p>' +
    `<table><thead><tr><th class="name">Poz.</th><th class="name">Schodzi</th><th class="name">Wchodzi</th></tr></thead><tbody>${subRows}</tbody></table>`;
}

// ------------------------- piramida wieku -------------------------

function renderAgePyramid() {
  const box = $('#agePyramid');
  if (!box) return;
  const buckets = {};
  for (const p of state.squad.players) {
    const a = Math.floor(p.ageYears || 0);
    buckets[a] = (buckets[a] || 0) + 1;
  }
  const ages = Object.keys(buckets).map(Number).sort((a, b) => a - b);
  if (!ages.length) return (box.innerHTML = '');
  const max = Math.max(...Object.values(buckets));
  box.innerHTML = ages
    .map((a) => {
      const n = buckets[a];
      const flag = a >= 30 ? ' style="color:#d65a5a"' : a <= 20 ? ' style="color:var(--accent)"' : '';
      return `<div class="agerow"><span${flag}>${a} lat</span><div class="sbar"><i style="width:${(n / max) * 100}%"></i></div><b>${n}</b></div>`;
    })
    .join('');
}

// ------------------------- cofnij (blokady) -------------------------

function pushLockHistory() {
  state.lockHistory = state.lockHistory || [];
  state.lockHistory.push(JSON.stringify(state.locks));
  if (state.lockHistory.length > 30) state.lockHistory.shift();
}
function undoLock() {
  if (!state.lockHistory?.length) return;
  state.locks = JSON.parse(state.lockHistory.pop());
  optimize();
}

// ------------------------- eksport raportu (Markdown) -------------------------

function buildReport() {
  const lu = state.lineupA;
  const lines = [`# Raport — ${state.squad.teamName}`, '', `_${new Date().toLocaleString('pl-PL')}_`, ''];
  if (lu) {
    const s = sectorRatings(lu.result.slots);
    lines.push(`## Skład (${lu.name}, Σ ${fmt(lu.result.total)})`, '');
    for (const sl of lu.result.slots) lines.push(`- **${POSITION_LABEL[sl.slot]}**: ${sl.player ? fullName(sl.player) : '—'} ${sl.player ? `(${fmt(sl.score)})` : ''}`);
    lines.push('', `Sektory (względne): Obrona ${s.def.toFixed(1)} · Pomoc ${s.mid.toFixed(1)} · Atak ${s.att.toFixed(1)}`, '');
  }
  const ps = state.squad.players;
  const wage = ps.reduce((a, p) => a + (p.salary || 0), 0);
  const tsi = ps.reduce((a, p) => a + (p.tsi || 0), 0);
  lines.push('## Ekonomia', '', `- Pensje/tydzień: ${wage.toLocaleString('pl-PL')}`, `- TSI łączne: ${tsi.toLocaleString('pl-PL')}`, `- TSI/pensja: ${(tsi / Math.max(1, wage)).toFixed(2)}`, '');
  const sp = recommendSetPieceTaker(ps).slice(0, 3).map((x) => fullName(x.player));
  const cap = recommendCaptain(ps).slice(0, 3).map((x) => fullName(x.player));
  lines.push('## Rekomendacje', '', `- Stałe fragmenty: ${sp.join(', ')}`, `- Kapitan: ${cap.join(', ')}`, '');
  if (state.changes?.enough) {
    lines.push('## Zmiany od ostatniej migawki', '');
    (state.changes.changed || []).forEach((x) =>
      lines.push(`- ${x.name}: ${x.deltas.map((d) => `${d.skill} ${d.from}→${d.to}`).join(', ')}`),
    );
  }
  return lines.join('\n');
}
function exportReport() {
  const md = buildReport();
  // Schowek działa i lokalnie, i w wersji standalone/na telefonie; pobieranie
  // pliku bywa zablokowane w osadzonych podglądach, więc kopiujemy.
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(md).then(
      () => alert('Raport (Markdown) skopiowany do schowka.'),
      () => showLongText(md),
    );
  } else {
    showLongText(md);
  }
}
function showLongText(text) {
  const w = window.open('', '_blank');
  if (w) {
    w.document.write('<pre style="white-space:pre-wrap;font:13px/1.5 system-ui;padding:16px">' + text.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;')) + '</pre>');
    w.document.close();
  } else {
    prompt('Skopiuj raport:', text);
  }
}

// ------------------------- kalibracja wag z ocen -------------------------

function runCalibration() {
  const res = calibrateWeights(state.squad.players);
  const anySamples = Object.values(res.sampleCounts).some((n) => n >= 4);
  if (!anySamples) {
    $('#calibNote').innerHTML =
      'Brak wystarczających danych. Potrzebne oceny z meczów z pozycjami — uruchom <code>node cli.js squad</code>.';
    return;
  }
  setWeights(res.weights);
  persistWeights();
  buildWeightSliders();
  optimize();
  const fit = res.fitted.map((s) => `${POSITION_LABEL[s]} (${res.sampleCounts[s]})`).join(', ') || '—';
  const skip = res.skipped.map((s) => POSITION_LABEL[s]).join(', ');
  $('#calibNote').innerHTML =
    `Dopasowano: <span class="full">${fit}</span>.` +
    (skip ? ` Za mało próbek (zostały domyślne): ${skip}.` : '');
}

// ------------------------- „wyjaśnij ocenę" -------------------------

function openExplain(player, slot, opts = currentOpts()) {
  const e = explainRating(player, slot, opts);
  $('#pickerTitle').textContent = `${fullName(player)} — ${POSITION_LABEL[slot]}`;
  const ul = $('#pickerList');
  ul.innerHTML =
    e.parts
      .map(
        (p) =>
          `<li><span>${SKILL_LABEL[p.skill] ?? p.skill} ${p.value} × ${p.weight.toFixed(2)}</span><span class="s">${p.contribution.toFixed(2)}</span></li>`,
      )
      .join('') +
    `<li class="clear"><span>Suma umiejętności</span><span class="s">${e.base.toFixed(2)}</span></li>` +
    `<li class="clear"><span>× forma (${player.form ?? '—'})</span><span class="s">${e.formMul.toFixed(2)}</span></li>` +
    `<li class="clear"><span>× kondycja (${player.stamina ?? '—'})</span><span class="s">${e.stamMul.toFixed(2)}</span></li>` +
    (e.bonus ? `<li class="clear"><span>+ bonus lojalności</span><span class="s">${e.bonus.toFixed(2)}</span></li>` : '') +
    `<li><span><strong>Ocena slotu</strong></span><span class="s"><strong>${e.total.toFixed(2)}</strong></span></li>`;
  $('#picker').classList.remove('hidden');
}

// ------------------------- bliskie decyzje (pasma pewności) -------------------------

function renderCloseCalls(pool, result, opts) {
  const box = $('#closeCalls');
  if (!box) return;
  const cc = closeCalls(pool, result, opts);
  document.querySelectorAll('#pitch .slot').forEach((el) => el.classList.remove('tossup'));
  if (!cc.length) {
    box.innerHTML = '<span class="hint small">Skład stabilny — brak bliskich decyzji.</span>';
    return;
  }
  const slotEls = document.querySelectorAll('#pitch .slot');
  cc.forEach((c) => {
    const el = [...slotEls].find((e) => e.querySelector('.pname')?.textContent === fullName(c.player));
    el?.classList.add('tossup');
  });
  box.innerHTML =
    `<strong>Bliskie decyzje (${cc.length})</strong> — tu rekomendacja jest krucha:` +
    '<ul>' +
    cc
      .map(
        (c) =>
          `<li>${POSITION_LABEL[c.slot]}: ${fullName(c.player)} vs ${fullName(c.alt)} — różnica tylko ${c.margin.toFixed(2)}</li>`,
      )
      .join('') +
    '</ul>';
}

// ------------------------- głębia kadry -------------------------

function renderDepth() {
  const box = $('#depthBox');
  if (!box) return;
  const d = squadDepth(state.squad.players, currentOpts());
  if (!d) return (box.innerHTML = '<span class="hint small">Brak danych.</span>');
  const key = d.keyPlayers
    .slice(0, 6)
    .map(
      (k) =>
        `<tr><td class="name">${fullName(k.player)}</td><td class="rating">${k.drop > 0 ? '−' + k.drop.toFixed(2) : '0'}</td></tr>`,
    )
    .join('');
  const pos = d.perPos
    .map(
      (p) =>
        `<tr><td class="name">${POSITION_LABEL[p.slot]}</td><td class="name">${p.best ? fullName(p.best) : '—'}</td><td class="name">${p.backup ? fullName(p.backup) : '—'}</td><td class="rating">${p.gap.toFixed(2)}</td></tr>`,
    )
    .join('');
  box.innerHTML =
    '<p class="hint small">Ile Σ traci najlepsza XI bez danego zawodnika (leave-one-out):</p>' +
    `<table><thead><tr><th class="name">Zawodnik</th><th>Spadek Σ</th></tr></thead><tbody>${key}</tbody></table>` +
    '<p class="hint small">Głębia per pozycja — różnica między 1. a 2. opcją (mała = ryzyko):</p>' +
    `<table><thead><tr><th class="name">Pozycja</th><th class="name">1. wybór</th><th class="name">2. wybór</th><th>Δ</th></tr></thead><tbody>${pos}</tbody></table>`;
}

// ------------------------- karta oceny drużyny A–F -------------------------

function renderReportCard() {
  const box = $('#reportCard');
  if (!box) return;
  const ps = state.squad.players;
  const sectors = state.lastSectors;
  const totalWage = ps.reduce((s, p) => s + (p.salary || 0), 0);
  const totalTsi = ps.reduce((s, p) => s + (p.tsi || 0), 0);
  const benchRatio =
    state.lineupA && state.lineupB
      ? state.lineupB.result.total / Math.max(1, state.lineupA.result.total)
      : null;
  const youthTop = state.youth?.players?.length
    ? [...state.youth.players].map(youthPotential).sort((a, b) => b - a).slice(0, 3).reduce((a, b, _, arr) => a + b / arr.length, 0)
    : null;
  const { grades, weakest } = squadGrades({
    sectors,
    benchRatio,
    tsiPerWage: totalWage ? totalTsi / totalWage : null,
    youthTop,
    ageScore: ageStructureScore(ps),
  });
  const chips = Object.entries(grades)
    .map(([area, g]) => `<span class="grade g-${g}">${area}<b>${g}</b></span>`)
    .join('');
  box.innerHTML =
    `<div class="grade-row">${chips}</div>` +
    (weakest
      ? `<p class="weakest">Największa słabość: <strong>${weakest.area} (${weakest.grade})</strong>${weaknessTip(weakest.area)}</p>`
      : '');
}
function weaknessTip(area) {
  const t = {
    Obrona: ' — rozważ formację 5-obrońcową lub wzmocnienie stopera.',
    Pomoc: ' — brakuje kontroli środka; dokup rozgrywającego albo graj 5 w pomocy.',
    Atak: ' — niska siła ofensywy; napastnik lub skrzydłowi z wykończeniem.',
    'Ławka': ' — Skład B dużo słabszy; głębia kadry do poprawy.',
    Ekonomia: ' — pensje wysokie względem TSI; przejrzyj „martwy balast".',
    'Młodzież': ' — niski potencjał akademii; skautuj lepszych młodzieżowców.',
    'Struktura wieku': ' — za dużo weteranów albo luka pokoleniowa 21–24.',
  };
  return t[area] || '';
}

// ------------------------- planer rotacji (Mecze) -------------------------

function renderRotation() {
  const t = $('#rotationTable');
  if (!t) return;
  const myPr = state.team?.powerRating || estimateMyPr();
  const upcoming = (state.matches || [])
    .filter((m) => m.status === 'UPCOMING' || m.status === 'ONGOING')
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const keyName = squadDepthKeyName();
  t.querySelector('thead').innerHTML =
    '<tr><th class="name">Data</th><th class="name">Rywal</th><th>PR rywala</th><th class="name">Trudność</th><th class="name">Rekomendacja</th></tr>';
  if (!upcoming.length) {
    t.querySelector('tbody').innerHTML = '<tr><td class="name" colspan="5">Brak nadchodzących meczów w danych.</td></tr>';
    return;
  }
  t.querySelector('tbody').innerHTML = upcoming
    .map((m) => {
      const home = m.homeTeamName === state.squad.teamName;
      const oppName = home ? m.awayTeamName : m.homeTeamName;
      const oppId = home ? m.awayTeamId : m.homeTeamId;
      const oppData = state.opponents?.[oppId];
      const oppPr = oppData?.team?.powerRating || null;
      let diff = 'nieznana', rec = 'Pełna siła (brak danych o rywalu)';
      if (oppPr && myPr) {
        const ratio = oppPr / myPr;
        if (ratio < 0.85) { diff = 'łatwy'; rec = `Rotacja / trening${keyName ? ` — możesz oszczędzić ${keyName}` : ''}`; }
        else if (ratio > 1.15) { diff = 'trudny'; rec = 'Pełna siła, najlepsza XI'; }
        else { diff = 'równy'; rec = 'Pełna siła'; }
      }
      const cls = diff === 'łatwy' ? 'full' : diff === 'trudny' ? 'none' : diff === 'równy' ? 'partial' : '';
      return `<tr><td class="name">${(m.date || '').slice(0, 10)}</td><td class="name">${oppName}</td><td class="rating">${oppPr || '—'}</td><td class="name ${cls}">${diff}</td><td class="name">${rec}</td></tr>`;
    })
    .join('');
}
function estimateMyPr() {
  const s = state.lastSectors;
  return s ? Math.round((s.def + s.mid + s.att) * 55) : null;
}
function squadDepthKeyName() {
  try {
    const d = squadDepth(state.squad.players, currentOpts());
    return d?.keyPlayers?.[0] ? fullName(d.keyPlayers[0].player) : null;
  } catch {
    return null;
  }
}

// ------------------------- radar zagrożeń (Kronika) -------------------------

function renderThreatRadar() {
  const box = $('#threatRadar');
  if (!box) return;
  const teams = state.chronicle?.teams || [];
  const threats = [];
  for (const t of teams) {
    const p = t.previous || {};
    const flags = [];
    if (p.totalTsi && t.totalTsi && (t.totalTsi - p.totalTsi) / p.totalTsi > 0.03)
      flags.push(`TSI +${(((t.totalTsi - p.totalTsi) / p.totalTsi) * 100).toFixed(0)}%`);
    if (p.powerRating && t.powerRating && t.powerRating - p.powerRating > 60)
      flags.push(`PR +${t.powerRating - p.powerRating}`);
    if (t.arenaExpansion) flags.push('buduje stadion (szykuje awans)');
    if (flags.length) threats.push({ name: t.name, flags });
  }
  if (!threats.length) {
    box.innerHTML = '<span class="hint small">Brak wyraźnych ruchów u śledzonych drużyn.</span>';
    return;
  }
  box.innerHTML =
    '<strong>Radar zagrożeń</strong><ul>' +
    threats.map((x) => `<li>⚠ <strong>${x.name}</strong>: ${x.flags.join(' · ')}</li>`).join('') +
    '</ul>';
}

// ------------------------- start -------------------------

function renderAll() {
  applyManual();
  if (state.youthStarId == null) state.youthStarId = detectYouthStar(state.youth.players);
  renderSquadTable();
  renderSkillMap();
  renderRatingMap();
  renderMatches();
  renderOpponentPreviews();
  renderEconomy();
  renderHistory();
  renderChanges();
  renderSimilarControls();
  renderCompareControls();
  renderTransfersView();
  renderChronicle();
  renderYouthControls();
  renderYouthTable();
  renderYouthSkillMap();
  renderYouthRatingMap();
  renderYouthMatches();
  renderYouthChanges();
  renderYouthPlanner();
  renderRotation();
  optimize(); // wywołuje też renderSectors + renderTraining + głębię + kartę ocen
  youthOptimize();
}

initOptimizerControls();
$('#teamInfo').textContent = `${state.squad.teamName} — ${state.squad.players.length} zawodników (przykład)`;
if (state.youthStarId == null) state.youthStarId = detectYouthStar(state.youth.players);
loadFromServer().then((ok) => {
  if (!ok) renderAll();
  else {
    renderMatches();
    renderOpponentPreviews();
    renderEconomy();
    renderHistory();
    renderChanges();
    renderSimilarControls();
    renderCompareControls();
    renderTransfersView();
    renderChronicle();
    renderYouthControls();
    renderYouthTable();
    renderYouthSkillMap();
    renderYouthRatingMap();
    renderYouthMatches();
    renderYouthChanges();
    renderYouthPlanner();
    renderRotation();
    youthOptimize();
  }
});
