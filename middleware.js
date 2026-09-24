import { NextResponse } from 'next/server';

export const config = {
  // Αφαιρέσαμε το '/' από το matcher για να αποφύγουμε το Error 500
  // Ορίζουμε ρητά τα routes που θέλουμε να ελέγξουμε
  matcher: ['/index.html', '/viewer.html', '/admin.html', '/api/manage-pdf'],
};

export default function middleware(request) {
  const { pathname } = request.nextUrl;
  
  // Χωρίς trailing slash στο τέλος
  const ALLOWED_DOMAIN = 'https://app.sklavenitismentor.gr';

  // --- ΕΛΕΓΧΟΣ 1: Iframe Restrictions για τις σελίδες προβολής ---
  if (pathname === '/index.html' || pathname === '/viewer.html') {
    const requestHeaders = new Headers(request.headers);
    const response = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });

    // Ορίζουμε το CSP header
    response.headers.set(
      'Content-Security-Policy',
      `frame-ancestors 'self' ${ALLOWED_DOMAIN}`
    );

    return response;
  }

  // --- ΕΛΕΓΧΟΣ 2: Basic Auth για το Admin & API ---
  if (pathname === '/admin.html' || pathname.startsWith('/api/manage-pdf')) {
    const USERNAME = process.env.ADMIN_USERNAME || 'admin';
    const PASSWORD = process.env.ADMIN_PASSWORD || 'pAH09G1mBYncJ2tYG';

    const basicAuth = request.headers.get('authorization');

    if (basicAuth) {
      try {
        const authValue = basicAuth.split(' ')[1];
        const [user, pwd] = atob(authValue).split(':');

        if (user === USERNAME && pwd === PASSWORD) {
          return NextResponse.next();
        }
      } catch (e) {
        // Αν αποτύχει το atob(), συνεχίζει στο 401
      }
    }

    return new Response('Απαιτείται σύνδεση.', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Secure Admin Area"',
      },
    });
  }

  return NextResponse.next();
}
