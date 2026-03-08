# Flock — Agent Instructions

## Cursor Cloud specific instructions

### Overview

Flock is a Node.js/TypeScript Express backend serving both an API (`/api/v1/*`) and a static web frontend (`web/`). It uses Prisma ORM with PostgreSQL. All external integrations (Razorpay, Gupshup, MSG91, ClearTax, UrbanPiper) default to mock mode in development — no real API keys needed.

### Key commands

See `README.md` for full quick-start. Summary of `package.json` scripts:

| Task | Command |
|------|---------|
| Dev server | `npm run dev` (port 3000) |
| Build | `npm run build` |
| Type check (lint) | `npx tsc --noEmit` |
| Prisma generate | `npm run db:generate` |
| Prisma migrate | `npm run db:migrate` |
| Seed database | `npm run db:seed` |
| Visual regression tests | `FLOCK_TEST_URL=http://localhost:3000 npx playwright test` |

No ESLint is configured; `tsc --noEmit` is the lint check.

### Non-obvious gotchas

- **Supabase roles required locally**: Prisma migrations reference PostgreSQL roles `anon` and `authenticated` (from Supabase RLS policies). Before running `npm run db:migrate` on a local PostgreSQL instance, create them:
  ```sql
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  GRANT USAGE ON SCHEMA public TO anon, authenticated;
  ```

- **Redis is optional**: If `REDIS_URL` is blank/unset, the server starts in degraded mode with a no-op Redis stub. Health endpoint reports `"redis": "degraded"` but all features work.

- **Mock OTP in API**: Set `EXPOSE_MOCK_OTP_IN_API=true` in `.env` so that `POST /auth/*/otp/send` responses include a `mockOtp` field — needed for automated testing and Playwright tests.

- **Staff OTP endpoints require `venueId`**: Both `/auth/staff/otp/send` and `/auth/staff/otp/verify` require a `venueId` field in the request body alongside `phone` and `code`.

- **Playwright tests**: Default `FLOCK_TEST_URL` points to a remote Render deploy. Override with `FLOCK_TEST_URL=http://localhost:3000` to test locally. First run with `--update-snapshots` to generate baseline screenshots.

- **Seeded test data**: After `npm run db:seed`, the venue slug is `the-barrel-room-koramangala` and the staff manager phone for testing is `9000000002`.

### MCP servers

Two MCP servers are configured in `.cursor/mcp.json`:

- **Supabase** (`@supabase/mcp-server-supabase`): Command-based, reads `SUPABASE_ACCESS_TOKEN` from the environment. Provides tools for managing Supabase projects (database queries, migrations, type generation). Requires user to add `SUPABASE_ACCESS_TOKEN` (a Supabase Personal Access Token) as a Cursor secret.

- **Render** (via `mcp-remote` bridge to `https://mcp.render.com/mcp`): Uses `sh -c` to expand `$RENDER_API_KEY` from the environment before passing it as an Authorization header. Provides tools for managing Render services, deployments, logs, and databases. Requires user to add `RENDER_API_KEY` (a Render API key from dashboard.render.com/settings#api-keys) as a Cursor secret.
