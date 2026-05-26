const { google } = require('googleapis');

async function getAuthClient() {
    try {
        if (process.env.GOOGLE_TOKEN_JSON) {
            const credentials = JSON.parse(process.env.GOOGLE_TOKEN_JSON);
            return google.auth.fromJSON(credentials);
        }
        return null;
    } catch (err) {
        console.error('カレンダーの認証エラー:', err);
        return null;
    }
}

async function addEvent(title, startTimeIso) {
    const auth = await getAuthClient();
    if (!auth) {
        console.error('カレンダー追加エラー: 認証クライアントの取得に失敗しました (GOOGLE_TOKEN_JSONが未設定、または不正な形式です)。');
        return null;
    }

    const calendar = google.calendar({version: 'v3', auth});
    const startDate = new Date(startTimeIso);
    const endDate = new Date(startDate.getTime() + 15 * 60000); // 15分間

    const event = {
        summary: title,
        description: 'じぞー (Remainder v4.0) からのTODO予定化',
        start: { dateTime: startDate.toISOString(), timeZone: 'Asia/Tokyo' },
        end: { dateTime: endDate.toISOString(), timeZone: 'Asia/Tokyo' },
        reminders: { useDefault: true },
    };

    try {
        const res = await calendar.events.insert({ calendarId: 'primary', requestBody: event });
        return res.data.id;
    } catch (err) {
        const errMsg = err.response?.data?.error?.message || err.message || String(err);
        console.error('カレンダー追加エラー (APIリクエスト失敗):', errMsg);
        throw new Error(`Calendar API Error: ${errMsg}`);
    }
}

async function updateEvent(eventId, title, newStartTimeIso) {
    const auth = await getAuthClient();
    if (!auth) {
        console.error('カレンダー更新エラー: 認証クライアントの取得に失敗しました。');
        return false;
    }

    const calendar = google.calendar({version: 'v3', auth});
    const startDate = new Date(newStartTimeIso);
    const endDate = new Date(startDate.getTime() + 15 * 60000);

    const event = {
        summary: title,
        description: 'じぞー (Remainder v4.0) からのTODO予定化',
        start: { dateTime: startDate.toISOString(), timeZone: 'Asia/Tokyo' },
        end: { dateTime: endDate.toISOString(), timeZone: 'Asia/Tokyo' },
        reminders: { useDefault: true },
    };

    try {
        await calendar.events.update({ calendarId: 'primary', eventId: eventId, requestBody: event });
        return true;
    } catch (err) {
        const errMsg = err.response?.data?.error?.message || err.message || String(err);
        console.error('カレンダー更新エラー (APIリクエスト失敗):', errMsg);
        throw new Error(`Calendar API Error: ${errMsg}`);
    }
}

async function deleteEvent(eventId) {
    const auth = await getAuthClient();
    if (!auth) return false;

    const calendar = google.calendar({version: 'v3', auth});
    try {
        await calendar.events.delete({ calendarId: 'primary', eventId: eventId });
        return true;
    } catch (err) {
        console.error('カレンダー削除エラー:', err);
        return false;
    }
}

module.exports = { addEvent, updateEvent, deleteEvent };
