export const config = {
  matcher: ['/index.html', '/viewer.html', '/admin.html', '/api/manage-pdf', '/evretirio_beta.html', '/chart.html'],
};

// Σύγκριση σταθερού χρόνου (στο Edge δεν υπάρχει node:crypto)
function safeEqual(a, b) {
  const x = String(a ?? ''), y = String(b ?? '');
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

function hasValidKey(url) {
  const expected = process.env.ACCESS_KEY;
  if (!expected) return false; // χωρίς ρύθμιση, κλειστό
  return safeEqual(url.searchParams.get('key'), expected);
}

export default function middleware(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  const ALLOWED_DOMAIN = 'https://app.sklavenitismentor.gr';

  // --- ΕΛΕΓΧΟΣ 1: Πρόσβαση στο Viewer (Iframe Ή Κλικ από Admin) ---
  if (pathname === '/index.html' || pathname === '/viewer.html' || pathname === '/evretirio_beta.html' || pathname === '/chart.html') {
    const fetchDest = request.headers.get('sec-fetch-dest');
    const referer = request.headers.get('referer') || '';

    // Ελέγχουμε αν το αίτημα προέρχεται από το admin.html
    const isFromAdmin = referer.includes('/admin.html');

    // ΑνΔΕΝ είναι σε iframe ΚΑΙ ΔΕΝ προέρχεται από το admin.html -> Μπλοκάρισμα
    if (fetchDest === 'document' && !isFromAdmin && !hasValidKey(url)) {
      return new Response('⛔ Δεν επιτρέπεται η πρόσβαση.', {
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
