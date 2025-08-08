import crypto from 'crypto';
export function makeChallenge(){ return { nonce: crypto.randomBytes(16).toString('hex'), difficulty: parseInt(process.env.POW_DIFFICULTY||'18',10) }; }
export function verifyPow(nonce, payloadHashHex, solutionHex, difficultyBits){
  const input = Buffer.concat([Buffer.from(nonce,'hex'), Buffer.from(payloadHashHex,'hex'), Buffer.from(solutionHex,'hex')]);
  const digest = crypto.createHash('sha256').update(input).digest();
  let zeros=0;
  for(const byte of digest){
    if(byte===0){ zeros+=8; continue; }
    for(let b=7;b>=0;b--){ if((byte>>b)&1) return zeros; zeros++; if(zeros>=difficultyBits) return zeros; }
    break;
  }
  return zeros;
}
