-- 받는 사람이 직접 칠 수 있게 링크 코드를 6글자(소문자 · 숫자)로 줄임: drop.wsns.studio/k3m9qr
alter table public.sd_shares drop constraint if exists sd_shares_id_check;
alter table public.sd_shares add constraint sd_shares_id_check check (id ~ '^[A-Za-z0-9]{6,16}$');
