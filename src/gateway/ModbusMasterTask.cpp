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
    if (isWaiting) {
        Serial.println("Modbus dang ban xu ly giao dich cu!");
        return false; // Tránh đụng độ
    }
    
    isWaiting = true;
    isSuccess = false;
    lastError = 0;
    
    // Đọc 10 thanh ghi đầu tiên (Từ địa chỉ 0)
    mb.readHreg(slaveId, 0, buffer, 10, [this, slaveId](Modbus::ResultCode event, uint16_t transId, void* ctx) -> bool {
        this->isWaiting = false;
        this->lastError = event;
        if (event == Modbus::EX_SUCCESS) {
            this->isSuccess = true;
        } else {
            Serial.printf("Loi Modbus TRAM %d: Ma loi = 0x%02X\n", slaveId, event);
        }
        return true;
    });

    // Đợi Modbus đọc xong (Tối đa 1000ms chống treo)
    uint32_t startWait = millis();
    while (isWaiting && (millis() - startWait < 1000)) {
        mb.task();
        delay(1);
    }

    if (isWaiting) {
        isWaiting = false; // Reset cờ nếu quá thời gian chờ
        Serial.printf("Loi: Modbus TRAM %d TIMEOUT (Chua nhan duoc phan hoi)\n", slaveId);
        return false;
    }

    if (isSuccess) {
        data.isOnline = true;
        data.temp = buffer[0] / 10.0;
        data.hum = buffer[1] / 10.0;
        
        data.stat1 = buffer[2];
        data.v1 = buffer[3] / 10.0;
        data.a1 = buffer[4] / 100.0;
        data.w1 = buffer[5] / 10.0;

        data.stat2 = buffer[6];
        data.v2 = buffer[7] / 10.0;
        data.a2 = buffer[8] / 100.0;
        data.w2 = buffer[9] / 10.0;
        return true;
    }
    return false;
}

bool ModbusMasterTask::sendCommand(uint8_t slaveId, uint8_t outletId, bool start) {
    if (isWaiting) {
        Serial.println("Modbus dang ban, khong the gui lenh!");
        return false;
    }

    isWaiting = true;
    isSuccess = false;
    lastError = 0;

    uint16_t reg = (outletId == 1) ? 10 : 11; // Thanh ghi lệnh tương ứng
    uint16_t val = start ? 1 : 0;

    mb.writeHreg(slaveId, reg, val, [this, slaveId, outletId, start](Modbus::ResultCode event, uint16_t transId, void* ctx) -> bool {
        this->isWaiting = false;
        this->lastError = event;
        if (event == Modbus::EX_SUCCESS) {
            this->isSuccess = true;
            Serial.printf("Gui lenh %s cho TRAM %d - O %d THANH CONG\n", start ? "BAT" : "TAT", slaveId, outletId);
        } else {
            Serial.printf("Gui lenh cho TRAM %d THAT BAI: Ma loi = 0x%02X\n", slaveId, event);
        }
        return true;
    });

    uint32_t startWait = millis();
    while (isWaiting && (millis() - startWait < 1000)) {
        mb.task();
        delay(1);
    }

    if (isWaiting) {
        isWaiting = false;
        Serial.printf("Loi: Gui lenh TRAM %d TIMEOUT\n", slaveId);
    }
    
    return isSuccess;
}

bool ModbusMasterTask::sendResetError(uint8_t slaveId, uint8_t outletId) {
    if (isWaiting) {
        Serial.println("Modbus dang ban, khong the gui lenh xoa loi!");
        return false;
    }

    isWaiting = true;
    isSuccess = false;
    lastError = 0;

    uint16_t reg = (outletId == 1) ? 10 : 11;
    uint16_t val = 2; // Lệnh 2 = Khôi phục lỗi

    mb.writeHreg(slaveId, reg, val, [this, slaveId, outletId](Modbus::ResultCode event, uint16_t transId, void* ctx) -> bool {
        this->isWaiting = false;
        this->lastError = event;
        if (event == Modbus::EX_SUCCESS) {
            this->isSuccess = true;
            Serial.printf("Gui lenh XOA LOI cho TRAM %d - O %d THANH CONG\n", slaveId, outletId);
        } else {
            Serial.printf("Gui lenh XOA LOI cho TRAM %d THAT BAI: Ma loi = 0x%02X\n", slaveId, event);
        }
        return true;
    });

    uint32_t startWait = millis();
    while (isWaiting && (millis() - startWait < 1000)) {
        mb.task();
        delay(1);
    }

    if (isWaiting) {
        isWaiting = false;
        Serial.printf("Loi: Gui lenh XOA LOI TRAM %d TIMEOUT\n", slaveId);
    }
    
    return isSuccess;
}

bool ModbusMasterTask::sendConfig(uint8_t slaveId, uint16_t maxCurrent, uint16_t tempLimit, uint16_t status) {
    if (isWaiting) {
        Serial.println("Modbus dang ban, khong the gui cau hinh!");
        return false;
    }

    isWaiting = true;
    isSuccess = false;
    lastError = 0;

    // Viết 3 thanh ghi cấu hình liên tiếp bắt đầu từ địa chỉ 12 (REG_MAX_CURRENT)
    static uint16_t configData[3];
    configData[0] = maxCurrent;
    configData[1] = tempLimit;
    configData[2] = status;

    mb.writeHreg(slaveId, 12, configData, 3, [this, slaveId](Modbus::ResultCode event, uint16_t transId, void* ctx) -> bool {
        this->isWaiting = false;
        this->lastError = event;
        if (event == Modbus::EX_SUCCESS) {
            this->isSuccess = true;
            Serial.printf("Gui cau hinh cho TRAM %d THANH CONG\n", slaveId);
        } else {
            Serial.printf("Gui cau hinh cho TRAM %d THAT BAI: Ma loi = 0x%02X\n", slaveId, event);
        }
        return true;
    });

    uint32_t startWait = millis();
    while (isWaiting && (millis() - startWait < 1500)) {
        mb.task();
        delay(1);
    }

    if (isWaiting) {
        isWaiting = false;
        Serial.printf("Loi: Gui cau hinh TRAM %d TIMEOUT\n", slaveId);
    }
    
    return isSuccess;
}

bool ModbusMasterTask::sendStationStatus(uint8_t slaveId, uint16_t status) {
    if (isWaiting) {
        Serial.println("Modbus dang ban, khong the gui trang thai!");
        return false;
    }

    isWaiting = true;
    isSuccess = false;
    lastError = 0;

    mb.writeHreg(slaveId, 14, status, [this, slaveId, status](Modbus::ResultCode event, uint16_t transId, void* ctx) -> bool {
        this->isWaiting = false;
        this->lastError = event;
        if (event == Modbus::EX_SUCCESS) {
            this->isSuccess = true;
            Serial.printf("Gui trang thai %d cho TRAM %d THANH CONG\n", status, slaveId);
        } else {
            Serial.printf("Gui trang thai cho TRAM %d THAT BAI: Ma loi = 0x%02X\n", slaveId, event);
        }
        return true;
    });

    uint32_t startWait = millis();
    while (isWaiting && (millis() - startWait < 1000)) {
        mb.task();
        delay(1);
    }

    if (isWaiting) {
        isWaiting = false;
        Serial.printf("Loi: Gui trang thai TRAM %d TIMEOUT\n", slaveId);
    }
    
    return isSuccess;
}

bool ModbusMasterTask::sendReboot(uint8_t slaveId) {
    if (isWaiting) {
        Serial.println("Modbus dang ban, khong the gui lenh reboot!");
        return false;
    }

    isWaiting = true;
    isSuccess = false;
    lastError = 0;

    uint16_t reg = 15; // REG_REBOOT
    uint16_t val = 1;

    mb.writeHreg(slaveId, reg, val, [this, slaveId](Modbus::ResultCode event, uint16_t transId, void* ctx) -> bool {
        this->isWaiting = false;
        this->lastError = event;
        if (event == Modbus::EX_SUCCESS) {
            this->isSuccess = true;
            Serial.printf("Gui lenh REBOOT cho TRAM %d THANH CONG\n", slaveId);
        } else {
            Serial.printf("Gui lenh REBOOT cho TRAM %d THAT BAI: Ma loi = 0x%02X\n", slaveId, event);
        }
        return true;
    });

    uint32_t startWait = millis();
    while (isWaiting && (millis() - startWait < 1000)) {
        mb.task();
        delay(1);
    }

    if (isWaiting) {
        isWaiting = false;
        Serial.printf("Loi: Gui lenh REBOOT TRAM %d TIMEOUT\n", slaveId);
    }
    
    return isSuccess;
}

bool ModbusMasterTask::sendFactoryReset(uint8_t slaveId) {
    if (isWaiting) {
        Serial.println("Modbus dang ban, khong the gui lenh factory reset!");
        return false;
    }

    isWaiting = true;
    isSuccess = false;
    lastError = 0;

    uint16_t reg = 15; // REG_REBOOT
    uint16_t val = 2;  // 2 đại diện cho Factory Reset

    mb.writeHreg(slaveId, reg, val, [this, slaveId](Modbus::ResultCode event, uint16_t transId, void* ctx) -> bool {
        this->isWaiting = false;
        this->lastError = event;
        if (event == Modbus::EX_SUCCESS) {
            this->isSuccess = true;
            Serial.printf("Gui lenh FACTORY RESET cho TRAM %d THANH CONG\n", slaveId);
        } else {
            Serial.printf("Gui lenh FACTORY RESET cho TRAM %d THAT BAI: Ma loi = 0x%02X\n", slaveId, event);
        }
        return true;
    });

    uint32_t startWait = millis();
    while (isWaiting && (millis() - startWait < 1000)) {
        mb.task();
        delay(1);
    }

    if (isWaiting) {
        isWaiting = false;
        Serial.printf("Loi: Gui lenh FACTORY RESET TRAM %d TIMEOUT\n", slaveId);
    }
    
    return isSuccess;
}

