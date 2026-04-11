#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <DHT.h>

// --- Cấu hình WiFi ---
const char* WIFI_SSID = "Rubyhouselau1@2025";
const char* WIFI_PASS = "ruby@09876";

// --- Cấu hình MQTT Cloud (Đang dùng HiveMQ Public để test) ---
// Sau này khi dự án release, ta sẽ đổi sang HiveMQ Cloud (bản có SSL/Mật khẩu bảo mật)
const char* MQTT_BROKER = "broker.hivemq.com"; 
const int   MQTT_PORT = 1883; 
const char* MQTT_CLIENT_ID = "EV_Charger_001"; // ID phải là duy nhất cho mỗi trụ sạc

// --- Cấu hình DHT11 ---
#define DHTPIN 19        // Chân dữ liệu của DHT11 kết nối với ESP32 (bạn có thể thay đổi tùy thực tế)
#define DHTTYPE DHT11   // Sử dụng loại cảm biến DHT11
DHT dht(DHTPIN, DHTTYPE);

// --- Các Topic MQTT ---
// Dùng wildcard (+) để lắng nghe lệnh từ tất cả các tủ và ổ cắm
const char* TOPIC_SUB_CMD = "ev_station/+/outlet/+/cmd";

WiFiClient espClient;
PubSubClient mqtt(espClient);

// --- Biến trạng thái toàn cục của Trạm sạc ---
// Mảng lưu trạng thái 2 chiều: [Tủ][Ổ cắm] (Tủ 1-2, Ổ 1-2)
bool is_charging[2][2] = {{false, false}, {false, false}}; 

// 1. Hàm kết nối WiFi
void setup_wifi() {
    delay(10);
    Serial.println("\nDang ket noi WiFi: " + String(WIFI_SSID));
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);

    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }
    Serial.println("\nWiFi da ket noi! IP: " + WiFi.localIP().toString());
}

// 2. Callback xử lý khi nhận được lệnh từ Server/Web
void mqtt_callback(char* topic, byte* payload, unsigned int length) {
    String message = "";
    for (unsigned int i = 0; i < length; i++) {
        message += (char)payload[i];
    }
    Serial.println("\n[MQTT] Nhan lenh tu topic: " + String(topic));
    Serial.println("Noi dung: " + message);

    // Tách stationId và outletId từ topic (VD: ev_station/002/outlet/1/cmd)
    String t = String(topic);
    int stationId = 1;
    if (t.indexOf("002") != -1) stationId = 2;
    
    int outletId = 1;
    if (t.indexOf("/2/cmd") != -1) outletId = 2;

    // Xử lý JSON lệnh nhận được
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, message);
    
    if (!error) {
        String command = doc["command"]; 
        if (command == "START_CHARGE") {
            is_charging[stationId - 1][outletId - 1] = true;
            Serial.printf("-> Thuc thi: DONG RELAY TU %d - O SO %d\n", stationId, outletId);
            // TODO: digitalWrite(RELAY_PIN, HIGH);
        } else if (command == "STOP_CHARGE") {
            is_charging[stationId - 1][outletId - 1] = false;
            Serial.printf("-> Thuc thi: NGAT RELAY TU %d - O SO %d\n", stationId, outletId);
            // TODO: digitalWrite(RELAY_PIN, LOW);
        }
    }
}

// 3. Hàm duy trì và kết nối lại MQTT nếu rớt mạng
void reconnect_mqtt() {
    static uint32_t last_reconnect_attempt = 0;
    
    // Chỉ thử kết nối lại mỗi 5 giây, KHÔNG dùng delay() để tránh treo mạch
    if (millis() - last_reconnect_attempt > 5000) {
        last_reconnect_attempt = millis();
        Serial.print("Dang ket noi MQTT Broker... ");
        if (mqtt.connect(MQTT_CLIENT_ID)) {
            Serial.println("Thanh cong!");
            mqtt.subscribe(TOPIC_SUB_CMD);
        } else {
            Serial.print("That bai, ma loi= ");
            Serial.println(mqtt.state());
        }
    }
}

void setup() {
    Serial.begin(115200);
    setup_wifi();
    mqtt.setServer(MQTT_BROKER, MQTT_PORT);
    mqtt.setCallback(mqtt_callback);

    dht.begin();
}

void loop() {
    if (!mqtt.connected()) {
        reconnect_mqtt();
        return; // Nếu mất kết nối, bỏ qua các bước dưới để tập trung thử kết nối lại
    }
    mqtt.loop(); // Lệnh bắt buộc để duy trì background MQTT

    // --- GỬI DỮ LIỆU ĐỊNH KỲ MỖI 5 GIÂY ---
    static uint32_t last_publish = 0;
    if (millis() - last_publish > 5000) {
        last_publish = millis();

        // Đọc dữ liệu từ cảm biến DHT11
        float humidity = dht.readHumidity();
        float temperature = dht.readTemperature();
        
        // Gửi dữ liệu mô phỏng cho cả Tủ 1 và Tủ 2 (tổng 4 ổ cắm)
        for (int s = 1; s <= 2; s++) {
            for (int i = 1; i <= 2; i++) {
                // Mô phỏng dữ liệu
                float voltage = random(2200, 2300) / 10.0; 
                float current = 0.0;
                if (is_charging[s - 1][i - 1]) {
                    current = random(20, 35) / 10.0;
                }
                float power = voltage * current;
                String current_status = is_charging[s - 1][i - 1] ? "CHARGING" : "AVAILABLE";

                // Đóng gói dữ liệu thành chuẩn JSON
                JsonDocument doc;
                char stationStr[4];
                snprintf(stationStr, sizeof(stationStr), "%03d", s);
                doc["station_id"] = stationStr;
                doc["outlet_id"] = i; 
                doc["status"] = current_status;
                doc["voltage"] = voltage;
                doc["current"] = current;
                doc["power"] = power;

                // Gửi kèm nhiệt độ & độ ẩm vào JSON nếu đọc thành công
                if (!isnan(temperature) && !isnan(humidity)) {
                    doc["temperature"] = round(temperature * 10) / 10.0;
                    doc["humidity"] = round(humidity * 10) / 10.0;
                }

                String payload;
                serializeJson(doc, payload);

                // Publish lên Cloud với topic tương ứng
                char topic_pub[50];
                snprintf(topic_pub, sizeof(topic_pub), "ev_station/%03d/outlet/%d/status", s, i);
                mqtt.publish(topic_pub, payload.c_str());
            }
        }
    }
}