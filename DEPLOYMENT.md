# Deploying the backend to Vercel with CI/CD

## What changed in this repo (read this first)

1. **`index.js`** no longer unconditionally calls `app.listen()`. It only
   does that when run directly (`node index.js` — local dev, or a
   traditional host). It now also exports the Express `app`.
2. **`api/index.js`** (new) re-exports the app — this is the file Vercel's
   Node runtime actually invokes.
3. **`vercel.json`** (new) rewrites every request to that function, so
   Express still sees the full original path (`/api/dues/...`, `/health`,
   etc.) and routes it exactly as before.
4. **`db/repositories/categoryChargesRepo.js`** (new) + changes in
   **`db/maintenanceCharges.js`**: category-charge edits used to be written
   to `db/categoryCharges.json` on disk. Vercel's filesystem is read-only
   (except `/tmp`, which doesn't persist), so those edits would have
   silently vanished in production. They're now stored in Postgres in a new
   `category_charges` table, kept warm in an in-memory cache per instance.
5. **`config/db.js`** now also accepts a `POSTGRES_URL` connection string
   (what Vercel Postgres provides) and defaults to SSL on for hosted
   connection strings.
6. Added `npm run lint` (ESLint) and `npm test` (a smoke test that just
   requires the app — catches syntax/require errors) so CI has something
   real to gate on.

## 1. Database (Vercel Postgres)

1. In the Vercel dashboard: **Storage → Create Database → Postgres**.
2. Once created, open the database's **Quickstart / `.env.local` tab** and
   copy the `POSTGRES_URL` value.
3. Connect to it (Vercel's dashboard has a built-in query tab, or use `psql`
   with that connection string) and run the contents of `db/schema.sql`
   once to create all tables, including the new `category_charges` table.
4. If you have existing data in `db/categoryCharges.json` from before this
   change, seed it manually with one `INSERT` per row into
   `category_charges`, or just let the app seed the defaults on first boot
   (it does this automatically if the table is empty) and re-edit via the
   UI.

## 2. Create the Vercel project (backend)

1. Push this repo to GitHub (you said it's already there).
2. In Vercel: **Add New → Project → Import** this GitHub repo.
3. Framework preset: **Other** (it's a plain Node/Express app, not Next.js).
4. Build command / output directory: leave empty — there's nothing to
   build, `vercel.json` handles routing to `api/index.js`.
5. **Link the Postgres database you created** to this project (Storage tab
   on the project → Connect Database). This auto-injects `POSTGRES_URL`.
6. Add the remaining environment variables (Project Settings →
   Environment Variables), for **Production** (and Preview, if you want PR
   previews to hit a real DB):
   - `JWT_SECRET` — a long random string
   - `DEFAULT_RESIDENT_PASSWORD` — default password assigned to new
     residents
   - (`POSTGRES_URL` is already set by the DB link in step 5)
7. **Turn off Vercel's automatic Git deployments** for this project
   (Project Settings → Git → disconnect, or set the production branch to
   something that isn't pushed to). We deploy explicitly from GitHub
   Actions instead, so you don't get duplicate/competing deployments.

## 3. GitHub Actions secrets (backend repo)

In the GitHub repo → Settings → Secrets and variables → Actions, add:

| Secret | Where to get it |
|---|---|
| `VERCEL_TOKEN` | Vercel → Account Settings → Tokens → Create |
| `VERCEL_ORG_ID` | Run `vercel link` locally once in this folder; it writes `.vercel/project.json` with both IDs |
| `VERCEL_PROJECT_ID` | Same as above |

The workflow (`.github/workflows/ci-cd.yml`) already does the rest:
- **Every PR**: installs deps, lints, runs the smoke test, then deploys a
  **preview** to Vercel if the gate passes.
- **Every push to `main`**: same gate, then deploys to **production**.

## 4. A real limitation to know about: request size

Vercel Functions cap request/response bodies at **4.5 MB**, enforced by
Vercel itself (not something fixable in Express). Your Excel upload route
(`POST /api/dues/upload`, using `multer.memoryStorage()`) and the JSON
body limit (`express.json({ limit: '25mb' })`) currently assume more room
than that. If admins ever upload Excel sheets bigger than ~4 MB, they'll
get a `413 FUNCTION_PAYLOAD_TOO_LARGE` on Vercel specifically (this would
NOT happen on Render/Railway/a VPS, which don't have this cap). If your
real `dues.xlsx` files stay small (the sample is 44 KB), you're fine —
just keep it in mind if that changes.

## 5. Local smoke test before pushing

```bash
npm ci
npm run lint
npm test
npm start   # visit http://localhost:4000/health
```
