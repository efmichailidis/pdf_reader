import { google } from 'googleapis';

// Όνομα φύλλου (tab) και στήλες. Άλλαξέ τα από τα env αν χρειαστεί.
const SHEET_NAME = process.env.EVRETIRIO_SHEET?.trim() || 'Θεματολόγιον';
const RANGE = `'${SHEET_NAME.replace(/'/g, "''")}'!A1:Z`;

// Αντιστοίχιση επικεφαλίδων φύλλου -> πεδία JSON.
// Η στήλη βρίσκεται από την επικεφαλίδα της, όπου κι αν είναι στο φύλλο.
// exact: η επικεφαλίδα πρέπει να είναι ακριβώς αυτή, αλλιώς αρκεί να ξεκινάει έτσι.
const FIELDS = [
  { key: 'section', headers: ['ΕΝΟΤΗΤΑ'] },
  { key: 'subject', headers: ['ΘΕΜΑ'], exact: true },
  { key: 'owner',   headers: ['ΘΕΜΑΤΟΦΥΛΑΚΑΣ'], exact: true },
  { key: 'name',    headers: ['ΟΝΟΜΑΤΕΠΩΝΥΜΟ', 'ΟΝΟΜΑ'] },
  { key: 'phone',   headers: ['ΤΗΛΕΦΩΝΟ', 'ΤΗΛ'] },
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
  const used = new Set();
  for (const f of FIELDS) {
    let idx = -1;
    for (const h of f.headers.map(norm)) {
      idx = headers.findIndex((x, i) => !used.has(i) && (f.exact ? x === h : x.startsWith(h)));
      if (idx >= 0) break;
    }
    if (idx >= 0) used.add(idx);
    else console.warn(`evretirio: δεν βρέθηκε στήλη για "${f.key}". Επικεφαλίδες:`, headers);
    cols[f.key] = idx; // -1 = κενό πεδίο, ποτέ λάθος στήλη
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
      for (const f of FIELDS) item[f.key] = cols[f.key] >= 0 ? clean(row[cols[f.key]]) : '';
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
    // Όχι ολόκληρο το error: περιέχει το refresh token στο config.
    console.error('evretirio API error:', error.code || '', error.response?.data || error.message);
    return res.status(500).json({ error: 'Αποτυχία ανάγνωσης του Ευρετηρίου' });
  }
}
