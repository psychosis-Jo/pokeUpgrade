const crypto = require('node:crypto');
function sign(uid, secret, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ uid, exp: now + 2 * 60 * 60 * 1000 })).toString('base64url');
  return body + '.' + crypto.createHmac('sha256', secret).update(body).digest('base64url');
}
function verify(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 2048) throw Error('登录已失效');
  const [body, signature, extra] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(body || '').digest();
  const supplied = Buffer.from(signature || '', 'base64url');
  if (extra || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) throw Error('登录已失效');
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (!/^[a-f0-9]{64}$/.test(claims.uid) || !Number.isFinite(claims.exp) || claims.exp <= now) throw Error('登录已失效');
  return claims.uid;
}
module.exports = { sign, verify };
