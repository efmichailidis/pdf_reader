import { v4 as uuidv4 } from 'crypto';

export const config = {
  api: {
    bodyParser: false, // Απαραίτητο για λήψη binary data
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_REPO = process.env.GITHUB_REPO; // e.g. "username/my-pdf-site"
  const BRANCH = 'main';

  // Διαβάζουμε το ID αν ο χρήστης θέλει να ενημερώσει υπάρχον (από το header)
  const existingId = req.headers['x-pdf-id'];
  const docId = existingId || `doc-${Date.now()}`;
  const filePath = `/assets/${docId}.pdf`;

  try {
    // 1. Συλλογή των bytes του PDF
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const contentBase64 = buffer.toString('base64');

    // 2. Αν πρόκειται για ενημέρωση, παίρνουμε το SHA του υπάρχοντος αρχείου
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

    // 3. Commit στο GitHub (Δημιουργία ή Ενημέρωση)
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

    const viewerUrl = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/index.html?id=${docId}`;

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
