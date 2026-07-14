const express = require('express');
const path = require('path');
const { pool } = require('./db');
const calendar = require('./calendar');
const { Anthropic } = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/api/stats', async (req, res) => {
    try {
        const { start, end } = req.query;
        let timeFilter = '';
        let actionTimeFilter = '';
        const params = [];

        if (start && end) {
            timeFilter = 'WHERE created_at >= $1 AND created_at <= $2';
            actionTimeFilter = 'WHERE action_at >= $1 AND action_at <= $2';
            params.push(start, end);
        }

        // 1. Completion Rate (TODO status distribution)
        const statusRes = await pool.query(`SELECT status, COUNT(*) as count FROM todos ${timeFilter} GROUP BY status`, params);
        const statusData = statusRes.rows;

        // 2. Action Trends
        const actionsRes = await pool.query(`SELECT action_type, DATE(action_at) as date, COUNT(*) as count FROM actions ${actionTimeFilter} GROUP BY action_type, DATE(action_at) ORDER BY date ASC`, params);
        const actionTrends = actionsRes.rows;

        // 3. Reschedule Ranking
        const reschedRes = await pool.query(`
            SELECT t.title, COUNT(a.id) as resched_count 
            FROM actions a 
            JOIN todos t ON a.todo_id = t.id 
            WHERE a.action_type = 'rescheduled' 
            ${start && end ? 'AND a.action_at >= $1 AND a.action_at <= $2' : ''}
            GROUP BY t.id, t.title 
            ORDER BY resched_count DESC LIMIT 5
        `, params);
        const rescheduleRanking = reschedRes.rows;

        // 4. Cancel Trend (Time slots)
        const cancelRes = await pool.query(`
            SELECT EXTRACT(HOUR FROM a.action_at) as hour, COUNT(*) as count 
            FROM actions a 
            WHERE a.action_type = 'cancelled'
            ${start && end ? 'AND a.action_at >= $1 AND a.action_at <= $2' : ''}
            GROUP BY hour 
            ORDER BY count DESC LIMIT 5
        `, params);
        const cancelTrend = cancelRes.rows;

        // 5. Claude Analysis
        const promptData = {
            statusData, actionTrends, rescheduleRanking, cancelTrend
        };
        
        const msg = await anthropic.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 500,
            system: "あなたはデータアナリストです。ユーザーのTODOデータを見て、事実に基づく傾向のみをフラットに指摘してください。心理的なカウンセリングや深い共感は一切不要です。「〇〇の時間帯にキャンセルが多いようです」「〇〇のタスクのリスケ回数が突出しています」など、データから読み取れる事実のみを2〜3文で簡潔に提示してください。データが少なすぎる場合はその旨を伝えてください。",
            messages: [
                { role: "user", content: `以下のデータから傾向を分析してください。\n\n${JSON.stringify(promptData)}` }
            ]
        });

        res.json({
            statusData,
            actionTrends,
            rescheduleRanking,
            cancelTrend,
            analysisText: msg.content[0].text
        });
    } catch (err) {
        console.error("API Error:", err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

const { EventEmitter } = require('events');
const macroEvent = new EventEmitter();

app.post('/api/macro-todo', async (req, res) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== process.env.API_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { text } = req.body;
    if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Bad Request' });
    }

    const titleText = text.trim();
    if (titleText.length === 0) {
        return res.status(400).json({ error: 'Text is empty' });
    }

    const shortcutMatch = titleText.match(/^(.*?)(?:[\s　]+)?(\d{4}|\d{6}|\d{8}|\d{12})$/);
    let isShortcutValid = false;
    let dateObj = null;
    let isoStr = '';
    let finalTitle = titleText;

    if (shortcutMatch) {
        finalTitle = shortcutMatch[1].trim();
        const inputStr = shortcutMatch[2];
        
        const now = new Date();
        const utc = now.getTime() + now.getTimezoneOffset() * 60000;
        const jstNow = new Date(utc + 9 * 3600000);

        let year = jstNow.getFullYear();
        let month = jstNow.getMonth() + 1;
        let day = jstNow.getDate();
        let hour = 0;
        let min = 0;

        if (inputStr.length === 4) {
            hour = parseInt(inputStr.substring(0, 2), 10);
            min = parseInt(inputStr.substring(2, 4), 10);
        } else if (inputStr.length === 6) {
            day = parseInt(inputStr.substring(0, 2), 10);
            hour = parseInt(inputStr.substring(2, 4), 10);
            min = parseInt(inputStr.substring(4, 6), 10);
        } else if (inputStr.length === 8) {
            month = parseInt(inputStr.substring(0, 2), 10);
            day = parseInt(inputStr.substring(2, 4), 10);
            hour = parseInt(inputStr.substring(4, 6), 10);
            min = parseInt(inputStr.substring(6, 8), 10);
        } else if (inputStr.length === 12) {
            year = parseInt(inputStr.substring(0, 4), 10);
            month = parseInt(inputStr.substring(4, 6), 10);
            day = parseInt(inputStr.substring(6, 8), 10);
            hour = parseInt(inputStr.substring(8, 10), 10);
            min = parseInt(inputStr.substring(10, 12), 10);
        }
        
        isoStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}T${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}:00+09:00`;
        dateObj = new Date(isoStr);
        
        if (!isNaN(dateObj.getTime()) && finalTitle.length > 0 && hour >= 0 && hour <= 23 && min >= 0 && min <= 59 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            isShortcutValid = true;
        } else {
            finalTitle = titleText;
        }
    }

    try {
        let newTodo;
        if (isShortcutValid) {
            const eventId = await calendar.addEvent(finalTitle, isoStr);
            const result = await pool.query(
                "INSERT INTO todos (title, status, scheduled_at, calendar_event_id) VALUES ($1, 'scheduled', $2, $3) RETURNING *",
                [finalTitle, dateObj.toISOString(), eventId]
            );
            newTodo = result.rows[0];

            await pool.query("INSERT INTO actions (todo_id, action_type) VALUES ($1, 'created')", [newTodo.id]);
            await pool.query("INSERT INTO actions (todo_id, action_type, action_at) VALUES ($1, 'scheduled', CURRENT_TIMESTAMP)", [newTodo.id]);
        } else {
            const result = await pool.query(
                "INSERT INTO todos (title, status) VALUES ($1, 'pending') RETURNING *",
                [finalTitle]
            );
            newTodo = result.rows[0];

            await pool.query("INSERT INTO actions (todo_id, action_type) VALUES ($1, 'created')", [newTodo.id]);
        }

        macroEvent.emit('newTodo', newTodo);
        res.status(201).json({ success: true, todo: newTodo });
    } catch (err) {
        console.error("Macro API DB Error:", err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

function startServer(port = 3000) {
    app.listen(port, "0.0.0.0", () => {
        console.log(`Web server listening on port ${port}`);
    });
}

module.exports = { startServer, macroEvent };
