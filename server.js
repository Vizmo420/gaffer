// OPCJONALNY serwer Express — alternatywa dla CLI, gdy chcesz żywe API zamiast
// importu plików. Token trzymany w cookie sesji, nigdy nie trafia do przeglądarki
// jako czysty tekst.
//
// Wymaga doinstalowania (są w optionalDependencies):
//   npm install express express-session cors
// oraz w .env: APP_BASE_URL, FRONTEND_URL, SESSION_SECRET
//
// Uruchomienie:  node server.js   (albo: npm run server)
// Logowanie:     otwórz http://localhost:3001/auth/login

import 'dotenv/config';
import {
  getRequestToken,
  authorizeUrl,
  getAccessToken,
  fetchSquad,
  fetchMatches,
  computeInactivity,
  findSimilarByTsi,
} from './lib/hattrick.js';

let express, session, cors;
try {
  ({ default: express } = await import('express'));
  ({ default: session } = await import('express-session'));
  ({ default: cors } = await import('cors'));
} catch {
  console.error(
    'Brak zależności trybu serwerowego. Zainstaluj:\n  npm install express express-session cors',
  );
  process.exit(1);
}

const PORT = Number(process.env.PORT ?? 3001);
const APP_BASE_URL = process.env.APP_BASE_URL ?? `http://localhost:${PORT}`;
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const consumerKey = process.env.CHPP_CONSUMER_KEY;
const consumerSecret = process.env.CHPP_CONSUMER_SECRET;

if (!consumerKey || !consumerSecret) {
  console.error('Brak CHPP_CONSUMER_KEY / CHPP_CONSUMER_SECRET w .env');
  process.exit(1);
}

const app = express();
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET ?? 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 },
  }),
);

const base = { consumerKey, consumerSecret };
const creds = (req) =>
  req.session.token
    ? { ...base, token: req.session.token, tokenSecret: req.session.tokenSecret }
    : null;

function requireAuth(req, res, next) {
  if (!creds(req)) return res.status(401).json({ error: 'not_authenticated' });
  next();
}

// --- OAuth: callback flow (nie "oob" jak w CLI) ---
app.get('/auth/login', async (req, res, next) => {
  try {
    const rt = await getRequestTokenWithCallback();
    req.session.reqToken = rt.token;
    req.session.reqTokenSecret = rt.tokenSecret;
    res.redirect(authorizeUrl(rt.token));
  } catch (e) {
    next(e);
  }
});

// getRequestToken z lib używa oauth_callback=oob; tutaj potrzebujemy prawdziwego
// callbacku, więc powtarzamy wywołanie z URL-em zwrotnym.
async function getRequestTokenWithCallback() {
  // Reużywamy logiki podpisu z lib przez mały trik: lib.getRequestToken zawsze
  // ustawia "oob". Dla trybu serwerowego wysyłamy własny callback.
  const { authHeader } = await import('./lib/oauth.js');
  const url = 'https://chpp.hattrick.org/oauth/request_token.ashx';
  const callback = `${APP_BASE_URL}/auth/callback`;
  const header = authHeader({
    url,
    consumerKey,
    consumerSecret,
    oauthExtra: { oauth_callback: callback },
  });
  const r = await fetch(url + '?' + new URLSearchParams({ oauth_callback: callback }), {
    headers: { Authorization: header },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`request_token (${r.status}): ${text}`);
  const p = new URLSearchParams(text);
  return { token: p.get('oauth_token'), tokenSecret: p.get('oauth_token_secret') };
}

app.get('/auth/callback', async (req, res, next) => {
  try {
    const { oauth_verifier } = req.query;
    const at = await getAccessToken({
      ...base,
      token: req.session.reqToken,
      tokenSecret: req.session.reqTokenSecret,
      verifier: oauth_verifier,
    });
    req.session.token = at.token;
    req.session.tokenSecret = at.tokenSecret;
    delete req.session.reqToken;
    delete req.session.reqTokenSecret;
    res.redirect(FRONTEND_URL);
  } catch (e) {
    next(e);
  }
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// --- API ---
app.get('/api/squad', requireAuth, async (req, res, next) => {
  try {
    const squad = await fetchSquad(creds(req));
    if (req.query.inactivity !== 'false') {
      await computeInactivity(creds(req), squad.teamId, squad.players, {
        limit: Number(req.query.limit ?? 10),
      });
    }
    res.json(squad);
  } catch (e) {
    next(e);
  }
});

app.get('/api/matches', requireAuth, async (req, res, next) => {
  try {
    const squad = await fetchSquad(creds(req));
    res.json(await fetchMatches(creds(req), squad.teamId));
  } catch (e) {
    next(e);
  }
});

app.get('/api/players/similar', requireAuth, async (req, res, next) => {
  try {
    const squad = await fetchSquad(creds(req));
    const target = squad.players.find((p) => p.id === Number(req.query.playerId));
    if (!target) return res.status(404).json({ error: 'player_not_found' });
    res.json(await findSimilarByTsi(creds(req), squad.teamId, target.tsi));
  } catch (e) {
    next(e);
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: String(err.message ?? err) });
});

app.listen(PORT, () => {
  console.log(`Serwer CHPP: ${APP_BASE_URL}`);
  console.log(`Zaloguj się: ${APP_BASE_URL}/auth/login`);
});
