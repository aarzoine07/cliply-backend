-- sample base tables (minimal structure for RLS chaining)
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null,
  org_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  role text default 'member',
  inserted_at timestamptz default now()
);

-- RLS
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

create policy "workspaces_member_select"
  on public.workspaces
  for select using (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = id
        and m.user_id = auth.uid()
    )
  );

create policy "workspace_members_self"
  on public.workspace_members
  for select using (auth.uid() = user_id);
