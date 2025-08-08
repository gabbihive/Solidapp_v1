# solidapp (MVP)

Privacy-first, no-login, reddit-like app for mutual aid and Q&A.

Quick run:
1) Copy `.env.example` to `.env` and edit values.
2) `npm install`
3) `npm run migrate && npm run seed`
4) `npm run dev` -> http://localhost:8080
Admin at `/$ADMIN_SLUG` with basic auth (user: admin, pass from env).
