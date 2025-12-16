# T2 — Surface Access Model (RLS + API)

Scope: “Surface-facing tables” exposed to the web/API layer.
Goal: Workspace members can access workspace content (not just owner_id), and API handlers must not bypass RLS for surface tables.

Surface tables covered:
- projects
- clips
- schedules
- connected_accounts

Non-scope:
- jobs and other internal worker tables (service role allowed where appropriate)

---

## Enforcement layers

### Database (RLS)
Access is enforced by Postgres RLS using workspace membership checks:
- `public.is_workspace_member(workspace_id)` (helper function; non-recursive)
- plus owner/org-link allowances where present

### API (Next.js routes)
For surface tables:
- Use a **user-scoped RLS client**: `getRlsClient(accessToken)`
- Do **not** use service-role client for reads/writes to surface tables
- Service-role is allowed for non-surface internals (e.g., inserting into `jobs`)

---

## Resource access rules

### projects (public.projects)
Who can see it?
- Workspace owner OR org-linked user OR any workspace member (via `public.is_workspace_member(workspace_id)`).
- Non-members cannot read.

Who can modify it?
- Same set of users as read.
- Enforced by `FOR ALL` policy with `USING` + `WITH CHECK` membership logic.

API expectations:
- Any route that reads/writes `projects` must use `getRlsClient(accessToken)` for the `projects` query.

Examples:
- Member can read a project in their workspace.
- User from another workspace cannot read/update that project (RLS denies).

---

### clips (public.clips)
Who can see it?
- Workspace owner OR org-linked user OR any workspace member (via `public.is_workspace_member(workspace_id)`).
- Non-members cannot read.

Who can modify it?
- Same set of users as read.
- Enforced by `FOR ALL` policy with `USING` + `WITH CHECK` membership logic.

API expectations:
- Any route that reads/writes `clips` must use `getRlsClient(accessToken)` for the `clips` query.
- Service role may still be used for internal inserts (e.g., enqueueing jobs), but NOT for clip reads/updates.

Examples:
- Member can approve/reject a clip in their workspace (RLS allows).
- Cross-workspace user is blocked from reading/updating that clip.

---

### schedules (public.schedules)
Who can see it?
- Workspace owner OR org-linked user OR any workspace member (via `public.is_workspace_member(workspace_id)`).
- Non-members cannot read.

Who can modify it?
- Same set of users as read.
- Enforced by `FOR ALL` policy with `USING` + `WITH CHECK` membership logic.

API expectations:
- Any route that reads/writes `schedules` must use `getRlsClient(accessToken)` for the `schedules` query.

Examples:
- Member can create/cancel a schedule in their workspace.
- Cross-workspace user cannot see/modify schedules outside their workspace.

---

### connected_accounts (public.connected_accounts)
Who can see it?
- Authenticated workspace members can read (`connected_accounts_workspace_member_read`).

Who can modify it?
- Authenticated workspace members can insert/update/delete within their workspace (`connected_accounts_workspace_member_modify`).

Service role note:
- A service-role-only policy exists for full access (intended for backend/internal operations),
  but web/API “surface” routes should still prefer the RLS client.

API expectations:
- Any route that reads/writes `connected_accounts` for the UI must use `getRlsClient(accessToken)`.

Examples:
- Member can list/update connected accounts for their workspace.
- Cross-workspace user is blocked from reading/updating those rows.

---

## Canonical API pattern

1) Build auth context and require workspace
2) Require access token
3) Use `getRlsClient(accessToken)` for surface tables
4) Use `getAdminClient()` only for non-surface internals (jobs, webhooks, etc.)

Minimal header contract (conceptual):
- `Authorization: Bearer <user_access_token>`
- `X-Workspace-ID: <workspace_uuid>`

