const cloud = require('wx-server-sdk');
const crypto = require('node:crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
exports.main = async () => {
  const { OPENID, APPID } = cloud.getWXContext();
  const secret = process.env.SESSION_SECRET;
  if (!OPENID || !APPID || !secret || secret.length < 32) throw Error('登录服务配置不完整');
  const uid = crypto.createHash('sha256').update(APPID + ':' + OPENID).digest('hex');
  const exp = Date.now() + 2 * 60 * 60 * 1000;
  const body = Buffer.from(JSON.stringify({ uid, exp })).toString('base64url');
  const token = body + '.' + crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return { uid, token, exp };
};
