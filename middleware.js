import { NextResponse } from 'next/server';

export const config = {
  matcher: ['/admin.html', '/api/manage-pdf', '/index.html']
};

export default function middleware(request) {
  const { pathname } = request.nextUrl;
  const ALLOWED_DOMAIN = 'https://app.sklavenitismentor.gr'; // 👈 Το εξωτερικό domain

  // --- ΕΛΕΓΧΟΣ 1: Iframe Restrictions για το /viewer.html ---
  // if (pathname === '/' || pathname === '/index.html') {
  //   const response = NextResponse.next();

  //   // Ορίζουμε το CSP header χωρίς trailing slash
  //   response.headers.set(
  //     'Content-Security-Policy',
  //     `frame-ancestors 'self' ${ALLOWED_DOMAIN}`
  //   );

  //   return response;
  // }
  
  // --- ΕΛΕΓΧΟΣ 2: Basic Auth για το Admin & API ---
  const USERNAME = process.env.ADMIN_USERNAME || 'admin';
  const PASSWORD = process.env.ADMIN_PASSWORD || 'pAH09G1mBYncJ2tYG';

  const basicAuth = request.headers.get('authorization');

  if (basicAuth) {
    const authValue = basicAuth.split(' ')[1];
    const [user, pwd] = atob(authValue).split(':');

    if (user === USERNAME && pwd === PASSWORD) {
      return NextResponse.next();
    }
  }

  return new Response('Απαιτείται σύνδεση.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Secure Admin Area"',
    },
  });
}
