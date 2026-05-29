const express = require('express');
const path = require('path');
const { pool } = require('./db');
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

    const cleanTitle = text.trim();
    if (cleanTitle.length === 0) {
        return res.status(400).json({ error: 'Text is empty' });
    }

    try {
        const result = await pool.query(
            "INSERT INTO todos (title, status) VALUES ($1, 'pending') RETURNING *",
            [cleanTitle]
        );
        const newTodo = result.rows[0];

        await pool.query(
            "INSERT INTO actions (todo_id, action_type) VALUES ($1, 'created')",
            [newTodo.id]
        );

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
