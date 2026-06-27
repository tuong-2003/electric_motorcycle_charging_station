#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include "ModbusMasterTask.h"

// --- Cấu hình WiFi ---
const char *WIFI_SSID = "Rubyhouselau1@2025";
const char *WIFI_PASS = "ruby@09876";
// const char *WIFI_SSID = "AP2FB8";
// const char *WIFI_PASS = "333333333";

// --- Cấu hình MQTT Cloud ---
const char *MQTT_BROKER = "broker.hivemq.com";
const int MQTT_PORT = 1883;
const char *MQTT_CLIENT_ID = "EV_Gateway_Master"; 

WiFiClient espClient;
PubSubClient mqtt(espClient);
ModbusMasterTask modbus;

// Khai báo danh sách các Tủ sạc hiện có (Slave ID)
const uint8_t STATION_IDS[] = {1}; 
const int NUM_STATIONS = 1;

void pollAndPublishStation(int stationId) {
    StationData data;
    char stationStr[4];
    snprintf(stationStr, sizeof(stationStr), "%03d", stationId);
    
    if (modbus.readStation(stationId, data)) {
        Serial.printf("Doc thanh cong TRAM %d: V=%.1f\n", stationId, data.v1);
        
        // --- Đẩy JSON Cổng 1 ---
        JsonDocument doc1;
        doc1["station_id"] = stationStr; 
        doc1["outlet_id"] = 1; 
        if (data.stat1 == 1) doc1["status"] = "CHARGING";
        else if (data.stat1 == 2) doc1["status"] = "OVERCURRENT";
        else if (data.stat1 == 3) doc1["status"] = "OVERTEMPERATURE";
        else doc1["status"] = "AVAILABLE";
        
        doc1["voltage"] = data.v1; doc1["current"] = data.a1; doc1["power"] = data.w1;
        doc1["temperature"] = data.temp; doc1["humidity"] = data.hum;
        String p1; serializeJson(doc1, p1);
        char topic1[50]; snprintf(topic1, sizeof(topic1), "ev_station/%s/outlet/1/status", stationStr);
        mqtt.publish(topic1, p1.c_str());

        // --- Đẩy JSON Cổng 2 ---
        JsonDocument doc2;
        doc2["station_id"] = stationStr; 
        doc2["outlet_id"] = 2; 
        if (data.stat2 == 1) doc2["status"] = "CHARGING";
        else if (data.stat2 == 2) doc2["status"] = "OVERCURRENT";
        else if (data.stat2 == 3) doc2["status"] = "OVERTEMPERATURE";
        else doc2["status"] = "AVAILABLE";
        
        doc2["voltage"] = data.v2; doc2["current"] = data.a2; doc2["power"] = data.w2;
        String p2; serializeJson(doc2, p2);
        char topic2[50]; snprintf(topic2, sizeof(topic2), "ev_station/%s/outlet/2/status", stationStr);
        mqtt.publish(topic2, p2.c_str());
    } else {
        Serial.printf("Doc THAT BAI TRAM %d! Vui long kiem tra ket noi.\n", stationId);
    }
}

void setup_wifi() {
    Serial.println("\nDang ket noi WiFi...");
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
    Serial.println("\nWiFi Connected! IP: " + WiFi.localIP().toString());
}

void mqtt_callback(char *topic, byte *payload, unsigned int length) {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, payload, length);
    if (error) return;

    int stId, outId;
    
    // 1. Lắng nghe lệnh điều khiển (VD: ev_station/001/outlet/1/cmd)
    if (sscanf(topic, "ev_station/%03d/outlet/%d/cmd", &stId, &outId) == 2) {
        const char *command = doc["command"];
        if (command && strcmp(command, "START_CHARGE") == 0) {
            Serial.printf("Gateway gui lenh BAT cho TRAM %d - O %d\n", stId, outId);
            modbus.sendCommand(stId, outId, true);
            delay(150); // Chờ 150ms để tủ sạc xử lý và cập nhật rơ-le vật lý
            pollAndPublishStation(stId);
        } else if (command && strcmp(command, "STOP_CHARGE") == 0) {
            Serial.printf("Gateway gui lenh TAT cho TRAM %d - O %d\n", stId, outId);
            modbus.sendCommand(stId, outId, false);
            delay(150); // Chờ 150ms để tủ sạc xử lý
            pollAndPublishStation(stId);
        }
    }
    // 2. Lắng nghe lệnh điều khiển trạm (VD: ev_station/001/cmd) hoặc cấu hình (VD: ev_station/001/config)
    else {
        char action[20] = {0};
        if (sscanf(topic, "ev_station/%03d/%19s", &stId, action) == 2) {
            if (strcmp(action, "cmd") == 0) {
                const char *command = doc["command"];
                if (command && strcmp(command, "REBOOT") == 0) {
                    Serial.printf("Gateway nhan lenh REBOOT cho TRAM %d từ Cloud\n", stId);
                    modbus.sendReboot(stId);
                } else if (command && strcmp(command, "FACTORY_RESET") == 0) {
                    Serial.printf("Gateway nhan lenh FACTORY_RESET cho TRAM %d từ Cloud\n", stId);
                    modbus.sendFactoryReset(stId);
                }
            }
            else if (strcmp(action, "config") == 0) {
                float maxCurrent = doc["max_current"] | 16.0;
                int tempLimit = doc["temp_limit"] | 65;
                const char *statusStr = doc["status"] | "online";
                
                uint16_t maxCurrentVal = (uint16_t)(maxCurrent * 100);
                uint16_t tempLimitVal = (uint16_t)tempLimit;
                uint16_t statusVal = (strcmp(statusStr, "maintenance") == 0) ? 1 : 0;
                
                Serial.printf("Gateway nhan cau hinh cho TRAM %d: MaxCurrent=%d (x100), TempLimit=%d, Status=%d\n", 
                              stId, maxCurrentVal, tempLimitVal, statusVal);
                modbus.sendConfig(stId, maxCurrentVal, tempLimitVal, statusVal);
                delay(150);
                pollAndPublishStation(stId);
            }
        }
    }
}

void reconnect_mqtt() {
    if (mqtt.connect(MQTT_CLIENT_ID)) {
        Serial.println("MQTT Connected!");
        mqtt.subscribe("ev_station/+/outlet/+/cmd"); // Lắng nghe lệnh cho tất cả các tủ sạc
        mqtt.subscribe("ev_station/+/cmd");           // Lắng nghe lệnh điều khiển toàn tủ sạc
        mqtt.subscribe("ev_station/+/config");        // Lắng nghe cấu hình cho tất cả các tủ sạc
    }
}

void setup() {
    Serial.begin(115200);
    setup_wifi();
    mqtt.setServer(MQTT_BROKER, MQTT_PORT);
    mqtt.setCallback(mqtt_callback);
    
    modbus.begin(); // Bật cổng RS485
    Serial.println("Gateway san sang!");
}

void loop() {
    // Watchdog mất kết nối để tự động ngắt sạc bảo vệ hệ thống
    static uint32_t disconnectStart = 0;
    static bool wasDisconnectedTriggered = false;

    if (WiFi.status() != WL_CONNECTED || !mqtt.connected()) {
        if (disconnectStart == 0) {
            disconnectStart = millis();
        } else if (millis() - disconnectStart > 30000) { // Quá 30 giây mất kết nối
            if (!wasDisconnectedTriggered) {
                Serial.println("🚨 [BẢO VỆ] Mất kết nối MQTT/WiFi quá 30s! Tự động ngắt sạc toàn bộ các cổng.");
                for (int i = 0; i < NUM_STATIONS; i++) {
                    int stId = STATION_IDS[i];
                    modbus.sendCommand(stId, 1, false);
                    delay(150);
                    modbus.sendCommand(stId, 2, false);
                    delay(150);
                    modbus.sendStationStatus(stId, 2); // [MỚI] Gửi mã Offline xuống màn hình TFT
                    delay(150);
                }
                wasDisconnectedTriggered = true;
            }
        }
    } else {
        disconnectStart = 0;
        wasDisconnectedTriggered = false;
    }

    if (!mqtt.connected()) reconnect_mqtt();
    else mqtt.loop();
    
    modbus.loop(); // QUAN TRỌNG: Gọi liên tục để duy trì state machine của Modbus Master
    
    // Quét Modbus các tủ sạc mỗi 5 giây và đẩy lên Cloud
    static uint32_t lastPoll = 0;
    if (millis() - lastPoll > 5000) {
        lastPoll = millis();
        
        for (int i = 0; i < NUM_STATIONS; i++) {
            pollAndPublishStation(STATION_IDS[i]);
        }
    }
}