#include <Arduino.h>
#include <DHT.h>
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include <qrcode.h>
#include <PZEM004Tv30.h>
#include "ModbusSlaveTask.h"
#include <WiFi.h>
#include <WebServer.h>
#include <Update.h>
#include <Preferences.h>

// --- Cấu hình Màn hình TFT ST7735 ---
#define TFT_CS    32
#define TFT_RST   33
#define TFT_DC    25
#define TFT_MOSI  26
#define TFT_SCLK  27

SPIClass *spi = new SPIClass(VSPI);
Adafruit_ST7735 tft = Adafruit_ST7735(spi, TFT_CS, TFT_DC, TFT_RST);

// Định nghĩa thêm màu xám đậm (chuẩn RGB565) vì thư viện không có sẵn
#define ST77XX_DARKGREY 0x4208

#define STATION_ID 1 // ID của Tủ sạc này (001)

// --- Cấu hình PZEM-004T ---
#define PZEM_RX_PIN 16
#define PZEM_TX_PIN 17
PZEM004Tv30 pzem(Serial2, PZEM_RX_PIN, PZEM_TX_PIN);

// --- Cấu hình PZEM-004T số 2 ---
#define PZEM2_RX_PIN 3
#define PZEM2_TX_PIN 1
PZEM004Tv30 pzem2(Serial, PZEM2_RX_PIN, PZEM2_TX_PIN);

// --- Cấu hình Relay (Active LOW với Opto PC817) ---
#define RELAY1_PIN 21
#define RELAY2_PIN 22

// --- Cấu hình DHT11 ---
#define DHTPIN 4 
#define DHTTYPE DHT11 
DHT dht(DHTPIN, DHTTYPE);

ModbusSlaveTask modbus;
uint32_t g_lastModbusPollTime = 0;

// --- Biến trạng thái của riêng Tủ này (2 Ổ cắm) ---
bool is_charging[2] = {false, false};
float current_v[2] = {0.0, 0.0};
float current_a[2] = {0.0, 0.0};
float current_w[2] = {0.0, 0.0};
float current_temp = 0.0;
float current_hum = 0.0;

// [MỚI] Biến theo dõi lỗi cục bộ và trạng thái màn hình bảo trì/mất kết nối
int outlet_error[2] = {0, 0}; // 0: OK, 1: Quá dòng, 2: Quá nhiệt
bool was_maintenance = false;
bool was_offline = false;

// Hàm phụ để ánh xạ trạng thái ổ sạc sang mã số nguyên Modbus
uint16_t getOutletStatus(int index) {
  if (is_charging[index]) return 1; // Đang sạc
  if (outlet_error[index] == 1) return 2; // Lỗi quá dòng
  if (outlet_error[index] == 2) return 3; // Lỗi quá nhiệt
  return 0; // Sẵn sàng
}

// --- Nút nhấn (BOOT button) và Trạng thái WiFi AP ---
#define BUTTON_PIN 0
bool is_ap_active = true;
uint32_t btn_press_time = 0;
bool btn_active = false;
bool btn_long_pressed = false;

// --- Cấu hình WebServer cho OTA ---
WebServer server(80);

// --- Cấu hình động & Persistence (NVS) ---
Preferences preferences;
uint16_t g_savedMaxCurrent = 1600;
uint16_t g_savedTempLimit = 65;
uint16_t g_savedStatus = 0;

// Hàm vẽ QR Code lên màn hình TFT
void drawQRCode(const char *text, int offset_x, int offset_y) {
  QRCode qrcode;
  uint8_t qrcodeData[qrcode_getBufferSize(1)];
  qrcode_initText(&qrcode, qrcodeData, 1, 0, text);

  int scale = 2; // Phóng to 2 lần -> Kích thước QR 42x42 px
  int padding = 2; // Viền trắng 2px xung quanh
  
  // Vẽ nền trắng cho QR (Bắt buộc để camera quét được dễ dàng)
  tft.fillRect(offset_x - padding, offset_y - padding, (qrcode.size * scale) + padding*2, (qrcode.size * scale) + padding*2, ST77XX_WHITE);

  for (uint8_t y = 0; y < qrcode.size; y++) {
    for (uint8_t x = 0; x < qrcode.size; x++) {
      if (qrcode_getModule(&qrcode, x, y)) {
        tft.fillRect(offset_x + x * scale, offset_y + y * scale, scale, scale, ST77XX_BLACK);
      }
    }
  }
}

// Hàm vẽ các thành phần tĩnh trên màn hình (chỉ gọi 1 lần lúc khởi động)
void initDisplay() {
  tft.fillScreen(ST77XX_BLACK);
  
  // Vẽ thanh trạng thái (Top Bar)
  tft.fillRect(0, 0, 160, 20, ST77XX_BLUE);
  
  // Vẽ viền và thông tin cố định cho 2 ổ cắm
  for (int i = 0; i < 2; i++) {
    int x_offset = i * 80;
    tft.drawRect(x_offset, 20, 80, 108, ST77XX_DARKGREY);
    
    tft.setCursor(x_offset + 5, 23);
    tft.setTextColor(ST77XX_YELLOW, ST77XX_BLACK);
    tft.setTextSize(1);
    
    char qrText[10];
    snprintf(qrText, sizeof(qrText), "%03d.%d", STATION_ID, i + 1);
    tft.print(qrText);
    
    // Vẽ hình ảnh QR code ở căn giữa cột
    drawQRCode(qrText, x_offset + 19, 35);
  }
}

// [MỚI] Hàm vẽ màn hình bảo trì tĩnh
void printCentered(const char *text, int y, uint16_t color, uint16_t bg = ST77XX_BLACK, uint8_t size = 1) {
  int16_t x1, y1;
  uint16_t w, h;
  tft.setTextSize(size);
  tft.getTextBounds(text, 0, y, &x1, &y1, &w, &h);
  tft.setCursor((160 - w) / 2, y);
  tft.setTextColor(color, bg);
  tft.print(text);
}

void drawMaintenanceScreen() {
  tft.fillScreen(ST77XX_BLACK);

  printCentered("BAO TRI", 20, ST77XX_ORANGE, ST77XX_BLACK, 2);

  printCentered("Tu sac tam ngung phuc vu", 68, ST77XX_WHITE);
  printCentered("Vui long quay lai sau.", 86, ST77XX_WHITE);

  char stationText[16];
  snprintf(stationText, sizeof(stationText), "Ma tu: %03d", STATION_ID);
  printCentered(stationText, 112, ST77XX_CYAN);
}

void drawOfflineScreen() {
  tft.fillScreen(ST77XX_BLACK);

  printCentered("MAT KET NOI", 20, ST77XX_RED, ST77XX_BLACK, 2);

  printCentered("Tu sac tam ngung phuc vu", 68, ST77XX_WHITE);
  printCentered("Vui long lien he Admin.", 86, ST77XX_WHITE);

  char stationText[16];
  snprintf(stationText, sizeof(stationText), "Ma tu: %03d", STATION_ID);
  printCentered(stationText, 112, ST77XX_CYAN);
}

void factoryResetStation() {
  // 1. Ngắt sạc khẩn cấp cả 2 cổng để bảo đảm an toàn điện
  digitalWrite(RELAY1_PIN, HIGH);
  digitalWrite(RELAY2_PIN, HIGH);
  is_charging[0] = false;
  is_charging[1] = false;
  outlet_error[0] = 0;
  outlet_error[1] = 0;

  // 2. Hiển thị màn hình cảnh báo khôi phục cài đặt gốc màu đỏ
  tft.fillScreen(ST77XX_RED);
  printCentered("FACTORY RESET", 30, ST77XX_WHITE, ST77XX_RED, 2);
  printCentered("Dang xoa cau hinh...", 70, ST77XX_WHITE, ST77XX_RED, 1);
  printCentered("He thong se reboot", 90, ST77XX_WHITE, ST77XX_RED, 1);

  // 3. Xóa sạch bộ nhớ Preferences lưu trên Flash (NVS)
  preferences.begin("ev_station", false);
  preferences.clear();
  preferences.end();

  // 4. Chờ người dùng thấy thông báo và restart thiết bị
  delay(2000);
  ESP.restart();
}

// Hàm cập nhật giao diện màn hình TFT (Chỉ cập nhật phần động, KHÔNG xóa toàn bộ nền)
void updateDisplay() {
  uint16_t station_status_val = modbus.getStationStatus();
  bool is_maintenance = (station_status_val == 1);
  bool is_offline = (station_status_val == 2) || (millis() - g_lastModbusPollTime > 30000);
  
  // Quản lý hiển thị màn hình mất kết nối
  if (is_offline) {
    if (!was_offline) {
      was_offline = true;
      drawOfflineScreen();
    }
    return;
  }
  
  if (was_offline) {
    was_offline = false;
    initDisplay();
  }

  // Quản lý chuyển đổi màn hình bảo trì để chống Flicker
  if (is_maintenance) {
    if (!was_maintenance) {
      was_maintenance = true;
      drawMaintenanceScreen();
    }
    
    return;
  }
  
  // Nếu vừa thoát chế độ bảo trì, vẽ lại nền bình thường
  if (was_maintenance) {
    was_maintenance = false;
    initDisplay();
  }

  tft.setTextSize(1);
  
  // 1. Cập nhật thanh trạng thái (Top Bar)
  tft.setTextColor(ST77XX_WHITE, ST77XX_BLUE); // Ghi đè nền xanh
  tft.setCursor(5, 6);
  tft.printf("TU SAC %03d  ", STATION_ID);
  
  tft.setCursor(90, 6);
  tft.printf("%2.0fC %2.0f%%   ", current_temp, current_hum); // Padding khoảng trắng ở đuôi

  // 2. Cập nhật thông số 2 ổ cắm
  for (int i = 0; i < 2; i++) {
    int x_offset = i * 80; // Cột trái cho ổ 1, Cột phải cho ổ 2
    
    tft.setCursor(x_offset + 5, 83);
    
    // Hiển thị mã lỗi nếu có, ngược lại hiển thị AVAILABLE / CHARGING
    if (outlet_error[i] == 1) {
      tft.setTextColor(ST77XX_RED, ST77XX_BLACK);
      tft.print("ERR_OVR_I");
    } else if (outlet_error[i] == 2) {
      tft.setTextColor(ST77XX_RED, ST77XX_BLACK);
      tft.print("ERR_OVR_T");
    } else {
      tft.setTextColor(is_charging[i] ? ST77XX_GREEN : ST77XX_CYAN, ST77XX_BLACK);
      tft.print(is_charging[i] ? "DANG SAC " : "SAN SANG");
    }

    tft.setTextColor(ST77XX_WHITE, ST77XX_BLACK); // Nền đen ghi đè lên số cũ
    tft.setCursor(x_offset + 5, 96); 
    tft.printf("%3.0fV %5.2fA ", current_v[i], current_a[i]); // Nâng độ chuẩn xác: 2 chữ số thập phân (VD: 5.50A)
    
    tft.setCursor(x_offset + 5, 110); 
    tft.setTextColor(is_charging[i] ? ST77XX_RED : ST77XX_WHITE, ST77XX_BLACK);
    tft.printf("%-6.1f W  ", current_w[i]); // Nâng độ chuẩn xác: 1 chữ số thập phân (VD: 2200.5 W)
  }
}

void setup() {
  g_lastModbusPollTime = millis();
  
  // Khởi động Relay (Mặc định tắt an toàn để không rò điện khi ESP32 vừa boot)
  pinMode(RELAY1_PIN, OUTPUT);
  pinMode(RELAY2_PIN, OUTPUT);
  digitalWrite(RELAY1_PIN, HIGH);
  digitalWrite(RELAY2_PIN, HIGH);

  // Khởi tạo nút nhấn (Nút BOOT mặc định trên ESP32)
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  // Khởi tạo SPI và Màn hình TFT với các chân Custom
  spi->begin(TFT_SCLK, -1, TFT_MOSI, TFT_CS); // SCLK, MISO, MOSI, CS (-1 vì không dùng MISO)
  tft.initR(INITR_BLACKTAB); // Khởi tạo chip ST7735S
  tft.setRotation(1);        // Màn hình ngang
  tft.fillScreen(ST77XX_BLACK);
  
  tft.setTextColor(ST77XX_WHITE);
  tft.setTextSize(1);
  tft.setCursor(30, 60);
  tft.print("Booting System...");

  // --- Cấu hình WiFi AP & Web OTA ---
  WiFi.mode(WIFI_AP);
  WiFi.softAP("EV_Station_OTA", "12345678"); // Tên WiFi: EV_Station_OTA, Pass: 12345678

  // Giao diện Web đơn giản để Upload file .bin
  server.on("/", HTTP_GET, []() {
    server.sendHeader("Connection", "close");
    server.send(200, "text/html", "<h2 style='font-family:sans-serif;'>EV Station Firmware Update</h2><form method='POST' action='/update' enctype='multipart/form-data'><input type='file' name='update'><br><br><input type='submit' value='Upload & Update'></form>");
  });

  // Xử lý file khi Upload
  server.on("/update", HTTP_POST, []() {
    server.sendHeader("Connection", "close");
    server.send(200, "text/plain", (Update.hasError()) ? "Update Failed! Please try again." : "Update Success! ESP32 is rebooting...");
    delay(1000);
    ESP.restart();
  }, []() {
    HTTPUpload& upload = server.upload();
    if (upload.status == UPLOAD_FILE_START) {
      if (!Update.begin(UPDATE_SIZE_UNKNOWN)) Update.printError(Serial);
    } else if (upload.status == UPLOAD_FILE_WRITE) {
      if (Update.write(upload.buf, upload.currentSize) != upload.currentSize) Update.printError(Serial);
    } else if (upload.status == UPLOAD_FILE_END) {
      if (Update.end(true)) {
        Serial.printf("Update Success: %u bytes\n", upload.totalSize);
      } else {
        Update.printError(Serial);
      }
    }
  });
  
  server.begin();

  dht.begin();
  modbus.begin(); // Bật Modbus Slave

  // Tải cấu hình đã lưu từ Preferences NVS
  preferences.begin("ev_station", false);
  g_savedMaxCurrent = preferences.getUShort("max_current", 1600); // Mặc định 16A (x100)
  g_savedTempLimit = preferences.getUShort("temp_limit", 65);     // Mặc định 65°C
  g_savedStatus = preferences.getUShort("status", 0);             // Mặc định 0 (online)
  preferences.end();

  // Đồng bộ cấu hình vào các thanh ghi Modbus Slave
  modbus.setMaxCurrent(g_savedMaxCurrent);
  modbus.setTempLimit(g_savedTempLimit);
  modbus.setStationStatus(g_savedStatus);

  initDisplay(); // Vẽ các viền cố định và xóa chữ Booting
  updateDisplay();
}

void loop() {
  if (is_ap_active) {
    server.handleClient(); // Lắng nghe và xử lý các yêu cầu Web OTA
  }

  // --- Xử lý nút nhấn giữ 5s (AP) hoặc 10s (Factory Reset) ---
  static bool ap_action_done = false;
  static bool reset_action_done = false;

  if (digitalRead(BUTTON_PIN) == LOW) {
    if (!btn_active) {
      btn_active = true;
      btn_press_time = millis();
      ap_action_done = false;
      reset_action_done = false;
    } else {
      uint32_t press_duration = millis() - btn_press_time;
      if (press_duration >= 10000 && !reset_action_done) {
        reset_action_done = true;
        Serial.println("LOG: Nhan nut BOOT qua 10s -> Tien hanh Factory Reset!");
        factoryResetStation();
      } else if (press_duration >= 5000 && !ap_action_done && !reset_action_done) {
        ap_action_done = true;
        is_ap_active = !is_ap_active;
        Serial.printf("LOG: Nhan nut BOOT qua 5s -> Chuyen che do WiFi AP: %s\n", is_ap_active ? "BAT" : "TAT");
        if (is_ap_active) {
          WiFi.mode(WIFI_AP);
          WiFi.softAP("EV_Station_OTA", "12345678");
        } else {
          WiFi.softAPdisconnect(true);
          WiFi.mode(WIFI_OFF);
        }
      }
    }
  } else {
    btn_active = false;
  }

  modbus.loop();

  // --- NHẬN LỆNH KHỞI ĐỘNG LẠI / RESET TỪ MODBUS ---
  int reboot_cmd = modbus.getRebootCommand();
  if (reboot_cmd == 1) {
    Serial.println("LOG: Nhan lenh KHOI DONG LAI tu Gateway!");
    modbus.clearRebootCommand();
    tft.fillScreen(ST77XX_BLACK);
    printCentered("REBOOTING...", 60, ST77XX_RED, ST77XX_BLACK, 2);
    delay(1000);
    ESP.restart();
  } else if (reboot_cmd == 2) {
    Serial.println("LOG: Nhan lenh FACTORY RESET tu Gateway!");
    modbus.clearRebootCommand();
    factoryResetStation();
  }

  // --- ĐỌC CẤU HÌNH ĐỘNG TỪ MODBUS VÀ PERSIST NVS ---
  uint16_t modbus_max_current = modbus.getMaxCurrent();
  uint16_t modbus_temp_limit = modbus.getTempLimit();
  uint16_t modbus_status = modbus.getStationStatus();

  // Nếu cấu hình từ Gateway (qua Modbus) khác với cấu hình đang lưu trong NVS
  if (modbus_max_current != g_savedMaxCurrent || 
      modbus_temp_limit != g_savedTempLimit || 
      modbus_status != g_savedStatus) {
      
      preferences.begin("ev_station", false);
      preferences.putUShort("max_current", modbus_max_current);
      preferences.putUShort("temp_limit", modbus_temp_limit);
      preferences.putUShort("status", modbus_status);
      preferences.end();

      g_savedMaxCurrent = modbus_max_current;
      g_savedTempLimit = modbus_temp_limit;
      g_savedStatus = modbus_status;
      Serial.printf("LOG: Da luu cau hinh moi vao Flash NVS: MaxCurrent=%d, TempLimit=%d, Status=%d\n", 
                    modbus_max_current, modbus_temp_limit, modbus_status);
  }

  float max_current_limit = modbus_max_current / 100.0;
  if (max_current_limit <= 0.1) max_current_limit = 16.0; // Fallback an toàn

  float temp_limit_val = (float)modbus_temp_limit;
  if (temp_limit_val <= 1.0) temp_limit_val = 65.0; // Fallback

  int station_status_val = modbus_status;
  bool is_maintenance = (station_status_val == 1);
  bool is_offline = (station_status_val == 2) || (millis() - g_lastModbusPollTime > 30000);

  // Phát hiện sự thay đổi trạng thái bảo trì hoặc mất kết nối để cập nhật màn hình lập tức
  static int prev_status = -1;
  static bool prev_offline = false;
  if (station_status_val != prev_status || is_offline != prev_offline) {
    prev_status = station_status_val;
    prev_offline = is_offline;
    updateDisplay();
  }

  // --- BẢO VỆ CHỦ ĐỘNG KHI ĐANG BẢO TRÌ HOẶC MẤT KẾT NỐI ---
  if (is_maintenance || is_offline) {
    bool state_changed = false;
    for (int i = 0; i < 2; i++) {
      if (is_charging[i]) {
        is_charging[i] = false;
        state_changed = true;
      }
      outlet_error[i] = 0; // Reset lỗi
    }
    digitalWrite(RELAY1_PIN, HIGH);
    digitalWrite(RELAY2_PIN, HIGH);
    if (state_changed) {
      updateDisplay();
    }
  }
  
  // --- NHẬN LỆNH ĐIỀU KHIỂN TỪ MODBUS ---
  int cmd1 = modbus.getCommandOutlet1();
  if (cmd1 == 1) {
    if (!is_maintenance && !is_offline && current_temp <= temp_limit_val) {
      is_charging[0] = true;
      outlet_error[0] = 0; // Xóa lỗi cũ
      digitalWrite(RELAY1_PIN, LOW);
    }
    modbus.clearCommandOutlet1();
    updateDisplay();
    modbus.updateTelemetry(current_temp, current_hum, 
                           current_v[0], current_a[0], current_w[0], getOutletStatus(0),
                           current_v[1], current_a[1], current_w[1], getOutletStatus(1));
  } else if (cmd1 == 0) {
    is_charging[0] = false;
    outlet_error[0] = 0; // Xóa lỗi cũ
    digitalWrite(RELAY1_PIN, HIGH);
    modbus.clearCommandOutlet1();
    updateDisplay();
    modbus.updateTelemetry(current_temp, current_hum, 
                           current_v[0], current_a[0], current_w[0], getOutletStatus(0),
                           current_v[1], current_a[1], current_w[1], getOutletStatus(1));
  }

  int cmd2 = modbus.getCommandOutlet2();
  if (cmd2 == 1) {
    if (!is_maintenance && !is_offline && current_temp <= temp_limit_val) {
      is_charging[1] = true;
      outlet_error[1] = 0; // Xóa lỗi cũ
      digitalWrite(RELAY2_PIN, LOW);
    }
    modbus.clearCommandOutlet2();
    updateDisplay();
    modbus.updateTelemetry(current_temp, current_hum, 
                           current_v[0], current_a[0], current_w[0], getOutletStatus(0),
                           current_v[1], current_a[1], current_w[1], getOutletStatus(1));
  } else if (cmd2 == 0) {
    is_charging[1] = false;
    outlet_error[1] = 0; // Xóa lỗi cũ
    digitalWrite(RELAY2_PIN, HIGH);
    modbus.clearCommandOutlet2();
    updateDisplay();
    modbus.updateTelemetry(current_temp, current_hum, 
                           current_v[0], current_a[0], current_w[0], getOutletStatus(0),
                           current_v[1], current_a[1], current_w[1], getOutletStatus(1));
  }

  // --- CẬP NHẬT CẢM BIẾN LÊN THANH GHI MODBUS MỖI 5 GIÂY ---
  static uint32_t last_publish = 0;
  if (millis() - last_publish > 5000) {
    last_publish = millis();

    // Đọc DHT11 với cơ chế chống lỗi NaN (Nếu lỗi sẽ giữ nguyên số cũ trên màn hình)
    float h = dht.readHumidity();
    float t = dht.readTemperature();
    if (!isnan(h) && !isnan(t)) {
      current_hum = h;
      current_temp = t;
    }

    for (int i = 1; i <= 2; i++) {
      if (is_charging[i-1]) {
        PZEM004Tv30* current_pzem = (i == 1) ? &pzem : &pzem2;
        float voltage = current_pzem->voltage();
        float current = current_pzem->current();
        float power = current_pzem->power();
        
        if (!isnan(voltage)) current_v[i-1] = voltage;
        if (!isnan(current)) current_a[i-1] = current;
        if (!isnan(power)) current_w[i-1] = power;
      } else {
        // Cổng sạc tắt: Không đọc PZEM để tránh timeout gây nghẽn Modbus
        current_v[i-1] = 0.0;
        current_a[i-1] = 0.0;
        current_w[i-1] = 0.0;
      }
    }

    // --- BẢO VỆ CỤC BỘ DỰA TRÊN NGƯỠNG ĐỌC ĐƯỢC ---
    if (!is_maintenance) {
      // 1. Kiểm tra nhiệt độ quá ngưỡng toàn trạm
      if (current_temp > temp_limit_val) {
        for (int i = 0; i < 2; i++) {
          is_charging[i] = false;
          outlet_error[i] = 2; // Lỗi quá nhiệt (2)
        }
        digitalWrite(RELAY1_PIN, HIGH);
        digitalWrite(RELAY2_PIN, HIGH);
        Serial.printf("LOG: TRAM QUA NHIET! %.1fC > %.1fC\n", current_temp, temp_limit_val);
      } 
      // 2. Kiểm tra quá dòng sạc từng cổng sạc
      else {
        if (is_charging[0] && current_a[0] > max_current_limit) {
          is_charging[0] = false;
          outlet_error[0] = 1; // Lỗi quá dòng (1)
          digitalWrite(RELAY1_PIN, HIGH);
          Serial.printf("LOG: CONG 1 QUA DONG! %.2fA > %.2fA\n", current_a[0], max_current_limit);
        }
        if (is_charging[1] && current_a[1] > max_current_limit) {
          is_charging[1] = false;
          outlet_error[1] = 1; // Lỗi quá dòng (1)
          digitalWrite(RELAY2_PIN, HIGH);
          Serial.printf("LOG: CONG 2 QUA DONG! %.2fA > %.2fA\n", current_a[1], max_current_limit);
        }
      }
    }

    // Đẩy dữ liệu ra thanh ghi để Gateway đọc
    modbus.updateTelemetry(current_temp, current_hum, 
                           current_v[0], current_a[0], current_w[0], getOutletStatus(0),
                           current_v[1], current_a[1], current_w[1], getOutletStatus(1));
    
    // Cập nhật lại các thông số V, A, W lên TFT mỗi 5 giây
    updateDisplay();
  }
}
