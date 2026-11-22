-- 쎈스드롭 (Sense Drop) 테이블 — Supabase WSNS 프로젝트
-- 회원 계정은 WSNS 사이트와 같은 auth.users 를 씁니다.
-- 브라우저(anon · authenticated)는 이 테이블에 직접 접근하지 못하고,
-- Cloudflare Worker 가 secret 키로만 읽고 씁니다.

create table public.sd_shares (
  id text primary key check (id ~ '^[A-Za-z0-9]{8,16}$'),
  owner_id uuid references auth.users (id) on delete cascade,
  title text not null default '배포 자료' check (char_length(title) <= 100),
  output text not null default 'pdf' check (output in ('pdf', 'original', 'both')),
  password_hash text not null,
  admin_token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

comment on table public.sd_shares is '쎈스드롭 공유 링크. owner_id 가 없으면 비회원이 만든 링크(관리 토큰으로만 관리).';

create index sd_shares_owner_idx on public.sd_shares (owner_id, created_at desc);
create index sd_shares_expires_idx on public.sd_shares (expires_at);

create table public.sd_files (
  id text primary key check (id ~ '^[A-Za-z0-9]{6,16}$'),
  share_id text not null references public.sd_shares (id) on delete cascade,
  position int not null default 0,
  original_name text not null check (char_length(original_name) <= 200),
  ext text not null check (ext in ('hwp', 'hwpx', 'pdf')),
  size bigint not null check (size >= 0),
  status text not null default 'uploading' check (status in ('uploading', 'converting', 'done', 'error')),
  error text,
  pdf_size bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.sd_files is '쎈스드롭 공유 파일. 원본 · PDF 는 Cloudflare R2 (shares/<share_id>/<file_id>.<ext|pdf>) 에 저장.';

create index sd_files_share_idx on public.sd_files (share_id, position);

create or replace function public.sd_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger sd_files_touch
  before update on public.sd_files
  for each row execute function public.sd_touch_updated_at();

alter table public.sd_shares enable row level security;
alter table public.sd_files enable row level security;

-- 정책 없음 + 권한 회수: 브라우저에서는 접근 불가, service_role(secret 키)만 사용
revoke all on public.sd_shares from anon, authenticated;
revoke all on public.sd_files from anon, authenticated;
revoke all on function public.sd_touch_updated_at() from public, anon, authenticated;

-- 0002: PDF 변환을 올리는 사람의 브라우저에서 하도록 바뀜
alter table public.sd_files add column original_uploaded boolean not null default false;
comment on column public.sd_files.original_uploaded is '원본(HWP/HWPX)을 R2에 올렸는지. PDF 변환은 올리는 사람의 브라우저에서 합니다.';
comment on column public.sd_files.pdf_size is '브라우저에서 변환해 올린 PDF 크기 (PDF 파일은 원본 크기와 같음)';
