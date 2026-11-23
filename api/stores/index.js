import { google } from 'googleapis';

export default async function handler(req, res) {
  try {

    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim();
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
    
    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      'http://localhost' // Redirect URI
    );
    
    oauth2Client.setCredentials({
      refresh_token: refreshToken,
    });

    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: process.env.SPREADSHEET_ID,
      ranges: ['Καταστήματα!A1:Z', 'Εγκαταστάσεις!A1:Z'],
    });

    return res.status(200).json({
      items: {
        stores: response.data.valueRanges[0].values || [],
        facilities: response.data.valueRanges[1].values || []
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
