require('dotenv').config(); // [MỚI] Load cấu hình từ file .env
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first'); // [FIX IPv6] Ép Node.js sử dụng IPv4, khắc phục triệt để lỗi ENETUNREACH của Gmail
const express = require('express');
const mqtt = require('mqtt');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer'); // [SỬA LẠI] Quay lại dùng Nodemailer cho Brevo/SendGrid
const path = require('path');

const app = express();
const port = process.env.PORT || 3000; // Lấy Port từ Cloud, nếu không có thì dùng 3000

// Khóa bí mật dùng để ký Token (Tuyệt đối không để lộ)
const SECRET_KEY = process.env.JWT_SECRET || 'khoa_bi_mat_cua_admin_tram_sac';

// Middleware để đọc dữ liệu JSON từ Client gửi lên
app.use(cors());
app.use(express.json());

// Phục vụ giao diện Web (Các file nằm trong thư mục 'public')
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// 1. CẤU HÌNH CƠ SỞ DỮ LIỆU MYSQL
// ==========================================
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'ev_station',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 3,
    queueLimit: 0,
    timezone: '+07:00' // Bổ sung cấu hình này để driver format đúng Date objects
});

// Thiết lập múi giờ cho mọi kết nối khi chúng được khởi tạo trong Pool
db.on('connection', (connection) => {
    connection.query("SET time_zone = '+07:00';", (err) => {
        if (err) console.error('⚠️ [MySQL] Lỗi set timezone cho kết nối mới:', err.message);
    });
});

db.getConnection((err, connection) => {
    if (err) {
        console.error('❌ [MySQL] Không thể kết nối! Chi tiết lỗi:', err.message);
    } else {
        console.log('🗄️ [MySQL] Đã kết nối tới Database thành công (Connection Pool)!');
        connection.release(); // Trả kết nối lại cho pool

        // [MỚI] Tự động tạo tài khoản Admin mặc định nếu chưa có
        const adminUser = process.env.ADMIN_USERNAME || 'Admin';
        const adminPass = process.env.ADMIN_PASSWORD || '@minad';
        const adminEmail = process.env.ADMIN_EMAIL || 'tuog678@gmail.com';

        db.query("SELECT id FROM users WHERE username = ?", [adminUser], async (err, results) => {
            if (!err && results.length === 0) {
                try {
                    const hashed = await bcrypt.hash(adminPass, 10);
                    db.query('INSERT INTO users (username, email, password, role, balance) VALUES (?, ?, ?, ?, 0)', [adminUser, adminEmail, hashed, 'admin'], (err) => {
                        if (!err) console.log(`👑 Đã khởi tạo tài khoản Admin mặc định: Tài khoản: ${adminUser} | Mật khẩu: ${adminPass}`);
                    });
                } catch (e) { console.error('Lỗi tạo admin mặc định', e); }
            } else if (!err && results.length > 0) {
                // Khong ghi de password Admin da ton tai; mat khau co the duoc doi tu web admin.
                db.query('UPDATE users SET email = ?, role = "admin" WHERE username = ?', [adminEmail, adminUser], (err) => {
                    if (err) console.error('Loi dong bo thong tin admin', err.message);
                });
            }
        });

        // [MỚI] Tự động tạo bảng lịch sử nạp tiền nếu chưa có
        const createTopupTable = `
        CREATE TABLE IF NOT EXISTS topup_history (
            id INT AUTO_INCREMENT PRIMARY KEY,
            transaction_id VARCHAR(100) UNIQUE,
            username VARCHAR(100) NOT NULL,
            amount INT NOT NULL,
            note TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );`;
        db.query(createTopupTable, (err) => {
            if (err) console.error('⚠️ [MySQL] Lỗi tạo bảng topup_history:', err.message);
            else {
                console.log('✅ [MySQL] Bảng topup_history đã sẵn sàng.');
                db.query("ALTER TABLE topup_history ADD COLUMN IF NOT EXISTS transaction_id VARCHAR(100) UNIQUE AFTER id", () => { });
            }
        });

        // Tự động kiểm tra và cập nhật cột status và activation_token cho bảng users
        db.query("SHOW COLUMNS FROM users LIKE 'status'", (err, results) => {
            if (!err && results.length === 0) {
                db.query("ALTER TABLE users ADD COLUMN status VARCHAR(50) DEFAULT 'active'", (err) => {
                    if (err) console.error("⚠️ [MySQL] Lỗi thêm cột status vào users:", err.message);
                });
            }
        });

        db.query("SHOW COLUMNS FROM users LIKE 'activation_token'", (err, results) => {
            if (!err && results.length === 0) {
                db.query("ALTER TABLE users ADD COLUMN activation_token VARCHAR(255) DEFAULT NULL", (err) => {
                    if (err) console.error("⚠️ [MySQL] Lỗi thêm cột activation_token vào users:", err.message);
                });
            }
        });

        // [MỚI] Tự động cập nhật thêm cột cấu hình cho bảng stations nếu chưa có
        db.query(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stations' AND COLUMN_NAME IN ('max_current', 'temp_limit')
        `, (err, results) => {
            if (err) {
                console.error("⚠️ [MySQL] Lỗi query INFORMATION_SCHEMA.COLUMNS:", err.message);
                loadStationConfigs();
            } else if (results) {
                const columns = results.map(r => r.COLUMN_NAME);
                const addPromises = [];
                if (!columns.includes('max_current')) {
                    addPromises.push(new Promise((resolve) => {
                        db.query("ALTER TABLE stations ADD COLUMN max_current INT NOT NULL DEFAULT 16", (err) => {
                            if (err) console.error("⚠️ [MySQL] Lỗi thêm cột max_current:", err.message);
                            else console.log("✅ [MySQL] Đã thêm cột max_current vào bảng stations.");
                            resolve();
                        });
                    }));
                }
                if (!columns.includes('temp_limit')) {
                    addPromises.push(new Promise((resolve) => {
                        db.query("ALTER TABLE stations ADD COLUMN temp_limit INT NOT NULL DEFAULT 65", (err) => {
                            if (err) console.error("⚠️ [MySQL] Lỗi thêm cột temp_limit:", err.message);
                            else console.log("✅ [MySQL] Đã thêm cột temp_limit vào bảng stations.");
                            resolve();
                        });
                    }));
                }

                if (addPromises.length > 0) {
                    Promise.all(addPromises).then(() => {
                        loadStationConfigs();
                    });
                } else {
                    loadStationConfigs();
                }
            } else {
                loadStationConfigs();
            }
        });
    }
});

// ==========================================
// THÔNG TIN GOOGLE APPS SCRIPT WEBHOOK (GỬI MAIL API REST)
// ==========================================
// Địa chỉ URL do Google cấp sau khi bạn Deploy Apps Script
const GAS_MAIL_URL = process.env.GAS_MAIL_URL || '';

const otpStorage = new Map(); // Lưu tạm mã OTP trong RAM (sẽ tự hủy nếu reset máy chủ)
const processingLocks = new Set(); // [CHỐNG SPAM/BẤM ĐÚP] Lock tạm thời cho các API POST

// [TỐI ƯU] Tự động dọn rác (Garbage Collection) các mã OTP hết hạn mỗi 10 phút để chống rò rỉ RAM
setInterval(() => {
    const now = Date.now();
    for (let [user, record] of otpStorage.entries()) {
        if (now > record.expires) otpStorage.delete(user);
    }
}, 600000);

// Hàm kiểm tra MX record của tên miền email để xác minh sự tồn tại của hòm thư
function verifyEmailDomain(email, callback) {
    const parts = email.split('@');
    if (parts.length !== 2) return callback(false);
    const domain = parts[1].toLowerCase();

    dns.resolveMx(domain, (err, addresses) => {
        if (err) {
            // ENOTFOUND: Tên miền không tồn tại
            // ENODATA: Tên miền tồn tại nhưng không cấu hình nhận mail (MX records)
            if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') {
                return callback(false);
            }
            // Các lỗi DNS khác (như timeout) thì tạm cho qua để tránh nghẽn hệ thống
            return callback(true);
        }

        if (!addresses || addresses.length === 0) {
            return callback(false);
        }

        // Kiểm tra xem có bản ghi MX hợp lệ nào không (Null MX RFC 7505 trả về exchange rỗng)
        const hasValidExchange = addresses.some(addr => addr.exchange && addr.exchange.trim() !== '');
        if (!hasValidExchange) {
            return callback(false);
        }

        callback(true);
    });
}

// Hàm xác thực email có tồn tại hay không bằng Abstract API (Fallback về DNS MX nếu hết quota hoặc không cấu hình key)
function verifyEmailExistence(email, callback) {
    const apiKey = process.env.ABSTRACT_API_KEY || '';
    if (!apiKey) {
        return verifyEmailDomain(email, callback);
    }

    const url = `https://emailvalidation.abstractapi.com/v1/?api_key=${apiKey}&email=${encodeURIComponent(email)}`;
    fetch(url)
        .then(res => {
            if (!res.ok) {
                throw new Error(`HTTP error ${res.status}`);
            }
            return res.json();
        })
        .then(data => {
            if (data.deliverability === 'UNDELIVERABLE' || (data.is_smtp_valid && data.is_smtp_valid.value === false)) {
                callback(false);
            } else {
                callback(true);
            }
        })
        .catch(err => {
            console.error('⚠️ [Abstract API] Lỗi hoặc hết quota, chuyển sang kiểm tra DNS MX:', err.message);
            verifyEmailDomain(email, callback);
        });
}

// ==========================================
// 2. CẤU HÌNH MQTT KẾT NỐI VỚI ESP32
// ==========================================
const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://broker.hivemq.com';
const client = mqtt.connect(MQTT_BROKER);

// [TỐI ƯU] Bộ nhớ đệm (RAM Cache) lưu trạng thái mới nhất của trạm
const liveDataCache = {};

// [MỚI] Bộ nhớ đệm lưu cấu hình dòng sạc và nhiệt độ cảnh báo của các trạm
const stationConfigCache = {};

function loadStationConfigs() {
    db.query('SELECT station_id, max_current, temp_limit, status FROM stations', (err, results) => {
        if (err) {
            console.error('⚠️ [Cache] Lỗi đồng bộ cấu hình trạm sạc:', err.message);
        } else if (results) {
            results.forEach(row => {
                stationConfigCache[row.station_id] = {
                    max_current: row.max_current,
                    temp_limit: row.temp_limit,
                    status: row.status
                };
            });
            console.log('📶 [Cache] Đã đồng bộ cấu hình trạm sạc vào RAM:', stationConfigCache);
        }
    });
}

// Dùng wildcard để hứng mọi tín hiệu từ mọi Tủ và mọi Ổ
const TOPIC_STATUS = 'ev_station/+/outlet/+/status';

client.on('connect', () => {
    console.log('🔗 [MQTT] Đã kết nối tới Broker thành công!');
    client.subscribe(TOPIC_STATUS, (err) => {
        if (!err) console.log(`📡 [MQTT] Đang lắng nghe ESP32 tại topic: ${TOPIC_STATUS}`);
    });
});

// Hứng dữ liệu ESP32 gửi lên
client.on('message', (topic, message) => {
    const parts = topic.split('/');
    if (parts.length === 5 && parts[0] === 'ev_station' && parts[4] === 'status') {
        try {
            const data = JSON.parse(message.toString());
            const stationId = parts[1];
            const outletId = parts[3];

            // Lưu dữ liệu vào Database MySQL
            const tempVal = data.temperature !== undefined ? data.temperature : null;
            const humVal = data.humidity !== undefined ? data.humidity : null;

            // [TỐI ƯU] Lưu vào RAM Cache siêu tốc
            if (!liveDataCache[stationId]) liveDataCache[stationId] = {};
            if (tempVal !== null) liveDataCache[stationId].temperature = tempVal;
            if (humVal !== null) liveDataCache[stationId].humidity = humVal;

            if (!liveDataCache[stationId].outletsData) liveDataCache[stationId].outletsData = {};
            liveDataCache[stationId].outletsData[outletId] = {
                voltage: data.voltage || 0,
                current: data.current || 0,
                power: data.power || 0,
                status: data.status || 'AVAILABLE'
            };

            const sql = 'INSERT INTO telemetry (station_id, status, voltage, current, power, temperature, humidity) VALUES (?, ?, ?, ?, ?, ?, ?)';
            db.query(sql, [`${stationId}.${outletId}`, data.status, data.voltage, data.current, data.power, tempVal, humVal], (err) => {
                if (err) console.error('⚠️ [MySQL] Lỗi ghi dữ liệu:', err.message);
            });

            // [MỚI] Kiểm tra bảo vệ quá tải và quá nhiệt từ cấu hình cache
            const config = stationConfigCache[stationId];
            if (config) {
                // 1. Kiểm tra quá dòng (overcurrent protection)
                if (data.current && data.current > config.max_current) {
                    console.warn(`🚨 [BẢO VỆ] Phát hiện quá dòng tại Tủ ${stationId} - Cổng ${outletId}: ${data.current}A (Giới hạn: ${config.max_current}A). Đang ngắt sạc khẩn cấp!`);

                    // Gửi lệnh ngắt sạc qua MQTT
                    client.publish(`ev_station/${stationId}/outlet/${outletId}/cmd`, JSON.stringify({ command: 'STOP_CHARGE' }));

                    // Chốt phiên sạc trong DB
                    db.query('SELECT user_id FROM charging_sessions WHERE station_id = ? AND status = "ongoing"', [`${stationId}.${outletId}`], (err, activeSessions) => {
                        if (!err && activeSessions && activeSessions.length > 0) {
                            processStopCharge(stationId, outletId, activeSessions[0].user_id, () => { });
                        }
                    });
                }

                // 2. Kiểm tra quá nhiệt (overtemperature protection)
                if (data.temperature && data.temperature > config.temp_limit) {
                    console.warn(`🚨 [BẢO VỆ] Phát hiện quá nhiệt tại Tủ ${stationId}: ${data.temperature}°C (Giới hạn: ${config.temp_limit}°C). Đang ngắt sạc toàn tủ!`);

                    // Gửi lệnh ngắt sạc qua MQTT cho cả 2 cổng
                    client.publish(`ev_station/${stationId}/outlet/1/cmd`, JSON.stringify({ command: 'STOP_CHARGE' }));
                    client.publish(`ev_station/${stationId}/outlet/2/cmd`, JSON.stringify({ command: 'STOP_CHARGE' }));

                    // Chốt toàn bộ phiên sạc đang sạc của trạm này
                    db.query('SELECT user_id, station_id FROM charging_sessions WHERE station_id LIKE ? AND status = "ongoing"', [`${stationId}.%`], (err, activeSessions) => {
                        if (!err && activeSessions) {
                            activeSessions.forEach(session => {
                                const outId = session.station_id.split('.')[1];
                                processStopCharge(stationId, outId, session.user_id, () => { });
                            });
                        }
                    });
                }
            }
        } catch (error) {
            // [BẢO VỆ] Bỏ qua gói tin lỗi, ngăn Node.js bị crash (sập server) nếu nhận chuỗi không phải JSON
        }
    }
});

// ==========================================
// 3. API ĐĂNG NHẬP & MIDDLEWARE BẢO MẬT
// ==========================================

// API Đăng nhập ảo
app.post('/api/login', (req, res) => {
    let { username, password, rememberMe } = req.body;

    // Tự động cắt bỏ dấu cách thừa do bàn phím điện thoại tự chèn vào
    if (username) username = username.trim();

    // [FIX] Thêm kiểm tra đầu vào để tránh lỗi không đáng có
    if (!username || !password) return res.status(400).json({ success: false, message: 'Vui lòng nhập đủ tài khoản và mật khẩu!' });

    // Truy vấn Database để tìm User
    const sql = 'SELECT * FROM users WHERE username = ?';
    db.query(sql, [username], async (err, results) => {
        if (err) {
            console.error('⚠️ [MySQL] Lỗi truy vấn:', err.message);
            return res.status(500).json({ success: false, message: 'Lỗi Server!' });
        }

        // Nếu không tìm thấy ai có username này
        if (results.length === 0) {
            return res.status(401).json({ success: false, message: 'Sai tài khoản hoặc mật khẩu!' });
        }

        const user = results[0]; // Lấy thông tin user tìm được

        if (user.status === 'pending') {
            return res.status(403).json({ success: false, message: 'Tài khoản chưa được kích hoạt! Vui lòng kiểm tra email để kích hoạt.' });
        }

        let isMatch = false;
        // Kiểm tra xem mật khẩu trong DB đã được mã hóa chưa (bcrypt hash thường bắt đầu bằng $2)
        if (user.password.startsWith('$2')) {
            isMatch = await bcrypt.compare(password, user.password);
        } else {
            // Mật khẩu cũ đang ở dạng chữ thường (plain text)
            isMatch = (password === user.password);
            // AUTO-MIGRATE: Nếu đúng, tự động mã hóa và cập nhật lại vào DB để lần sau an toàn hơn!
            if (isMatch) {
                const hashed = await bcrypt.hash(password, 10);
                db.query('UPDATE users SET password = ? WHERE id = ?', [hashed, user.id]);
                console.log(`🔐 Đã tự động mã hóa mật khẩu cho user: ${username}`);
            }
        }

        if (isMatch) {
            const expireTime = rememberMe ? '30d' : '1d';
            const token = jwt.sign({ id: user.id, role: user.role, username: user.username }, SECRET_KEY, { expiresIn: expireTime });
            res.json({ success: true, token: token, message: `Đăng nhập thành công! Xin chào ${user.role} ${user.username}` });
        } else {
            res.status(401).json({ success: false, message: 'Sai tài khoản hoặc mật khẩu!' });
        }
    });
});

// API Yêu cầu cấp lại mật khẩu (Gửi OTP qua Email)
app.post('/api/forgot-password', (req, res) => {
    let { username, email } = req.body;
    if (username) username = username.trim();
    if (email) email = email.trim();

    if (!username || !email) return res.status(400).json({ success: false, message: 'Vui lòng điền cả Tài khoản và Email hợp lệ!' });

    // Tăng bảo mật chống SPAM: Bắt buộc cung cấp CHÍNH XÁC cặp Username và Email liên kết
    db.query('SELECT id, username, email FROM users WHERE username = ? AND email = ?', [username, email], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Lỗi Database' });
        if (results.length === 0) return res.status(404).json({ success: false, message: 'Thông tin Tài khoản và Email không khớp hoặc không tồn tại!' });

        const userEmail = results[0].email;
        const actualUsername = results[0].username;

        const otpKey = actualUsername.toLowerCase();

        // [CHỐNG SPAM] Kiểm tra trạng thái Request của user để tránh việc spam nút Gửi OTP
        const existingRecord = otpStorage.get(otpKey);
        if (existingRecord && existingRecord.nextRequestAvailable > Date.now()) {
            const waitTime = Math.ceil((existingRecord.nextRequestAvailable - Date.now()) / 1000);
            return res.status(429).json({ success: false, message: `Hệ thống vừa gửi OTP xong. Vui lòng chờ ${waitTime} giây nữa trước khi yêu cầu gửi lại!` });
        }

        // Tạo mã OTP ngẫu nhiên (6 chữ số)
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        // Cập nhật Storage: OTP sống 5 phút, nhưng thêm Cooldown (khóa Request) 60 giây chống Spam
        otpStorage.set(otpKey, {
            otp,
            expires: Date.now() + 5 * 60 * 1000,
            nextRequestAvailable: Date.now() + 60 * 1000
        });

        const maskEmailStr = userEmail.replace(/(.{1})(.*)(?=@)/, (match, p1, p2) => p1 + '*'.repeat(p2.length));

        if (!GAS_MAIL_URL) {
            console.error('⚠️ Cảnh báo: Chưa cấu hình biến môi trường GAS_MAIL_URL!');
            return res.status(500).json({ success: false, message: 'Lỗi: Hệ thống gửi mail chưa được cấu hình (Thiếu Webhook URL)' });
        }

        const payload = {
            to: userEmail,
            subject: `Hệ thống Trạm Sạc - Mã OTP của bạn là ${otp}`,
            htmlBody: `<p>Chào ${actualUsername},</p><p>Mã OTP khôi phục mật khẩu của bạn là: <strong style="font-size:18px; color: #3498db;">${otp}</strong></p><p>Lưu ý: Mã này chỉ có hiệu lực trong vòng 5 phút.</p>`
        };

        // Bắn API sang Google Apps Script qua HTTPS (Port 443 - Chuẩn REST API không bao giờ bị Render chặn)
        fetch(GAS_MAIL_URL, {
            method: 'POST',
            body: JSON.stringify(payload)
        })
            .then(response => response.json())
            .then(data => {
                if (data.status === 'success') {
                    res.json({ success: true, message: `Mã OTP đã được gửi về: ${maskEmailStr}` });
                } else {
                    console.error('⚠️ [Google API] Lỗi từ Webhook:', data.message);
                    res.status(500).json({ success: false, message: 'Google Server từ chối lệnh gửi mail!' });
                }
            })
            .catch(error => {
                console.error('⚠️ [Google API] Fetch thất bại:', error.message);
                res.status(500).json({ success: false, message: 'Lỗi văng kết nối mạng nội bộ đến Google Server.' });
            });
    });
});

// API Đặt lại mật khẩu mới bằng OTP
app.post('/api/reset-password', async (req, res) => {
    let { username, otp, newPassword } = req.body;
    if (username) username = username.trim();

    // Tìm chính xác username gốc (phòng trường hợp người dùng nhập email ở bước trước)
    db.query('SELECT username FROM users WHERE username = ? OR email = ?', [username, username], async (err, results) => {
        if (err || results.length === 0) return res.status(400).json({ success: false, message: 'Không tìm thấy tài khoản!' });

        const actualUsername = results[0].username;
        const otpKey = actualUsername.toLowerCase();

        const record = otpStorage.get(otpKey);
        if (!record) return res.status(400).json({ success: false, message: 'OTP đã hết hạn hoặc chưa được yêu cầu!' });
        if (Date.now() > record.expires) { otpStorage.delete(otpKey); return res.status(400).json({ success: false, message: 'Mã OTP đã hết hạn (quá 5 phút)!' }); }
        if (record.otp !== otp) return res.status(400).json({ success: false, message: 'Mã OTP không chính xác!' });
        if (!newPassword || newPassword.length < 6) return res.status(400).json({ success: false, message: 'Mật khẩu mới phải từ 6 ký tự!' });

        const hashed = await bcrypt.hash(newPassword, 10);
        db.query('UPDATE users SET password = ? WHERE username = ?', [hashed, actualUsername], (err) => {
            if (err) return res.status(500).json({ success: false, message: 'Lỗi cập nhật DB' });
            otpStorage.delete(otpKey); // Dọn rác
            res.json({ success: true, message: 'Đổi mật khẩu thành công!' });
        });
    });
});

// API Yêu cầu gửi OTP đăng ký tài khoản mới (Chỉ gửi nếu tài khoản/email chưa tồn tại)
app.post('/api/register/send-otp', (req, res) => {
    let { username, email } = req.body;
    if (username) username = username.trim();
    if (email) email = email.trim();

    if (!username || !email) {
        return res.status(400).json({ success: false, message: 'Vui lòng cung cấp cả Tài khoản và Email!' });
    }

    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ success: false, message: 'Địa chỉ Email không hợp lệ!' });
    }

    // Kiểm tra xem Username hoặc Email đã tồn tại chưa
    verifyEmailExistence(email, (isValidDomain) => {
        if (!isValidDomain) {
            return res.status(400).json({ success: false, message: 'Tên miền Email không tồn tại hoặc không thể nhận thư!' });
        }

        db.query('SELECT username, email, status FROM users WHERE username = ? OR email = ?', [username, email], (err, results) => {
            if (err) {
                console.error('⚠️ [MySQL] Lỗi kiểm tra User:', err.message);
                return res.status(500).json({ success: false, message: 'Lỗi Database!' });
            }

            if (results.length > 0) {
                for (const user of results) {
                    if (user.username === username && user.status !== 'pending') {
                        return res.status(400).json({ success: false, message: 'Tên tài khoản đã tồn tại!' });
                    }
                    if (user.email === email && user.status !== 'pending') {
                        return res.status(400).json({ success: false, message: 'Địa chỉ Email này đã được đăng ký!' });
                    }
                }
            }

            const otpKey = `reg_otp:${email.toLowerCase()}`;

            // [CHỐNG SPAM] Cooldown 60s
            const existingRecord = otpStorage.get(otpKey);
            if (existingRecord && existingRecord.nextRequestAvailable > Date.now()) {
                const waitTime = Math.ceil((existingRecord.nextRequestAvailable - Date.now()) / 1000);
                return res.status(429).json({ success: false, message: `Hệ thống vừa gửi OTP xong. Vui lòng chờ ${waitTime} giây nữa trước khi yêu cầu gửi lại!` });
            }

            // Tạo mã OTP ngẫu nhiên (6 chữ số)
            const otp = Math.floor(100000 + Math.random() * 900000).toString();

            // Lưu tạm vào RAM (Hiệu lực 5 phút)
            otpStorage.set(otpKey, {
                otp,
                expires: Date.now() + 5 * 60 * 1000,
                nextRequestAvailable: Date.now() + 60 * 1000
            });

            const maskEmailStr = email.replace(/(.{1})(.*)(?=@)/, (match, p1, p2) => p1 + '*'.repeat(p2.length));

            if (!GAS_MAIL_URL) {
                console.error('⚠️ Cảnh báo: Chưa cấu hình biến môi trường GAS_MAIL_URL!');
                return res.status(500).json({ success: false, message: 'Lỗi: Hệ thống gửi mail chưa được cấu hình!' });
            }

            const payload = {
                to: email,
                subject: `Hệ thống Trạm Sạc - Mã OTP đăng ký của bạn là ${otp}`,
                htmlBody: `<p>Chào ${username},</p><p>Mã OTP để đăng ký tài khoản của bạn là: <strong style="font-size:18px; color: #27ae60;">${otp}</strong></p><p>Lưu ý: Mã này chỉ có hiệu lực trong vòng 5 phút.</p>`
            };

            fetch(GAS_MAIL_URL, {
                method: 'POST',
                body: JSON.stringify(payload)
            })
                .then(response => response.json())
                .then(data => {
                    if (data.status === 'success') {
                        res.json({ success: true, message: `Mã OTP đã được gửi về: ${maskEmailStr}` });
                    } else {
                        console.error('⚠️ [Google API] Lỗi từ Webhook:', data.message);
                        res.status(500).json({ success: false, message: 'Google Server từ chối lệnh gửi mail!' });
                    }
                })
                .catch(error => {
                    console.error('⚠️ [Google API] Fetch thất bại:', error.message);
                    res.status(500).json({ success: false, message: 'Lỗi kết nối đến Google Server.' });
                });
        });
    });
});

// API Đăng ký tài khoản tự do (Cho khách hàng từ App)
app.post('/api/register', async (req, res) => {
    let { username, email, password, otp } = req.body;

    // Cắt bỏ khoảng trắng thừa
    if (username) username = username.trim();
    if (email) email = email.trim();

    if (!username || !email || !password || !otp) {
        return res.status(400).json({ success: false, message: 'Vui lòng điền đầy đủ thông tin và mã OTP!' });
    }
    if (password.length < 6) return res.status(400).json({ success: false, message: 'Mật khẩu phải từ 6 ký tự!' });

    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) return res.status(400).json({ success: false, message: 'Địa chỉ Email không hợp lệ!' });

    // Xác thực mã OTP
    const otpKey = `reg_otp:${email.toLowerCase()}`;
    const record = otpStorage.get(otpKey);

    if (!record) {
        return res.status(400).json({ success: false, message: 'Mã OTP đã hết hạn hoặc chưa được yêu cầu!' });
    }
    if (Date.now() > record.expires) {
        otpStorage.delete(otpKey);
        return res.status(400).json({ success: false, message: 'Mã OTP đã hết hạn!' });
    }
    if (record.otp !== otp) {
        return res.status(400).json({ success: false, message: 'Mã OTP không chính xác!' });
    }

    // Kiểm tra username và email tồn tại trước khi INSERT (chống race condition lần cuối)
    db.query('SELECT id, username, email, status FROM users WHERE username = ? OR email = ?', [username, email], async (err, results) => {
        if (err) {
            console.error('⚠️ [MySQL] Lỗi kiểm tra User:', err.message);
            return res.status(500).json({ success: false, message: 'Lỗi Database!' });
        }

        let pendingUser = null;
        if (results.length > 0) {
            for (const user of results) {
                if (user.username === username && user.status !== 'pending') {
                    return res.status(400).json({ success: false, message: 'Tên tài khoản đã tồn tại!' });
                }
                if (user.email === email) {
                    if (user.status === 'pending') {
                        pendingUser = user;
                    } else {
                        return res.status(400).json({ success: false, message: 'Địa chỉ Email này đã được đăng ký!' });
                    }
                }
            }
        }

        // Tiến hành mã hóa mật khẩu và chèn dữ liệu
        try {
            const hashed = await bcrypt.hash(password, 10);
            if (pendingUser) {
                // Ghi đè mật khẩu mới và kích hoạt tài khoản đang chờ kích hoạt
                db.query(
                    'UPDATE users SET username = ?, password = ?, status = "active", activation_token = NULL WHERE id = ?',
                    [username, hashed, pendingUser.id],
                    (err) => {
                        if (err) {
                            console.error('⚠️ [MySQL] Lỗi kích hoạt đè tài khoản:', err.message);
                            return res.status(500).json({ success: false, message: 'Lỗi Database!' });
                        }
                        // Xóa OTP sau khi đăng ký thành công
                        otpStorage.delete(otpKey);
                        res.json({ success: true, message: 'Đăng ký thành công! Tài khoản của bạn đã được kích hoạt và sẵn sàng.' });
                    }
                );
            } else {
                // Tạo mới hoàn toàn
                db.query('INSERT INTO users (username, email, password, role, balance, status) VALUES (?, ?, ?, "user", 0, "active")', [username, email, hashed], (err) => {
                    if (err) {
                        console.error('⚠️ [MySQL] Lỗi Đăng ký User:', err.message);
                        if (err.code === 'ER_DUP_ENTRY') {
                            return res.status(400).json({ success: false, message: 'Tên tài khoản hoặc Email đã tồn tại!' });
                        }
                        return res.status(500).json({ success: false, message: 'Lỗi Database!' });
                    }
                    // Xóa OTP sau khi đăng ký thành công
                    otpStorage.delete(otpKey);
                    res.json({ success: true, message: 'Đăng ký thành công! Bạn có thể đăng nhập ngay.' });
                });
            }
        } catch (error) {
            res.status(500).json({ success: false, message: 'Lỗi mã hóa dữ liệu!' });
        }
    });
});

// Lính gác (Middleware) chặn các Request không có thẻ hợp lệ
function verifyToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bỏ chữ "Bearer " lấy chuỗi Token

    if (!token) return res.status(403).json({ success: false, message: 'Vui lòng đăng nhập!' });

    jwt.verify(token, SECRET_KEY, (err, decoded) => {
        if (err) return res.status(401).json({ success: false, message: 'Token không hợp lệ hoặc đã hết hạn!' });
        req.user = decoded; // Lưu lại thông tin giải mã (chứa chữ 'admin')
        next(); // Ký duyệt cho qua!
    });
}

// API Điều khiển Sạc từ xa (App sẽ gọi API này, Backend mới là người đẩy MQTT)
app.post('/api/charge/start', verifyToken, (req, res) => {
    const userId = req.user.id;
    const { stationId, outletId } = req.body; // Nhận ID ổ cắm từ web

    // Tạo Idempotency Key tạm thời
    const lockKey = `start_${userId}_${stationId}_${outletId}`;
    if (processingLocks.has(lockKey)) {
        return res.status(429).json({ success: false, message: 'Hệ thống đang xử lý lệnh sạc của bạn, vui lòng không bấm đúp!' });
    }
    processingLocks.add(lockKey);
    const releaseLock = () => processingLocks.delete(lockKey);

    // 1. Kiểm tra số dư người dùng (Bỏ qua đối với Admin)
    db.query('SELECT balance, role FROM users WHERE id = ?', [userId], (err, results) => {
        if (err || results.length === 0) { releaseLock(); return res.status(500).json({ success: false, message: 'Lỗi DB' }); }

        const user = results[0];
        if (user.role !== 'admin' && user.balance <= 0) {
            releaseLock();
            return res.status(400).json({ success: false, message: '⛔ Số dư ví không đủ để sạc!' });
        }

        // [MỚI] Kiểm tra xem tủ sạc có đang ở chế độ bảo trì hay không
        const config = stationConfigCache[stationId];
        if (config && config.status === 'maintenance') {
            releaseLock();
            return res.status(400).json({ success: false, message: '⛔ Tủ sạc này đang ở chế độ bảo trì, không thể bắt đầu sạc!' });
        }

        // 2. Kiểm tra xem trụ sạc có đang rảnh không
        db.query('SELECT id FROM charging_sessions WHERE station_id = ? AND status = "ongoing"', [`${stationId}.${outletId}`], (err, sessions) => {
            if (sessions.length > 0) {
                releaseLock();
                return res.status(400).json({ success: false, message: '⛔ Trụ sạc này đang được sử dụng!' });
            }

            // 3. Tạo Phiên sạc mới trong Database ngay lập tức (Lạc quan - Optimistic)
            db.query('INSERT INTO charging_sessions (station_id, user_id, status) VALUES (?, ?, "ongoing")', [`${stationId}.${outletId}`, userId], (err) => {
                releaseLock();
                if (err) return res.status(500).json({ success: false, message: 'Lỗi khi tạo phiên sạc trên Database!' });

                console.log(`📲 [API] User [${req.user.username}] bắt đầu sạc tại Tủ ${stationId}, Ổ ${outletId}`);

                // Gửi lệnh sạc xuống thiết bị qua MQTT
                const topicCmd = `ev_station/${stationId}/outlet/${outletId}/cmd`;
                client.publish(topicCmd, JSON.stringify({ command: 'START_CHARGE' }));

                res.json({ success: true, message: `Bắt đầu phiên sạc thành công cho Cổng ${outletId} - Tủ ${stationId}!` });
            });
        });
    });
});

// Hàm xử lý chốt phiên sạc dùng chung cho API và Worker
function processStopCharge(stationId, outletId, userId, callback) {
    const fullStationId = `${stationId}.${outletId}`;

    // [TỐI ƯU] JOIN với bảng stations để lấy unit_price thực tế của trạm thay vì fix cứng 3500
    const sql = 'SELECT s.id, s.start_time, st.unit_price, TIMESTAMPDIFF(SECOND, s.start_time, NOW()) as duration_sec FROM charging_sessions s JOIN stations st ON st.station_id = ? WHERE s.station_id = ? AND s.status = "ongoing"';
    db.query(sql, [stationId, fullStationId], (err, sessions) => {
        if (err || sessions.length === 0) {
            client.publish(`ev_station/${stationId}/outlet/${outletId}/cmd`, JSON.stringify({ command: 'STOP_CHARGE' }));
            return callback(true, 'Đã ngắt Relay (Không có phiên sạc nào cần chốt tiền).');
        }

        const sessionId = sessions[0].id;
        const durationHours = sessions[0].duration_sec / 3600.0;
        const dynamicUnitPrice = sessions[0].unit_price || 3500; // Fallback an toàn

        db.query('SELECT AVG(power) as avg_power FROM telemetry WHERE station_id = ? AND created_at >= ?', [fullStationId, sessions[0].start_time], (err, tele) => {
            let avgPower = (tele && tele.length > 0 && tele[0].avg_power != null) ? tele[0].avg_power : 0;
            const totalKwh = (avgPower / 1000) * durationHours;
            const totalCost = totalKwh * dynamicUnitPrice;

            // [FIX Idempotency / Race Condition] Thêm điều kiện status = "ongoing" vào WHERE. 
            // Nếu Worker và User gọi Stop cùng lúc, chỉ có 1 bên thực hiện thành công (affectedRows = 1)
            db.query('UPDATE charging_sessions SET end_time = NOW(), total_kwh = ?, total_cost = ?, status = "completed" WHERE id = ? AND status = "ongoing"', [totalKwh, totalCost, sessionId], (err, result) => {
                if (err || result.affectedRows === 0) {
                    // Phiên sạc đã được chốt bởi 1 luồng khác (vd: Worker tự động cắt)
                    return callback(false, 'Phiên sạc đã được chốt trước đó!');
                }

                db.query('SELECT role FROM users WHERE id = ?', [userId], (err, userRes) => {
                    const isAdmin = (userRes && userRes.length > 0 && userRes[0].role === 'admin');
                    if (isAdmin) {
                        client.publish(`ev_station/${stationId}/outlet/${outletId}/cmd`, JSON.stringify({ command: 'STOP_CHARGE' }));
                        callback(true, `Đã chốt hóa đơn Cổng ${outletId} - Tủ ${stationId}!\n- Tiêu thụ: ${totalKwh.toFixed(4)} kWh\n- Số tiền: ${totalCost.toFixed(0)} VNĐ`);
                    } else {
                        db.query('UPDATE users SET balance = balance - ? WHERE id = ?', [totalCost, userId], () => {
                            client.publish(`ev_station/${stationId}/outlet/${outletId}/cmd`, JSON.stringify({ command: 'STOP_CHARGE' }));
                            callback(true, `Đã chốt hóa đơn Cổng ${outletId} - Tủ ${stationId}!\n- Tiêu thụ: ${totalKwh.toFixed(4)} kWh\n- Thành tiền: ${totalCost.toFixed(0)} VNĐ`);
                        });
                    }
                });
            });
        });
    });
}

app.post('/api/charge/stop', verifyToken, (req, res) => {
    const userId = req.user.id;
    const { stationId, outletId } = req.body;

    const lockKey = `stop_${userId}_${stationId}_${outletId}`;
    if (processingLocks.has(lockKey)) {
        return res.status(429).json({ success: false, message: 'Đang chốt hóa đơn, vui lòng không bấm đúp!' });
    }
    processingLocks.add(lockKey);

    console.log(`📲 [API] User [${req.user.username}] yêu cầu CHỐT phiên sạc`);
    processStopCharge(stationId, outletId, userId, (success, message) => {
        processingLocks.delete(lockKey);
        res.json({ success, message });
    });
});

// API Lấy dữ liệu lịch sử để vẽ biểu đồ
app.get('/api/telemetry/history', (req, res) => {
    // Lay cac mau gan nhat va tach tong cong suat theo tung tu sac.
    const sql = `
        SELECT DATE_FORMAT(FROM_UNIXTIME(bucket_epoch), "%H:%i:%s") as time, power_1, power_2
        FROM (
            SELECT
                UNIX_TIMESTAMP(created_at) as bucket_epoch,
                SUM(CASE WHEN station_id LIKE '001.%' THEN power ELSE 0 END) as power_1,
                SUM(CASE WHEN station_id LIKE '002.%' THEN power ELSE 0 END) as power_2
            FROM telemetry
            WHERE created_at >= NOW() - INTERVAL 30 MINUTE
            GROUP BY bucket_epoch
            ORDER BY bucket_epoch DESC
            LIMIT 20
        ) recent
        ORDER BY bucket_epoch ASC
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Lỗi DB' });
        res.json({ success: true, data: results });
    });
});

// API Lấy danh sách lịch sử sạc cá nhân hoặc tất cả (đối với Admin)
app.get('/api/sessions/history', verifyToken, (req, res) => {
    const { startDate, endDate, stationId, username } = req.query;

    let sql = `
        SELECT s.id, s.station_id, u.username,
               DATE_FORMAT(s.start_time, '%d/%m/%Y %H:%i:%s') as start, 
               DATE_FORMAT(s.end_time, '%d/%m/%Y %H:%i:%s') as end, 
               s.total_kwh, s.total_cost, s.status 
        FROM charging_sessions s
        JOIN users u ON s.user_id = u.id
    `;
    let params = [];
    let conditions = [];

    // Phân quyền: Admin xem tất cả, User thường chỉ xem của bản thân
    if (req.user.role !== 'admin') {
        conditions.push('s.user_id = ?');
        params.push(req.user.id);
    } else if (username && username.trim() !== '') {
        // Admin lọc theo tên người dùng
        conditions.push('u.username LIKE ?');
        params.push(`%${username.trim()}%`);
    }

    if (startDate && endDate && startDate.trim() !== '' && endDate.trim() !== '') {
        conditions.push('s.start_time >= ? AND s.start_time <= ?');
        params.push(`${startDate} 00:00:00`, `${endDate} 23:59:59`);
    }

    if (stationId && stationId.trim() !== '') {
        conditions.push('s.station_id LIKE ?');
        params.push(`${stationId}%`);
    }

    if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY s.id DESC LIMIT 200';

    db.query(sql, params, (err, results) => {
        if (err) {
            console.error('⚠️ [MySQL] Lỗi query history:', err.message);
            return res.status(500).json({ success: false, message: 'Lỗi DB' });
        }
        res.json({ success: true, data: results });
    });
});

// API Xóa toàn bộ lịch sử sạc cá nhân
app.delete('/api/sessions/history', verifyToken, (req, res) => {
    db.query('DELETE FROM charging_sessions WHERE user_id = ?', [req.user.id], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: 'Lỗi DB' });
        res.json({ success: true, message: 'Đã xóa toàn bộ lịch sử sạc thành công.' });
    });
});

// API Lấy danh sách Trạm sạc và Tổng điện năng
app.get('/api/stations', verifyToken, (req, res) => {
    const { startDate, endDate } = req.query;

    let joinCondition = "cs.station_id LIKE CONCAT(s.station_id, '.%') AND cs.status = 'completed'";
    let params = [];

    if (startDate && endDate) {
        joinCondition += " AND cs.start_time >= ? AND cs.start_time <= ?";
        params.push(`${startDate} 00:00:00`, `${endDate} 23:59:59`);
    }

    // Câu lệnh SQL: Lấy thông tin trạm VÀ tính tổng kWh từ các hóa đơn đã hoàn tất
    const sql = `
        SELECT 
            s.station_id, 
            s.name, 
            s.location, 
            s.unit_price, 
            s.status,
            s.max_current,
            s.temp_limit,
            COALESCE(SUM(cs.total_kwh), 0) as total_kwh
        FROM stations s
        LEFT JOIN charging_sessions cs ON ${joinCondition}
        GROUP BY s.station_id
    `;
    db.query(sql, params, (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Lỗi DB' });

        // Lấy danh sách các ổ cắm đang được sạc (ongoing)
        db.query("SELECT station_id, user_id, TIMESTAMPDIFF(SECOND, start_time, NOW()) as duration_sec FROM charging_sessions WHERE status = 'ongoing'", (err, activeSessions) => {
            const activeMap = {};
            if (!err && activeSessions) {
                activeSessions.forEach(session => {
                    activeMap[session.station_id] = { user_id: session.user_id, duration_sec: session.duration_sec };
                });
            }

            // [TỐI ƯU] Ghép dữ liệu DB, Real-time RAM Cache và Trạng thái Ổ cắm
            const mappedData = results.map(st => {
                // Tự động quét 2 ổ cắm của mỗi trạm để ép cấu hình
                const outlets = [1, 2].map(outletId => {
                    const fullId = `${st.station_id}.${outletId}`;
                    const sessionInfo = activeMap[fullId];
                    const outData = (liveDataCache[st.station_id] && liveDataCache[st.station_id].outletsData && liveDataCache[st.station_id].outletsData[outletId]) || { voltage: 0, current: 0, power: 0, status: 'AVAILABLE' };

                    let baseOutlet = {
                        id: outletId,
                        voltage: outData.voltage,
                        current: outData.current,
                        power: outData.power
                    };

                    if (!sessionInfo) {
                        // Nếu không có phiên sạc đang chạy trong DB, nhưng thực tế phần cứng đang chạy sạc (dựa vào status 'CHARGING' hoặc dòng điện > 0.05A)
                        if (outData.status === 'CHARGING' || outData.current > 0.05) {
                            return { ...baseOutlet, status: 'charging_by_other' };
                        }
                        return { ...baseOutlet, status: 'available' };
                    } else if (sessionInfo.user_id === req.user.id) {
                        return { ...baseOutlet, status: 'charging_by_me', duration_sec: sessionInfo.duration_sec };
                    } else {
                        return { ...baseOutlet, status: 'charging_by_other' };
                    }
                });

                return {
                    ...st,
                    temperature: liveDataCache[st.station_id]?.temperature || null,
                    humidity: liveDataCache[st.station_id]?.humidity || null,
                    outlets: outlets
                };
            });
            res.json({ success: true, data: mappedData });
        });
    });
});

// API Cập nhật đơn giá sạc cho toàn bộ các Tủ sạc (Chỉ Admin)
app.put('/api/stations/price', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Chỉ Admin mới có quyền cấu hình đơn giá!' });
    const { unitPrice } = req.body;
    if (unitPrice == null || isNaN(unitPrice) || parseInt(unitPrice) < 0) {
        return res.status(400).json({ success: false, message: 'Đơn giá mới không hợp lệ!' });
    }

    db.query('UPDATE stations SET unit_price = ?', [parseInt(unitPrice)], (err) => {
        if (err) return res.status(500).json({ success: false, message: 'Lỗi Database cập nhật đơn giá' });
        res.json({ success: true, message: 'Đã cập nhật đơn giá mới cho toàn bộ các tủ sạc!' });
    });
});

// API Thêm Tủ sạc mới (Chỉ Admin)
app.post('/api/stations', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Chỉ Admin mới có quyền thêm tủ sạc!' });

    const { station_id, name, location, max_current, temp_limit } = req.body;

    if (!station_id || !name) {
        return res.status(400).json({ success: false, message: 'Vui lòng cung cấp đầy đủ Mã tủ và Tên tủ!' });
    }

    // Kiểm tra xem station_id đã tồn tại hay chưa
    db.query('SELECT station_id FROM stations WHERE station_id = ?', [station_id], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Lỗi Database kiểm tra tủ sạc' });
        if (results.length > 0) {
            return res.status(400).json({ success: false, message: 'Mã tủ sạc đã tồn tại!' });
        }

        // Lấy đơn giá điện hiện tại từ trạm khác để áp dụng đồng bộ, hoặc dùng mặc định 3500
        db.query('SELECT unit_price FROM stations LIMIT 1', (err, priceResults) => {
            let unitPrice = 3500;
            if (!err && priceResults && priceResults.length > 0) {
                unitPrice = priceResults[0].unit_price;
            }

            const query = 'INSERT INTO stations (station_id, name, location, unit_price, status, max_current, temp_limit) VALUES (?, ?, ?, ?, ?, ?, ?)';
            const params = [
                station_id,
                name,
                location || 'Trạm sạc',
                unitPrice,
                'online',
                max_current || 16,
                temp_limit || 65
            ];

            db.query(query, params, (err) => {
                if (err) return res.status(500).json({ success: false, message: 'Lỗi Database thêm tủ sạc mới' });

                // Đồng bộ lại cấu hình trạm sạc vào RAM Cache
                stationConfigCache[station_id] = {
                    max_current: parseInt(max_current || 16),
                    temp_limit: parseInt(temp_limit || 65),
                    status: 'online'
                };

                // Phát hành cấu hình xuống MQTT
                const configTopic = `ev_station/${station_id}/config`;
                client.publish(configTopic, JSON.stringify({
                    max_current: parseInt(max_current || 16),
                    temp_limit: parseInt(temp_limit || 65),
                    status: 'online'
                }), { retain: true });

                res.json({ success: true, message: 'Đã thêm tủ sạc mới thành công!' });
            });
        });
    });
});

// API Chỉnh sửa Tên và Địa chỉ Trạm sạc (Chỉ Admin)
app.put('/api/stations/:id', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Chỉ Admin mới có quyền cấu hình trạm sạc!' });

    const stationId = req.params.id;
    const { name, max_current, temp_limit, status } = req.body;

    if (!name) return res.status(400).json({ success: false, message: 'Vui lòng nhập Tên tủ sạc!' });

    db.query(
        'UPDATE stations SET name = ?, max_current = ?, temp_limit = ?, status = ? WHERE station_id = ?',
        [name, max_current || 16, temp_limit || 65, status || 'online', stationId],
        (err) => {
            if (err) return res.status(500).json({ success: false, message: 'Lỗi Database cập nhật trạm sạc' });

            // Đồng bộ lại cấu hình trạm sạc vào RAM Cache ngay lập tức
            stationConfigCache[stationId] = {
                max_current: parseInt(max_current || 16),
                temp_limit: parseInt(temp_limit || 65),
                status: status || 'online'
            };

            // [MỚI] Phát hành gói tin cấu hình xuống MQTT cho Gateway nhận diện (dùng retained)
            const configTopic = `ev_station/${stationId}/config`;
            client.publish(configTopic, JSON.stringify({
                max_current: parseInt(max_current || 16),
                temp_limit: parseInt(temp_limit || 65),
                status: status || 'online'
            }), { retain: true });

            // Nếu đổi trạng thái sang Bảo trì (maintenance), tự động gửi lệnh ngắt sạc cho tất cả ổ cắm thuộc tủ này
            if (status === 'maintenance') {
                console.log(`🛠️ [Admin] Đặt tủ sạc ${stationId} sang chế độ BẢO TRÌ. Tự động ngắt sạc các cổng.`);
                // Đẩy lệnh ngắt sạc qua MQTT cho cả 2 ổ sạc
                client.publish(`ev_station/${stationId}/outlet/1/cmd`, JSON.stringify({ command: 'STOP_CHARGE' }));
                client.publish(`ev_station/${stationId}/outlet/2/cmd`, JSON.stringify({ command: 'STOP_CHARGE' }));

                // Chốt các phiên sạc đang chạy của trạm này (nếu có)
                db.query('SELECT user_id, station_id FROM charging_sessions WHERE station_id LIKE ? AND status = "ongoing"', [`${stationId}.%`], (err, activeSessions) => {
                    if (!err && activeSessions) {
                        activeSessions.forEach(session => {
                            const outId = session.station_id.split('.')[1];
                            processStopCharge(stationId, outId, session.user_id, () => { });
                        });
                    }
                });
            }

            res.json({ success: true, message: 'Cập nhật cấu hình trạm sạc thành công!' });
        }
    );
});

// API Gửi lệnh khởi động lại (Reboot) Tủ sạc (Chỉ Admin)
app.post('/api/stations/:id/reboot', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Chỉ Admin mới có quyền khởi động lại tủ sạc!' });

    const stationId = req.params.id;

    console.log(`🔄 [Admin] Gửi lệnh khởi động lại tủ sạc ${stationId}`);

    // Gửi lệnh reboot qua MQTT
    const cmdTopic = `ev_station/${stationId}/cmd`;
    client.publish(cmdTopic, JSON.stringify({ command: 'REBOOT' }), (err) => {
        if (err) {
            console.error(`⚠️ [MQTT] Lỗi gửi lệnh reboot tới tủ ${stationId}:`, err.message);
            return res.status(500).json({ success: false, message: 'Lỗi gửi lệnh điều khiển thiết bị!' });
        }
        res.json({ success: true, message: `Lệnh khởi động lại đã được gửi tới tủ sạc ${stationId}!` });
    });
});

// API Xóa Tủ sạc (Chỉ Admin)
app.delete('/api/stations/:id', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Chỉ Admin mới có quyền xóa tủ sạc!' });

    const stationId = req.params.id;

    // 1. Thực hiện xóa tủ sạc trong DB
    db.query('DELETE FROM stations WHERE station_id = ?', [stationId], (err, result) => {
        if (err) {
            console.error(`⚠️ [MySQL] Lỗi xóa tủ sạc ${stationId}:`, err.message);
            return res.status(500).json({ success: false, message: 'Lỗi Database khi xóa tủ sạc!' });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy tủ sạc để xóa!' });
        }

        // 2. Xóa khỏi cấu hình RAM Cache
        delete stationConfigCache[stationId];
        delete liveDataCache[stationId];

        // 3. Xóa cấu hình retained trên MQTT Broker bằng cách gửi payload rỗng
        const configTopic = `ev_station/${stationId}/config`;
        client.publish(configTopic, '', { retain: true });

        console.log(`🗑️ [Admin] Đã xóa tủ sạc ${stationId}`);
        res.json({ success: true, message: `Đã xóa tủ sạc ${stationId} thành công!` });
    });
});

// API Lấy thông tin ví tiền của User đang đăng nhập
app.get('/api/user/me', verifyToken, (req, res) => {
    db.query('SELECT username, role, balance FROM users WHERE id = ?', [req.user.id], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Lỗi DB' });
        if (results.length === 0) return res.status(404).json({ success: false, message: 'Không tìm thấy User' });
        res.json({ success: true, data: results[0] });
    });
});

// API Đổi mật khẩu của User đang đăng nhập (Admin hoặc User thường)
app.post('/api/user/change-password', verifyToken, async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
        return res.status(400).json({ success: false, message: 'Vui lòng cung cấp đầy đủ mật khẩu cũ và mới!' });
    }

    db.query('SELECT password FROM users WHERE id = ?', [req.user.id], async (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Lỗi Database truy vấn mật khẩu' });
        if (results.length === 0) return res.status(404).json({ success: false, message: 'Không tìm thấy User' });

        const user = results[0];
        try {
            // So sánh mật khẩu cũ
            const match = await bcrypt.compare(oldPassword, user.password);
            if (!match) return res.status(400).json({ success: false, message: 'Mật khẩu cũ không chính xác!' });

            // Hóa mật khẩu mới
            const hashed = await bcrypt.hash(newPassword, 10);
            db.query('UPDATE users SET password = ? WHERE id = ?', [hashed, req.user.id], (err) => {
                if (err) return res.status(500).json({ success: false, message: 'Lỗi Database cập nhật mật khẩu' });
                res.json({ success: true, message: 'Đã đổi mật khẩu thành công!' });
            });
        } catch (e) {
            res.status(500).json({ success: false, message: 'Lỗi hệ thống khi mã hóa mật khẩu' });
        }
    });
});



// API Lấy danh sách User (Chỉ Admin)
app.get('/api/users', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Chỉ Admin mới có quyền xem danh sách!' });
    db.query('SELECT id, username, email, role, balance, status, created_at FROM users WHERE LOWER(role) != "admin" AND LOWER(username) != "admin"', (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Lỗi DB' });
        res.json({ success: true, data: results });
    });
});

// API Đăng ký User mới (Chỉ Admin)
app.post('/api/users/register', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Chỉ Admin mới có quyền tạo tài khoản!' });
    const { username, email, password, role, resend } = req.body;
    if (!username || !password || !email) return res.status(400).json({ success: false, message: 'Thiếu thông tin!' });

    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) return res.status(400).json({ success: false, message: 'Địa chỉ Email không hợp lệ!' });

    // Định nghĩa hàm thực hiện gửi lại email kích hoạt
    const performResend = () => {
        try {
            const newActivationToken = require('crypto').randomBytes(32).toString('hex');
            const activationLink = `${req.protocol}://${req.get('host')}/api/users/activate?token=${newActivationToken}`;

            db.query(
                'UPDATE users SET activation_token = ? WHERE email = ?',
                [newActivationToken, email],
                (err) => {
                    if (err) {
                        console.error('⚠️ [MySQL] Lỗi cập nhật token kích hoạt:', err.message);
                        return res.status(500).json({ success: false, message: 'Lỗi Database!' });
                    }

                    // Gửi email kích hoạt tài khoản bằng GAS Webhook
                    const payload = {
                        to: email,
                        subject: 'Hệ thống Trạm Sạc - Gửi lại liên kết kích hoạt tài khoản của bạn',
                        htmlBody: `
                            <div style="font-family: sans-serif; padding: 20px; line-height: 1.6;">
                                <h2 style="color: #2e7d32;">Kích hoạt tài khoản EV Charging Station</h2>
                                <p>Tài khoản của bạn đang chờ kích hoạt.</p>
                                <p>Vui lòng click vào liên kết dưới đây để kích hoạt tài khoản của bạn:</p>
                                <p style="margin: 25px 0;">
                                    <a href="${activationLink}" style="background-color: #2e7d32; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">
                                        Kích hoạt tài khoản ngay
                                    </a>
                                </p>
                                <p style="color: #666; font-size: 12px;">Nếu nút trên không hoạt động, bạn có thể copy link sau dán vào thanh địa chỉ trình duyệt: <br><a href="${activationLink}">${activationLink}</a></p>
                            </div>
                        `
                    };

                    if (GAS_MAIL_URL) {
                        fetch(GAS_MAIL_URL, {
                            method: 'POST',
                            body: JSON.stringify(payload)
                        }).catch(() => { });
                    }

                    return res.json({ success: true, message: 'Đã gửi lại email kích hoạt mới thành công!' });
                }
            );
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Lỗi sinh mã kích hoạt!' });
        }
    };

    // Nếu yêu cầu gửi lại (confirm từ Admin)
    if (resend) {
        return performResend();
    }

    verifyEmailExistence(email, (isValidEmail) => {
        if (!isValidEmail) {
            return res.status(400).json({ success: false, message: 'Địa chỉ Email không tồn tại hoặc không thể nhận thư!' });
        }

        // [TỐI ƯU] Kiểm tra trước khi INSERT để có thông báo lỗi rõ ràng và an toàn hơn
        db.query('SELECT username, email, status FROM users WHERE username = ? OR email = ?', [username, email], async (err, results) => {
            if (err) {
                console.error('⚠️ [MySQL] Lỗi kiểm tra User:', err.message);
                return res.status(500).json({ success: false, message: 'Lỗi Database: ' + err.message });
            }

            if (results.length > 0) {
                let pendingUser = null;
                for (const user of results) {
                    if (user.username === username && user.status !== 'pending') {
                        return res.status(400).json({ success: false, message: 'Tên tài khoản này đã tồn tại!' });
                    }
                    if (user.email === email) {
                        if (user.status === 'pending') {
                            pendingUser = user;
                        } else {
                            return res.status(400).json({ success: false, message: 'Địa chỉ Email này đã tồn tại!' });
                        }
                    }
                }

                if (pendingUser) {
                    // Trả về mã code PENDING_EXISTS để Frontend hiển thị hộp thoại xác nhận hỏi Admin
                    return res.json({
                        success: false,
                        code: 'PENDING_EXISTS',
                        message: 'Tài khoản này đã được tạo trước đó và đang chờ xác nhận. Bạn có muốn gửi lại email kích hoạt mới không?'
                    });
                }
            }

            try {
                const hashed = await bcrypt.hash(password, 10);
                const activationToken = require('crypto').randomBytes(32).toString('hex');
                const activationLink = `${req.protocol}://${req.get('host')}/api/users/activate?token=${activationToken}`;

                db.query(
                    'INSERT INTO users (username, email, password, role, balance, status, activation_token) VALUES (?, ?, ?, ?, 0, "pending", ?)',
                    [username, email, hashed, role || 'user', activationToken],
                    (err) => {
                        if (err) {
                            console.error('⚠️ [MySQL] Lỗi Admin tạo User:', err.message);
                            if (err.code === 'ER_DUP_ENTRY') {
                                return res.status(400).json({ success: false, message: 'Thông tin đã tồn tại trong hệ thống!' });
                            }
                            return res.status(500).json({ success: false, message: 'Lỗi Database: ' + err.message });
                        }

                        // Gửi email kích hoạt tài khoản bằng GAS Webhook
                        const payload = {
                            to: email,
                            subject: 'Hệ thống Trạm Sạc - Kích hoạt tài khoản của bạn',
                            htmlBody: `
                                <div style="font-family: sans-serif; padding: 20px; line-height: 1.6;">
                                    <h2 style="color: #2e7d32;">Chào mừng bạn đến với EV Charging Station!</h2>
                                    <p>Tài khoản của bạn đã được quản trị viên khởi tạo trên hệ thống.</p>
                                    <p>Vui lòng click vào liên kết dưới đây để kích hoạt tài khoản của bạn:</p>
                                    <p style="margin: 25px 0;">
                                        <a href="${activationLink}" style="background-color: #2e7d32; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">
                                            Kích hoạt tài khoản ngay
                                        </a>
                                    </p>
                                    <p style="color: #666; font-size: 12px;">Nếu nút trên không hoạt động, bạn có thể copy link sau dán vào thanh địa chỉ trình duyệt: <br><a href="${activationLink}">${activationLink}</a></p>
                                </div>
                            `
                        };

                        if (GAS_MAIL_URL) {
                            fetch(GAS_MAIL_URL, {
                                method: 'POST',
                                body: JSON.stringify(payload)
                            })
                                .then(response => response.json())
                                .then(data => {
                                    if (data.status !== 'success') {
                                        console.error('⚠️ [Google API] Lỗi từ Webhook khi gửi link kích hoạt:', data.message);
                                    }
                                })
                                .catch(error => {
                                    console.error('⚠️ [Google API] Gửi link kích hoạt thất bại:', error.message);
                                });
                        }

                        res.json({ success: true, message: 'Tạo tài khoản thành công! Đang chờ xác nhận từ chủ email để kích hoạt.' });
                    }
                );
            } catch (error) {
                console.error('⚠️ [Bcrypt] Lỗi mã hóa mật khẩu:', error.message);
                res.status(500).json({ success: false, message: 'Lỗi mã hóa dữ liệu!' });
            }
        });
    });
});

// API Kích hoạt tài khoản qua Email Link
app.get('/api/users/activate', (req, res) => {
    const { token } = req.query;
    if (!token) {
        return res.status(400).send(`
            <div style="font-family: sans-serif; text-align: center; margin-top: 100px; padding: 20px;">
                <h1 style="color: #d32f2f;">Lỗi Kích Hoạt</h1>
                <p>Mã kích hoạt không hợp lệ hoặc đã hết hạn.</p>
            </div>
        `);
    }

    db.query('SELECT username FROM users WHERE activation_token = ?', [token], (err, results) => {
        if (err || !results || results.length === 0) {
            return res.status(400).send(`
                <div style="font-family: sans-serif; text-align: center; margin-top: 100px; padding: 20px;">
                    <h1 style="color: #d32f2f;">Lỗi Kích Hoạt</h1>
                    <p>Liên kết kích hoạt không hợp lệ hoặc tài khoản đã được kích hoạt trước đó.</p>
                </div>
            `);
        }

        const username = results[0].username;
        db.query('UPDATE users SET status = "active", activation_token = NULL WHERE activation_token = ?', [token], (err) => {
            if (err) {
                return res.status(500).send(`
                    <div style="font-family: sans-serif; text-align: center; margin-top: 100px; padding: 20px;">
                        <h1 style="color: #d32f2f;">Lỗi Kích Hoạt</h1>
                        <p>Lỗi hệ thống khi cập nhật trạng thái kích hoạt.</p>
                    </div>
                `);
            }
            res.send(`
                <div style="font-family: sans-serif; text-align: center; margin-top: 100px; padding: 20px;">
                    <h1 style="color: #2e7d32;">Kích hoạt tài khoản thành công!</h1>
                    <p>Tài khoản <strong>${username}</strong> của bạn đã được kích hoạt thành công.</p>
                    <p>Bây giờ bạn đã có thể đăng nhập vào ứng dụng.</p>
                </div>
            `);
        });
    });
});

// API Nạp tiền (Chỉ Admin)
app.post('/api/users/add_balance', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Chỉ Admin mới có quyền nạp tiền!' });
    const { userId, amount } = req.body;
    if (!userId || !amount || amount <= 0) return res.status(400).json({ success: false, message: 'Thông tin không hợp lệ!' });

    db.query('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, userId], (err) => {
        if (err) return res.status(500).json({ success: false, message: 'Lỗi DB' });
        res.json({ success: true, message: `Đã nạp ${amount.toLocaleString('vi-VN')} VNĐ vào tài khoản ID ${userId}!` });
    });
});

// API Xóa User và dữ liệu liên quan (Chỉ Admin)
app.delete('/api/users/:id', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Chỉ Admin mới có quyền xóa tài khoản!' });

    const targetUserId = req.params.id;

    // Bảo vệ: Không cho phép Admin tự xóa chính mình đang đăng nhập
    if (parseInt(targetUserId) === req.user.id) {
        return res.status(400).json({ success: false, message: 'Hệ thống từ chối việc tự xóa tài khoản của chính bạn!' });
    }

    const safeUserId = parseInt(targetUserId, 10);

    // Bước 1: Xóa toàn bộ lịch sử sạc (charging_sessions) của user này trước để tránh lỗi khóa ngoại (Foreign Key constraint)
    db.query('DELETE FROM charging_sessions WHERE user_id = ?', [safeUserId], (err) => {
        if (err) {
            console.error('⚠️ [MySQL] Lỗi xóa charging_sessions:', err.message);
            return res.status(500).json({ success: false, message: 'Lỗi DB lịch sử sạc: ' + err.message });
        }

        // Bước 2: Xóa thông tin User
        db.query('DELETE FROM users WHERE id = ?', [safeUserId], (err, result) => {
            if (err) return res.status(500).json({ success: false, message: 'Lỗi DB khi xóa User: ' + err.message });
            if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Không tìm thấy User!' });
            res.json({ success: true, message: 'Xóa User thành công!' });
        });
    });
});

// ==========================================
// 4. BACKGROUND WORKER (CRONJOB) - GIÁM SÁT & TỰ ĐỘNG XỬ LÝ
// ==========================================
function runBackgroundWorker() {

    // Lấy tất cả các phiên đang sạc của User
    // [TỐI ƯU] Bổ sung JOIN với bảng stations để tính trước tiền điện dựa trên giá của từng trạm
    db.query('SELECT s.id, s.station_id, s.start_time, s.user_id, u.balance, u.role, st.unit_price, TIMESTAMPDIFF(SECOND, s.start_time, NOW()) as duration_sec FROM charging_sessions s JOIN users u ON s.user_id = u.id JOIN stations st ON st.station_id = SUBSTRING_INDEX(s.station_id, ".", 1) WHERE s.status = "ongoing"', (err, sessions) => {
        if (err || sessions.length === 0) return;

        sessions.forEach(session => {
            // --- TÍNH NĂNG: GIỚI HẠN THỜI GIAN SẠC TỐI ĐA (12 GIỜ) ---
            if (session.duration_sec >= 43200) {
                console.log(`⏰ [Worker] Cảnh báo: Phiên sạc #${session.id} tại ${session.station_id} vượt giới hạn thời gian (12 giờ). Tự động ngắt sạc khẩn cấp!`);
                const [stId, outId] = session.station_id.split('.');
                processStopCharge(stId, outId, session.user_id, () => { });
                return;
            }

            // Tính toán khoảng trễ nhịp tim hoàn toàn trên DB bằng SQL liên kết bảng sạc và telemetry (Chống lệch múi giờ / clock drift)
            db.query(
                'SELECT TIMESTAMPDIFF(SECOND, GREATEST(s.start_time, COALESCE((SELECT created_at FROM telemetry WHERE station_id = s.station_id ORDER BY id DESC LIMIT 1), s.start_time)), NOW()) as seconds_since FROM charging_sessions s WHERE s.id = ?',
                [session.id],
                (err, diffRes) => {
                    if (err || diffRes.length === 0) return;

                    const secondsSinceLastHeartbeat = diffRes[0].seconds_since;

                    if (secondsSinceLastHeartbeat > 30) {
                        console.log(`⚠️ [Worker] Trạm ${session.station_id} mất kết nối! Tự động chốt hóa đơn #${session.id}`);
                        const [stId, outId] = session.station_id.split('.');
                        processStopCharge(stId, outId, session.user_id, () => { });
                        return; // Đã chốt hóa đơn do rớt mạng, dừng xử lý tiếp
                    }

                    // --- TÍNH NĂNG: TỰ ĐỘNG NGẮT KHI SẠC ĐẦY / KHÔNG TẢI (DÒNG < 0.01A TRONG 5 PHÚT) ---
                    if (session.duration_sec >= 300) {
                        db.query(
                            'SELECT AVG(t.current) as avg_current, COUNT(t.id) as count FROM telemetry t JOIN charging_sessions s ON s.id = ? WHERE t.station_id = s.station_id AND t.created_at >= s.start_time AND t.created_at >= NOW() - INTERVAL 5 MINUTE',
                            [session.id],
                            (err, currentRes) => {
                                if (!err && currentRes && currentRes.length > 0) {
                                    const avgCurrent = currentRes[0].avg_current;
                                    const count = currentRes[0].count;

                                    if (count >= 30 && avgCurrent !== null && avgCurrent < 0.01) {
                                        console.log(`🔌 [Worker] Phát hiện SẠC ĐẦY / KHÔNG TẢI tại ${session.station_id} (Dòng TB 5 phút: ${avgCurrent.toFixed(4)}A). Tự động ngắt sạc!`);
                                        const [stId, outId] = session.station_id.split('.');
                                        processStopCharge(stId, outId, session.user_id, () => { });
                                        return;
                                    }
                                }
                            }
                        );
                    }

                    // --- TÍNH NĂNG: KIỂM TRA SỐ DƯ TÀI KHOẢN (Bỏ qua đối với Admin) ---
                    if (session.role === 'admin') {
                        return;
                    }

                    const durationHours = session.duration_sec / 3600.0;
                    db.query(
                        'SELECT AVG(t.power) as avg_power FROM telemetry t JOIN charging_sessions s ON s.id = ? WHERE t.station_id = s.station_id AND t.created_at >= s.start_time',
                        [session.id],
                        (err, tele2) => {
                            let avgPower = (tele2 && tele2.length > 0 && tele2[0].avg_power != null) ? tele2[0].avg_power : 0;
                            const unitPrice = session.unit_price || 3500;
                            const tempCost = (avgPower / 1000) * durationHours * unitPrice;

                            if (tempCost >= session.balance) {
                                console.log(`💰 [Worker] Ví của User #${session.user_id} sắp hết tiền! Tự động ngắt sạc tại trụ ${session.station_id}`);
                                const [stId, outId] = session.station_id.split('.');
                                processStopCharge(stId, outId, session.user_id, () => { });
                            }
                        }
                    );
                });
        });
    });
}

// [MỚI] Tách riêng tác vụ dọn dẹp Database chạy mỗi 24h (Thay vì 15 giây 1 lần gây giật lag máy chủ)
setInterval(() => {
    db.query('DELETE FROM telemetry WHERE created_at < NOW() - INTERVAL 7 DAY', (err, result) => {
        if (!err && result.affectedRows > 0) {
            console.log(`🧹 [Cleaner] Đã dọn dẹp ${result.affectedRows} dòng dữ liệu cũ trong bảng telemetry.`);
        }
    });
}, 24 * 60 * 60 * 1000); // 24 giờ

// ==========================================
// 5. WEBHOOK NẠP TIỀN TỰ ĐỘNG (OPEN BANKING / SEPAY)
// ==========================================
// Khóa bảo mật: Lấy từ biến môi trường hoặc dùng khóa mặc định. Tuyệt đối KHÔNG chia sẻ chìa khóa này.
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'EV_CHARGING_SECRET_KEY';

app.post('/api/payment/webhook', (req, res) => {
    // 1. Kiểm tra lính gác: Auth Header
    const authHeader = req.headers['authorization'] || req.headers['x-api-key'] || '';
    if (!authHeader.includes(WEBHOOK_SECRET)) {
        console.warn(`🚨 [Security] Ai đó đang cố giả mạo Webhook Nạp tiền! (Sai API Token)`);
        return res.status(401).json({ success: false, message: 'Unauthorized (Lỗi xác thực)' });
    }

    // Payload thực tế từ SePay: { id, transferAmount, content, gateway, ... }
    const { id: transactionId, transferAmount, content } = req.body;

    if (!transferAmount || !content || !transactionId) {
        return res.status(400).json({ success: false, message: 'Dữ liệu Webhook không hợp lệ' });
    }

    // Kiểm tra Idempotency: Giao dịch này đã xử lý chưa?
    db.query('SELECT id FROM topup_history WHERE transaction_id = ?', [transactionId], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Lỗi DB kiểm tra giao dịch' });

        if (results.length > 0) {
            console.log(`⚠️ [Webhook] Bỏ qua giao dịch ${transactionId} do đã được xử lý trước đó (Idempotent).`);
            return res.status(200).json({ success: true, message: 'Webhook đã được xử lý trước đó' });
        }

        // Phân tích mã nội dung (Tìm chữ "NAP TRAM [username]")
        const splitContent = content.toUpperCase().split(' ');
        const napIndex = splitContent.indexOf('NAP');
        const tramIndex = splitContent.indexOf('TRAM');

        // Chống hack: Chỉ mở cổng cộng tiền nếu nội dung bắt đầu bằng lệnh chỉ định
        if (napIndex !== -1 && tramIndex === napIndex + 1 && splitContent.length > tramIndex + 1) {
            // [FIX] Lọc bỏ ký tự đặc biệt (dấu -/. do ngân hàng tự thêm) để khớp đúng username trong DB
            const username = splitContent[tramIndex + 1].toLowerCase().replace(/[^a-z0-9]/g, '');

            db.query('UPDATE users SET balance = balance + ? WHERE username = ?', [transferAmount, username], (err, result) => {
                if (err) {
                    console.error('⚠️ [Webhook] Lỗi cộng tiền:', err.message);
                    return res.status(500).json({ success: false, message: 'Lỗi DB' });
                }
                if (result.affectedRows === 0) {
                    console.log(`⚠️ [Webhook] Nhận được ${transferAmount}đ nhưng không tìm thấy tài khoản "${username}". Vui lòng xử lý tay!`);
                    return res.status(404).json({ success: false, message: 'User không tồn tại' });
                }

                console.log(`🔥 [Webhook] Tự động CỘNG ${transferAmount}đ vào ví của User "${username}" thành công!`);

                // [MỚI] Ghi log và chốt Transaction ID để chống cộng tiền đúp
                db.query('INSERT INTO topup_history (transaction_id, username, amount, note) VALUES (?, ?, ?, ?)', [transactionId, username, transferAmount, content], (hErr) => {
                    if (hErr) console.error('⚠️ [Webhook] Lỗi ghi log nạp tiền:', hErr.message);
                });

                return res.json({ success: true, message: 'Đã nạp tiền thành công' });
            });
        } else {
            // Có người chuyển tiền không đúng cú pháp, ghi log lại báo cho Admin
            console.log(`⚠️ [Webhook] Giao dịch ${transferAmount}đ KHÔNG đúng Cú pháp. Lời nhắn: "${content}"`);
            return res.status(200).json({ success: true, message: 'Webhook đã ghi nhận (Bỏ qua nạp tự động do sai cú pháp)' });
        }
    });
});

// [MỚI] API lấy lịch sử nạp tiền của người dùng (Hỗ trợ lọc theo Khoảng thời gian)
app.get('/api/user/topup-history', (req, res) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ success: false, message: 'Thiếu Token' });

    const token = authHeader.split(' ')[1];
    jwt.verify(token, SECRET_KEY, (err, decoded) => {
        if (err) return res.status(401).json({ success: false, message: 'Token hết hạn' });

        const username = decoded.username;
        const { startDate, endDate } = req.query; // Nhận tham số lọc: startDate, endDate (YYYY-MM-DD)

        let sql = 'SELECT amount, note, created_at FROM topup_history WHERE username = ?';
        let params = [username];

        if (startDate && endDate) {
            // Lọc trong khoảng từ 00:00:00 ngày bắt đầu đến 23:59:59 ngày kết thúc
            sql += ' AND created_at >= ? AND created_at <= ?';
            params.push(`${startDate} 00:00:00`);
            params.push(`${endDate} 23:59:59`);
        }

        sql += ' ORDER BY created_at DESC LIMIT 200'; // Tăng giới hạn bản ghi khi xem theo khoảng thời gian

        db.query(sql, params, (err, results) => {
            if (err) return res.status(500).json({ success: false, message: 'Lỗi DB' });
            res.json({ success: true, data: results });
        });
    });
});

// [MỚI] API xóa toàn bộ lịch sử nạp tiền của người dùng
app.delete('/api/user/topup-history', (req, res) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ success: false, message: 'Thiếu Token' });

    const token = authHeader.split(' ')[1];
    jwt.verify(token, SECRET_KEY, (err, decoded) => {
        if (err) return res.status(401).json({ success: false, message: 'Token hết hạn' });

        const username = decoded.username;
        db.query('DELETE FROM topup_history WHERE username = ?', [username], (err, result) => {
            if (err) return res.status(500).json({ success: false, message: 'Lỗi DB' });
            res.json({ success: true, message: 'Đã xóa toàn bộ lịch sử nạp tiền' });
        });
    });
});

// Chặn báo lỗi rác 404 do trình duyệt tự tìm file favicon
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Bắt tất cả các đường dẫn không tồn tại và trả về lỗi 404 chuẩn JSON
app.use((req, res) => res.status(404).json({ success: false, message: 'Đường dẫn API hoặc File không tồn tại!' }));

// Khởi động Web Server
app.listen(port, () => {
    console.log(`🚀 Backend Server đang chạy tại: http://localhost:${port}`);
    // Chạy Worker mỗi 15 giây
    setInterval(runBackgroundWorker, 15000);
});
