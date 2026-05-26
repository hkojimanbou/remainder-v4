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

    // タイムゾーンのズレを確実に防ぐため、JSTのISO文字列を生成
    const formatJST = (d) => {
        const jst = new Date(d.getTime() + 9 * 3600000);
        return jst.toISOString().replace('.000Z', '+09:00');
    };

    const event = {
        summary: title,
        description: 'じぞー (Remainder v4.0) からのTODO予定化',
        start: { dateTime: formatJST(startDate), timeZone: 'Asia/Tokyo' },
        end: { dateTime: formatJST(endDate), timeZone: 'Asia/Tokyo' },
        reminders: { useDefault: true },
    };

    try {
        const res = await calendar.events.insert({ calendarId: 'primary', resource: event });
        return res.data.id;
    } catch (err) {
        console.error('カレンダー追加エラー (APIリクエスト失敗):', err.response?.data || err.message || err);
        return null;
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

    const formatJST = (d) => {
        const jst = new Date(d.getTime() + 9 * 3600000);
        return jst.toISOString().replace('.000Z', '+09:00');
    };

    const event = {
        summary: title,
        description: 'じぞー (Remainder v4.0) からのTODO予定化',
        start: { dateTime: formatJST(startDate), timeZone: 'Asia/Tokyo' },
        end: { dateTime: formatJST(endDate), timeZone: 'Asia/Tokyo' },
        reminders: { useDefault: true },
    };

    try {
        await calendar.events.update({ calendarId: 'primary', eventId: eventId, resource: event });
        return true;
    } catch (err) {
        console.error('カレンダー更新エラー (APIリクエスト失敗):', err.response?.data || err.message || err);
        return false;
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
