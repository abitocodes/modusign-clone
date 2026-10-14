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

## 구조
- `src/app` — 라우트 (App Router). 인증 처리는 `src/proxy.ts`
- `src/components/ui` · `shell` · `pdf` · `editor` · `signature` …
- `src/lib` — Supabase 클라이언트, 타입, 메일, 감사 이력, PDF 완료 처리, 발송 파이프라인
- `supabase/migrations` — 스키마 + RLS
