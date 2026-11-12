import { google } from 'googleapis';

// Όνομα φύλλου (tab) και στήλες. Άλλαξέ τα από τα env αν χρειαστεί.
const SHEET_NAME = process.env.EVRETIRIO_SHEET?.trim() || 'Θεματολόγιο';
const RANGE = `'${SHEET_NAME.replace(/'/g, "''")}'!A1:E`;

// Αντιστοίχιση επικεφαλίδων φύλλου -> πεδία JSON.
// Αν δεν βρεθεί κάποια επικεφαλίδα, χρησιμοποιείται η θέση της στήλης (A–E).
const FIELDS = [
  { key: 'section', header: 'ΕΝΟΤΗΤΑ', fallback: 0 },
  { key: 'subject', header: 'ΘΕΜΑ', fallback: 1, exact: true },
  { key: 'owner',   header: 'ΘΕΜΑΤΟΦΥΛΑΚΑΣ', fallback: 2, exact: true },
  { key: 'name',    header: 'ΟΝΟΜΑΤΕΠΩΝΥΜΟ', fallback: 3 },
  { key: 'phone',   header: 'ΤΗΛΕΦΩΝΟ', fallback: 4 },
];

const norm = (v) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

function resolveColumns(headerRow) {
  const headers = (headerRow || []).map(norm);
  const cols = {};
  for (const f of FIELDS) {
    const h = norm(f.header);
    const idx = headers.findIndex((x) => (f.exact ? x === h : x.startsWith(h)));
    cols[f.key] = idx >= 0 ? idx : f.fallback;
  }
  return cols;
}

function getAuth() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID?.trim(),
    process.env.GOOGLE_CLIENT_SECRET?.trim(),
    'http://localhost'
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN?.trim() });
  return oauth2Client;
}

// Πότε άλλαξε τελευταία φορά το spreadsheet (θέλει Drive scope).
// Αν δεν επιτρέπεται, επιστρέφει null και η σελίδα απλώς δεν δείχνει ημερομηνία.
async function getModifiedTime(auth, spreadsheetId) {
  try {
    const drive = google.drive({ version: 'v3', auth });
    const { data } = await drive.files.get({
      fileId: spreadsheetId,
      fields: 'modifiedTime',
      supportsAllDrives: true,
    });
    return data.modifiedTime || null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const auth = getAuth();
    const spreadsheetId = process.env.SPREADSHEET_ID;
    const sheets = google.sheets({ version: 'v4', auth });

    const [valuesRes, updatedAt] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: RANGE,
        valueRenderOption: 'FORMATTED_VALUE', // κρατά τα τηλέφωνα όπως φαίνονται στο φύλλο
      }),
      getModifiedTime(auth, spreadsheetId),
    ]);

    const rows = valuesRes.data.values || [];
    const [headerRow, ...dataRows] = rows;
    const cols = resolveColumns(headerRow);

    const actions = [];
    dataRows.forEach((row, i) => {
      const item = { id: i + 1 }; // id = αριθμός γραμμής κάτω από τις επικεφαλίδες
      for (const f of FIELDS) item[f.key] = clean(row[cols[f.key]]);
      if (!item.subject) return; // κενές γραμμές ή γραμμές χωρίς θέμα
      actions.push(item);
    });

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({
      project: SHEET_NAME,
      totalActions: actions.length,
      updatedAt,
      actions,
    });
  } catch (error) {
    console.error('evretirio API error:', error);
    return res.status(500).json({ error: 'Αποτυχία ανάγνωσης του Ευρετηρίου' });
  }
}
