# 쎈스드롭 (Sense Drop)

한글(HWP · HWPX) 파일을 올리면 **보이는 그대로 PDF로 바꿔**, 비밀번호 걸린 **링크 하나로** 나눠 주는 웹앱입니다. PDF · 오피스 문서 · 이미지 · 압축 · 음성 · 영상 파일은 그대로 함께 나눠 줄 수 있습니다 (`worker/src/file-types.ts`).
시험지 · 가정통신문처럼 여러 사람에게 같은 파일을 보내야 할 때, 한 장씩 PDF로 출력해 메신저로 보내던 일을 줄여 줍니다.
WSNS 쎈스 시리즈 · 무료.

- 주소: https://drop.wsns.studio (배포 후)
- 체험판 (서버 없음, 이 브라우저 안에서만 링크가 열림): https://osense.github.io/Sensse_Drop/
- 소개: https://wsns.studio/products/sense-drop/

## 쓰는 방법

1. **보내는 사람**: 파일을 끌어다 놓고 → 보내는 방식(PDF / PDF + 원본 / 원본) → 제목 · 비밀번호 · 자동 삭제 시간 → `공유 링크 만들기`
2. 링크(`drop.wsns.studio/k3m9qr` 처럼 6글자 코드라 직접 쳐도 됩니다)와 비밀번호를 메신저로 보내거나 QR 코드를 화면에 띄웁니다. (`링크 + 비밀번호 복사` 버튼)
3. **받는 사람**: 링크 → 비밀번호 → 파일을 누르면 바로 내려받습니다. 휴대폰에서도 됩니다.

| | 비회원 | WSNS 계정 로그인 |
|---|---|---|
| 한 번에 올리는 파일 | 2개 | 10개 |
| 파일 하나 용량 | 5MB | 20MB |
| 자동 삭제 | 10분 후만 | 10분 · 1시간 · 3일 · 7일 후 |
| 배포 기록 (열람 · 내려받기 횟수, 바로 닫기) | 이 기기에서만 | 어느 기기에서나 |

요금제(나그네 · 멤버십 · 프로)는 `worker/src/plans.ts` · `web/src/lib/plans.ts` 에 있습니다. 프로(연 9,900원)는 결제 연동 전이라 Supabase `sd_plans` 에 직접 넣어 켭니다 (migration 0005 주석 참고). 프로의 큰 파일(64MB 초과)은 R2 멀티파트로 32MB씩 나눠 올리고, 끊기면 같은 파일을 다시 골라 이어 올립니다. 구독이 끝나고 7일 유예가 지나면 Cron 이 멤버십 한도를 넘는 프로 링크를 닫고 파일을 지웁니다 (갱신 시 `enforced_at` 을 null 로).

회원 계정은 wsns.studio · 쎈스 초크 · 쎈스 스쿨과 같은 **WSNS 통합 계정**(Supabase Auth)입니다. 가입 · 비밀번호 찾기는 wsns.studio 에서 합니다.

## 구조

```
web/         화면 — Next.js 16 (정적 export) · Tailwind v4 · shadcn/ui · WSNS CI
worker/      Cloudflare Worker — /api/*, /s/<링크>, R2 파일, 만료 정리(Cron)
supabase/    Supabase WSNS 프로젝트 테이블 (sd_shares, sd_files)
wrangler.jsonc
```

- **변환은 올리는 사람의 브라우저에서** 합니다. 서버(컨테이너)가 변환하지 않아 Cloudflare 무료 플랜으로도 돌아갑니다.
  - [@rhwp/core](https://github.com/edwardkim/rhwp) (Rust + WebAssembly 한글 렌더러, MIT)로 쪽마다 그리고
  - 문서에 쓰인 글자에 맞춰 대체 웹폰트(나눔 · Noto, Google Fonts)를 먼저 받아 다시 조판한 뒤
  - 192dpi 그림으로 jsPDF 에 묶어 PDF 를 만듭니다 (`web/src/lib/convert.ts`).
- 파일: Cloudflare R2 `sense-drop-files` 버킷 (`shares/<링크>/<파일>.pdf|hwp|hwpx`). 정한 삭제 시간이 지나거나 직접 닫으면 링크는 바로 열리지 않고, 5분마다 도는 Cron 이 파일을 지웁니다. 제목 · 파일 이름 · 열람/내려받기 횟수 기록은 '배포 기록'에 30일 남았다가 지워집니다 (`HISTORY_DAYS`, migration 0004). 삭제 시간 선택지는 `worker/src/index.ts` 의 `EXPIRE_OPTIONS` · `GUEST_EXPIRE_MINUTES`.
- 링크 정보: Supabase WSNS 프로젝트의 `sd_shares`, `sd_files`. 브라우저는 직접 접근할 수 없고(RLS + 권한 회수) Worker 가 secret 키로만 읽고 씁니다.
- 받는 사람 비밀번호는 PBKDF2 해시로 저장하고, 맞으면 12시간짜리 서명 쿠키를 줍니다. 틀린 시도는 Cloudflare Rate Limiting(분당 10회)으로 막습니다.
- 한글 렌더러 WASM 은 28MB 라 Cloudflare 정적 파일 한도(25MB)를 넘습니다. 빌드할 때 gzip(약 10MB)으로 줄여 두고 Worker 가 `Content-Encoding: gzip` 으로 내보냅니다.

### 변환 품질과 한계 (중요)

- 한컴오피스가 아닌 오픈소스 렌더러라 **복잡한 문서는 원본과 다를 수 있습니다.** 특히 수식 · 글상자 · 겹친 개체 · 특수 글꼴(한컴 전용 글꼴)을 많이 쓴 시험지는 보내기 전에 `받는 화면 보기`로 PDF 를 열어 확인하세요.
- 한컴 글꼴(함초롬 · HY · 한컴바탕 등)은 나눔 · Noto 글꼴로 바꿔 그립니다. 글자 폭이 조금 달라 줄바꿈 위치가 바뀔 수 있습니다.
- PDF 는 쪽 그림(192dpi)이라 **글자 선택 · 검색이 되지 않고**, 원본보다 용량이 큽니다(쪽당 수십~수백 KB). 그래서 PDF 는 원본 한도의 4배까지 받습니다.
- 변환 중에는 창을 닫으면 안 됩니다. 실패한 파일은 링크 관리 화면의 ↻ 버튼으로 같은 파일이나 직접 만든 PDF 를 다시 올릴 수 있습니다.
- 암호가 걸린 HWP 는 열 수 없습니다.
- 원본과 완전히 같은 결과가 꼭 필요하면 한컴오피스에서 PDF 로 저장해 올리세요. PDF 는 그대로 전달됩니다.

## 개발

```bash
npm install && npm install --prefix web
npm run build          # web/out 생성 (rhwp WASM 을 web/public/vendor 로 복사)
npx wrangler dev       # http://localhost:8787
```

`SUPABASE_SECRET_KEY` 가 없으면 **개발 모드**로 돌아갑니다: 링크 정보는 메모리에, 파일은 로컬 R2 에 저장하고,
`Authorization: Bearer dev-member` 를 회원으로 봅니다. 공유 주소를 로컬로 만들려면 `.dev.vars` 에 `PUBLIC_URL=http://localhost:8787`.

## 체험판 (GitHub Pages)

서버를 붙이기 전에 전체 흐름(파일 올리기 → 변환 → 링크 · QR → 받는 화면 · 카운트다운)을 써 볼 수 있게, `main` 푸시마다 `.github/workflows/pages.yml` 이 `npm --prefix web run build:pages` 로 만든 정적 화면을 `gh-pages` 브랜치에 올립니다 (https://osense.github.io/Sensse_Drop/).
`NEXT_PUBLIC_STATIC_ONLY=1` 이면 `/api/*` 요청을 브라우저 안의 체험판 서버(`web/src/lib/mock-api.ts`, IndexedDB)가 받습니다. 만든 링크와 파일은 그 브라우저에만 저장돼 다른 기기 · QR 로는 열리지 않습니다. 로그인은 실제 WSNS 계정(Supabase)으로 됩니다.

## 배포 (Cloudflare Workers, GitHub Actions)

`main` 에 푸시하면 `.github/workflows/deploy.yml` 이 빌드 · 배포합니다. 저장소 Settings → Secrets and variables → Actions 에 넣을 값:

| 이름 | 어디서 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → "Edit Cloudflare Workers" 템플릿 + Account › Workers R2 Storage: Edit |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 대시보드 Workers & Pages 오른쪽의 Account ID |
| `SUPABASE_SECRET_KEY` | Supabase WSNS 프로젝트 → Project Settings → API Keys → secret 키 (`sb_secret_…`) |

- 첫 배포 때 R2 버킷 `sense-drop-files` 를 만들고, `drop.wsns.studio` 를 Worker 커스텀 도메인으로 붙입니다 (`wrangler.jsonc` 의 `routes`). wsns.studio 영역이 같은 Cloudflare 계정에 있어야 합니다. 다른 주소를 쓰려면 `routes` 와 `vars.PUBLIC_URL` 을 같이 바꾸세요.
- 비회원 · 회원 한도는 `wrangler.jsonc` 의 `vars` (`GUEST_MAX_FILES` 등)에서 바꿉니다. 화면은 `/api/config` 로 값을 받아 씁니다.
- 받는 사람 쿠키 서명 키는 기본으로 `SUPABASE_SECRET_KEY` 에서 만듭니다. 따로 두려면 `SESSION_SECRET` 시크릿을 추가하세요.

## Supabase

`supabase/migrations/0001_sense_drop.sql` — WSNS 프로젝트에 이미 적용되어 있습니다. 회원 탈퇴(`auth.users` 삭제) 시 그 회원의 링크 정보도 함께 지워지고, R2 파일은 보관 기간이 지나면 Cron 이 지웁니다.

## 라이선스 고지

- @rhwp/core — MIT, © Edward Kim (`web/public/vendor/rhwp.LICENSE.txt` 로 함께 배포)
- jsPDF — MIT · qrcode — MIT · lucide — ISC · Pretendard · Noto · 나눔 글꼴 — OFL
