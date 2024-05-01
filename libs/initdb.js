const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const db_path = path.join(__dirname, '..', 'databases', 'data.db');

if (!fs.existsSync(db_path)) {
    console.log('Database not exist, creating new');

    // Создаем новый файл
    fs.writeFileSync(db_path, '');
    const db = new sqlite3.Database(db_path, sqlite3.OPEN_READWRITE, (err) => {
        if (err) return console.error(err.message);
    });
    let sql = `
    CREATE TABLE IF NOT EXISTS content_stream (
        id INTEGER PRIMARY KEY,
        file_name TEXT NOT NULL,
        file_format TEXT NOT NULL,
        full_datetime_start TEXT NOT NULL,
        full_datetime_end TEXT NOT NULL,
        priority INTEGER
    )
    `;

    db.run(sql, (err) => {
        if (err) {
            console.error('Error creating:', err.message);
        } else {
            console.log('Table create complete');
        }
    });
}




