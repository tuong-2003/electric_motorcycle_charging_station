const express = require('express');
const mqtt = require('mqtt');
const cors = require('cors');
const jwt = require('jsonwebtoken'); // [MỚI] Thư viện cấp phát và kiểm tra Token
const mysql = require('mysql2'); // [MỚI] Khai báo thư viện kết nối MySQL

const app = express();
const port = 3000;

// Khóa bí mật dùng để ký Token (Tuyệt đối không để lộ)
const SECRET_KEY = 'khoa_bi_mat_cua_admin_tram_sac';

// Middleware để đọc dữ liệu JSON từ Client gửi lên
app.use(cors());
app.use(express.json());

// ==========================================
// 1. CẤU HÌNH CƠ SỞ DỮ LIỆU MYSQL
// ==========================================
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',      // Tài khoản mặc định của XAMPP
    password: '',      // Mật khẩu mặc định của XAMPP là rỗng
    database: 'ev_station'
});

db.connect((err) => {
    if (err) {
        console.error('❌ [MySQL] Không thể kết nối! Hãy chắc chắn bạn đã bật MySQL trên XAMPP.');
    } else {
        console.log('🗄️ [MySQL] Đã kết nối tới Database ev_station thành công!');
    }
});

// ==========================================
// 2. CẤU HÌNH MQTT KẾT NỐI VỚI ESP32
// ==========================================
const MQTT_BROKER = 'mqtt://broker.hivemq.com';
const client = mqtt.connect(MQTT_BROKER);

const TOPIC_STATUS = 'ev_station/001/status';
const TOPIC_CMD = 'ev_station/001/cmd';

client.on('connect', () => {
    console.log('🔗 [MQTT] Đã kết nối tới Broker thành công!');
    client.subscribe(TOPIC_STATUS, (err) => {
        if (!err) console.log(`📡 [MQTT] Đang lắng nghe ESP32 tại topic: ${TOPIC_STATUS}`);
    });
});

// Hứng dữ liệu ESP32 gửi lên
client.on('message', (topic, message) => {
    if (topic === TOPIC_STATUS) {
        const data = JSON.parse(message.toString());
        console.log('⚡ [Trạm 001] Trạng thái:', data);
        
        // Lưu dữ liệu vào Database MySQL
        const sql = 'INSERT INTO telemetry (station_id, status, voltage, current, power) VALUES (?, ?, ?, ?, ?)';
        db.query(sql, [data.station_id, data.status, data.voltage, data.current, data.power], (err, result) => {
            if (err) console.error('⚠️ [MySQL] Lỗi ghi dữ liệu:', err.message);
        });
    }
});

// ==========================================
// 3. API ĐĂNG NHẬP & MIDDLEWARE BẢO MẬT
// ==========================================

// API Đăng nhập ảo
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    // Truy vấn Database để tìm User
    const sql = 'SELECT * FROM users WHERE username = ?';
    db.query(sql, [username], (err, results) => {
        if (err) {
            console.error('⚠️ [MySQL] Lỗi truy vấn:', err.message);
            return res.status(500).json({ success: false, message: 'Lỗi Server!' });
        }

        // Nếu không tìm thấy ai có username này
        if (results.length === 0) {
            return res.status(401).json({ success: false, message: 'Sai tài khoản hoặc mật khẩu!' });
        }

        const user = results[0]; // Lấy thông tin user tìm được
        // So sánh mật khẩu (Trong thực tế công nghiệp sẽ dùng thư viện bcrypt để giải mã)
        if (user.password === password) {
            const token = jwt.sign({ id: user.id, role: user.role, username: user.username }, SECRET_KEY, { expiresIn: '1h' });
            res.json({ success: true, token: token, message: `Đăng nhập thành công! Xin chào ${user.role} ${user.username}` });
        } else {
            res.status(401).json({ success: false, message: 'Sai tài khoản hoặc mật khẩu!' });
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
    const stationId = '001';

    // 1. Kiểm tra số dư người dùng
    db.query('SELECT balance FROM users WHERE id = ?', [userId], (err, results) => {
        if (err || results.length === 0) return res.status(500).json({ success: false, message: 'Lỗi DB' });
        
        if (results[0].balance <= 0) {
            return res.status(400).json({ success: false, message: '⛔ Số dư ví không đủ để sạc!' });
        }

        // 2. Kiểm tra xem trụ sạc có đang rảnh không
        db.query('SELECT id FROM charging_sessions WHERE station_id = ? AND status = "ongoing"', [stationId], (err, sessions) => {
            if (sessions.length > 0) {
                return res.status(400).json({ success: false, message: '⛔ Trụ sạc này đang được sử dụng!' });
            }

            // 3. Tạo Phiên sạc mới
            db.query('INSERT INTO charging_sessions (station_id, status) VALUES (?, "ongoing")', [stationId], (err) => {
                console.log(`📲 [API] User [${req.user.username}] bắt đầu sạc tại trụ ${stationId}`);
                client.publish(TOPIC_CMD, JSON.stringify({ command: 'START_CHARGE' }));
                res.json({ success: true, message: '✅ Đã bắt đầu phiên sạc thành công!' });
            });
        });
    });
});

app.post('/api/charge/stop', verifyToken, (req, res) => {
    const userId = req.user.id;
    const stationId = '001';
    const UNIT_PRICE = 3500; // Đơn giá điện: 3.500 VNĐ/kWh

    console.log(`📲 [API] User [${req.user.username}] yêu cầu CHỐT phiên sạc`);

    // 1. Tìm phiên sạc đang chạy và tính tổng thời gian (giây)
    db.query('SELECT id, start_time, TIMESTAMPDIFF(SECOND, start_time, NOW()) as duration_sec FROM charging_sessions WHERE station_id = ? AND status = "ongoing"', [stationId], (err, sessions) => {
        if (err || sessions.length === 0) {
            client.publish(TOPIC_CMD, JSON.stringify({ command: 'STOP_CHARGE' }));
            return res.json({ success: true, message: '✅ Đã ngắt Relay (Không có phiên sạc nào cần chốt tiền).' });
        }

        const sessionId = sessions[0].id;
        const durationHours = sessions[0].duration_sec / 3600.0; // Đổi ra giờ

        // 2. Tính công suất trung bình dựa vào lịch sử Telemetry đã ghi nhận
        db.query('SELECT AVG(power) as avg_power FROM telemetry WHERE station_id = ? AND created_at >= ?', [stationId, sessions[0].start_time], (err, tele) => {
            // Xử lý an toàn trường hợp tele[0].avg_power trả về null (do sạc quá ngắn)
            let avgPower = (tele && tele.length > 0 && tele[0].avg_power != null) ? tele[0].avg_power : 0;
            
            const totalKwh = (avgPower / 1000) * durationHours;
            const totalCost = totalKwh * UNIT_PRICE;

            // 3. Cập nhật số điện/tiền vào hóa đơn (Phiên sạc)
            db.query('UPDATE charging_sessions SET end_time = NOW(), total_kwh = ?, total_cost = ?, status = "completed" WHERE id = ?', [totalKwh, totalCost, sessionId], () => {
                
                // 4. Trừ tiền vào ví User
                db.query('UPDATE users SET balance = balance - ? WHERE id = ?', [totalCost, userId], () => {
                    client.publish(TOPIC_CMD, JSON.stringify({ command: 'STOP_CHARGE' }));
                    res.json({ success: true, message: `✅ Đã chốt hóa đơn!\n- Tiêu thụ: ${totalKwh.toFixed(4)} kWh\n- Thành tiền: ${totalCost.toFixed(0)} VNĐ` });
                });
            });
        });
    });
});

// API Lấy dữ liệu lịch sử để vẽ biểu đồ
app.get('/api/telemetry/history', (req, res) => {
    // Lấy 20 bản ghi gần nhất, format thời gian thành giờ:phút:giây
    const sql = 'SELECT power, DATE_FORMAT(created_at, "%H:%i:%s") as time FROM telemetry ORDER BY id DESC LIMIT 20';
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

// API Lấy thông tin ví tiền của User đang đăng nhập
app.get('/api/user/me', verifyToken, (req, res) => {
    db.query('SELECT username, role, balance FROM users WHERE id = ?', [req.user.id], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Lỗi DB' });
        if (results.length === 0) return res.status(404).json({ success: false, message: 'Không tìm thấy User' });
        res.json({ success: true, data: results[0] });
    });
});

// Khởi động Web Server
app.listen(port, () => {
    console.log(`🚀 Backend Server đang chạy tại: http://localhost:${port}`);
});