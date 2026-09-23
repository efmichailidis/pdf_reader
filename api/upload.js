export const config = {
  api: {
    bodyParser: false, // Απαραίτητο για λήψη binary/PDF δεδομένων
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_REPO = process.env.GITHUB_REPO; // μορφή: "owner/repo"
  const FILE_PATH = 'assets/chart.pdf'; // Η διαδρομή του PDF μέσα στο repo σου
  const BRANCH = 'main';

  try {
    // 1. Συλλογή των bytes του PDF από το request
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const contentBase64 = buffer.toString('base64');

    // 2. Ανάκτηση του SHA του υπάρχοντος αρχείου (απαιτείται από το GitHub για update)
    const getFileRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${FILE_PATH}?ref=${BRANCH}`,
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );

    let sha = '';
    if (getFileRes.ok) {
      const fileData = await getFileRes.json();
      sha = fileData.sha;
    }

    // 3. Commit του νέου αρχείου στο GitHub
    const updateRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${FILE_PATH}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github.v3+json',
        },
        body: JSON.stringify({
          message: 'Update PDF via Admin Form',
          content: contentBase64,
          sha: sha || undefined, // Αν υπάρχει το αντικαθιστά, αλλιώς το δημιουργεί
          branch: BRANCH,
        }),
      }
    );

    if (!updateRes.ok) {
      const errorData = await updateRes.json();
      throw new Error(errorData.message || 'GitHub API commit failed');
    }

    return res.status(200).json({
      message: 'Το PDF ενημερώθηκε στο GitHub! Το Vercel ξεκίνησε νέο deployment.',
    });
  } catch (error) {
    console.error('Upload Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
