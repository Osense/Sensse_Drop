-- 받는 사람에게 보일 안내 메시지 (자료 설명 · 인사말). 비밀번호를 넣은 뒤 파일 목록 위에 보입니다.
alter table public.sd_shares add column if not exists message text not null default '' check (char_length(message) <= 1000);
comment on column public.sd_shares.message is '받는 사람에게 보일 안내 메시지 (자료 설명 · 인사말). 비밀번호를 넣은 뒤에 보입니다.';
