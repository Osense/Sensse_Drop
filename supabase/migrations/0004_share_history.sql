-- 내 배포 기록: 링크가 닫혀도(시간이 다 되거나 직접 닫아도) 파일만 바로 지우고,
-- 제목 · 파일 이름 · 열람 / 내려받기 횟수 기록은 30일 동안 남겨 둡니다. 기록은 언제든 직접 지울 수 있어요.
alter table public.sd_shares add column if not exists closed_at timestamptz;
alter table public.sd_shares add column if not exists purged_at timestamptz;
alter table public.sd_shares add column if not exists open_count integer not null default 0;
alter table public.sd_files add column if not exists download_count integer not null default 0;

comment on column public.sd_shares.closed_at is '올린 사람이 시간 전에 직접 닫은 시각';
comment on column public.sd_shares.purged_at is '닫힌 뒤 R2 파일을 지운 시각. 이 시각부터 30일 뒤 기록도 지움';
comment on column public.sd_shares.open_count is '받는 사람이 비밀번호를 넣고 들어온 횟수';
comment on column public.sd_files.download_count is '받는 사람이 내려받은 횟수';

create index if not exists sd_shares_purged_idx on public.sd_shares (purged_at);

create or replace function public.sd_count_open(p_share text)
returns void language sql security definer set search_path = '' as $$
  update public.sd_shares set open_count = open_count + 1 where id = p_share;
$$;

create or replace function public.sd_count_download(p_share text, p_file text)
returns void language sql security definer set search_path = '' as $$
  update public.sd_files set download_count = download_count + 1 where id = p_file and share_id = p_share;
$$;

revoke all on function public.sd_count_open(text) from public, anon, authenticated;
revoke all on function public.sd_count_download(text, text) from public, anon, authenticated;
grant execute on function public.sd_count_open(text) to service_role;
grant execute on function public.sd_count_download(text, text) to service_role;
