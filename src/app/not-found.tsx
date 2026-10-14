import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-body-2 text-center">
      <p className="text-5xl font-bold text-fg-disabled">404</p>
      <h1 className="text-xl font-bold text-fg">페이지를 찾을 수 없습니다.</h1>
      <p className="text-sm text-fg-muted">주소가 잘못되었거나 접근 권한이 없는 페이지입니다.</p>
      <Link href="/" className="mt-2 inline-flex h-10 items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-fg hover:bg-primary-hover">
        홈으로
      </Link>
    </div>
  );
}
