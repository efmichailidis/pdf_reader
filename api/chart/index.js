import { google } from 'googleapis';

// Φύλλο (tab) με το οργανόγραμμα: UNIT και PERSON γραμμές στο ίδιο φύλλο.
// Spreadsheet: ORGCHART_SPREADSHEET_ID, αλλιώς πέφτει στο SPREADSHEET2_ID.
const SHEET_NAME = process.env.ORGCHART_SHEET?.trim() || 'Δεδομένα Οργανογράμματος & Προσωπικού';
const RANGE = `'${SHEET_NAME.replace(/'/g, "''")}'`;

// Αντιστοίχιση επικεφαλίδων φύλλου -> πεδία JSON (ακριβής αντιστοίχιση μετά την κανονικοποίηση).
// Η κανονικοποίηση αφαιρεί τόνους, κάνει κεφαλαία και αντικαθιστά κενά/παύλες με "_",
// άρα "Parent ID", "parent-id" και "PARENT_ID" είναι το ίδιο.
const FIELDS = [
  { key: 'row_type',    headers: ['ROW_TYPE', 'ΤΥΠΟΣ_ΓΡΑΜΜΗΣ', 'ΤΥΠΟΣ'], required: true },
  { key: 'id',          headers: ['ID', 'Α/Α'], required: true },
  { key: 'parent_id',   headers: ['PARENT_ID', 'PARENT', 'ΓΟΝΕΑΣ'] },
  { key: 'unit_id',     headers: ['UNIT_ID', 'UNIT', 'ΜΟΝΑΔΑ'] },
  { key: 'title',       headers: ['TITLE', 'ΤΙΤΛΟΣ'] },
  { key: 'node_type',   headers: ['NODE_TYPE'] },
  { key: 'side',        headers: ['SIDE', 'ΠΛΕΥΡΑ'] },
  { key: 'order_index', headers: ['ORDER_INDEX', 'ORDER', 'ΣΕΙΡΑ'] },
  { key: 'color_theme', headers: ['COLOR_THEME', 'COLOR', 'ΧΡΩΜΑ'] },
  { key: 'full_name',   headers: ['FULL_NAME', 'ΟΝΟΜΑΤΕΠΩΝΥΜΟ'] },
  { key: 'job_title',   headers: ['JOB_TITLE', 'ΘΕΣΗ', 'ΙΔΙΟΤΗΤΑ'] },
  { key: 'is_head',     headers: ['IS_HEAD', 'ΕΠΙΚΕΦΑΛΗΣ'] },
  { key: 'email',       headers: ['EMAIL', 'E-MAIL', 'E_MAIL'] },
  { key: 'phone',       headers: ['PHONE', 'ΤΗΛΕΦΩΝΟ', 'ΤΗΛ'] },
  { key: 'description', headers: ['DESCRIPTION', 'ΠΕΡΙΓΡΑΦΗ'] },
  // { key: 'photo_url',   headers: ['PHOTO_URL', 'PHOTO', 'ΦΩΤΟΓΡΑΦΙΑ'] },
  { key: 'pdf_url',     headers: ['PDF_URL', 'PDF', 'LINK', 'URL', 'ΣΥΝΔΕΣΜΟΣ', 'ΑΡΧΕΙΟ'] },

];

const ROW_TYPES = {
  UNIT: 'UNIT', ΜΟΝΑΔΑ: 'UNIT',
  PERSON: 'PERSON', ΠΡΟΣΩΠΟ: 'PERSON', ΑΤΟΜΟ: 'PERSON', ΥΠΑΛΛΗΛΟΣ: 'PERSON',
};

const SIDES = { LEFT: 'left', RIGHT: 'right', ΑΡΙΣΤΕΡΑ: 'left', ΔΕΞΙΑ: 'right' };

const norm = (v) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/[\s-]+/g, '_')
    .toUpperCase();

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

function resolveColumns(headerRow) {
  const headers = (headerRow || []).map(norm);
  const used = new Set();
  const cols = {};

  for (const f of FIELDS) {
    let idx = -1;
    for (const h of f.headers.map(norm)) {
      idx = headers.findIndex((x, i) => !used.has(i) && x === h);
      if (idx >= 0) break;
    }
    if (idx >= 0) used.add(idx);
    else if (f.required) {
      console.warn(`orgchart: δεν βρέθηκε στήλη για "${f.key}". Επικεφαλίδες:`, headers);
    }
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

const isTruthy = (v) => ['ΝΑΙ', 'YES', 'TRUE', '1', 'Y', 'X'].includes(norm(v));

function buildActions(dataRows, cols) {
  const cell = (row, key) => (cols[key] >= 0 ? clean(row[cols[key]]) : '');
  const actions = [];
  const unitIds = new Set();
  let personSeq = 0;

  dataRows.forEach((row, i) => {
    const rowType = ROW_TYPES[norm(cell(row, 'row_type'))];
    if (!rowType) return; // κενές γραμμές ή άγνωστος τύπος

    if (rowType === 'UNIT') {
      const id = cell(row, 'id');
      const title = cell(row, 'title');
      if (!id || !title) {
        console.warn(`orgchart: γραμμή ${i + 2} (UNIT) χωρίς id ή title, παραλείπεται.`);
        return;
      }
      if (unitIds.has(id)) {
        console.warn(`orgchart: διπλό UNIT id "${id}" στη γραμμή ${i + 2}, παραλείπεται.`);
        return;
      }
      unitIds.add(id);

      const order = parseInt(cell(row, 'order_index'), 10);
      const side = SIDES[norm(cell(row, 'side'))] || '';
      const pdf = cell(row, 'pdf_url');
      
      actions.push({
        row_type: 'UNIT',
        id,
        parent_id: cell(row, 'parent_id'),
        unit_id: '',
        title,
        node_type: cell(row, 'node_type').toLowerCase(),
        side,
        order_index: Number.isNaN(order) ? '' : String(order),
        color_theme: cell(row, 'color_theme').toLowerCase(),
        full_name: '',
        job_title: '',
        is_head: '',
        email: cell(row, 'email'),
        phone: cell(row, 'phone'),
        description: cell(row, 'description') || null,
        // Μόνο http(s): τίποτα άλλο δεν θα έπρεπε να ανοίγει από κλικ
        pdf_url: /^https?:\/\//i.test(pdf) ? pdf : '',
      });
      return;
    }

    // PERSON
    const fullName = cell(row, 'full_name');
    const unitId = cell(row, 'unit_id') || cell(row, 'parent_id');
    if (!fullName || !unitId) {
      console.warn(`orgchart: γραμμή ${i + 2} (PERSON) χωρίς full_name ή unit_id, παραλείπεται.`);
      return;
    }
    personSeq += 1;
    const photo = cell(row, 'photo_url');

    actions.push({
      row_type: 'PERSON',
      id: cell(row, 'id') || `emp_${String(personSeq).padStart(3, '0')}`,
      parent_id: '',
      unit_id: unitId,
      title: '',
      node_type: '',
      side: '',
      order_index: '',
      color_theme: '',
      full_name: fullName,
      job_title: cell(row, 'job_title'),
      is_head: isTruthy(cell(row, 'is_head')) ? 'ΝΑΙ' : 'ΟΧΙ',
      email: cell(row, 'email'),
      phone: cell(row, 'phone'),
      description: null,
      photo_url: /^https?:\/\//i.test(photo) ? photo : null,
    });
  });

  // Έλεγχοι συνέπειας (μόνο προειδοποιήσεις στα logs, δεν χαλάνε την απάντηση)
  for (const a of actions) {
    if (a.row_type === 'UNIT' && a.parent_id && !unitIds.has(a.parent_id)) {
      console.warn(`orgchart: το UNIT "${a.id}" έχει άγνωστο parent_id "${a.parent_id}".`);
    }
    if (a.row_type === 'PERSON' && !unitIds.has(a.unit_id)) {
      console.warn(`orgchart: το PERSON "${a.id}" έχει άγνωστο unit_id "${a.unit_id}".`);
    }
  }

  return actions;
}

function isAllowed(req) {
  const site = req.headers['sec-fetch-site'];
  if (site) return site === 'same-origin';

  // Παλιότεροι browsers: έλεγχος Origin/Referer απέναντι στο host του ίδιου deployment
  const src = req.headers.origin || req.headers.referer;
  if (!src) return false;
  try { return new URL(src).host === req.headers.host; } catch { return false; }
}

export default async function handler(req, res) {
  if (!isAllowed(req)) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const auth = getAuth();
    const spreadsheetId = (process.env.ORGCHART_SPREADSHEET_ID)?.trim();
    if (!spreadsheetId) {
      console.error('orgchart API error: λείπει ORGCHART_SPREADSHEET_ID / SPREADSHEET2_ID');
      return res.status(500).json({ error: 'Λείπει η ρύθμιση του spreadsheet' });
    }
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
    const actions = buildActions(dataRows, cols);

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({
      project: SHEET_NAME,
      totalActions: actions.length,
      updatedAt,
      actions,
    });
  } catch (error) {
    // Όχι ολόκληρο το error: περιέχει το refresh token στο config.
    console.error('orgchart API error:', error.code || '', error.response?.data || error.message);
    return res.status(500).json({ error: 'Αποτυχία ανάγνωσης του Οργανογράμματος' });
  }
}
