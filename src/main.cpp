#include <Arduino.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <PubSubClient.h>
#include <WiFi.h>

// --- Cấu hình WiFi ---
const char *WIFI_SSID = "Rubyhouselau1@2025";
const char *WIFI_PASS = "ruby@09876";

// --- Cấu hình MQTT Cloud (Đang dùng HiveMQ Public để test) ---
const char *MQTT_BROKER = "broker.hivemq.com";
const int MQTT_PORT = 1883;
const char *MQTT_CLIENT_ID = "EV_Charger_001"; 

// --- Cấu hình DHT11 ---
#define DHTPIN 4 
#define DHTTYPE DHT11 
DHT dht(DHTPIN, DHTTYPE);

// --- Các Topic MQTT ---
const char *TOPIC_SUB_CMD = "ev_station/+/outlet/+/cmd";

WiFiClient espClient;
PubSubClient mqtt(espClient);

// --- Biến trạng thái toàn cục của Trạm sạc ---
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
void mqtt_callback(char *topic, byte *payload, unsigned int length) {
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, payload, length);

  if (!error) {
    const char *command = doc["command"];
    
    if (command != nullptr) {
      int stationId = (strstr(topic, "/002/") != NULL) ? 2 : 1;
      int outletId = (strstr(topic, "/outlet/2/") != NULL) ? 2 : 1;

      if (strcmp(command, "START_CHARGE") == 0) {
        is_charging[stationId - 1][outletId - 1] = true;
        // TODO: digitalWrite(RELAY_PIN, HIGH);
      } else if (strcmp(command, "STOP_CHARGE") == 0) {
        is_charging[stationId - 1][outletId - 1] = false;
        // TODO: digitalWrite(RELAY_PIN, LOW);
      }
    }
  }
}

// 3. Hàm duy trì và kết nối lại MQTT nếu rớt mạng
void reconnect_mqtt() {
  static uint32_t last_reconnect_attempt = 0;

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
    return;
  }
  mqtt.loop();

  // --- GỬI DỮ LIỆU ĐỊNH KỲ MỖI 5 GIÂY ---
  static uint32_t last_publish = 0;
  if (millis() - last_publish > 5000) {
    last_publish = millis();

    float humidity = dht.readHumidity();
    float temperature = dht.readTemperature();

    for (int s = 1; s <= 2; s++) {
      for (int i = 1; i <= 2; i++) {
        float voltage = random(2200, 2300) / 10.0;
        float current = 0.0;
        if (is_charging[s - 1][i - 1]) {
          current = random(20, 35) / 10.0;
        }
        float power = voltage * current;
        String current_status = is_charging[s - 1][i - 1] ? "CHARGING" : "AVAILABLE";

        JsonDocument doc;
        char stationStr[4];
        snprintf(stationStr, sizeof(stationStr), "%03d", s);
        doc["station_id"] = stationStr;
        doc["outlet_id"] = i;
        doc["status"] = current_status;
        doc["voltage"] = voltage;
        doc["current"] = current;
        doc["power"] = power;

        if (!isnan(temperature) && !isnan(humidity)) {
          doc["temperature"] = round(temperature * 10) / 10.0;
          doc["humidity"] = round(humidity * 10) / 10.0;
        }

        String payload;
        serializeJson(doc, payload);

        char topic_pub[50];
        snprintf(topic_pub, sizeof(topic_pub), "ev_station/%03d/outlet/%d/status", s, i);
        mqtt.publish(topic_pub, payload.c_str());
      }
    }
  }
}