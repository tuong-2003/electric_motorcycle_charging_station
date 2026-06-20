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

    uint8_t getLastError() const { return lastError; }

private:
    ModbusRTU mb;
    uint16_t buffer[12]; // Chứa 12 thanh ghi đọc về
    bool isWaiting = false;
    bool isSuccess = false;
    uint8_t lastError = 0;
};

#endif