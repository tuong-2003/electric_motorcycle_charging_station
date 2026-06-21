require('dotenv').config();
const mysql = require('mysql2');

const db = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'ev_station',
    port: process.env.DB_PORT || 3306
});

db.query('SELECT station_id, name, status, max_current, temp_limit FROM stations', (err, results) => {
    if (err) {
        console.error('Error querying DB:', err.message);
    } else {
        console.log('STATIONS DATA FROM DB:');
        console.log(JSON.stringify(results, null, 2));
    }
    db.end();
});
