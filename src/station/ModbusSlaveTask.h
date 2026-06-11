#ifndef MODBUS_SLAVE_TASK_H
#define MODBUS_SLAVE_TASK_H

#include <Arduino.h>
#include <ModbusRTU.h>

#define RS485_RX_PIN 18
#define RS485_TX_PIN 19
#define SLAVE_ID 1 // ID của tủ sạc này (Có thể đổi thành 2, 3... cho các tủ khác)

// --- BẢN ĐỒ THANH GHI MODBUS (REGISTER MAP) ---
#define REG_TEMP             0
#define REG_HUM              1
#define REG_OUTLET1_STATUS   2 // 0: Available, 1: Charging
#define REG_OUTLET1_V        3 // Giá trị thực x10 (VD: 220.5V -> 2205)
#define REG_OUTLET1_A        4 // Giá trị thực x100 (VD: 5.12A -> 512)
#define REG_OUTLET1_W        5 // Giá trị thực x10
#define REG_OUTLET2_STATUS   6
#define REG_OUTLET2_V        7
#define REG_OUTLET2_A        8
#define REG_OUTLET2_W        9
#define REG_CMD_OUTLET1      10 // Gateway ghi 1 vào đây để Bật, 0 để Tắt
#define REG_CMD_OUTLET2      11 

class ModbusSlaveTask {
public:
    void begin();
    void loop();
    void updateTelemetry(float temp, float hum, 
                         float v1, float a1, float w1, bool stat1, 
                         float v2, float a2, float w2, bool stat2);
    int getCommandOutlet1(); // Trả về 1 (Bật), 0 (Tắt), hoặc -1 (Không có lệnh)
    int getCommandOutlet2();
    void clearCommandOutlet1();
    void clearCommandOutlet2();

private:
    ModbusRTU mb;
};

#endif