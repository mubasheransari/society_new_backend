# Invoice Backend (PostgreSQL)

This backend uses PostgreSQL for houses, invoices, payments, admin users, and NOC verification.

## Setup

1. Install packages

```bash
npm install
```

2. Create `.env` from `.env.example`

3. Initialize database schema

```bash
npm run db:init
```

4. Optional: migrate old JSON data into PostgreSQL

```bash
npm run db:migrate-json
```

5. Start backend

```bash
npm run dev
```

## Main routes

- `GET /health`
- `GET /api/dues`
- `POST /api/dues`
- `POST /api/dues/upload`
- `POST /api/dues/seed`
- `GET /api/dues/suggestions?q=309`
- `GET /api/dues/:plotNo/invoices`
- `POST /api/dues/:plotNo/generate-invoice`
- `POST /api/dues/:plotNo/invoices/:billMonth/payments`
- `DELETE /api/dues/:plotNo`
- `GET /api/noc?plot=309`
- `POST /api/noc/generate`
- `GET /api/noc/verify/:identifier`
- `GET /api/noc/history/:plotNo`
- `PUT /api/noc/:identifier/revoke`
- `GET /api/admin-users`
- `POST /api/admin-users`

## QR verification flow

1. Generate a NOC using `POST /api/noc/generate`
2. Save the returned `nocNumber` or `qrValue` in the QR code
3. Scan in the mobile app
4. Call `GET /api/noc/verify/:identifier`
5. Render the returned full NOC data on the mobile app

## Commands

```bash
npm install
npm run db:init
npm run dev
```

If port 4000 is already busy:

```bash
lsof -i :4000
kill -9 <PID>
npm run dev
```
# backend_society_02-04

## Category charges update

This version supports:

- Actual owner charges before discount
- Discounted owner charges after discussion
- Owner discount per month
- Actual rental charges before discount
- Discounted rental charges after discussion
- Rental discount per month
- Add new category from frontend
- Update/delete category from frontend

API endpoints:

- `GET /api/dues/charges-config`
- `POST /api/dues/charges-config`
- `PUT /api/dues/charges-config`
- `PATCH /api/dues/charges-config/:categoryCode`
- `DELETE /api/dues/charges-config/:categoryCode`

Future invoices continue using the discounted owner charge by default unless rental type is selected while adding a house.
# society_new_backend
