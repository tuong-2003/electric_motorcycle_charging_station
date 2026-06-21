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

// --- Biến trạng thái của riêng Tủ này (2 Ổ cắm) ---
bool is_charging[2] = {false, false};
float current_v[2] = {0.0, 0.0};
float current_a[2] = {0.0, 0.0};
float current_w[2] = {0.0, 0.0};
float current_temp = 0.0;
float current_hum = 0.0;

// [MỚI] Biến theo dõi lỗi cục bộ và trạng thái màn hình bảo trì
int outlet_error[2] = {0, 0}; // 0: OK, 1: Quá dòng, 2: Quá nhiệt
bool was_maintenance = false;

// --- Nút nhấn (BOOT button) và Trạng thái WiFi AP ---
#define BUTTON_PIN 0
bool is_ap_active = true;
uint32_t btn_press_time = 0;
bool btn_active = false;
bool btn_long_pressed = false;

// --- Cấu hình WebServer cho OTA ---
WebServer server(80);

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
void drawMaintenanceScreen() {
  tft.fillScreen(ST77XX_BLACK);
  tft.fillRect(0, 0, 160, 20, ST77XX_RED);
  tft.setCursor(5, 6);
  tft.setTextColor(ST77XX_WHITE, ST77XX_RED);
  tft.print("MODBUS - SYSTEM LOCK");
  
  tft.setTextColor(ST77XX_YELLOW);
  tft.setTextSize(2);
  tft.setCursor(35, 45);
  tft.print("BAO TRI");
  
  tft.setTextSize(1);
  tft.setTextColor(ST77XX_WHITE);
  tft.setCursor(15, 80);
  tft.print("TRAM TAM NGHEN DE");
  tft.setCursor(15, 95);
  tft.print("BAO DUONG THIET BI");
}

// Hàm cập nhật giao diện màn hình TFT (Chỉ cập nhật phần động, KHÔNG xóa toàn bộ nền)
void updateDisplay() {
  bool is_maintenance = (modbus.getStationStatus() == 1);
  
  // Quản lý chuyển đổi màn hình bảo trì để chống Flicker
  if (is_maintenance) {
    if (!was_maintenance) {
      was_maintenance = true;
      drawMaintenanceScreen();
    }
    
    // Cập nhật nhiệt độ/độ ẩm trên thanh trạng thái đỏ của màn hình bảo trì
    tft.setTextSize(1);
    tft.setTextColor(ST77XX_WHITE, ST77XX_RED);
    tft.setCursor(105, 6);
    tft.printf("%2.0fC %2.0f%%", current_temp, current_hum);
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
  tft.print("MODBUS  ");
  
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
      tft.print(is_charging[i] ? "CHARGING " : "AVAILABLE");
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
  
  // Khởi tạo Relay (Mặc định tắt an toàn để không rò điện khi ESP32 vừa boot)
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
  initDisplay(); // Vẽ các viền cố định và xóa chữ Booting
  updateDisplay();
}

void loop() {
  if (is_ap_active) {
    server.handleClient(); // Lắng nghe và xử lý các yêu cầu Web OTA
  }

  // --- Xử lý nút nhấn giữ 5s để bật/tắt WiFi AP ---
  if (digitalRead(BUTTON_PIN) == LOW) {
    if (!btn_active) {
      btn_active = true;
      btn_press_time = millis();
      btn_long_pressed = false;
    } else if (!btn_long_pressed && (millis() - btn_press_time >= 5000)) {
      btn_long_pressed = true; // Đánh dấu đã xử lý để không bị lặp lại liên tục
      is_ap_active = !is_ap_active;
      if (is_ap_active) {
        WiFi.mode(WIFI_AP);
        WiFi.softAP("EV_Station_OTA", "12345678");
      } else {
        WiFi.softAPdisconnect(true);
        WiFi.mode(WIFI_OFF);
      }
    }
  } else {
    btn_active = false;
  }

  modbus.loop();

  // --- ĐỌC CẤU HÌNH ĐỘNG TỪ MODBUS ---
  float max_current_limit = modbus.getMaxCurrent() / 100.0;
  if (max_current_limit <= 0.1) max_current_limit = 16.0; // Fallback an toàn

  float temp_limit_val = (float)modbus.getTempLimit();
  if (temp_limit_val <= 1.0) temp_limit_val = 65.0; // Fallback

  int station_status_val = modbus.getStationStatus();
  bool is_maintenance = (station_status_val == 1);

  // Phát hiện sự thay đổi trạng thái bảo trì để cập nhật màn hình lập tức
  static bool prev_maintenance = false;
  if (is_maintenance != prev_maintenance) {
    prev_maintenance = is_maintenance;
    updateDisplay();
  }

  // --- BẢO VỆ CHỦ ĐỘNG KHI ĐANG BẢO TRÌ ---
  if (is_maintenance) {
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
    if (!is_maintenance && current_temp <= temp_limit_val) {
      is_charging[0] = true;
      outlet_error[0] = 0; // Xóa lỗi cũ
      digitalWrite(RELAY1_PIN, LOW);
    }
    modbus.clearCommandOutlet1();
    updateDisplay();
  } else if (cmd1 == 0) {
    is_charging[0] = false;
    outlet_error[0] = 0; // Xóa lỗi cũ
    digitalWrite(RELAY1_PIN, HIGH);
    modbus.clearCommandOutlet1();
    updateDisplay();
  }

  int cmd2 = modbus.getCommandOutlet2();
  if (cmd2 == 1) {
    if (!is_maintenance && current_temp <= temp_limit_val) {
      is_charging[1] = true;
      outlet_error[1] = 0; // Xóa lỗi cũ
      digitalWrite(RELAY2_PIN, LOW);
    }
    modbus.clearCommandOutlet2();
    updateDisplay();
  } else if (cmd2 == 0) {
    is_charging[1] = false;
    outlet_error[1] = 0; // Xóa lỗi cũ
    digitalWrite(RELAY2_PIN, HIGH);
    modbus.clearCommandOutlet2();
    updateDisplay();
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
      // Con trỏ tự động chọn pzem tương ứng với từng ổ sạc
      PZEM004Tv30* current_pzem = (i == 1) ? &pzem : &pzem2;
      
      float voltage = current_pzem->voltage();
      float current = current_pzem->current();
      float power = current_pzem->power();
      
      current_v[i-1] = !isnan(voltage) ? voltage : 0.0;
      current_a[i-1] = !isnan(current) ? current : 0.0;
      current_w[i-1] = !isnan(power) ? power : 0.0;
      
      // Tự động ép về 0 nếu đang ngắt sạc (không cho rò dòng)
      if (!is_charging[i-1]) {
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
                           current_v[0], current_a[0], current_w[0], is_charging[0],
                           current_v[1], current_a[1], current_w[1], is_charging[1]);
    
    // Cập nhật lại các thông số V, A, W lên TFT mỗi 5 giây
    updateDisplay();
  }
}