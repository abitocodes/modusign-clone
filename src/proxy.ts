import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { previewCookieSession } from "@/lib/preview/auth";
import { PREVIEW } from "@/lib/preview/flag";
import { PREVIEW_SESSION_COOKIE } from "@/lib/preview/types";

// /dev/mailbox shows live sign links: it is not public (admins only, see the page)
const PUBLIC_PREFIXES = ["/login", "/sign/", "/link/", "/api/sign/"];
// preview mode: the mock backend's routes authorise by the session cookie / URL signature themselves
const PREVIEW_PUBLIC_PREFIXES = ["/api/preview/"];

function isPublicPath(pathname: string, prefixes: string[]) {
  return prefixes.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p));
}

function redirectTo(request: NextRequest, pathname: string, search: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = search;
  return NextResponse.redirect(url);
}

/** preview mode (`npm run dev:preview`): the session is the mock backend's `mc_preview_uid` cookie */
function previewProxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = previewCookieSession(request.cookies.get(PREVIEW_SESSION_COOKIE)?.value);
  const isPublic = isPublicPath(pathname, [...PUBLIC_PREFIXES, ...PREVIEW_PUBLIC_PREFIXES]);
  if (session === "none" && !isPublic) {
    return redirectTo(request, "/login", pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`);
  }
  // only a verified session leaves the login page (an unverified one may belong to a lost account)
  if (session === "valid" && pathname === "/login") return redirectTo(request, "/", "");
  return NextResponse.next({ request });
}

export async function proxy(request: NextRequest) {
  if (PREVIEW) return previewProxy(request);
  // the mock backend's endpoints do not exist outside preview mode — for anyone, signed in or not
  // (the route handler answers 404 as well)
  if (isPublicPath(request.nextUrl.pathname, PREVIEW_PUBLIC_PREFIXES)) return new NextResponse("Not found", { status: 404 });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // Refreshes the auth token if needed. Do not run code between createServerClient and getUser().
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = isPublicPath(pathname, PUBLIC_PREFIXES);

  if (!user && !isPublic) {
    return redirectTo(request, "/login", pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`);
  }

  if (user && pathname === "/login") {
    return redirectTo(request, "/", "");
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|pdf.worker|fonts/|.*\.(?:svg|png|jpg|jpeg|gif|webp|woff2?|mjs)$).*)"],
};
