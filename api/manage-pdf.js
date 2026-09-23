import jwt from 'jsonwebtoken';
import { parse } from 'cookie';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // --- ΕΛΕΓΧΟΣ AUTHENTICATION ---
  const cookies = parse(req.headers.cookie || '');
  const token = cookies.admin_token;

  if (!token) {
    return res.status(401).json({ error: 'Δεν έχετε δικαίωμα πρόσβασης. Παρακαλώ συνδεθείτε.' });
  }

  try {
    jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Μη έγκυρο ή ληγμένο session.' });
  }
  // -------------------------------

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_REPO = process.env.GITHUB_REPO;
  const BRANCH = 'main';

  const existingId = req.headers['x-pdf-id'];
  const docId = existingId || `doc-${Date.now()}`;
  const filePath = `public/uploads/${docId}.pdf`;

  try {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const contentBase64 = buffer.toString('base64');

    let sha = '';
    if (existingId) {
      const getFileRes = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}?ref=${BRANCH}`,
        {
          headers: {
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            Accept: 'application/vnd.github.v3+json',
          },
        }
      );
      if (getFileRes.ok) {
        const fileData = await getFileRes.json();
        sha = fileData.sha;
      }
    }

    const updateRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github.v3+json',
        },
        body: JSON.stringify({
          message: existingId ? `Update PDF: ${docId}` : `Create PDF: ${docId}`,
          content: contentBase64,
          sha: sha || undefined,
          branch: BRANCH,
        }),
      }
    );

    if (!updateRes.ok) {
      const errorData = await updateRes.json();
      throw new Error(errorData.message || 'GitHub commit failed');
    }

    const viewerUrl = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/viewer.html?id=${docId}`;

    return res.status(200).json({
      message: existingId ? 'Το PDF ενημερώθηκε!' : 'Νέο PDF δημιουργήθηκε!',
      id: docId,
      url: viewerUrl,
    });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
