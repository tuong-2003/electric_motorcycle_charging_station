#include "ModbusSlaveTask.h"

void ModbusSlaveTask::begin() {
    Serial1.begin(9600, SERIAL_8N1, RS485_RX_PIN, RS485_TX_PIN);
    mb.begin(&Serial1);
    mb.slave(SLAVE_ID);

    // Khởi tạo các thanh ghi (Holding Registers) bao gồm cả thanh ghi cấu hình mới và reboot
    for (uint16_t i = 0; i <= REG_REBOOT; i++) {
        mb.addHreg(i, 0);
    }
    
    // Đặt giá trị mặc định cho thanh ghi Lệnh là 0xFFFF (-1) để phân biệt với 0 và 1
    mb.Hreg(REG_CMD_OUTLET1, 0xFFFF);
    mb.Hreg(REG_CMD_OUTLET2, 0xFFFF);

    // Đặt cấu hình mặc định (phòng hờ khi chưa nhận được đồng bộ từ Gateway)
    mb.Hreg(REG_MAX_CURRENT, 1600); // 16A x 100
    mb.Hreg(REG_TEMP_LIMIT, 65);    // 65°C
    mb.Hreg(REG_STATION_STATUS, 0); // Hoạt động bình thường (0)
}

void ModbusSlaveTask::loop() {
    mb.task(); // Lắng nghe và trả lời Gateway liên tục
}

void ModbusSlaveTask::updateTelemetry(float temp, float hum, 
                                      float v1, float a1, float w1, bool stat1, 
                                      float v2, float a2, float w2, bool stat2) {
    // Đóng gói số thập phân thành số nguyên để truyền qua Modbus
    mb.Hreg(REG_TEMP, (uint16_t)(temp * 10));
    mb.Hreg(REG_HUM, (uint16_t)(hum * 10));
    
    mb.Hreg(REG_OUTLET1_STATUS, stat1 ? 1 : 0);
    mb.Hreg(REG_OUTLET1_V, (uint16_t)(v1 * 10));
    mb.Hreg(REG_OUTLET1_A, (uint16_t)(a1 * 100));
    mb.Hreg(REG_OUTLET1_W, (uint16_t)(w1 * 10));

    mb.Hreg(REG_OUTLET2_STATUS, stat2 ? 1 : 0);
    mb.Hreg(REG_OUTLET2_V, (uint16_t)(v2 * 10));
    mb.Hreg(REG_OUTLET2_A, (uint16_t)(a2 * 100));
    mb.Hreg(REG_OUTLET2_W, (uint16_t)(w2 * 10));
}

int ModbusSlaveTask::getCommandOutlet1() {
    uint16_t val = mb.Hreg(REG_CMD_OUTLET1);
    if (val == 1 || val == 0) return val;
    return -1;
}

int ModbusSlaveTask::getCommandOutlet2() {
    uint16_t val = mb.Hreg(REG_CMD_OUTLET2);
    if (val == 1 || val == 0) return val;
    return -1;
}

void ModbusSlaveTask::clearCommandOutlet1() { mb.Hreg(REG_CMD_OUTLET1, 0xFFFF); }
void ModbusSlaveTask::clearCommandOutlet2() { mb.Hreg(REG_CMD_OUTLET2, 0xFFFF); }

uint16_t ModbusSlaveTask::getMaxCurrent() { return mb.Hreg(REG_MAX_CURRENT); }
uint16_t ModbusSlaveTask::getTempLimit() { return mb.Hreg(REG_TEMP_LIMIT); }
uint16_t ModbusSlaveTask::getStationStatus() { return mb.Hreg(REG_STATION_STATUS); }

int ModbusSlaveTask::getRebootCommand() {
    return mb.Hreg(REG_REBOOT);
}

void ModbusSlaveTask::clearRebootCommand() {
    mb.Hreg(REG_REBOOT, 0);
}