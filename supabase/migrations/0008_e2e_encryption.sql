-- 0008: 종단간 암호화 (파일 · 파일 이름을 보내는 사람 브라우저에서 잠가 올림)
-- 서버(Worker · DB · R2)는 비밀번호도, 파일을 푸는 열쇠도 갖지 않습니다.
-- enc 가 없는 링크는 예전 방식(평문) 링크로, 정한 시간이 지나면 그대로 사라집니다.

alter table public.sd_shares add column if not exists enc jsonb;
comment on column public.sd_shares.enc is
  '종단간 암호화 정보 {v, iter, salt, wrap, pv}. wrap = 비밀번호(+서버 pepper)로 감싼 링크 열쇠. 비밀번호 없이는 풀 수 없음';

alter table public.sd_files add column if not exists name_enc text check (name_enc is null or char_length(name_enc) <= 1200);
comment on column public.sd_files.name_enc is
  '링크 열쇠로 잠근 진짜 파일 이름. 이때 original_name 은 ''파일 1.hwp'' 같은 자리 표시';

-- password_hash 는 이제 비밀번호가 아니라 브라우저가 만든 확인용 값(authKey)의 해시입니다.
comment on column public.sd_shares.password_hash is
  '받는 사람 확인용 해시. 암호화 링크는 비밀번호 자체가 아니라 브라우저에서 PBKDF2 로 만든 authKey 의 해시';
