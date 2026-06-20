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

    const char *command = doc["command"];
    int stId, outId;
    
    // Cắt ID từ topic (VD: ev_station/001/outlet/1/cmd)
    if (sscanf(topic, "ev_station/%03d/outlet/%d/cmd", &stId, &outId) == 2) {
        if (command && strcmp(command, "START_CHARGE") == 0) {
            Serial.printf("Gateway gui lenh BAT cho TRAM %d - O %d\n", stId, outId);
            modbus.sendCommand(stId, outId, true);
        } else if (command && strcmp(command, "STOP_CHARGE") == 0) {
            Serial.printf("Gateway gui lenh TAT cho TRAM %d - O %d\n", stId, outId);
            modbus.sendCommand(stId, outId, false);
        }
    }
}

void reconnect_mqtt() {
    if (mqtt.connect(MQTT_CLIENT_ID)) {
        Serial.println("MQTT Connected!");
        mqtt.subscribe("ev_station/+/outlet/+/cmd"); // Lắng nghe lệnh cho tất cả các tủ sạc
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
    if (!mqtt.connected()) reconnect_mqtt();
    else mqtt.loop();
    
    modbus.loop(); // QUAN TRỌNG: Gọi liên tục để duy trì state machine của Modbus Master
    
    // Quét Modbus các tủ sạc mỗi 5 giây và đẩy lên Cloud
    static uint32_t lastPoll = 0;
    if (millis() - lastPoll > 5000) {
        lastPoll = millis();
        
        for (int i = 0; i < NUM_STATIONS; i++) {
            StationData data;
            char stationStr[4];
            snprintf(stationStr, sizeof(stationStr), "%03d", STATION_IDS[i]);
            
            if (modbus.readStation(STATION_IDS[i], data)) {
                Serial.printf("Doc thanh cong TRAM %d: V=%.1f\n", STATION_IDS[i], data.v1);
                
                // --- Đẩy JSON Cổng 1 ---
                JsonDocument doc1;
                doc1["station_id"] = stationStr; doc1["outlet_id"] = 1; doc1["status"] = data.stat1 ? "CHARGING" : "AVAILABLE";
                doc1["voltage"] = data.v1; doc1["current"] = data.a1; doc1["power"] = data.w1;
                doc1["temperature"] = data.temp; doc1["humidity"] = data.hum;
                String p1; serializeJson(doc1, p1);
                char topic1[50]; snprintf(topic1, sizeof(topic1), "ev_station/%s/outlet/1/status", stationStr);
                mqtt.publish(topic1, p1.c_str());

                // --- Đẩy JSON Cổng 2 ---
                JsonDocument doc2;
                doc2["station_id"] = stationStr; doc2["outlet_id"] = 2; doc2["status"] = data.stat2 ? "CHARGING" : "AVAILABLE";
                doc2["voltage"] = data.v2; doc2["current"] = data.a2; doc2["power"] = data.w2;
                String p2; serializeJson(doc2, p2);
                char topic2[50]; snprintf(topic2, sizeof(topic2), "ev_station/%s/outlet/2/status", stationStr);
                mqtt.publish(topic2, p2.c_str());
            } else {
                Serial.printf("Doc THAT BAI TRAM %d! Vui long kiem tra ket noi.\n", STATION_IDS[i]);
            }
        }
    }
}