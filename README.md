# Garment Shop Manager

Phone-first web app (installable PWA) for small Indian garment shops: stock, labels, selling and udhaar, in Hindi and English. **User guide (PDF with screenshots):** [`docs/guide/Dukaan_Manager_User_Guide.pdf`](docs/guide/Dukaan_Manager_User_Guide.pdf). The full brief is in [`CLAUDE.md`](CLAUDE.md); decisions are in [`docs/decisions.md`](docs/decisions.md).

## Run locally

```bash
npm install
npm run dev          # http://localhost:3000
```

Needs `.env.local` (not committed):

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

## Database

Put a Supabase access token in `.env.supabase` as `SUPABASE_ACCESS_TOKEN=...` (not committed), then:

```bash
npm run db:setup     # create the Supabase project once and write .env.local
npm run db:migrate   # apply supabase/migrations/*.sql
npm run db:seed      # demo shop: 5 categories, 30 products
```

## Tests

```bash
npm test             # pricing/money unit tests + Row Level Security tests
```

The Row Level Security tests run against the real project and skip themselves when `.env.local` is missing.
