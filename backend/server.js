require('dotenv').config(); // [MỚI] Load cấu hình từ file .env
const express = require('express');
const mqtt = require('mqtt');
const cors = require('cors');
const jwt = require('jsonwebtoken'); // [MỚI] Thư viện cấp phát và kiểm tra Token
const mysql = require('mysql2'); // [MỚI] Khai báo thư viện kết nối MySQL
const bcrypt = require('bcryptjs'); // [MỚI] Thư viện mã hóa mật khẩu
const nodemailer = require('nodemailer'); // [MỚI] Thư viện gửi Email
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
const db = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'ev_station',
    port: process.env.DB_PORT || 3306
});

db.connect((err) => {
    if (err) {
        console.error('❌ [MySQL] Không thể kết nối! Chi tiết lỗi:', err.message);
    } else {
        console.log('🗄️ [MySQL] Đã kết nối tới Database thành công!');
    }
});

// ==========================================
// CẤU HÌNH GỬI EMAIL (NODEMAILER)
// ==========================================
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'tuog678@gmail.com', // Thay bằng email của bạn
        pass: 'wssu aqds otrb ysil'  // Thay bằng Mật khẩu ứng dụng 16 chữ số
    }
});
const otpStorage = new Map(); // Lưu tạm mã OTP trong RAM (sẽ tự hủy nếu reset máy chủ)

// ==========================================
// 2. CẤU HÌNH MQTT KẾT NỐI VỚI ESP32
// ==========================================
const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://broker.hivemq.com';
const client = mqtt.connect(MQTT_BROKER);

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
        const data = JSON.parse(message.toString());
        const stationId = parts[1];
        const outletId = parts[3];
        
        console.log(`⚡ [Tủ ${stationId} - Ổ ${outletId}] Trạng thái:`, data);
        
        // Lưu dữ liệu vào Database MySQL
        const sql = 'INSERT INTO telemetry (station_id, status, voltage, current, power) VALUES (?, ?, ?, ?, ?)';
        db.query(sql, [`${stationId}.${outletId}`, data.status, data.voltage, data.current, data.power], (err, result) => {
            if (err) console.error('⚠️ [MySQL] Lỗi ghi dữ liệu:', err.message);
        });
    }
});

// ==========================================
// 3. API ĐĂNG NHẬP & MIDDLEWARE BẢO MẬT
// ==========================================

// API Đăng nhập ảo
app.post('/api/login', (req, res) => {
    const { username, password, rememberMe } = req.body;

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
    const { username } = req.body;
    if (!username) return res.status(400).json({ success: false, message: 'Vui lòng nhập tên tài khoản!' });

    db.query('SELECT id, email FROM users WHERE username = ?', [username], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Lỗi DB' });
        if (results.length === 0) return res.status(404).json({ success: false, message: 'Tài khoản không tồn tại!' });

        const userEmail = results[0].email;
        if (!userEmail) return res.status(400).json({ success: false, message: 'Tài khoản này chưa được liên kết Email!' });

        // Tạo mã OTP ngẫu nhiên 6 số
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        otpStorage.set(username, { otp, expires: Date.now() + 5 * 60 * 1000 }); // Sống 5 phút

        const mailOptions = {
            from: '"EV Station Admin" <no-reply@evstation.com>',
            to: userEmail,
            subject: 'Mã OTP khôi phục mật khẩu - EV Station',
            text: `Chào ${username},\n\nMã OTP khôi phục mật khẩu của bạn là: ${otp}\nMã này sẽ hết hạn sau 5 phút.\n\nNếu bạn không yêu cầu đổi mật khẩu, vui lòng bỏ qua email này.`
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) return res.status(500).json({ success: false, message: 'Lỗi gửi email! Vui lòng kiểm tra cấu hình Gmail.' });
            
            // Che mờ Email để bảo mật (VD: tuog678@gmail.com -> t***@gmail.com)
            const maskedEmail = userEmail.replace(/(.{1})(.*)(?=@)/, (match, p1, p2) => p1 + '*'.repeat(p2.length));
            res.json({ success: true, message: `Mã OTP đã được gửi về địa chỉ: ${maskedEmail}` });
        });
    });
});

// API Đặt lại mật khẩu mới bằng OTP
app.post('/api/reset-password', async (req, res) => {
    const { username, otp, newPassword } = req.body;
    
    const record = otpStorage.get(username);
    if (!record) return res.status(400).json({ success: false, message: 'OTP đã hết hạn hoặc chưa được yêu cầu!' });
    if (Date.now() > record.expires) { otpStorage.delete(username); return res.status(400).json({ success: false, message: 'Mã OTP đã hết hạn (quá 5 phút)!' }); }
    if (record.otp !== otp) return res.status(400).json({ success: false, message: 'Mã OTP không chính xác!' });
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ success: false, message: 'Mật khẩu mới phải từ 6 ký tự!' });

    const hashed = await bcrypt.hash(newPassword, 10);
    db.query('UPDATE users SET password = ? WHERE username = ?', [hashed, username], (err) => {
        if (err) return res.status(500).json({ success: false, message: 'Lỗi cập nhật DB' });
        otpStorage.delete(username); // Dọn rác
        res.json({ success: true, message: 'Đổi mật khẩu thành công!' });
    });
});

// API Đăng ký tài khoản tự do (Cho khách hàng từ App)
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) return res.status(400).json({ success: false, message: 'Vui lòng điền đầy đủ thông tin!' });
    if (password.length < 6) return res.status(400).json({ success: false, message: 'Mật khẩu phải từ 6 ký tự!' });

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return res.status(400).json({ success: false, message: 'Địa chỉ Email không hợp lệ!' });

    try {
        const hashed = await bcrypt.hash(password, 10);
        // Mặc định khách tự đăng ký sẽ có role là 'user'
        db.query('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, "user")', [username, email, hashed], (err) => {
            if (err) return res.status(400).json({ success: false, message: 'Tài khoản hoặc Email đã tồn tại trong hệ thống!' });
            res.json({ success: true, message: 'Đăng ký thành công! Bạn có thể đăng nhập ngay.' });
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Lỗi mã hóa dữ liệu!' });
    }
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

    // 1. Kiểm tra số dư người dùng
    db.query('SELECT balance FROM users WHERE id = ?', [userId], (err, results) => {
        if (err || results.length === 0) return res.status(500).json({ success: false, message: 'Lỗi DB' });
        
        if (results[0].balance <= 0) {
            return res.status(400).json({ success: false, message: '⛔ Số dư ví không đủ để sạc!' });
        }

        // 2. Kiểm tra xem trụ sạc có đang rảnh không
        db.query('SELECT id FROM charging_sessions WHERE station_id = ? AND status = "ongoing"', [`${stationId}.${outletId}`], (err, sessions) => {
            if (sessions.length > 0) {
                return res.status(400).json({ success: false, message: '⛔ Trụ sạc này đang được sử dụng!' });
            }

            // 3. Tạo Phiên sạc mới
            db.query('INSERT INTO charging_sessions (station_id, status) VALUES (?, "ongoing")', [`${stationId}.${outletId}`], (err) => {
                console.log(`📲 [API] User [${req.user.username}] bắt đầu sạc tại Tủ ${stationId}, Ổ ${outletId}`);
                const topicCmd = `ev_station/${stationId}/outlet/${outletId}/cmd`;
                client.publish(topicCmd, JSON.stringify({ command: 'START_CHARGE' }));
                res.json({ success: true, message: '✅ Đã bắt đầu phiên sạc thành công!' });
            });
        });
    });
});

app.post('/api/charge/stop', verifyToken, (req, res) => {
    const userId = req.user.id;
    const { stationId, outletId } = req.body;
    const UNIT_PRICE = 3500; // Đơn giá điện: 3.500 VNĐ/kWh

    console.log(`📲 [API] User [${req.user.username}] yêu cầu CHỐT phiên sạc`);
    const fullStationId = `${stationId}.${outletId}`;

    // 1. Tìm phiên sạc đang chạy và tính tổng thời gian (giây)
    db.query('SELECT id, start_time, TIMESTAMPDIFF(SECOND, start_time, NOW()) as duration_sec FROM charging_sessions WHERE station_id = ? AND status = "ongoing"', [fullStationId], (err, sessions) => {
        if (err || sessions.length === 0) {
            client.publish(`ev_station/${stationId}/outlet/${outletId}/cmd`, JSON.stringify({ command: 'STOP_CHARGE' }));
            return res.json({ success: true, message: '✅ Đã ngắt Relay (Không có phiên sạc nào cần chốt tiền).' });
        }

        const sessionId = sessions[0].id;
        const durationHours = sessions[0].duration_sec / 3600.0; // Đổi ra giờ

        // 2. Tính công suất trung bình dựa vào lịch sử Telemetry đã ghi nhận
        db.query('SELECT AVG(power) as avg_power FROM telemetry WHERE station_id = ? AND created_at >= ?', [fullStationId, sessions[0].start_time], (err, tele) => {
            // Xử lý an toàn trường hợp tele[0].avg_power trả về null (do sạc quá ngắn)
            let avgPower = (tele && tele.length > 0 && tele[0].avg_power != null) ? tele[0].avg_power : 0;
            
            const totalKwh = (avgPower / 1000) * durationHours;
            const totalCost = totalKwh * UNIT_PRICE;

            // 3. Cập nhật số điện/tiền vào hóa đơn (Phiên sạc)
            db.query('UPDATE charging_sessions SET end_time = NOW(), total_kwh = ?, total_cost = ?, status = "completed" WHERE id = ?', [totalKwh, totalCost, sessionId], () => {
                
                // 4. Trừ tiền vào ví User
                db.query('UPDATE users SET balance = balance - ? WHERE id = ?', [totalCost, userId], () => {
                    client.publish(`ev_station/${stationId}/outlet/${outletId}/cmd`, JSON.stringify({ command: 'STOP_CHARGE' }));
                    res.json({ success: true, message: `✅ Đã chốt hóa đơn!\n- Tiêu thụ: ${totalKwh.toFixed(4)} kWh\n- Thành tiền: ${totalCost.toFixed(0)} VNĐ` });
                });
            });
        });
    });
});

// API Lấy dữ liệu lịch sử để vẽ biểu đồ
app.get('/api/telemetry/history', (req, res) => {
    // Gom nhóm theo thời gian, tách riêng công suất ổ 1.1 và ổ 1.2
    const sql = `
        SELECT 
            DATE_FORMAT(created_at, "%H:%i:%s") as time,
            SUM(CASE WHEN station_id LIKE '001.%' THEN power ELSE 0 END) as power_1,
            SUM(CASE WHEN station_id LIKE '002.%' THEN power ELSE 0 END) as power_2
        FROM telemetry 
        GROUP BY time ORDER BY time DESC LIMIT 20
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Lỗi DB' });
        // Đảo ngược mảng để vẽ từ trái (cũ) sang phải (mới)
        res.json({ success: true, data: results.reverse() });
    });
});

// API Lấy danh sách lịch sử sạc (Hóa đơn)
app.get('/api/sessions/history', (req, res) => {
    const sql = `
        SELECT id, station_id, 
               DATE_FORMAT(start_time, '%d/%m/%Y %H:%i:%s') as start, 
               DATE_FORMAT(end_time, '%d/%m/%Y %H:%i:%s') as end, 
               total_kwh, total_cost, status 
        FROM charging_sessions 
        ORDER BY id DESC LIMIT 50
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Lỗi DB' });
        res.json({ success: true, data: results });
    });
});

// API Lấy danh sách Trạm sạc và Tổng điện năng
app.get('/api/stations', verifyToken, (req, res) => {
    // Câu lệnh SQL: Lấy thông tin trạm VÀ tính tổng kWh từ các hóa đơn đã hoàn tất
    const sql = `
        SELECT 
            s.station_id, 
            s.name, 
            s.location, 
            s.unit_price, 
            s.status,
            COALESCE(SUM(cs.total_kwh), 0) as total_kwh
        FROM stations s
        LEFT JOIN charging_sessions cs ON cs.station_id LIKE CONCAT(s.station_id, '.%') AND cs.status = 'completed'
        GROUP BY s.station_id
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Lỗi DB' });
        res.json({ success: true, data: results });
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

// API Lấy danh sách User (Chỉ Admin)
app.get('/api/users', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Chỉ Admin mới có quyền xem danh sách!' });
    db.query('SELECT id, username, role, balance, created_at FROM users', (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Lỗi DB' });
        res.json({ success: true, data: results });
    });
});

// API Đăng ký User mới (Chỉ Admin)
app.post('/api/users/register', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Chỉ Admin mới có quyền tạo tài khoản!' });
    const { username, email, password, role } = req.body;
    if (!username || !password || !email) return res.status(400).json({ success: false, message: 'Thiếu thông tin!' });
    
    const hashed = await bcrypt.hash(password, 10);
    db.query('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)', [username, email, hashed, role || 'user'], (err) => {
        if (err) return res.status(400).json({ success: false, message: 'Username hoặc Email đã bị trùng!' });
        res.json({ success: true, message: 'Tạo tài khoản thành công!' });
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

// ==========================================
// 4. BACKGROUND WORKER (CRONJOB) - GIÁM SÁT & TỰ ĐỘNG XỬ LÝ
// ==========================================
function runBackgroundWorker() {
    console.log('⚙️  [Worker] Running background checks...');

    // Lấy tất cả các phiên đang sạc (ongoing)
    db.query('SELECT s.id, s.station_id, s.start_time, u.id as user_id, u.balance FROM charging_sessions s JOIN users u ON s.rfid_tag = (SELECT rfid_tag FROM rfid_cards WHERE user_id = u.id LIMIT 1) WHERE s.status = "ongoing"', (err, sessions) => {
        if (err || sessions.length === 0) return;

        sessions.forEach(session => {
            // VÁ LỖ HỔNG 2: "TREO HÓA ĐƠN" DO MẤT KẾT NỐI
            // Kiểm tra "nhịp tim" (heartbeat) từ trạm sạc
            db.query('SELECT created_at FROM telemetry WHERE station_id = ? ORDER BY id DESC LIMIT 1', [session.station_id], (err, tele) => {
                if (tele.length > 0) {
                    const lastHeartbeat = new Date(tele[0].created_at);
                    const secondsSinceLastHeartbeat = (new Date() - lastHeartbeat) / 1000;

                    // Nếu quá 30 giây không thấy tín hiệu, coi như trạm đã mất kết nối -> Tự động chốt đơn
                    if (secondsSinceLastHeartbeat > 30) {
                        console.log(`⚠️ [Worker] Trạm ${session.station_id} mất kết nối! Tự động chốt hóa đơn #${session.id}`);
                        // Gọi API tự chốt đơn (giả lập như người dùng bấm nút Tắt)
                        const stopPayload = { user: { id: session.user_id, username: 'System' } }; // Giả lập req.user
                        const res = { status: () => ({ json: () => {} }), json: () => {} }; // Giả lập res
                        app.handle({ method: 'POST', url: '/api/charge/stop', body: stopPayload, user: stopPayload.user }, res);
                        return; // Dừng kiểm tra phiên này
                    }
                }
            });

            // VÁ LỖ HỔNG 1: "SẠC ĐẾN ÂM TIỀN"
            // Tính toán chi phí tạm thời
            const durationHours = (new Date() - new Date(session.start_time)) / 3600000.0;
            db.query('SELECT AVG(power) as avg_power FROM telemetry WHERE station_id = ? AND created_at >= ?', [session.station_id, session.start_time], (err, tele) => {
                let avgPower = (tele && tele.length > 0 && tele[0].avg_power != null) ? tele[0].avg_power : 0;
                const tempCost = (avgPower / 1000) * durationHours * 3500; // UNIT_PRICE

                // Nếu chi phí tạm thời đã vượt quá số dư, tự động ngắt sạc
                if (tempCost >= session.balance) {
                    console.log(`💰 [Worker] Ví của User #${session.user_id} sắp hết tiền! Tự động ngắt sạc tại trụ ${session.station_id}`);
                    const [stId, outId] = session.station_id.split('.');
                    client.publish(`ev_station/${stId}/outlet/${outId}/cmd`, JSON.stringify({ command: 'STOP_CHARGE' }));
                }
            });
        });
    });
}

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