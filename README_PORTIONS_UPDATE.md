# Multiple Portions Update

This backend now supports multiple portions under one house.

## Added
- `house_portions` table
- `portion_id` and `portion_name` on monthly invoices and payments
- APIs:
  - `GET /api/dues/:plotNo/portions`
  - `POST /api/dues/:plotNo/portions`
  - `DELETE /api/dues/:plotNo/portions/:portionId`
- Existing invoice API now supports `?portionId=`
- Generate invoice supports `portionId` in request body

Run DB migration/init again after replacing backend:

```bash
npm run init-db
npm run dev
```

## Existing Plot Portions Update

This backend already supports adding portions to an existing plot through:

- `GET /api/dues/:plotNo/portions`
- `POST /api/dues/:plotNo/portions`
- `DELETE /api/dues/:plotNo/portions/:portionId`

If your existing database is old, run:

```bash
psql -U stranger -d society_management -f scripts/migrate_existing_portions.sql
```
