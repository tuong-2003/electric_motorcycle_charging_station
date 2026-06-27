#ifndef MODBUS_MASTER_TASK_H
#define MODBUS_MASTER_TASK_H

#include <Arduino.h>
#include <ModbusRTU.h>

#define RS485_RX_PIN 18
#define RS485_TX_PIN 19

struct StationData {
    bool isOnline;
    float temp;
    float hum;
    bool stat1;
    float v1, a1, w1;
    bool stat2;
    float v2, a2, w2;
};

class ModbusMasterTask {
public:
    void begin();
    void loop();
    
    // Hàm đọc Tủ sạc (Trả về true nếu tủ sạc có phản hồi)
    bool readStation(uint8_t slaveId, StationData &data);
    
    // Hàm ghi lệnh xuống Tủ sạc
    bool sendCommand(uint8_t slaveId, uint8_t outletId, bool start);

    // Hàm ghi cấu hình xuống Tủ sạc (maxCurrent x100, tempLimit, status)
    bool sendConfig(uint8_t slaveId, uint16_t maxCurrent, uint16_t tempLimit, uint16_t status);

    // Hàm gửi lệnh khởi động lại xuống Tủ sạc
    bool sendReboot(uint8_t slaveId);

    uint8_t getLastError() const { return lastError; }

private:
    ModbusRTU mb;
    uint16_t buffer[16]; // Chứa 16 thanh ghi đọc về (từ 0 đến 15)
    bool isWaiting = false;
    bool isSuccess = false;
    uint8_t lastError = 0;
};

#endif