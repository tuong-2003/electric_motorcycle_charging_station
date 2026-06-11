#ifndef CONFIG_H
#define CONFIG_H

// --- Cấu hình WiFi ---
// #define WIFI_SSID "Rubyhouselau1@2025"
// #define WIFI_PASS "ruby@09876"
const char *WIFI_SSID = "AP2FB8";
const char *WIFI_PASS = "333333333";

// --- Cấu hình MQTT Cloud ---
#define MQTT_BROKER "broker.hivemq.com"
#define MQTT_PORT 1883
#define MQTT_CLIENT_ID "EV_Charger_001" // Nên đặt ID duy nhất cho mỗi thiết bị

#endif