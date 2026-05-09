const { pool } = require('./db');

async function initDB() {
    const createTodosTable = `
        CREATE TABLE IF NOT EXISTS todos (
            id SERIAL PRIMARY KEY,
            title TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status TEXT NOT NULL,
            scheduled_at TIMESTAMP,
            calendar_event_id TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;

    const createActionsTable = `
        CREATE TABLE IF NOT EXISTS actions (
            id SERIAL PRIMARY KEY,
            todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
            action_type TEXT NOT NULL,
            action_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            from_time TIMESTAMP,
            to_time TIMESTAMP,
            note TEXT
        );
    `;

    try {
        console.log("Connecting to PostgreSQL...");
        await pool.query(createTodosTable);
        console.log("todos table created or already exists.");
        
        await pool.query(createActionsTable);
        console.log("actions table created or already exists.");
        
        console.log("Database initialization completed successfully.");
    } catch (err) {
        console.error("Failed to initialize database:", err);
    } finally {
        await pool.end();
    }
}

initDB();
