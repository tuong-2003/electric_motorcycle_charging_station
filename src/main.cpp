#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// --- Cấu hình WiFi ---
const char* WIFI_SSID = "KST Group";
const char* WIFI_PASS = "Kim$0nT13n";

// --- Cấu hình MQTT Cloud (Đang dùng HiveMQ Public để test) ---
// Sau này khi dự án release, ta sẽ đổi sang HiveMQ Cloud (bản có SSL/Mật khẩu bảo mật)
const char* MQTT_BROKER = "broker.hivemq.com"; 
const int   MQTT_PORT = 1883; 
const char* MQTT_CLIENT_ID = "EV_Charger_001"; // ID phải là duy nhất cho mỗi trụ sạc

// --- Các Topic MQTT ---
const char* TOPIC_PUB_STATUS = "ev_station/001/status"; // ESP32 gửi dữ liệu lên Web
const char* TOPIC_SUB_CMD    = "ev_station/001/cmd";    // ESP32 nhận lệnh từ Web

WiFiClient espClient;
PubSubClient mqtt(espClient);

// --- Biến trạng thái toàn cục của Trạm sạc ---
bool is_charging = false; // Mặc định ban đầu là rảnh (chưa sạc)

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

    // Xử lý JSON lệnh nhận được
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, message);
    
    if (!error) {
        String command = doc["command"]; 
        if (command == "START_CHARGE") {
            is_charging = true;
            Serial.println("-> Thuc thi: DONG RELAY SAC CHO XE");
            // TODO: digitalWrite(RELAY_PIN, HIGH);
        } else if (command == "STOP_CHARGE") {
            is_charging = false;
            Serial.println("-> Thuc thi: NGAT RELAY SAC");
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
        
        // TODO: Đo thực tế bằng PZEM-004T
        // Hiện tại: Mô phỏng điện áp dao động từ 220.0V đến 230.0V
        float voltage = random(2200, 2300) / 10.0; 
        float current = 0.0;

        // Nếu đang sạc, dòng điện dao động từ 2.0A đến 3.5A. Nếu không sạc thì dòng = 0.
        if (is_charging) {
            current = random(20, 35) / 10.0;
        }
        
        float power = voltage * current;
        
        String current_status = is_charging ? "CHARGING" : "AVAILABLE";

        // Đóng gói dữ liệu thành chuẩn JSON
        JsonDocument doc;
        doc["station_id"] = "001";
        doc["status"] = current_status;
        doc["voltage"] = voltage;
        doc["current"] = current;
        doc["power"] = power;

        String payload;
        serializeJson(doc, payload);

        // Publish lên Cloud
        mqtt.publish(TOPIC_PUB_STATUS, payload.c_str());
        Serial.println("[MQTT] Da gui: " + payload);
    }
}