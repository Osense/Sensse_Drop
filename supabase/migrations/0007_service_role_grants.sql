-- 서버(Worker)가 secret 키(service_role)로 쎈스드롭 표를 읽고 쓸 수 있게 권한 주기.
-- 새로 만든 표에 권한이 저절로 붙지 않는 프로젝트 설정이라 직접 줍니다. (브라우저용 anon · authenticated 에는 주지 않음)
grant select, insert, update, delete on public.sd_shares, public.sd_files, public.sd_plans to service_role;
