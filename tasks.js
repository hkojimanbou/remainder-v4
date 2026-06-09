const { google } = require('googleapis');

async function getAuthClient() {
    try {
        if (process.env.GOOGLE_TOKEN_JSON) {
            const credentials = JSON.parse(process.env.GOOGLE_TOKEN_JSON);
            return google.auth.fromJSON(credentials);
        }
        return null;
    } catch (err) {
        console.error('タスクの認証エラー:', err);
        return null;
    }
}

const listIdCache = {};

async function ensureTaskList(title) {
    if (listIdCache[title]) return listIdCache[title];

    const auth = await getAuthClient();
    if (!auth) return null;
    const service = google.tasks({ version: 'v1', auth });
    
    try {
        let nextPageToken = null;
        let foundId = null;
        
        // ページネーションで全リストを検索
        do {
            const res = await service.tasklists.list({
                pageToken: nextPageToken,
                maxResults: 100
            });
            const lists = res.data.items || [];
            const existing = lists.find(l => l.title === title);
            if (existing) {
                foundId = existing.id;
                break;
            }
            nextPageToken = res.data.nextPageToken;
        } while (nextPageToken);

        if (foundId) {
            listIdCache[title] = foundId;
            return foundId;
        }
        
        // なければ新規作成
        const createRes = await service.tasklists.insert({
            requestBody: { title: title }
        });
        listIdCache[title] = createRes.data.id;
        return createRes.data.id;
    } catch (err) {
        console.error('タスクリスト取得/作成エラー:', err.message);
        return null;
    }
}


async function addTaskToList(listId, title, isCompleted = false) {
    const auth = await getAuthClient();
    if (!auth || !listId) return false;
    const service = google.tasks({ version: 'v1', auth });
    
    const requestBody = { title: title };
    if (isCompleted) {
        requestBody.status = 'completed';
        requestBody.completed = new Date().toISOString();
    } else {
        requestBody.status = 'needsAction';
    }

    try {
        await service.tasks.insert({
            tasklist: listId,
            requestBody: requestBody
        });
        return true;
    } catch (err) {
        console.error('タスク追加エラー:', err.message);
        return false;
    }
}

module.exports = { ensureTaskList, addTaskToList };
