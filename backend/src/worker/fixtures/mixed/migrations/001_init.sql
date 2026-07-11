create table users (
  id uuid primary key,
  email text not null
);

create table if not exists public.projects (
  id uuid primary key,
  owner uuid references users(id)
);
