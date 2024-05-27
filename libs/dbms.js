const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db_path = path.join(__dirname, '..', 'databases', 'data.db');

// Подключение к базе данных
const db = new sqlite3.Database(db_path, sqlite3.OPEN_READWRITE, (err) => {
    if (err) return console.error(err.message);
});

// Функция для добавления данных в таблицу
function addData(file_name, file_format, full_datetime_start, full_datetime_end, priority) {
    return new Promise((resolve, reject) => {
        const sql = `INSERT INTO content_stream (file_name, file_format, full_datetime_start, full_datetime_end, priority) 
                     VALUES (?, ?, ?, ?, ?)`;
        db.run(sql, [file_name, file_format, full_datetime_start, full_datetime_end, priority], function(err) {
            if (err) {
                reject(err);
            }
            resolve(this.lastID);
        });
    });
}

// Функция для поиска объектов в заданном диапазоне времени
function searchOverlays(full_datetime_start, full_datetime_end) {
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT * FROM content_stream
            WHERE
                (full_datetime_start > ? AND full_datetime_start < ?) OR
                (full_datetime_end < ? AND full_datetime_end > ?) OR
                (full_datetime_start < ? AND full_datetime_end > ?) OR
                (full_datetime_start = ? OR full_datetime_end = ?)
        `;

        db.all(sql, 
            [full_datetime_start, full_datetime_end, 
            full_datetime_end, full_datetime_start, 
            full_datetime_start, full_datetime_end,
            full_datetime_start, full_datetime_end], 
            (err, rows) => {
            if (err) {
                reject(err);
            }
            resolve(rows);
        });
    });
}

function getData(id_element) {
    const sql = `SELECT * FROM content_stream WHERE id = ?`;
    return new Promise((resolve, reject) => {
        db.get(sql, [id_element], (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
}

function updateData(id, file_name, file_format, full_datetime_start, full_datetime_end, priority) {
    const sql = `
        UPDATE content_stream 
        SET 
            file_name = ?,
            file_format = ?,
            full_datetime_start = ?,
            full_datetime_end = ?,
            priority = ?
        WHERE id = ?
    `;
    return new Promise((resolve, reject) => {
        db.run(sql, [file_name, file_format, full_datetime_start, full_datetime_end, priority, id], function(err) {
            if (err) {
                reject(err);
            } else {
                resolve(this.lastID);
            }
        });
    });
}

// Функция для получения списка элементов, которые связаны с исходным файлом и начнут проигрываться только после нынешнего момента времени
function getLinksToFile(file_name, file_format, full_datetime_current) {
    const sql = `SELECT * FROM content_stream WHERE file_name = ? AND file_format = ? AND full_datetime_start > ?`;
    return new Promise((resolve, reject) => {
        db.all(sql, [file_name, file_format, full_datetime_current], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

// Функция для вывода полного списка данных в заданном диапазоне времени
function getListBeforeDatetime(full_datetime_end) {
    return new Promise((resolve, reject) => {
        const sql = `SELECT * FROM content_stream WHERE full_datetime_end < ?`;
        console.log(full_datetime_end);
        db.all(sql, [full_datetime_end], (err, rows) => {
            if (err) {
                reject(err);
            }
            resolve(rows);
        });
    });
}

// Функция для вывода полного списка данных
function getList() {
    return new Promise((resolve, reject) => {
        const sql = `SELECT * FROM content_stream`;
        db.all(sql, (err, rows) => {
            if (err) {
                reject(err);
            }
            resolve(rows);
        });
    });
}

// Функция для удаления данных из таблицы по ID
function deleteDataById(id) {
    return new Promise((resolve, reject) => {
        const sql = `DELETE FROM content_stream WHERE id = ?`;
        db.run(sql, [id], function(err) {
            if (err) {
                reject(err);
            }
            resolve(true);
        });
    });
}

function getPlaylist(full_datetime_current) {
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT *
            FROM content_stream
            WHERE full_datetime_start > ?
            ORDER BY datetime(full_datetime_start) - datetime(?)
        `;
        db.all(sql, [full_datetime_current, full_datetime_current], (err, result) => {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        });
    });
}

module.exports = {
    addData,
    searchOverlays,
    updateData,
    deleteDataById,
    getData,
    getList,
    getListBeforeDatetime,
    getLinksToFile,
    getPlaylist
};