import crypto from 'crypto';
const secret = () => (process.env.TOKEN_SECRET || 'dev-secret');
export function signCooldownToken(lastTs, minIntervalSec){
  const payload = JSON.stringify({ lastTs, min: minIntervalSec });
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('hex');
  return Buffer.from(payload).toString('base64') + '.' + sig;
}
export function verifyCooldownToken(token){
  if(!token) return null;
  const [payloadB64, sig] = token.split('.');
  if(!payloadB64||!sig) return null;
  const payload = Buffer.from(payloadB64,'base64').toString();
  const expSig = crypto.createHmac('sha256', secret()).update(payload).digest('hex');
  try{
    if(!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expSig))) return null;
  }catch{ return null; }
  try { return JSON.parse(payload); } catch { return null; }
}
