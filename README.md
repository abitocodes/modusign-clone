# OpenSign (사내 전자서명)

Next.js 16 · TypeScript · Tailwind CSS v4 · Supabase 로 만든 사내 전용 전자서명 서비스입니다.
다크 테마의 화면 구성을 갖췄고, 로고·일러스트는 모두 직접 제작한 원본입니다.

- 로그인: **아이디/비밀번호만** (공개 회원가입 없음 — 관리자가 통합 설정 > 멤버에서 직원 계정을 생성)
- 외부인은 로그인 없이 메일의 링크(`/sign/[token]`)로 본인 확인 후 서명
- 구독/결제/사용량 제한 없음

## 주요 기능
- 서명 요청: 문서 업로드(PDF·이미지, 여러 파일 병합) → 참여자 설정(순서대로/순서없이, 서명/열람) → 입력란 배치(사인·도장, 텍스트, 체크박스, 날짜, 드롭다운, 따라쓰기, 이미지) → 요청 정보(유효 기한, 잠금, 첨부, 참조자, 라벨) → 즉시/예약 전송
- 서명자 화면: 본인 확인 → 미리보기 → 입력란 작성(사인 그리기/사인 만들기/업로드, 도장 만들기) → 전자서명 동의 → 완료, 서명 거절
- 완료 처리: 서명 값이 합쳐진 완료 PDF + 감사 추적 인증서, 원본 검증키(SHA-256), 완료 메일(첨부)
- 문서함(상태별 필터·검색·정렬·진행 정보·리마인드·취소·라벨·숨기기·다운로드·CSV 추출), 홈 대시보드
- 템플릿(자주 쓰는 템플릿·사용하기), 대량전송, 링크서명
- 사인·도장, 내부결재/결재선, 맞춤 입력란, 주소록, 문서 편집기, 서식 작성기
- 통합 설정: 기본 정보, 멤버(계정 생성·역할·비밀번호 초기화), 그룹, 감사 로그, 개인 설정(비밀번호 변경)

## 로컬 개발
사전 준비: Node.js 20.9+, Docker Desktop

```bash
npm install
npx supabase start          # 로컬 Supabase (API :54321, Studio :54323, Mailpit :54324)
cp .env.example .env.local  # 값은 `npx supabase status` 출력으로 채우기 (SMTP_HOST=127.0.0.1, SMTP_PORT=54325)
npm run db:reset            # 마이그레이션 적용 + 테스트 계정 생성
npm run dev                 # http://localhost:3000
```

로컬 테스트 계정(개발용): `admin` / `Admin1234!`, `minsu` / `Test1234!`, `seoyeon` / `Test1234!`
로컬에서 보낸 메일은 Mailpit(http://127.0.0.1:54324) 과 `/dev/mailbox` 에서 확인합니다.

## 미리보기 모드 (백엔드 없이 화면 확인)
Supabase·Docker·SMTP 없이 모든 화면을 클릭해 볼 수 있는 데모 모드입니다.

```bash
npm install
npm run dev:preview         # http://localhost:3100 (빌드 출력 .next-preview — npm run dev 와 동시에 실행 가능)
```

- **로그인**: 아무 아이디·비밀번호나 입력하면 데모 관리자(최고 관리자)로 로그인됩니다. 아이디 `minsu`·`seoyeon`(또는 데모 멤버의 이메일)은 그 멤버로 로그인됩니다. 비밀번호 변경도 현재 비밀번호와 관계없이 진행됩니다.
- **데이터**: 서버 메모리의 가짜 백엔드(`src/lib/preview`)가 `supabase/migrations` 의 스키마(기본값·NOT NULL·CHECK·UNIQUE·외래 키)와 앱이 쓰는 Supabase 조회·저장·RPC·스토리지·인증을 흉내 냅니다. 가상의 데모 데이터(“(샘플)” 문서·템플릿·주소록·결재 등)가 미리 들어 있고, 서버를 다시 시작하거나 “데모 데이터 초기화”를 누르면 처음 상태로 돌아갑니다. RLS 는 흉내 내지 않습니다.
- **메일**: 실제로 보내지 않고 `/dev/mailbox`(보낸 메일함)에만 기록합니다. 서명 요청·리마인드·완료 메일도 보낸 것처럼 화면이 진행됩니다.
- **네트워크**: 외부에 접속하지 않습니다. Supabase 주소는 닫힌 로컬 포트로, SMTP 는 비활성으로 고정되어 `.env.local` 의 Supabase·SMTP 값이 쓰이지 않습니다.

미리보기 전용 버튼은 노란 점선 테두리와 “미리보기 전용” 표시로 구분됩니다.

| 위치 | 버튼 | 동작 |
|---|---|---|
| 모든 화면 왼쪽 아래 (휴대폰은 왼쪽 위) | 미리보기 모드 배지 | 보낸 메일함 보기, 데모 데이터 초기화, 서명을 기다리는 문서의 서명자 화면 열기 |
| 전송 완료 화면 · 문서함 행 펼침 · 문서 보기 | ○○ 서명자 화면 열기 | 메일 없이 그 참여자의 서명 화면(`/sign/…`)을 새 탭에서 엽니다 |
| 〃 (요청자·관리자) | 모든 서명자 서명 완료 처리 (미리보기) | 차례가 된 서명자부터 순서대로 임의 값으로 서명합니다. 완료 PDF·감사 추적 인증서·완료 메일까지 실제 서명과 같은 경로로 처리됩니다 |
| 서명자 본인 확인 화면 | 본인 확인 건너뛰기 (미리보기) | 초대받은 이메일(과 인증 비밀번호)로 본인 확인을 진행합니다 |
| 서명자 서명 화면 | 자동 입력 (미리보기) | 내 입력란을 모두 임의 값(사인 이미지, 텍스트, 날짜 …)으로 채웁니다. 이어서 입력 완료 → 동의하고 서명합니다 |

이 기능은 `npm run dev:preview` 에서만 켜집니다(`NEXT_PUBLIC_PREVIEW_MODE=1` 이면서 개발 모드, `src/lib/preview/flag.ts`).
`npm run build`(production)와 일반 `npm run dev` 에서는 `next.config.ts` 가 미리보기 UI(`@/components/preview`)와 가짜 백엔드의 브라우저 클라이언트를 빈 모듈로 바꿔 끼우므로 번들에 포함되지 않고, `/api/preview/*` 는 404 를 반환합니다.

```bash
npm run dev:preview          # (다른 터미널에서 실행 중일 때)
npm run test:preview         # 가짜 계정으로 전체 화면 클릭 E2E — 시스템 Chrome 사용, --headed 로 화면 보기
npm run test:preview-engine  # 가짜 백엔드 자체 테스트 (실제 마이그레이션과 앱의 모든 select 문 기준)
```

## Supabase 클라우드 프로젝트 연결
1. Supabase 대시보드에서 프로젝트 생성 → Authentication > Sign In / Providers 에서 **Allow new users to sign up 끄기**
2. 스키마 적용: `npm run db:bundle` → 생성된 `supabase/bundle.sql` 내용을 SQL Editor 에 붙여넣고 Run
   (또는 `npx supabase link --project-ref <ref>` 후 `npx supabase db push`)
3. `.env.local` 에 Project URL, publishable(anon) key, secret(service_role) key 입력 (`.env.example` 참고)
4. 첫 관리자 계정 생성:
   ```bash
   npm run create-admin -- --env .env.local --email you@company.com --username admin --name 관리자 --company 우리회사
   ```
   생성된 초기 비밀번호는 `admin-credentials.local.txt`(git 제외)에 저장됩니다. 첫 로그인 후 변경하세요.
5. 메일 발송이 필요하면 `.env.local` 의 SMTP_* 값을 설정합니다(미설정 시 `outbound_emails` 테이블에만 기록).
   실제 운영에서는 SMTP_* 를 반드시 설정하세요. `/dev/mailbox` 는 관리자용 디버깅 화면이며 서명 링크 전달 수단이 아닙니다.
6. `SIGN_COOKIE_SECRET`(32자 이상 임의 문자열)을 설정합니다(서명자 본인 확인 쿠키 키).
7. 감사 추적의 접속 IP는 신뢰할 수 있는 리버스 프록시가 설정한 값만 사용합니다. 앱 앞에 nginx 등 프록시를 두고
   `X-Forwarded-For` 에 주소를 덧붙이게 하거나(`TRUSTED_PROXY_HOPS`), 클라이언트 주소로 덮어쓰는 헤더를
   `TRUSTED_IP_HEADER` 로 지정하세요. 프록시 없이 `next start` 만 실행하면 클라이언트가 보낸 값을 걸러낼 수 없습니다.

## 구조
- `src/app` — 라우트 (App Router). 인증 처리는 `src/proxy.ts`
- `src/components/ui` · `shell` · `pdf` · `editor` · `signature` …
- `src/lib` — Supabase 클라이언트, 타입, 메일, 감사 이력, PDF 완료 처리, 발송 파이프라인
- `supabase/migrations` — 스키마 + RLS
