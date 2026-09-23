import jwt from 'jsonwebtoken';
import { serialize } from 'cookie';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username, password } = req.body;

  const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  const JWT_SECRET = process.env.JWT_SECRET;

  // Επαλήθευση των διαπιστευτηρίων
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Λανθασμένο username ή password' });
  }

  // Δημιουργία JWT Token (ισχύει για 8 ώρες)
  const token = jwt.sign({ user: username }, JWT_SECRET, { expiresIn: '8h' });

  // Αποθήκευση του Token σε ασφαλές HTTP-Only Cookie
  const cookieHeader = serialize('admin_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 60 * 60 * 8, // 8 ώρες
    path: '/',
  });

  res.setHeader('Set-Cookie', cookieHeader);
  return res.status(200).json({ success: true, message: 'Επιτυχής σύνδεση!' });
}
