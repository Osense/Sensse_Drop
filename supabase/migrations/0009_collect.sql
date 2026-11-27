-- 수합(과제 걷기) 링크: 교사가 링크를 주면 학생이 이름을 적고 파일을 올리고, 교사가 모두 모아 받습니다.
-- 나눠 주기 링크와 같은 표(sd_shares · sd_files)를 쓰고, 구분 칸과 학생 이름 칸만 더합니다.
-- 이 SQL 을 실행하기 전에도 기존 나눠 주기 링크는 그대로 동작합니다 (새 칸은 수합 링크에만 씀).

-- share: 나눠 주기 · collect: 수합
alter table public.sd_shares add column if not exists kind text not null default 'share';
alter table public.sd_shares drop constraint if exists sd_shares_kind_check;
alter table public.sd_shares add constraint sd_shares_kind_check check (kind in ('share', 'collect'));
-- 수합 설정: { "perPerson": 3, "nameLabel": "학번과 이름", "roster": ["홍길동", …], "deadline": "…", "closedAt": "…" }
alter table public.sd_shares add column if not exists collect jsonb;
comment on column public.sd_shares.kind is 'share: 나눠 주기 링크 · collect: 수합(과제 걷기) 링크';
comment on column public.sd_shares.collect is '수합 설정 (한 사람이 낼 파일 수, 이름 칸 안내, 학생 명단, 제출 마감, 마감한 시각)';

-- 수합 링크의 파일: 낸 학생 이름과, 그 학생이 자기 제출을 올리고 취소할 때 쓰는 토큰의 해시
alter table public.sd_files add column if not exists submitter text check (submitter is null or char_length(submitter) <= 40);
alter table public.sd_files add column if not exists submit_token_hash text;
comment on column public.sd_files.submitter is '수합 링크에서 파일을 낸 사람이 적은 이름';
comment on column public.sd_files.submit_token_hash is '수합 링크에서 낸 사람 브라우저가 가진 토큰의 SHA-256 (자기 제출 올리기 · 취소용)';
