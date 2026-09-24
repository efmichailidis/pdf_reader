export const config = {
  matcher: ['/index.html', '/viewer.html', '/admin.html', '/api/manage-pdf'],
};

export default function middleware(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  const ALLOWED_DOMAIN = 'https://app.sklavenitismentor.gr';

  // --- ΕΛΕΓΧΟΣ 1: Πρόσβαση στο Viewer (Iframe Ή Κλικ από Admin) ---
  if (pathname === '/index.html' || pathname === '/viewer.html') {
    const fetchDest = request.headers.get('sec-fetch-dest');
    const referer = request.headers.get('referer') || '';

    // Ελέγχουμε αν το αίτημα προέρχεται από το admin.html
    const isFromAdmin = referer.includes('/admin.html');

    // ΑνΔΕΝ είναι σε iframe ΚΑΙ ΔΕΝ προέρχεται από το admin.html -> Μπλοκάρισμα
    if (fetchDest === 'document' && !isFromAdmin) {
      return new Response('⛔ Η πρόσβαση επιτρέπεται μόνο μέσω iframe ή από τη σελίδα Διαχείρισης (Admin).', {
        status: 403,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    return new Response(null, {
      status: 200,
      headers: {
        'x-middleware-next': '1',
        'Content-Security-Policy': `frame-ancestors 'self' ${ALLOWED_DOMAIN}`,
      },
    });
  }

  // --- ΕΛΕΓΧΟΣ 2: Basic Auth για Admin & API ---
  if (pathname === '/admin.html' || pathname.startsWith('/api/manage-pdf')) {
    const USERNAME = process.env.ADMIN_USERNAME || 'admin';
    const PASSWORD = process.env.ADMIN_PASSWORD || 'pAH09G1mBYncJ2tYG';

    const basicAuth = request.headers.get('authorization');

    if (basicAuth) {
      try {
        const authValue = basicAuth.split(' ')[1];
        const [user, pwd] = atob(authValue).split(':');

        if (user === USERNAME && pwd === PASSWORD) {
          return new Response(null, {
            headers: {
              'x-middleware-next': '1',
            },
          });
        }
      } catch (e) {}
    }

    return new Response('Απαιτείται σύνδεση.', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Secure Admin Area"',
      },
    });
  }

  return new Response(null, {
    headers: {
      'x-middleware-next': '1',
    },
  });
}
