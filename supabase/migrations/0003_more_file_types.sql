-- 한글 말고 다른 형식도 그대로 나눠 주기 (한글만 PDF로 변환). worker/src/file-types.ts 와 같은 목록.
alter table public.sd_files drop constraint if exists sd_files_ext_check;
alter table public.sd_files add constraint sd_files_ext_check check (ext in (
  'hwp','hwpx','pdf',
  'doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp','rtf','txt','csv','md',
  'jpg','jpeg','png','gif','webp','heic','heif','bmp',
  'zip','mp3','m4a','wav','mp4','mov'
));
