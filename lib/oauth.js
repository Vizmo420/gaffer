// OAuth 1.0a — podpisywanie żądań do CHPP (HMAC-SHA1).
// CHPP nie da się wołać czysto z przeglądarki: consumer secret musiałby być
// w kodzie frontu, a endpointy i tak nie wystawiają CORS. Dlatego podpis
// liczymy tutaj, po stronie Node (CLI albo opcjonalny server.js).

import crypto from 'node:crypto';

// RFC 3986: encodeURIComponent nie koduje ! * ' ( ) — OAuth wymaga.
export function pctEncode(str) {
  return encodeURIComponent(String(str)).replace(
    /[!*'()]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

function nonce() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Buduje nagłówek `Authorization: OAuth ...` dla żądania GET.
 * @param {object} o
 * @param {string} o.url            bazowy URL bez query stringa
 * @param {string} o.consumerKey
 * @param {string} o.consumerSecret
 * @param {string} [o.token]        oauth_token (request token albo access token)
 * @param {string} [o.tokenSecret]  sekret tokenu ('' dla pierwszego kroku)
 * @param {object} [o.oauthExtra]   dodatkowe pola oauth_* (np. oauth_callback, oauth_verifier)
 * @param {object} [o.query]        parametry query stringa (file, version, teamID, ...)
 * @returns {string} wartość nagłówka Authorization
 */
export function authHeader({
  url,
  method = 'GET',
  consumerKey,
  consumerSecret,
  token,
  tokenSecret = '',
  oauthExtra = {},
  query = {},
}) {
  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce(),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: '1.0',
    ...(token ? { oauth_token: token } : {}),
    ...oauthExtra,
  };

  // Podstawa podpisu: wszystkie parametry (oauth_* + query) posortowane.
  const all = { ...oauth, ...query };
  const paramString = Object.keys(all)
    .sort()
    .map((k) => `${pctEncode(k)}=${pctEncode(all[k])}`)
    .join('&');

  const baseString = [
    method.toUpperCase(),
    pctEncode(url),
    pctEncode(paramString),
  ].join('&');

  const signingKey = `${pctEncode(consumerSecret)}&${pctEncode(tokenSecret)}`;
  oauth.oauth_signature = crypto
    .createHmac('sha1', signingKey)
    .update(baseString)
    .digest('base64');

  return (
    'OAuth ' +
    Object.keys(oauth)
      .sort()
      .map((k) => `${pctEncode(k)}="${pctEncode(oauth[k])}"`)
      .join(', ')
  );
}
