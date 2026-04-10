const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// 1. API Đăng nhập
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  // Giả lập check database
  if (username && password) {
    res.json({ success: true, token: 'fake-jwt-token-12345' });
  } else {
    res.json({ success: false, message: 'Vui lòng nhập tài khoản và mật khẩu!' });
  }
});

// 2. API Lấy thông tin hồ sơ/ví User
app.get('/api/user/me', (req, res) => {
  // Giả lập trả về số dư ví của User
  res.json({ success: true, data: { balance: 150000 } });
});

// 3. API Lấy danh sách trạm sạc
app.get('/api/stations', (req, res) => {
  // Mock data khớp với UI Frontend đang cần
  const mockStations = [
    { station_id: "001", name: "Trạm Sạc Vincom", location: "Quận 1, TP.HCM", status: "online", unit_price: 3500 },
    { station_id: "002", name: "Trạm Sạc Đại học Bách Khoa", location: "Quận 10, TP.HCM", status: "online", unit_price: 3200 },
    { station_id: "003", name: "Trạm Sạc Landmark 81", location: "Bình Thạnh, TP.HCM", status: "offline", unit_price: 3800 }
  ];
  res.json({ success: true, data: mockStations });
});

// 4. API Bắt đầu sạc (từ mã QR hoặc danh sách)
app.post('/api/charge/start', (req, res) => {
  const { stationId, outletId } = req.body;
  
  // TODO: Gửi tín hiệu xuống mạch ESP8266/ESP32 ở đây
  console.log(`=> Yêu cầu bật sạc tại Trạm: ${stationId} - Ổ cắm: ${outletId}`);
  
  res.json({ 
    success: true, 
    message: `Kích hoạt thành công Trạm ${stationId} - Ổ ${outletId}` 
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`EV Charging API Server đang chạy tại cổng ${PORT}`);
});
