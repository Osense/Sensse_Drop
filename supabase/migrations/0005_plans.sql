-- 쎈스드롭 요금제: 나그네(로그인 없음) · 멤버십(WSNS 계정) · 프로(연 9,900원)
-- 결제 연동 전이라 프로는 이 표에 직접 넣어 켭니다:
--   insert into public.sd_plans (user_id, plan, expires_at, note) values ('<auth.users.id>', 'pro', now() + interval '1 year', '수동 지급');
create table if not exists public.sd_plans (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null check (plan in ('pro')),
  expires_at timestamptz not null,
  note text,
  -- 구독이 끝나고 유예 7일이 지나 멤버십 한도를 넘는 링크를 닫은 시각 (갱신하면 null 로 되돌림)
  enforced_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.sd_plans enable row level security;
comment on table public.sd_plans is '쎈스드롭 프로 이용 기간. Worker 가 secret 키로만 읽습니다.';

-- 링크를 만들 때의 요금제 (파일 크기 한도 확인용)
alter table public.sd_shares add column if not exists plan text not null default 'member' check (plan in ('guest', 'member', 'pro'));
update public.sd_shares set plan = 'guest' where owner_id is null;

-- 회원 탈퇴: 열려 있던 링크는 바로 닫고(받는 사람은 더 이상 못 열고), Cron 이 R2 파일을 지운 뒤 기록도 지웁니다.
-- (auth.users 를 지우면 sd_shares 가 함께 지워져 R2 파일만 남는 일이 없도록 owner_id 를 비우고 표시만 해 둠)
alter table public.sd_shares add column if not exists orphaned_at timestamptz;
comment on column public.sd_shares.orphaned_at is '만든 회원이 탈퇴한 시각. 파일을 지운 뒤 기록도 바로 지움';
alter table public.sd_shares drop constraint if exists sd_shares_owner_id_fkey;
alter table public.sd_shares add constraint sd_shares_owner_id_fkey foreign key (owner_id) references auth.users (id) on delete set null;

create or replace function public.sd_on_user_deleted()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.sd_shares
     set orphaned_at = now(),
         closed_at = case when closed_at is null and expires_at > now() then now() else closed_at end,
         expires_at = least(expires_at, now())
   where owner_id = old.id;
  return old;
end;
$$;
drop trigger if exists sd_on_user_deleted on auth.users;
create trigger sd_on_user_deleted before delete on auth.users for each row execute function public.sd_on_user_deleted();
revoke all on function public.sd_on_user_deleted() from public, anon, authenticated;

-- 탈퇴 전 확인용 (WSNS 계정 화면): 내 쎈스드롭 링크 중 아직 열려 있는 것
create or replace function public.sd_my_open_shares()
returns table (id text, title text, expires_at timestamptz, file_count integer)
language sql stable security definer set search_path = '' as $$
  select s.id, s.title, s.expires_at, (select count(*)::int from public.sd_files f where f.share_id = s.id)
    from public.sd_shares s
   where s.owner_id = auth.uid() and s.expires_at > now() and s.closed_at is null
   order by s.expires_at desc;
$$;
revoke all on function public.sd_my_open_shares() from public, anon;
grant execute on function public.sd_my_open_shares() to authenticated;
