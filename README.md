# He thong tram sac xe dien EV Charging Station

Do an xay dung mo hinh tram sac xe dien co kha nang dieu khien, giam sat va thanh toan qua ung dung. He thong gom tu sac ESP32, bo gateway ESP32, backend Node.js/MySQL, giao dien quan tri web va ung dung di dong Expo.

## 1. Tong quan

He thong cho phep nguoi dung dang ky/dang nhap, nap tien vao vi, quet QR tren tu sac, bat/tat phien sac, xem so du va lich su sac. Quan tri vien co the theo doi trang thai tram theo thoi gian gan thuc, cau hinh gia dien, cau hinh nguong bao ve, quan ly nguoi dung va xem lich su giao dich.

Luong du lieu chinh:

```text
Station ESP32 -> Modbus RTU/RS485 -> Gateway ESP32 -> MQTT -> Backend Node.js -> MySQL/Web/App
Web/App -> Backend API -> MQTT -> Gateway ESP32 -> Modbus RTU/RS485 -> Station ESP32
```

## 2. Thanh phan he thong

| Thanh phan | Thu muc / file | Vai tro |
| --- | --- | --- |
| Firmware Gateway | `src/gateway/` | Doc du lieu Modbus tu cac tu sac, day telemetry len MQTT, nhan lenh/cau hinh tu MQTT va ghi xuong Modbus |
| Firmware Station | `src/station/` | Dieu khien 2 cong sac, relay, cam bien PZEM-004T, DHT11, man hinh TFT, QR va OTA noi bo |
| Backend | `backend/server.js` | API, MQTT subscriber/publisher, xu ly phien sac, thanh toan, nguoi dung, telemetry va bao ve he thong |
| Web admin | `backend/public/index.html` | Giao dien quan tri tram sac, nguoi dung, lich su, dieu khien cong sac |
| Mobile app | `ev-user-app/` | Ung dung Expo/React Native cho nguoi dung: dang nhap, vi tien, QR, sac, lich su |
| Database schema | `database.dbml` | Mo ta bang users, stations, telemetry, charging_sessions, topup_history |

## 3. Tinh nang chinh

- Giam sat dien ap, dong dien, cong suat, nhiet do va do am.
- Dieu khien bat/tat 2 cong sac tren moi tu sac.
- Giao tiep noi bo Modbus RTU qua RS485 giua gateway va station.
- Giao tiep cloud MQTT voi topic dang `ev_station/{station_id}/outlet/{outlet_id}/...`.
- Bao ve qua dong, qua nhiet, mat ket noi va gioi han thoi gian sac.
- Tai khoan nguoi dung, vi tien, lich su sac va lich su nap tien.
- Nap tien qua webhook ngan hang/Open Banking theo cu phap `NAP TRAM {username}`.
- Giao dien web cho admin va ung dung di dong cho nguoi dung.
- OTA firmware cho station qua WiFi AP `EV_Station_OTA`.

## 4. Cau truc thu muc

```text
.
|-- backend/              # Node.js backend va giao dien quan tri web
|-- docs/                 # Bao cao, phu luc, so do, hinh anh ket qua
|-- ev-user-app/          # Ung dung di dong Expo/React Native
|-- src/
|   |-- gateway/          # Firmware ESP32 gateway
|   `-- station/          # Firmware ESP32 station
|-- database.dbml         # So do CSDL dang DBML
`-- platformio.ini        # Cau hinh build PlatformIO
```

## 5. Tai lieu do an

- [Bao cao do an PDF](docs/bao-cao-do-an.pdf)
- [Nguon bao cao Markdown](docs/bao-cao-do-an.md)
- [Phu luc ky thuat](docs/phu-luc.md)
- [So do he thong](docs/so-do-he-thong.png)
- [So do ket noi phan cung](docs/so-do-ket-noi.png)
- [Ket qua demo](docs/ket-qua-demo/)

Luu y: cac hinh trong `docs/` la bo minh hoa/khung trinh bay de dua len GitHub. Khi co anh chup thuc te tu dashboard, app, man hinh TFT va Serial Monitor, co the thay the truc tiep cac file cung ten.

## 6. Cai dat va chay

### 6.1. Firmware ESP32

Yeu cau:

- Visual Studio Code + PlatformIO
- Board ESP32 DevKit
- Thu vien PlatformIO da khai bao trong `platformio.ini`

Build ca hai firmware:

```bash
pio run
```

Build rieng gateway:

```bash
pio run -e gateway
```

Build rieng station:

```bash
pio run -e station
```

Nap firmware:

```bash
pio run -e gateway -t upload
pio run -e station -t upload
```

### 6.2. Backend

```bash
cd backend
npm install
npm start
```

Backend mac dinh chay tren:

```text
http://localhost:3000
```

Cac bien moi truong nen cau hinh qua `.env`:

```env
PORT=3000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=ev_station
DB_PORT=3306
JWT_SECRET=change_me
MQTT_BROKER=mqtt://broker.hivemq.com
WEBHOOK_SECRET=change_me
ADMIN_USERNAME=Admin
ADMIN_PASSWORD=change_me
ADMIN_EMAIL=admin@example.com
```

### 6.3. Mobile app

```bash
cd ev-user-app
npm install
npm start
```

Sau khi Expo khoi dong, co the chay bang Expo Go, Android emulator, iOS simulator hoac web tuy moi truong.

## 7. MQTT topic

| Topic | Huong | Noi dung |
| --- | --- | --- |
| `ev_station/001/outlet/1/status` | Gateway -> Cloud | Trang thai, V/A/W, nhiet do, do am cua cong 1 |
| `ev_station/001/outlet/2/status` | Gateway -> Cloud | Trang thai, V/A/W cua cong 2 |
| `ev_station/001/outlet/1/cmd` | Backend -> Gateway | `START_CHARGE` / `STOP_CHARGE` |
| `ev_station/001/outlet/2/cmd` | Backend -> Gateway | `START_CHARGE` / `STOP_CHARGE` |
| `ev_station/001/config` | Backend -> Gateway | `max_current`, `temp_limit`, `status` |

## 8. Co so du lieu

Schema duoc mo ta trong [database.dbml](database.dbml), gom cac bang chinh:

- `users`: tai khoan, vai tro, email, mat khau da hash, so du vi.
- `stations`: thong tin tu sac, vi tri, gia dien, trang thai, nguong cau hinh.
- `telemetry`: log dien ap, dong dien, cong suat, nhiet do, do am.
- `charging_sessions`: phien sac, thoi gian, san luong, chi phi.
- `topup_history`: lich su nap tien va ma giao dich ngan hang.

## 9. Ket qua dat duoc

- Xay dung duoc mo hinh tram sac 2 cong dung ESP32.
- Dieu khien relay va doc thong so dien qua PZEM-004T.
- Hien thi QR va trang thai len man hinh TFT ST7735.
- Gateway doc station qua Modbus va dua du lieu len MQTT.
- Backend luu log, quan ly phien sac, vi tien va webhook nap tien.
- Web admin va mobile app co kha nang theo doi, dieu khien va xem lich su.

## 10. Luu y bao mat truoc khi public GitHub

Truoc khi dua repo len GitHub public, can kiem tra va thay cac thong tin that bang bien moi truong hoac placeholder, dac biet:

- WiFi SSID/password trong firmware.
- `JWT_SECRET`, `WEBHOOK_SECRET`, tai khoan admin mac dinh.
- Thong tin email/API key/ngan hang neu co.
- URL backend public neu khong muon cong khai.

## 11. Huong phat trien

- Tach cau hinh WiFi/MQTT ra file rieng khong commit.
- Bo sung migration SQL tu `database.dbml`.
- Them test API backend va test tinh tien phien sac.
- Bo sung xac thuc OTA va ma hoa ket noi MQTT.
- Hoan thien case nhieu station, nhieu gateway va dashboard realtime bang WebSocket.
