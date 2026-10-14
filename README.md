<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/opensign-logo-dark.svg">
    <img src="public/brand/opensign-logo-light.svg" alt="OpenSign" width="300" height="67">
  </picture>
</p>

<h3 align="center">서명 요청부터 완료 PDF·감사 추적 인증서까지,<br>팀 안에서 쓰는 오픈소스 전자서명</h3>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-ffcb4c?style=flat-square"></a>
  <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=nextdotjs&logoColor=white">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-149eca?style=flat-square&logo=react&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="Tailwind CSS v4" src="https://img.shields.io/badge/Tailwind-v4-06b6d4?style=flat-square&logo=tailwindcss&logoColor=white">
  <img alt="Supabase" src="https://img.shields.io/badge/Supabase-3ecf8e?style=flat-square&logo=supabase&logoColor=white">
  <a href="https://github.com/abitocodes/opensign/pulls"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-3ecf8e?style=flat-square"></a>
</p>

<p align="center">
  <b>한국어</b> · <a href="README.en.md">English</a>
</p>

<p align="center">
  <img src="docs/assets/opensign-demo.gif" alt="OpenSign 데모: 로그인, 서명 요청 전송, 서명자 서명, 완료까지" width="100%">
</p>

## 목차

- [소개](#소개)
- [주요 기능](#주요-기능)
- [빠르게 체험하기](#빠르게-체험하기)
- [구조](#구조)
- [서명 요청 흐름](#서명-요청-흐름)
- [문서 상태](#문서-상태)
- [기술 스택](#기술-스택)
- [로컬 개발](#로컬-개발)
- [환경 변수](#환경-변수)
- [배포](#배포)
- [프로젝트 구조](#프로젝트-구조)
- [스크립트와 테스트](#스크립트와-테스트)
- [보안](#보안)
- [알려진 제한](#알려진-제한)
- [기여하기](#기여하기)
- [라이선스](#라이선스)

## 소개

OpenSign은 **팀 안에서 쓰는 전자서명 웹 서비스**입니다. 직원은 아이디·비밀번호로 로그인해 문서를 올리고 서명을 요청하고, 외부 서명자는 계정 없이 메일로 받은 링크에서 본인 확인 후 서명합니다. 모든 서명이 끝나면 서명 값이 합쳐진 **완료 PDF**와 **감사 추적 인증서**(별도 PDF)가 만들어져 참여자에게 메일로 전달됩니다.

- **계정은 관리자가 만듭니다.** 공개 회원가입도, 소셜 로그인도 없습니다.
- **외부 서명자는 로그인하지 않습니다.** 메일 링크로 들어와 이메일 본인 확인(선택 비밀번호, 시도 횟수 제한)을 거칩니다.
- **요금제·결제·사용량 제한이 없습니다.** 직접 운영하는 Supabase 프로젝트 위에서 돌아갑니다.
- **모든 단계가 감사 이력으로 남습니다.** 생성·전송·열람·서명·거절·취소 이벤트와 접속 IP·브라우저 정보를 기록하고, 완료 PDF의 SHA-256 검증키를 남깁니다.
- **백엔드 없이도 체험할 수 있습니다.** `npm run dev:preview` 한 줄이면 가상 데이터로 모든 화면을 클릭해 볼 수 있습니다.

## 주요 기능

| 영역 | 내용 |
|---|---|
| 서명 요청 | 문서 업로드(PDF·이미지, 여러 파일 병합) → 참여자 설정(순서대로/순서없이, 서명/열람) → 입력란 배치(사인·도장, 텍스트, 체크박스, 날짜, 드롭다운, 따라쓰기, 이미지) → 요청 정보(유효 기한, 잠금, 첨부, 참조자, 라벨) → 즉시/예약 전송 |
| 서명자 화면 | 본인 확인 → 미리보기 → 입력란 작성(사인 그리기·사인 만들기·업로드, 도장 만들기) → 전자서명 동의 → 완료, 또는 서명 거절 |
| 완료 처리 | 서명 값이 합쳐진 완료 PDF + 감사 추적 인증서, 원본 검증키(SHA-256), 완료 메일(PDF 2개 첨부) |
| 문서 관리 | 문서함(상태별 필터·검색·정렬·진행 정보·리마인드·취소·라벨·숨기기·다운로드·CSV 추출), 홈 대시보드 |
| 반복 업무 | 템플릿, 대량전송, 링크서명, 내부결재·결재선, 맞춤 입력란, 주소록, 문서 편집기, 서식 작성기 |
| 관리 | 통합 설정: 기본 정보, 멤버(계정 생성·역할·비밀번호 초기화), 그룹, 감사 로그, 개인 설정 |

## 빠르게 체험하기

Docker도, Supabase 계정도, 메일 서버도 필요 없습니다. Node.js 20.9 이상만 있으면 됩니다.

```bash
git clone https://github.com/abitocodes/opensign.git
cd opensign
npm install
npm run dev:preview        # http://localhost:3100
```

서버 메모리 안의 **가짜 백엔드**가 인증·데이터베이스·스토리지·메일을 대신합니다. `supabase/migrations`의 스키마(기본값·NOT NULL·CHECK·UNIQUE·외래 키)를 그대로 읽어 같은 규칙으로 동작하고, "(샘플)" 문서·템플릿·주소록·결재 같은 가상의 데이터가 미리 들어 있습니다.

- **로그인**: 아무 아이디·비밀번호나 입력하면 데모 관리자로 로그인됩니다. 아이디 `minsu`·`seoyeon`은 그 멤버로 로그인됩니다.
- **메일**: 실제로 보내지 않고 `/dev/mailbox`(보낸 메일함)에만 기록합니다. 서명 요청·리마인드·완료 메일도 보낸 것처럼 화면이 진행됩니다.
- **초기화**: 서버를 다시 시작하거나 화면 왼쪽 아래 "미리보기 모드" 배지에서 "데모 데이터 초기화"를 누르면 처음 상태로 돌아갑니다.

<p align="center">
  <img src="docs/assets/preview-mode.svg" alt="같은 Next.js 앱이 NEXT_PUBLIC_PREVIEW_MODE 스위치에 따라 실제 Supabase·SMTP 또는 서버 메모리의 가짜 백엔드를 쓰며, 미리보기 전용 버튼은 미리보기 밖에서 빈 모듈로 바뀌고 /api/preview/* 는 404가 되는 과정을 보여 주는 다이어그램" width="100%">
</p>

외부 서명자가 실제로 서명하지 않아도 흐름을 끝까지 볼 수 있도록 미리보기 전용 버튼이 있습니다. 노란 점선 테두리로 구분됩니다.

| 위치 | 버튼 | 동작 |
|---|---|---|
| 모든 화면 왼쪽 아래 (휴대폰은 왼쪽 위) | 미리보기 모드 배지 | 보낸 메일함 보기, 데모 데이터 초기화, 서명을 기다리는 문서의 서명자 화면 열기 |
| 전송 완료 화면 · 문서함 행 펼침 · 문서 보기 | ○○ 서명자 화면 열기 | 메일 없이 그 참여자의 서명 화면(`/sign/…`)을 새 탭에서 엽니다 |
| 〃 (요청자·관리자) | 모든 서명자 서명 완료 처리 (미리보기) | 차례가 된 서명자부터 순서대로 임의 값으로 서명합니다. 완료 PDF·감사 추적 인증서·완료 메일까지 실제 서명과 같은 경로로 처리됩니다 |
| 서명자 본인 확인 화면 | 본인 확인 건너뛰기 (미리보기) | 초대받은 이메일(과 인증 비밀번호)로 본인 확인을 진행합니다 |
| 서명자 서명 화면 | 자동 입력 (미리보기) | 내 입력란을 모두 임의 값(사인 이미지, 텍스트, 날짜 …)으로 채웁니다 |

이 버튼과 가짜 백엔드는 **개발 서버에서만** 켜집니다(`NEXT_PUBLIC_PREVIEW_MODE=1` 이면서 `NODE_ENV`가 production이 아닐 때, [`src/lib/preview/flag.ts`](src/lib/preview/flag.ts)). `npm run build` 결과물과 일반 `npm run dev`에서는 `next.config.ts`가 미리보기 UI와 가짜 백엔드의 브라우저 클라이언트를 빈 모듈로 바꿔 끼우므로 번들에 들어가지 않고, `/api/preview/*`는 404를 돌려줍니다. 자세한 설계는 [`src/lib/preview/DESIGN.md`](src/lib/preview/DESIGN.md)에 있습니다.

## 구조

<p align="center">
  <img src="docs/assets/architecture.svg" alt="직원과 외부 서명자의 요청이 Next.js 앱의 proxy.ts를 거쳐 페이지·서버 액션으로 가고, 사용자 세션의 RLS 클라이언트와 service role 관리자 클라이언트로 Supabase Auth·Postgres·Storage를 쓰며, 서명 요청과 완료 메일은 SMTP로 나가는 OpenSign 구조도" width="100%">
</p>

- **`src/proxy.ts`** — 모든 요청에서 세션을 갱신하고 로그인 여부를 검사합니다. 공개 경로는 `/login`, `/sign/`, `/link/`, `/api/sign/` 뿐입니다.
- **Supabase 클라이언트는 두 종류입니다.** 기본은 로그인한 사용자의 세션으로 동작하는 RLS 클라이언트(`lib/supabase/server.ts`)입니다. service role 관리자 클라이언트(`lib/supabase/admin.ts`)는 서명자 토큰 흐름, 멤버 계정 관리, 메일·이력 기록처럼 **먼저 다른 방법으로 권한을 확인한 서버 코드**에서만 씁니다.
- **파일은 브라우저가 Storage로 직접 올립니다.** 비공개 버킷 `documents`에 워크스페이스 멤버십(RLS)으로 올리고, 서버는 저장 경로를 항상 id로 다시 만들어 씁니다.
- **서버 코드**: `lib/server/send.ts`(즉시·예약 전송, 기한 만료 처리), `lib/pdf/finalize.ts`(완료 PDF·감사 추적 인증서·SHA-256), `lib/email`(발송과 템플릿), `lib/events.ts`(감사 이력).
- **메일**: 모든 메일은 `outbound_emails` 테이블에도 기록됩니다. SMTP가 설정돼 있지 않으면 기록만 합니다.

## 서명 요청 흐름

<p align="center">
  <img src="docs/assets/signing-flow.svg" alt="요청자가 문서를 업로드하고 참여자·입력란·요청 정보를 설정해 전송하면, 서명자가 메일 링크로 본인 확인 후 입력·동의·서명하고(순서대로 요청은 다음 서명자로 반복, 거절 가능), 모두 서명하면 서버가 완료 PDF·감사 추적 인증서·SHA-256을 만들어 완료 메일로 보내는 흐름을 보여 주는 애니메이션 다이어그램" width="100%">
</p>

1. **준비** — 요청자가 문서를 올리고(Storage), 참여자와 입력란을 정하고, 유효 기한·참조자·라벨 같은 요청 정보를 입력합니다.
2. **전송** — `sendDocument`가 참여자마다 새 서명 토큰을 발급하고 서명 요청 메일을 보냅니다. 순서대로 요청은 첫 서명자에게만, 순서없이 요청은 모두에게 동시에 보냅니다.
3. **서명** — 서명자는 메일 링크 `/sign/[token]`을 열어 이메일 본인 확인(선택 비밀번호, 실패 시 잠금)을 거치고, 입력란을 채운 뒤 동의하고 서명합니다. 서명은 `sign_submit` RPC가 행 잠금과 함께 원자적으로 처리하며, 거절하면 `sign_reject`가 처리합니다. 순서대로 요청이면 다음 서명자에게 요청 메일이 갑니다.
4. **완료** — 마지막 참여자까지 끝나면 서버가 완료 PDF와 감사 추적 인증서를 만들고 SHA-256 검증키를 기록한 뒤, 두 PDF를 첨부한 완료 메일을 요청자·참조자·모든 참여자에게 보냅니다.

## 문서 상태

<p align="center">
  <img src="docs/assets/document-states.svg" alt="OpenSign 문서 상태(documents.status) 흐름도: 작성 중에서 즉시·예약 전송으로 진행 중이 되고, 완료·서명 거절·서명 취소(기한 만료)·요청 취소·수정 중으로 바뀌는 전이와 각 전이를 일으키는 함수, 그리고 참여자 상태(대기 중, 서명 필요, 완료 또는 거절)를 보여 줍니다" width="100%">
</p>

| `documents.status` | 문서함 표시 | 바뀌는 순간 |
|---|---|---|
| `draft` | 작성 중 | 업로드 직후. 예약 전송이 검증에 실패해도 이 상태로 돌아옵니다 |
| `scheduled` | 예약 | 예약 전송 설정(`scheduleSend`). 예약 시각이 지나면 `dispatchScheduled`가 전송합니다 |
| `in_progress` | 내 서명 필요 · 상대 서명 필요 · 내 열람 필요 · 상대 열람 필요 | `sendDocument`로 전송됨. 보는 사람에 따라 표시가 달라집니다 |
| `completed` | 완료 · 열람 완료 | 마지막 참여자까지 서명(열람)을 마침 |
| `rejected` | 서명 거절 | 서명자가 거절(`sign_reject`) |
| `signing_cancelled` | 서명 취소 | 서명 기한 만료(`expireOverdue`) |
| `request_cancelled` | 요청 취소 | 요청자·관리자가 취소(`doc_cancel_request`) |
| `on_modifying` | 수정 중 | 내용 수정(`doc_start_modify`). 다시 전송하면 서명 토큰이 새로 발급됩니다 |

## 기술 스택

| 영역 | 사용 기술 |
|---|---|
| 프레임워크 | Next.js 16 (App Router, Turbopack, `proxy.ts`) · React 19 |
| 언어·스타일 | TypeScript 5 · Tailwind CSS v4 (CSS 우선 설정, 디자인 토큰) |
| 백엔드 | Supabase — Auth(아이디/비밀번호) · Postgres(RLS·RPC) · Storage(비공개 버킷) |
| PDF | pdf.js(문서 보기) · pdf-lib + fontkit(완료 PDF·감사 추적 인증서) |
| 메일 | nodemailer (SMTP, 미설정 시 DB 기록만) |
| UI | lucide-react · sonner · Pretendard 글꼴 |
| 테스트 | playwright-core(시스템 Chrome) E2E · 미리보기 엔진 자체 테스트 |
| 배포 | Vercel 또는 Node 서버 |

## 로컬 개발

사전 준비: Node.js 20.9 이상, Docker Desktop(로컬 Supabase용)

```bash
git clone https://github.com/abitocodes/opensign.git
cd opensign
npm install
npx supabase start          # 로컬 Supabase: API :54321 · Studio :54323 · Mailpit :54324
cp .env.example .env.local  # `npx supabase status` 출력으로 값을 채웁니다 (SMTP_HOST=127.0.0.1, SMTP_PORT=54325)
npm run db:reset            # 마이그레이션 적용 + 테스트 계정 생성
npm run dev                 # http://localhost:3000
```

- 로컬 테스트 계정(개발용): `admin` / `Admin1234!`, `minsu` / `Test1234!`, `seoyeon` / `Test1234!`
- 로컬에서 보낸 메일은 Mailpit(http://127.0.0.1:54324)과 `/dev/mailbox`에서 확인합니다.
- `npm run seed`는 알려진 비밀번호의 계정을 만들기 때문에 **로컬이 아닌 Supabase 주소에서는 실행을 거부**합니다. 다른 env 파일을 쓰려면 `node scripts/seed.mjs --env <파일>`.

## 환경 변수

[`.env.example`](.env.example)을 `.env.local`로 복사해 채웁니다. 실제 값은 절대 커밋하지 마세요(`.env*`는 git에서 제외됩니다).

| 변수 | 필수 | 설명 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 예 | Supabase 프로젝트 URL (로컬: `http://127.0.0.1:54321`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 예 | publishable(anon) 키. 브라우저에 노출돼도 되며 RLS가 적용됩니다 |
| `SUPABASE_SERVICE_ROLE_KEY` | 예 | secret(service_role) 키. **서버 전용** — 절대 브라우저에 노출하지 마세요 |
| `SIGN_COOKIE_SECRET` | 권장 | 서명자 본인 확인 쿠키 키(32자 이상 무작위). 비우면 service role 키에서 파생합니다 |
| `NEXT_PUBLIC_APP_URL` | 선택 | 메일 링크에 쓰는 공개 URL. Vercel에서는 운영 도메인을 자동으로 사용합니다 |
| `TRUSTED_PROXY_HOPS`, `TRUSTED_IP_HEADER` | 선택 | 감사 추적의 접속 IP를 읽는 방법(아래 "자체 서버" 참고) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | 운영 시 | 비우면 메일을 발송하지 않고 `outbound_emails`에 기록만 합니다 |

## 배포

### Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fabitocodes%2Fopensign&env=NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,SIGN_COOKIE_SECRET&envDescription=Supabase%20keys%20and%20a%20random%20cookie%20secret&envLink=https%3A%2F%2Fgithub.com%2Fabitocodes%2Fopensign%2Fblob%2Fmain%2F.env.example&project-name=opensign&repository-name=opensign)

저장소에 [`vercel.json`](vercel.json)이 들어 있습니다. 서울 리전(`icn1`)을 쓰고, `main` 브랜치만 배포하며(미리보기 배포 없음) 프레임워크는 Next.js입니다.

1. [Supabase 클라우드 프로젝트](#supabase-클라우드-프로젝트)를 준비합니다.
2. 위 버튼을 누르거나 Vercel에서 저장소를 가져옵니다(Application Preset: Next.js).
3. **첫 배포 전에** 환경 변수를 넣습니다. `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SIGN_COOKIE_SECRET` 네 개를 **Production**에만 적용하고, 비밀 값은 Sensitive로 저장합니다. `NEXT_PUBLIC_*` 값은 빌드 때 번들에 들어가므로 바꾸면 다시 배포해야 합니다.
4. Deploy를 누릅니다. 이후 `main`에 push하면 자동으로 배포됩니다.
5. 외부 서명자에게 메일을 보내려면 `SMTP_*`도 설정합니다. 설정하지 않으면 메일은 발송되지 않고 DB에만 기록됩니다.

**추가 과금 없이 쓰려면**

- **Vercel Hobby** 요금제는 한도를 넘으면 초과분을 청구하지 않고 사용이 제한됩니다. 단, Hobby는 약관상 **비상업적 개인 용도**에만 쓸 수 있으니 회사 업무에 쓴다면 Pro와 Spend Management를 사용하세요.
- **Supabase Free** 요금제에서는 Spend cap이 켜져 있어(기본값) 한도를 넘어도 요금이 청구되지 않습니다. 대신 프로젝트가 느려지거나 읽기 전용이 될 수 있고, 한동안 쓰지 않으면 프로젝트가 일시 정지될 수 있습니다.
- 앱은 이미지 최적화·분석 같은 유료 기능을 쓰지 않고, 서버 기능은 서울 리전 한 곳에서만 실행됩니다.
- Supabase에서 **Allow new users to sign up을 꺼 두세요.** 가입을 막아 두면 봇이 계정을 만들 수 없습니다.

**알아 둘 점**: Vercel Functions는 요청 본문이 4.5 MB를 넘으면 413 오류를 돌려줍니다. 문서 파일은 브라우저가 Supabase Storage로 직접 올리므로 영향이 없지만, 서버 액션으로 보내는 값(서명 이미지 등)은 이 한도 안이어야 합니다. 감사 추적의 접속 IP는 Vercel이 `X-Forwarded-For`를 덮어쓰므로 기본값(`TRUSTED_PROXY_HOPS=1`)으로 정확히 기록됩니다. 명시하고 싶다면 `TRUSTED_IP_HEADER=x-vercel-forwarded-for`를 설정하세요.

### 자체 서버 (Node.js)

```bash
npm run build
npm run start               # 기본 포트 3000
```

nginx 같은 리버스 프록시 뒤에서 운영한다면 감사 추적의 접속 IP를 위해 둘 중 하나를 설정하세요. 프록시 없이 `next start`만 실행하면 클라이언트가 보낸 `X-Forwarded-For`를 걸러낼 수 없습니다.

- 프록시가 `X-Forwarded-For`에 주소를 **덧붙인다면** 프록시 개수를 `TRUSTED_PROXY_HOPS`로 지정합니다(기본 1 = 가장 오른쪽 항목).
- 프록시가 클라이언트 주소로 **덮어쓰는** 헤더(`x-real-ip` 등)가 있으면 `TRUSTED_IP_HEADER`로 그 이름을 지정합니다.

### Supabase 클라우드 프로젝트

1. Supabase 대시보드에서 프로젝트를 만들고 Authentication > Sign In / Providers 에서 **Allow new users to sign up을 끕니다.**
2. 스키마를 적용합니다. `npm run db:bundle`로 만든 `supabase/bundle.sql`을 SQL Editor에 붙여넣어 실행하거나, `npx supabase link --project-ref <ref>` 후 `npx supabase db push`를 사용합니다.
3. `.env.local`(또는 Vercel 환경 변수)에 Project URL, publishable(anon) 키, secret(service_role) 키를 넣습니다.
4. 첫 관리자 계정을 만듭니다.
   ```bash
   npm run create-admin -- --env .env.local --email you@example.com --username admin --name 관리자 --company 우리회사
   ```
   생성된 초기 비밀번호는 `admin-credentials.local.txt`(git 제외)에 저장됩니다. 첫 로그인 후 바꾸세요.
5. 이후 직원 계정은 로그인한 관리자가 **통합 설정 > 멤버**에서 만듭니다.

## 프로젝트 구조

```text
opensign/
├─ src/
│  ├─ app/                     App Router 라우트 (페이지 · 서버 액션 · 라우트 핸들러)
│  │  ├─ (auth)/login          로그인
│  │  ├─ workspaces/[wid]/     esign(홈 · 요청 · 문서함) · documents(위저드 · 뷰어) · settings · templates
│  │  ├─ sign/[token]          외부 서명자 화면
│  │  ├─ link/[token]          링크서명(공개)
│  │  ├─ api/                  문서 다운로드 · 서명자 API · 미리보기 API(개발 전용)
│  │  └─ dev/mailbox           보낸 메일함(관리자 전용)
│  ├─ components/              ui · shell · pdf · editor · signature · wizard · settings · preview …
│  ├─ lib/                     supabase 클라이언트 · server(send) · pdf(finalize) · email · events · preview(가짜 백엔드)
│  └─ proxy.ts                 세션 갱신 · 로그인 가드
├─ supabase/                   config.toml · migrations/ (스키마 + RLS + RPC)
├─ scripts/                    seed · create-admin · e2e · dev-preview · bundle-migrations
├─ public/                     글꼴 · pdf.js 워커 · 브랜드 로고
├─ docs/assets/                README 이미지 (데모 GIF · 모션 그래픽)
└─ vercel.json
```

## 스크립트와 테스트

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 (http://localhost:3000, 로컬 Supabase 필요) |
| `npm run dev:preview` | 백엔드 없는 미리보기 서버 (http://localhost:3100) |
| `npm run build` · `npm run start` | 프로덕션 빌드와 실행 |
| `npm run typecheck` · `npm run lint` | 타입 검사 · 린트 |
| `npm run db:reset` | 로컬 DB 초기화 + 마이그레이션 + 테스트 계정 |
| `npm run db:bundle` | 모든 마이그레이션을 `supabase/bundle.sql` 하나로 묶기 |
| `npm run create-admin` | 첫 관리자 계정 만들기 |
| `npm run test:preview-engine` | 가짜 백엔드 자체 테스트 (실제 마이그레이션과 앱의 모든 `select` 문 기준) |
| `npm run test:preview` | 가짜 계정으로 전체 화면을 클릭하는 E2E (시스템 Chrome 사용, `--headed`로 화면 보기) |
| `npm run test:e2e` | 업로드 → 전송 → 메일 → 서명 → 완료 메일(첨부 2개)까지 확인하는 E2E (로컬 Supabase 필요) |

## 보안

- 공개 회원가입이 없고, 로그인 뒤 이동 주소(`next`)는 같은 사이트 안으로만 허용합니다.
- **RLS**: 모든 테이블(26개)에 RLS가 켜져 있고 워크스페이스 멤버십 기반 정책을 둡니다. 서명자 토큰·인증 비밀번호·임시 입력값 컬럼은 RLS 클라이언트로 읽거나 쓸 수 없고, 권한을 확인한 서버 코드(service role)만 접근합니다.
- 서명·거절·취소·수정은 `sign_submit`·`sign_reject`·`doc_cancel_request`·`doc_start_modify` RPC가 **행 잠금과 함께 원자적으로** 처리하며, 문서 상태·차례·기한을 매번 다시 검사합니다. 다시 전송하면 서명 토큰이 새로 발급됩니다.
- 서명자 본인 확인 쿠키는 참여자 정보에 묶인 HMAC이고, 실패 횟수는 DB에서 세어 무차별 대입을 막습니다.
- 스토리지는 비공개 버킷과 서명 URL을 쓰고, 서버가 경로를 id로 다시 만들며(정규 경로 CHECK), 발송·완료 PDF는 덮어쓸 수 없습니다.
- PNG 압축 폭탄 검사, 메일 헤더 인젝션·ReDoS 방어, 감사 추적 IP는 신뢰할 수 있는 프록시가 설정한 값만 사용합니다.
- `/dev/mailbox`는 팀 워크스페이스의 소유자·관리자만 볼 수 있습니다.

보안 문제를 발견했다면 공개 이슈로 올리지 말고 저장소 소유자([@abitocodes](https://github.com/abitocodes))에게 비공개로 알려 주세요.

## 알려진 제한

- 카카오톡 전송, 문서 공유, 계약 리마인더 설정, AI 계약관리, 캐비닛 등 일부 메뉴는 화면만 있고 "준비 중"으로 표시됩니다.
- 운영에서 외부 서명자에게 메일을 보내려면 SMTP 설정이 필요합니다.
- Vercel에서는 서버 액션 요청 본문이 4.5 MB로 제한됩니다. 문서는 합친 결과 기준으로 최대 10 MB까지 올릴 수 있습니다.
- 미리보기 모드는 RLS를 흉내 내지 않고(모든 멤버가 데모 회사의 모든 데이터를 봄), 프로덕션 빌드에서는 켤 수 없습니다.
- OpenSign은 서명 절차와 증빙(감사 추적, 해시)을 제공하지만, 전자서명의 법적 효력과 증거력은 국가·계약 종류에 따라 다르며 이 문서는 법률 자문이 아닙니다.

## 기여하기

이슈와 풀 리퀘스트를 환영합니다.

```bash
git checkout -b feat/my-change
npm run typecheck && npm run lint && npm run test:preview-engine
npm run test:preview        # 화면을 바꿨다면 (미리보기 서버를 자동으로 띄웁니다)
npm run test:e2e            # 서명·메일·DB를 바꿨다면 (로컬 Supabase 필요)
```

- 커밋 메시지는 `feat:` · `fix:` · `chore:` 같은 [Conventional Commits](https://www.conventionalcommits.org/ko/) 형식을 씁니다.
- 화면의 글은 한국어입니다. 색은 하드코딩하지 말고 Tailwind 디자인 토큰 클래스(`bg-surface`, `text-fg`…)를, UI 조각은 `src/components/ui`를 재사용하세요.
- DB를 바꿀 때는 `supabase/migrations`에 **새 마이그레이션 파일**을 추가하고(이미 적용된 파일은 고치지 않습니다), RLS 정책을 함께 작성하세요.
- 새 RPC나 테이블을 쓰면 미리보기 모드의 가짜 백엔드(`src/lib/preview/rpc`)에도 같은 동작을 추가해야 `test:preview`가 통과합니다.
- 비밀 값은 절대 커밋하지 마세요. 저장소에는 `.env.example`만 있습니다.
- AI 코딩 에이전트를 위한 작업 규칙은 [`CLAUDE.md`](CLAUDE.md)에 있습니다.

## 라이선스

[MIT](LICENSE) © 2026 abitocodes

주요 의존성은 MIT · Apache-2.0(TypeScript, pdf.js, playwright-core) · ISC(lucide-react) · MIT-0(nodemailer) 라이선스이고, `public/fonts`에 포함된 Pretendard 글꼴은 [SIL Open Font License 1.1](https://github.com/orioncactus/pretendard/blob/main/LICENSE)을 따릅니다.
