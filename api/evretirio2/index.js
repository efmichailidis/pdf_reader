import { google } from 'googleapis';

// Όνομα φύλλου (tab). Διαβάζονται όλες οι στήλες του, όσα αρχεία κι αν προστεθούν.
const SHEET_NAME = process.env.EVRETIRIO2_SHEET?.trim() || 'Θεματολόγιο';
const RANGE = `'${SHEET_NAME.replace(/'/g, "''")}'`;

// Αντιστοίχιση επικεφαλίδων φύλλου -> πεδία JSON.
// exact: η επικεφαλίδα πρέπει να είναι ακριβώς αυτή, αλλιώς αρκεί να ξεκινάει έτσι.
const FIELDS = [
  { key: 'id',      headers: ['Α/Α', 'ΑΑ'], exact: true },
  { key: 'section', headers: ['ΕΝΟΤΗΤΑ'] },
  { key: 'subject', headers: ['ΘΕΜΑ'], exact: true },
  { key: 'owner',   headers: ['ΘΕΜΑΤΟΦΥΛΑΚΑΣ'], exact: true },
  { key: 'name',    headers: ['ΟΝΟΜΑΤΕΠΩΝΥΜΟ'] },
  { key: 'phone',   headers: ['ΤΗΛΕΦΩΝΟ', 'ΤΗΛ'] },
  { key: 'email',   headers: ['EMAIL', 'E-MAIL'] },
];

// Στήλες αρχείων: «Όνομα αρχείου N» και «Link N»
const FILE_NAME_RE = /^ΟΝΟΜΑ ΑΡΧΕΙΟΥ\s*(\d+)$/;
const FILE_LINK_RE = /^LINK\s*(\d+)$/;

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
  const used = new Set();

  // Πρώτα οι στήλες αρχείων, ώστε να μην τις «πάρει» κάποιο άλλο πεδίο
  const fileCols = {};
  headers.forEach((h, i) => {
    let m;
    if ((m = h.match(FILE_NAME_RE))) { (fileCols[m[1]] ||= {}).name = i; used.add(i); }
    else if ((m = h.match(FILE_LINK_RE))) { (fileCols[m[1]] ||= {}).link = i; used.add(i); }
  });

  const cols = {};
  for (const f of FIELDS) {
    let idx = -1;
    for (const h of f.headers.map(norm)) {
      idx = headers.findIndex((x, i) => !used.has(i) && (f.exact ? x === h : x.startsWith(h)));
      if (idx >= 0) break;
    }
    if (idx >= 0) used.add(idx);
    else if (!['id', 'email'].includes(f.key)) {
      console.warn(`evretirio: δεν βρέθηκε στήλη για "${f.key}". Επικεφαλίδες:`, headers);
    }
    cols[f.key] = idx; // -1 = κενό πεδίο, ποτέ λάθος στήλη
  }

  const files = Object.keys(fileCols)
    .sort((a, b) => a - b)
    .map((n) => ({ n, ...fileCols[n] }))
    .filter((f) => f.link !== undefined);

  return { cols, files };
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
    const spreadsheetId = process.env.SPREADSHEET2_ID;
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
    const { cols, files } = resolveColumns(headerRow);
    const cell = (row, idx) => (idx >= 0 ? clean(row[idx]) : '');

    const actions = [];
    dataRows.forEach((row, i) => {
      const item = {};
      for (const f of FIELDS) item[f.key] = cell(row, cols[f.key]);
      if (!item.subject) return; // κενές γραμμές ή γραμμές χωρίς θέμα
      if (!item.id) item.id = String(i + 1); // αν δεν υπάρχει στήλη Α/α

      item.files = files
        .map((f) => ({ name: cell(row, f.name ?? -1) || `Αρχείο ${f.n}`, url: cell(row, f.link) }))
        .filter((f) => /^https?:\/\//i.test(f.url));

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
