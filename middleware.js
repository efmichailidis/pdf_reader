export const config = {
  // Ορίζουμε ρητά τις διαδρομές που θέλουμε να ελέγξουμε
  matcher: ['/index.html', '/viewer.html', '/admin.html', '/api/manage-pdf'],
};

export default function middleware(request) {
  // Χρήση του standard Web API URL
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Το εξωτερικό domain (ΧΩΡΙΣ slash στο τέλος)
  const ALLOWED_DOMAIN = 'https://app.sklavenitismentor.gr';

  // --- ΕΛΕΓΧΟΣ 1: CSP Header για τις σελίδες Viewer ---
  if (pathname === '/index.html' || pathname === '/viewer.html') {
    // Δημιουργούμε ένα standard Response προσθέτοντας το CSP Header
    return new Response(null, {
      status: 200,
      headers: {
        'x-middleware-next': '1', // Λέει στο Vercel να συνεχίσει κανονικά στη σελίδα
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
          // Συνέχεια στο επόμενο handler
          return new Response(null, {
            headers: {
              'x-middleware-next': '1',
            },
          });
        }
      } catch (e) {
        // Αν αποτύχει το atob, συνεχίζει στο 401
      }
    }

    // Αν τα στοιχεία είναι λάθος ή λείπουν -> 401 Unauthorized
    return new Response('Απαιτείται σύνδεση.', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Secure Admin Area"',
      },
    });
  }

  // Για οποιοδήποτε άλλο request, επιτρέπεται η προσπέλαση
  return new Response(null, {
    headers: {
      'x-middleware-next': '1',
    },
  });
}
