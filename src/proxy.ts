import { jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/api/auth/login" || request.nextUrl.pathname.startsWith("/api/auth/passkeys/authentication/") || request.nextUrl.pathname === "/api/health" || request.nextUrl.pathname === "/offline" || request.nextUrl.pathname === "/sw.js" || request.nextUrl.pathname === "/manifest.webmanifest" || request.nextUrl.pathname.startsWith("/icons/")) return NextResponse.next();
  const token = request.cookies.get("meeting_session")?.value;
  try {
    if (!token || !process.env.SESSION_SECRET) throw new Error();
    const verified = await jwtVerify(token, new TextEncoder().encode(process.env.SESSION_SECRET), { algorithms: ["HS256"] });
    if (verified.payload.ver !== 2 || !verified.payload.jti) throw new Error();
    return NextResponse.next();
  } catch {
    if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
