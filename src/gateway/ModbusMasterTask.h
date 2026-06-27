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
    uint16_t stat1;
    float v1, a1, w1;
    uint16_t stat2;
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
    
    // Hàm xóa chốt lỗi quá dòng/quá nhiệt cho ổ sạc
    bool sendResetError(uint8_t slaveId, uint8_t outletId);

    // Hàm ghi cấu hình xuống Tủ sạc (maxCurrent x100, tempLimit, status)
    bool sendConfig(uint8_t slaveId, uint16_t maxCurrent, uint16_t tempLimit, uint16_t status);

    // Hàm ghi trạng thái ngoại tuyến hoặc bình thường xuống Tủ sạc
    bool sendStationStatus(uint8_t slaveId, uint16_t status);

    // Hàm gửi lệnh khởi động lại xuống Tủ sạc
    bool sendReboot(uint8_t slaveId);

    // Hàm gửi lệnh khôi phục cài đặt gốc xuống Tủ sạc
    bool sendFactoryReset(uint8_t slaveId);

    uint8_t getLastError() const { return lastError; }

private:
    ModbusRTU mb;
    uint16_t buffer[16]; // Chứa 16 thanh ghi đọc về (từ 0 đến 15)
    bool isWaiting = false;
    bool isSuccess = false;
    uint8_t lastError = 0;
};

#endif