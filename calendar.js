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
    if (!auth) return null;

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
        const res = await calendar.events.insert({ calendarId: 'primary', resource: event });
        return res.data.id;
    } catch (err) {
        console.error('カレンダー追加エラー:', err);
        return null;
    }
}

async function updateEvent(eventId, title, newStartTimeIso) {
    const auth = await getAuthClient();
    if (!auth) return false;

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
        await calendar.events.update({ calendarId: 'primary', eventId: eventId, resource: event });
        return true;
    } catch (err) {
        console.error('カレンダー更新エラー:', err);
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
