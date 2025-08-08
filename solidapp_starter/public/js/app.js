// Minimal client JS: voting, compose post, comments, bug reports, PoW + cooldown tokens
const TOKEN_KEY = 'solidapp_cooldown_token';

async function getToken() {
  let t = localStorage.getItem(TOKEN_KEY);
  if (!t) {
    // create dummy token for uniqueness in voting
    localStorage.setItem(TOKEN_KEY, 'dummy.' + Math.random().toString(16).slice(2));
    t = localStorage.getItem(TOKEN_KEY);
  }
  return t;
}

async function sha256hex(buf){
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

function hexToBytes(hex){ const bytes=new Uint8Array(hex.length/2); for(let i=0;i<bytes.length;i++) bytes[i]=parseInt(hex.substr(i*2,2),16); return bytes; }
function bytesToHex(bytes){ return [...bytes].map(b=>b.toString(16).padStart(2,'0')).join(''); }
function leadingZeroBits(arr){ let z=0; for (const byte of arr){ if(byte===0){ z+=8; continue; } for(let b=7;b>=0;b--){ if((byte>>b)&1) return z; z++; } break; } return z; }

async function solvePow(nonceHex, payloadHashHex, difficultyBits){
  let counter = 0;
  const nonce = hexToBytes(nonceHex);
  const payload = hexToBytes(payloadHashHex);
  while (true){
    const sol = new Uint8Array(8);
    new DataView(sol.buffer).setBigUint64(0, BigInt(counter));
    const input = new Uint8Array(nonce.length + payload.length + sol.length);
    input.set(nonce,0); input.set(payload,nonce.length); input.set(sol,nonce.length+payload.length);
    const hash = await crypto.subtle.digest('SHA-256', input);
    if (leadingZeroBits(new Uint8Array(hash)) >= difficultyBits) return bytesToHex(sol);
    counter++;
    if (counter % 20000 === 0) await new Promise(r=>setTimeout(r));
  }
}

async function fetchPowAndSolve(payloadObj){
  const payloadStr = JSON.stringify(payloadObj);
  const payloadHash = await sha256hex(new TextEncoder().encode(payloadStr));
  const ch = await (await fetch('/api/pow')).json();
  const solution = await solvePow(ch.nonce, payloadHash, ch.difficulty);
  return { payloadStr, payloadHash, pow: ch, solution };
}

// Voting
document.addEventListener('click', async (e)=>{
  const btn = e.target.closest('.vote');
  if (!btn) return;
  e.preventDefault();
  const type = btn.dataset.type;
  const id = btn.dataset.id;
  const dir = parseInt(btn.dataset.dir,10);
  const token = await getToken();
  const r = await fetch(`/api/${type==='post'?'posts':'comments'}/${id}/vote`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ direction: dir, token })
  });
  if (r.ok) location.reload();
});

// Compose post
const postForm = document.getElementById('post-form');
if (postForm){
  postForm.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(postForm);
    const payload = {
      section_slug: fd.get('section_slug'),
      title: fd.get('title'),
      body_md: fd.get('body_md'),
      kind: fd.get('kind'),
      token: localStorage.getItem(TOKEN_KEY) || null
    };
    const { payloadHash, pow, solution } = await fetchPowAndSolve(payload);
    const r = await fetch('/api/posts', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ ...payload, payload_hash: payloadHash, pow_nonce: pow.nonce, pow_solution: solution })
    });
    const s = document.getElementById('post-status');
    if (r.ok){
      const json = await r.json();
      if (json.token) localStorage.setItem(TOKEN_KEY, json.token);
      s.textContent = 'Posted. Redirecting...';
      setTimeout(()=> location.href = `/p/${json.id}`, 400);
    } else {
      const err = await r.json().catch(()=>({error:'Error'}));
      s.textContent = 'Error: ' + err.error;
    }
  });
}

// Comment form
const cform = document.querySelector('.comment-form');
if (cform){
  cform.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(cform);
    const payload = {
      post_id: parseInt(cform.dataset.post,10),
      body_md: fd.get('body_md'),
      token: localStorage.getItem(TOKEN_KEY) || null
    };
    const { payloadHash, pow, solution } = await fetchPowAndSolve(payload);
    const r = await fetch('/api/comments', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ ...payload, payload_hash: payloadHash, pow_nonce: pow.nonce, pow_solution: solution })
    });
    if (r.ok){
      const json = await r.json();
      if (json.token) localStorage.setItem(TOKEN_KEY, json.token);
      location.reload();
    } else { alert('Error submitting comment'); }
  });
}

// Bug report
const bugForm = document.getElementById('bug-form');
if (bugForm){
  bugForm.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(bugForm);
    const r = await fetch('/api/bugs', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ title: fd.get('title'), description: fd.get('description') })
    });
    const s = document.getElementById('bug-status');
    s.textContent = r.ok ? 'Thanks.' : 'Error.';
    if (r.ok) bugForm.reset();
  });
}
