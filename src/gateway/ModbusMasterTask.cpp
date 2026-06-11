#include "ModbusMasterTask.h"

void ModbusMasterTask::begin() {
    Serial1.begin(9600, SERIAL_8N1, RS485_RX_PIN, RS485_TX_PIN);
    mb.begin(&Serial1);
    mb.master(); // Set ESP32 này làm Master
}

void ModbusMasterTask::loop() {
    mb.task();
}

bool ModbusMasterTask::readStation(uint8_t slaveId, StationData &data) {
    if (mb.slave()) return false; // Đang bận
    
    isWaiting = true;
    isSuccess = false;
    
    // Đọc 10 thanh ghi đầu tiên (Từ địa chỉ 0)
    mb.readHreg(slaveId, 0, buffer, 10, [this](Modbus::ResultCode event, uint16_t transId, void* ctx) -> bool {
        this->isWaiting = false;
        if (event == Modbus::EX_SUCCESS) this->isSuccess = true;
        return true;
    });

    // Đợi Modbus đọc xong (Tối đa 500ms chống treo)
    uint32_t startWait = millis();
    while (isWaiting && (millis() - startWait < 500)) {
        mb.task();
        delay(1);
    }

    if (isSuccess) {
        data.isOnline = true;
        data.temp = buffer[0] / 10.0;
        data.hum = buffer[1] / 10.0;
        
        data.stat1 = buffer[2] == 1;
        data.v1 = buffer[3] / 10.0;
        data.a1 = buffer[4] / 100.0;
        data.w1 = buffer[5] / 10.0;

        data.stat2 = buffer[6] == 1;
        data.v2 = buffer[7] / 10.0;
        data.a2 = buffer[8] / 100.0;
        data.w2 = buffer[9] / 10.0;
        return true;
    }
    return false;
}

bool ModbusMasterTask::sendCommand(uint8_t slaveId, uint8_t outletId, bool start) {
    if (mb.slave()) return false;
    isWaiting = true;
    isSuccess = false;

    uint16_t reg = (outletId == 1) ? 10 : 11; // Thanh ghi lệnh tương ứng
    uint16_t val = start ? 1 : 0;

    mb.writeHreg(slaveId, reg, val, [this](Modbus::ResultCode event, uint16_t transId, void* ctx) -> bool {
        this->isWaiting = false;
        if (event == Modbus::EX_SUCCESS) this->isSuccess = true;
        return true;
    });

    uint32_t startWait = millis();
    while (isWaiting && (millis() - startWait < 500)) {
        mb.task();
        delay(1);
    }
    return isSuccess;
}
