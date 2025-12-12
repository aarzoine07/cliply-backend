# Merge Gate for Backend (Engine Surface / Core API)

This checklist must be run locally before merging any backend work into `main` or `dev`.  
It mirrors what CI runs in the `backend-core` and `extended-tests` jobs.

---

## 1. Environment & Type Safety

From the repo root:

```bash
cd /Users/davidmaman/Desktop/cliply-backend

pnpm run check:env
pnpm run check:env:template
pnpm run typecheck