import Fastify from 'fastify';
import path from 'path';
import fj from '@fastify/formbody';
import statik from '@fastify/static';
import view from '@fastify/view';
import basicAuth from '@fastify/basic-auth';
import nunjucks from 'nunjucks';
import crypto from 'crypto';

import { run, get, all } from './db.js';
import { renderMarkdown } from './sanitizer.js';
import { makeChallenge, verifyPow } from './pow.js';
import { signCooldownToken, verifyCooldownToken } from './tokens.js';
import { hot } from './ranking.js';

const app = Fastify({ logger: true });
app.register(fj);
app.register(statik, { root: path.join(process.cwd(), 'public'), prefix: '/public/' });
app.register(view, {
  engine: { nunjucks },
  root: path.join(process.cwd(), 'src', 'views'),
  viewExt: 'njk'
});

const ADMIN_SLUG = process.env.ADMIN_SLUG || 'admin-9f2a7c1b';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me';
await app.register(basicAuth, {
  validate: async (username, password) => {
    if (username !== 'admin' || password !== ADMIN_PASSWORD) throw new Error('Unauthorized');
  },
  authenticate: true
});

const SITE_NAME = process.env.SITE_NAME || 'Solidapp';
const SITE_TAGLINE = process.env.SITE_TAGLINE || 'Mutual aid, offers, and questions — no login.';
const POST_COOLDOWN = parseInt(process.env.POST_COOLDOWN_SECONDS || '60', 10);
const COMMENT_COOLDOWN = parseInt(process.env.COMMENT_COOLDOWN_SECONDS || '30', 10);
const MAX_LINKS_PER_POST = parseInt(process.env.MAX_LINKS_PER_POST || '3', 10);
const MAX_LINKS_PER_COMMENT = parseInt(process.env.MAX_LINKS_PER_COMMENT || '2', 10);

function countLinks(text){ const m=(text||'').match(/https?:\/\//gi); return m?m.length:0; }

app.addHook('preHandler', async (req, reply) => { reply.locals = { SITE_NAME, SITE_TAGLINE, ADMIN_SLUG }; });

app.get('/', async (req, reply) => {
  const { sort = 'hot', q = '', section = '' } = req.query;

  let where = "p.status = 'visible'";
  const params = {};
  if (section) { where += ' AND s.slug = @section'; params.section = section; }
  if (q) { where += ' AND (p.title LIKE @q OR p.body_md LIKE @q)'; params.q = `%${q}%`; }

  const posts = all(`
    SELECT p.*, s.name AS section_name, s.slug AS section_slug
    FROM posts p
    JOIN sections s ON s.id = p.section_id
    WHERE ${where}
  `, params);

  for (const r of posts) r.hot = hot(r.score, r.created_at);

  posts.sort((a, b) => {
    if (sort === 'new') return b.created_at - a.created_at;
    if (sort === 'top') return b.score - a.score;
    return b.hot - a.hot; // hot (default)
  });

  const sections = all(`SELECT * FROM sections WHERE is_active = 1 ORDER BY name ASC`);
  return reply.view('index.njk', { posts, sections, sort, q, section });
});

app.get('/s/:slug', async (req, reply) => {
  const { slug } = req.params;
  const section = get(`SELECT * FROM sections WHERE slug=@slug AND is_active=1`, { slug });
  if (!section) return reply.code(404).send('Section not found');
  const posts = all(`SELECT * FROM posts WHERE section_id=@sid AND status='visible' ORDER BY created_at DESC`, { sid: section.id });
  for(const r of posts) r.hot = hot(r.score, r.created_at);
  return reply.view('section.njk', { section, posts });
});

app.post('/api/posts', async (req, reply) => {
  const { section_slug, title, body_md, kind, pow_nonce, pow_solution, token, payload_hash } = req.body;
  const now = Math.floor(Date.now()/1000);
  if (!section_slug || !title || !body_md || !kind) return reply.code(400).send({ error: 'Missing fields' });
  const t = verifyCooldownToken(token);
  if (t && now - (t.lastTs || 0) < POST_COOLDOWN) return reply.code(429).send({ error: 'Cooldown in effect' });
  const difficulty = parseInt(process.env.POW_DIFFICULTY || '18', 10);
  const zeros = verifyPow(pow_nonce, payload_hash, pow_solution, difficulty);
  if (zeros < difficulty) return reply.code(400).send({ error: 'Invalid PoW' });
  if (countLinks(body_md) > MAX_LINKS_PER_POST) return reply.code(400).send({ error: 'Too many links' });
  const section = get(`SELECT * FROM sections WHERE slug=@slug AND is_active=1`, { slug: section_slug });
  if (!section) return reply.code(400).send({ error: 'Invalid section' });
  const body_html = renderMarkdown(body_md);
  const info = run(`INSERT INTO posts(section_id,title,body_md,body_html,kind,score,status,created_at) VALUES (@sid,@title,@md,@html,@kind,0,'visible',@ts)`,
    { sid: section.id, title, md: body_md, html: body_html, kind, ts: now });
  const newToken = signCooldownToken(now, POST_COOLDOWN);
  return reply.send({ ok: true, id: info.lastInsertRowid, token: newToken });
});

app.get('/p/:id', async (req, reply) => {
  const { id } = req.params;
  const post = get(`SELECT p.*, s.name AS section_name, s.slug AS section_slug FROM posts p JOIN sections s ON s.id=p.section_id WHERE p.id=@id`, { id });
  if (!post || post.status !== 'visible') return reply.code(404).send('Not found');
  const comments = all(`SELECT * FROM comments WHERE post_id=@id AND status='visible' ORDER BY created_at ASC`, { id });
  return reply.view('post.njk', { post, comments });
});

app.post('/api/comments', async (req, reply) => {
  const { post_id, parent_id, body_md, pow_nonce, pow_solution, token, payload_hash } = req.body;
  const now = Math.floor(Date.now()/1000);
  if (!post_id || !body_md) return reply.code(400).send({ error: 'Missing fields' });
  const t = verifyCooldownToken(token);
  if (t && now - (t.lastTs || 0) < COMMENT_COOLDOWN) return reply.code(429).send({ error: 'Cooldown in effect' });
  const difficulty = parseInt(process.env.POW_DIFFICULTY || '18', 10);
  const zeros = verifyPow(pow_nonce, payload_hash, pow_solution, difficulty);
  if (zeros < difficulty) return reply.code(400).send({ error: 'Invalid PoW' });
  if (countLinks(body_md) > MAX_LINKS_PER_COMMENT) return reply.code(400).send({ error: 'Too many links' });
  const body_html = renderMarkdown(body_md);
  const info = run(`INSERT INTO comments(post_id,parent_id,body_md,body_html,score,status,created_at) VALUES (@pid,@parent,@md,@html,0,'visible',@ts)`,
    { pid: post_id, parent: parent_id || null, md: body_md, html: body_html, ts: now });
  const newToken = signCooldownToken(now, COMMENT_COOLDOWN);
  return reply.send({ ok: true, id: info.lastInsertRowid, token: newToken });
});

function voteCommon(entity, id, direction, token){
  const now = Math.floor(Date.now()/1000);
  if (![1,-1].includes(direction)) return { error: 'Invalid vote' };
  const t = verifyCooldownToken(token);
  if (!t) return { error: 'Missing or invalid token' };
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  try {
    run(`INSERT INTO votes(entity_type,entity_id,direction,token_hash,created_at) VALUES (@e,@id,@d,@h,@ts)`,
      { e: entity, id, d: direction, h: tokenHash, ts: now });
  } catch(e){ return { ok: true }; }
  const table = entity === 'post' ? 'posts' : 'comments';
  run(`UPDATE ${table} SET score = score + @delta WHERE id=@id`, { delta: direction, id });
  return { ok: true };
}

app.post('/api/posts/:id/vote', async (req, reply) => {
  const id = parseInt(req.params.id,10);
  const { direction, token } = req.body;
  const res = voteCommon('post', id, parseInt(direction,10), token);
  if (res.error) return reply.code(400).send(res);
  reply.send(res);
});
app.post('/api/comments/:id/vote', async (req, reply) => {
  const id = parseInt(req.params.id,10);
  const { direction, token } = req.body;
  const res = voteCommon('comment', id, parseInt(direction,10), token);
  if (res.error) return reply.code(400).send(res);
  reply.send(res);
});

app.post('/api/report', async (req, reply) => {
  const { entity_type, entity_id, reason } = req.body;
  if (!['post','comment'].includes(entity_type)) return reply.code(400).send({ error: 'Bad entity' });
  const now = Math.floor(Date.now()/1000);
  run(`INSERT INTO reports(entity_type, entity_id, reason, created_at) VALUES (@t,@i,@r,@ts)`,
      { t: entity_type, i: entity_id, r: (reason||'').slice(0,500), ts: now });
  reply.send({ ok: true });
});

app.get('/api/pow', async (req, reply) => { reply.send(makeChallenge()); });

app.get(`/${ADMIN_SLUG}`, { preHandler: app.basicAuth }, async (req, reply) => {
  const posts = all(`SELECT p.*, s.slug as section_slug FROM posts p JOIN sections s ON s.id=p.section_id ORDER BY p.created_at DESC LIMIT 100`);
  const comments = all(`SELECT * FROM comments ORDER BY created_at DESC LIMIT 100`);
  const reports = all(`SELECT * FROM reports ORDER BY created_at DESC LIMIT 100`);
  const sections = all(`SELECT * FROM sections ORDER BY name`);
  return reply.view('admin.njk', { posts, comments, reports, sections });
});

app.post(`/${ADMIN_SLUG}/post/:id/:action`, { preHandler: app.basicAuth }, async (req, reply) => {
  const { id, action } = req.params;
  const ok = ['hide','show','freeze','delete'].includes(action);
  if (!ok) return reply.code(400).send('Bad action');
  const status = action === 'show' ? 'visible' : (action === 'hide' ? 'hidden' : (action === 'freeze' ? 'frozen' : 'deleted'));
  run(`UPDATE posts SET status=@s WHERE id=@id`, { s: status, id });
  reply.redirect(`/${ADMIN_SLUG}`);
});

app.post(`/${ADMIN_SLUG}/comment/:id/:action`, { preHandler: app.basicAuth }, async (req, reply) => {
  const { id, action } = req.params;
  const ok = ['hide','show','freeze','delete'].includes(action);
  if (!ok) return reply.code(400).send('Bad action');
  const status = action === 'show' ? 'visible' : (action === 'hide' ? 'hidden' : (action === 'freeze' ? 'frozen' : 'deleted'));
  run(`UPDATE comments SET status=@s WHERE id=@id`, { s: status, id });
  reply.redirect(`/${ADMIN_SLUG}`);
});

app.post(`/${ADMIN_SLUG}/sections`, { preHandler: app.basicAuth }, async (req, reply) => {
  const { slug, name, description, is_active } = req.body;
  if (!slug || !name) return reply.code(400).send('Missing');
  run(`INSERT INTO sections(slug,name,description,is_active) VALUES(@slug,@name,@desc,@active)
       ON CONFLICT(slug) DO UPDATE SET name=excluded.name, description=excluded.description, is_active=excluded.is_active`,
      { slug, name, desc: description || '', active: is_active ? 1 : 0 });
  reply.redirect(`/${ADMIN_SLUG}`);
});

app.get(`/${ADMIN_SLUG}/export/:what`, { preHandler: app.basicAuth }, async (req, reply) => {
  const { what } = req.params;
  const map = {
    posts: `SELECT * FROM posts`,
    comments: `SELECT * FROM comments`,
    reports: `SELECT * FROM reports`,
    sections: `SELECT * FROM sections`
  };
  const sql = map[what];
  if (!sql) return reply.code(400).send('Bad export');
  const rows = all(sql);
  reply.header('Content-Type', 'application/json');
  reply.send(JSON.stringify(rows, null, 2));
});

app.get('/compose', async (req, reply) => {
  const sections = all(`SELECT * FROM sections WHERE is_active=1 ORDER BY name`);
  return reply.view('compose.njk', { sections });
});

const port = parseInt(process.env.PORT || '8080', 10);
app.listen({ port, host: '0.0.0.0' }).then(()=> app.log.info(`Listening on ${port}`));

