import { NextResponse } from 'next/server';

export const config = {
  // Εφαρμόζεται ΜΟΝΟ στη σελίδα διαχείρισης και στο API ανεβάσματος
  matcher: ['/admin.html', '/api/manage-pdf'],
};

export default function middleware(request) {
  // Καλό είναι να τα βάλεις στο Vercel -> Environment Variables
  const USERNAME = process.env.ADMIN_USERNAME || 'admin';
  const PASSWORD = process.env.ADMIN_PASSWORD || 'pAH09G1mBYncJ2tYG';

  const basicAuth = request.headers.get('authorization');

  if (basicAuth) {
    const authValue = basicAuth.split(' ')[1];
    // Αποκωδικοποίηση Base64
    const [user, pwd] = atob(authValue).split(':');

    if (user === USERNAME && pwd === PASSWORD) {
      // Τα στοιχεία είναι σωστά -> Επιτρέπουμε την πρόσβαση
      return NextResponse.next();
    }
  }

  // Ζητάει από τον browser να εμφανίσει το παράθυρο σύνδεσης (Basic Auth)
  return new Response('Απαιτείται σύνδεση.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Secure Admin Area"',
    },
  });
}
