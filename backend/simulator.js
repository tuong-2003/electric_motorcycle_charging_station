const mqtt = require('mqtt');
const readline = require('readline');

const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://broker.hivemq.com';
const client = mqtt.connect(MQTT_BROKER);

// Danh sách các trạm sạc giả lập
const simulatedStations = {
    // Để tránh xung đột dữ liệu với tủ sạc thật 001 của bạn, simulator chỉ giả lập tủ 002 và 003.
    // '001': createDefaultStation('001'),
    '002': createDefaultStation('002'),
    '003': createDefaultStation('003')
};

function createDefaultStation(id) {
    return {
        id: id,
        status: 'online',
        temperature: 25.0,
        humidity: 60.0,
        temp_limit: 65.0,
        max_current: 16.0,
        outlets: {
            '1': {
                status: 'AVAILABLE',
                is_charging: false,
                voltage: 0.0,
                current: 0.0,
                power: 0.0,
                error: 0, // 0: OK, 1: OVERCURRENT, 2: OVERTEMPERATURE
                overcurrent_injected: false
            },
            '2': {
                status: 'AVAILABLE',
                is_charging: false,
                voltage: 0.0,
                current: 0.0,
                power: 0.0,
                error: 0,
                overcurrent_injected: false
            }
        },
        overtemp_injected: false
    };
}

// Khi kết nối MQTT thành công
client.on('connect', () => {
    console.log(`📶 [Simulator] Đã kết nối MQTT Broker: ${MQTT_BROKER}`);

    // Subscribe các topic cấu hình và lệnh điều khiển cho cả 3 trạm
    Object.keys(simulatedStations).forEach(stId => {
        client.subscribe(`ev_station/${stId}/outlet/+/cmd`);
        client.subscribe(`ev_station/${stId}/config`);
        client.subscribe(`ev_station/${stId}/cmd`);
        console.log(`📡 [Simulator] Đang lắng nghe các lệnh cho Tủ sạc ${stId}...`);
    });

    printMenu();
});

// Nhận lệnh từ Cloud/Gateway
client.on('message', (topic, payload) => {
    let data;
    try {
        data = JSON.parse(payload.toString());
    } catch (e) {
        return;
    }

    // 1. Lệnh điều khiển cổng sạc: ev_station/001/outlet/1/cmd
    let matchOutletCmd = topic.match(/ev_station\/(\d+)\/outlet\/(\d+)\/cmd/);
    if (matchOutletCmd) {
        const stId = matchOutletCmd[1];
        const outletId = matchOutletCmd[2];
        const station = simulatedStations[stId];
        if (!station) return;

        const cmd = data.command;
        const outlet = station.outlets[outletId];
        if (!outlet) return;

        console.log(`\n📬 [Nhận Lệnh] Tủ sạc ${stId} - Ổ ${outletId}: Lệnh = ${cmd}`);

        if (cmd === 'START_CHARGE') {
            // Kiểm tra bảo vệ quá nhiệt trước
            if (station.temperature > station.temp_limit || station.overtemp_injected) {
                console.log(`❌ [Từ chối] Tủ sạc ${stId} đang bị quá nhiệt, không thể khởi động rơ-le!`);
                return;
            }

            outlet.is_charging = true;
            outlet.error = 0;
            outlet.overcurrent_injected = false;
            outlet.status = 'CHARGING';
            outlet.voltage = 220.0;
            outlet.current = 5.5; // Dòng điện sạc bình thường giả định 5.5A
            outlet.power = outlet.voltage * outlet.current;

            console.log(`⚡ [Khởi động] Đã đóng Rơ-le Cổng ${outletId} trạm ${stId}.`);
        } else if (cmd === 'STOP_CHARGE') {
            outlet.is_charging = false;
            outlet.voltage = 0.0;
            outlet.current = 0.0;
            outlet.power = 0.0;

            // QUAN TRỌNG: Không xóa cờ lỗi chốt khi nhận lệnh STOP_CHARGE
            if (outlet.status !== 'OVERCURRENT' && outlet.status !== 'OVERTEMPERATURE') {
                outlet.status = 'AVAILABLE';
                outlet.error = 0;
            }
            console.log(`🔌 [Ngắt] Đã mở Rơ-le Cổng ${outletId} trạm ${stId}.`);
        } else if (cmd === 'RESET_ERROR') {
            outlet.is_charging = false;
            outlet.voltage = 0.0;
            outlet.current = 0.0;
            outlet.power = 0.0;
            outlet.status = 'AVAILABLE';
            outlet.error = 0;
            outlet.overcurrent_injected = false;
            console.log(`🧹 [Xóa Lỗi] Đã khôi phục trạng thái Cổng ${outletId} trạm ${stId} về Sẵn sàng.`);
        }

        publishTelemetry(stId);
        printMenu();
    }

    // 2. Lệnh cấu hình: ev_station/001/config
    let matchConfig = topic.match(/ev_station\/(\d+)\/config/);
    if (matchConfig) {
        const stId = matchConfig[1];
        const station = simulatedStations[stId];
        if (!station) return;

        if (data.max_current !== undefined) station.max_current = parseFloat(data.max_current);
        if (data.temp_limit !== undefined) station.temp_limit = parseFloat(data.temp_limit);
        if (data.status !== undefined) station.status = data.status;

        console.log(`\n⚙️ [Đồng bộ cấu hình] Tủ ${stId}: Dòng Max = ${station.max_current}A, Ngưỡng Nhiệt = ${station.temp_limit}°C, Trạng thái = ${station.status}`);
        printMenu();
    }

    // 3. Lệnh điều khiển tủ sạc toàn trạm: ev_station/001/cmd
    let matchGlobalCmd = topic.match(/ev_station\/(\d+)\/cmd/);
    if (matchGlobalCmd) {
        const stId = matchGlobalCmd[1];
        const station = simulatedStations[stId];
        if (!station) return;

        const cmd = data.command;
        console.log(`\n📬 [Lệnh Hệ thống] Tủ sạc ${stId}: ${cmd}`);

        if (cmd === 'REBOOT') {
            console.log(`🔄 [Reboot] Tủ sạc ${stId} đang khởi động lại ảo...`);
            station.temperature = 25.0;
            station.overtemp_injected = false;
            Object.keys(station.outlets).forEach(oId => {
                const o = station.outlets[oId];
                o.is_charging = false;
                o.voltage = 0.0;
                o.current = 0.0;
                o.power = 0.0;
                o.status = 'AVAILABLE';
                o.error = 0;
                o.overcurrent_injected = false;
            });
        } else if (cmd === 'FACTORY_RESET') {
            console.log(`🚨 [Factory Reset] Khôi phục cài đặt gốc tủ sạc ${stId} ảo...`);
            simulatedStations[stId] = createDefaultStation(stId);
        }

        publishTelemetry(stId);
        printMenu();
    }
});

// Vòng lặp định kỳ đẩy dữ liệu (Heartbeat) mỗi 5 giây
setInterval(() => {
    Object.keys(simulatedStations).forEach(stId => {
        const station = simulatedStations[stId];

        // Cập nhật ngẫu nhiên nhỏ thông số nhiệt độ/độ ẩm để giả lập thực tế
        if (station.overtemp_injected) {
            station.temperature = 72.5; // Đẩy lên quá ngưỡng
        } else {
            // Giả lập tăng nhẹ nhiệt độ khi đang sạc
            let anyCharging = Object.values(station.outlets).some(o => o.is_charging);
            if (anyCharging) {
                station.temperature = Math.min(64.5, station.temperature + 0.1);
            } else {
                station.temperature = Math.max(25.0, station.temperature - 0.1);
            }
        }

        // 1. Kiểm tra cảnh báo quá nhiệt toàn tủ
        if (station.temperature > station.temp_limit) {
            Object.keys(station.outlets).forEach(oId => {
                const o = station.outlets[oId];
                o.is_charging = false;
                o.voltage = 0.0;
                o.current = 0.0;
                o.power = 0.0;
                o.status = 'OVERTEMPERATURE';
                o.error = 2;
            });
        } else {
            // Khôi phục tự động lỗi quá nhiệt khi nhiệt độ hạ xuống dưới ngưỡng
            Object.keys(station.outlets).forEach(oId => {
                const o = station.outlets[oId];
                if (o.status === 'OVERTEMPERATURE') {
                    o.status = 'AVAILABLE';
                    o.error = 0;
                }
            });

            // 2. Kiểm tra quá dòng từng cổng sạc
            Object.keys(station.outlets).forEach(oId => {
                const o = station.outlets[oId];
                if (o.is_charging) {
                    if (o.overcurrent_injected) {
                        o.current = station.max_current + 2.5; // Đẩy dòng vượt ngưỡng
                        o.power = o.voltage * o.current;
                    } else {
                        // Dao động dòng điện nhẹ khi sạc bình thường
                        o.current = 5.5 + (Math.random() - 0.5) * 0.2;
                        o.power = o.voltage * o.current;
                    }

                    // Kích hoạt quá dòng
                    if (o.current > station.max_current) {
                        o.is_charging = false;
                        o.voltage = 0.0;
                        o.current = 0.0;
                        o.power = 0.0;
                        o.status = 'OVERCURRENT';
                        o.error = 1;
                        console.log(`\n🚨 [BẢO VỆ CỤC BỘ] Phát hiện quá dòng tại Tủ sạc ${stId} - Ổ ${oId}! (${(station.max_current + 2.5).toFixed(2)}A > ${station.max_current}A)`);
                        printMenu();
                    }
                }
            });
        }

        publishTelemetry(stId);
    });
}, 5000);

// Hàm xuất telemetry MQTT trùng định dạng của Gateway
function publishTelemetry(stId) {
    const station = simulatedStations[stId];
    if (!station) return;

    // Cổng 1 status
    const o1 = station.outlets['1'];
    const p1 = {
        station_id: stId,
        outlet_id: 1,
        status: o1.status,
        voltage: parseFloat(o1.voltage.toFixed(1)),
        current: parseFloat(o1.current.toFixed(2)),
        power: parseFloat(o1.power.toFixed(1)),
        temperature: parseFloat(station.temperature.toFixed(1)),
        humidity: parseFloat(station.humidity.toFixed(1))
    };
    client.publish(`ev_station/${stId}/outlet/1/status`, JSON.stringify(p1));

    // Cổng 2 status
    const o2 = station.outlets['2'];
    const p2 = {
        station_id: stId,
        outlet_id: 2,
        status: o2.status,
        voltage: parseFloat(o2.voltage.toFixed(1)),
        current: parseFloat(o2.current.toFixed(2)),
        power: parseFloat(o2.power.toFixed(1))
    };
    client.publish(`ev_station/${stId}/outlet/2/status`, JSON.stringify(p2));
}

// Bảng điều khiển dòng lệnh
function printMenu() {
    // Chỉ hiển thị gọn thông báo và trạng thái
    console.log('\x1Bc'); // Clear terminal screen
    console.log('========================================================================');
    console.log('⚡ TRÌNH GIẢ LẬP TỦ SẠC XE ĐIỆN VẬT LÝ TRÊN MẠNG MQTT ⚡');
    console.log('========================================================================');
    console.log(`MQTT Broker: ${MQTT_BROKER}\n`);

    Object.keys(simulatedStations).forEach(stId => {
        const st = simulatedStations[stId];
        let maintStr = st.status === 'maintenance' ? ' [BẢO TRÌ]' : '';
        console.log(`Station ${stId}: Nhiệt độ = ${st.temperature.toFixed(1)}°C / Ngưỡng = ${st.temp_limit}°C${maintStr}`);
        Object.keys(st.outlets).forEach(oId => {
            const o = st.outlets[oId];
            let activeStr = o.is_charging ? `⚡ SẠC (${o.current.toFixed(2)}A, ${o.power.toFixed(1)}W)` : 'RẢNH';
            if (o.status === 'OVERCURRENT') activeStr = '❌ LỖI QUÁ DÒNG';
            if (o.status === 'OVERTEMPERATURE') activeStr = '🔥 LỖI QUÁ NHIỆT';
            console.log(`   └─ Ổ ${oId}: Trạng thái = [${o.status}] | Hoạt động: ${activeStr}`);
        });
    });
    console.log('\n------------------------------------------------------------------------');
    console.log('Phím tắt tiêm sự cố bảo vệ an toàn hệ thống:');
    console.log(' [1] Tiêm lỗi Quá Dòng vào Tủ sạc 002 - Ổ sạc 1 (Khi đang sạc)');
    console.log(' [2] Tiêm lỗi Quá Nhiệt vào Tủ sạc 002 (Nhiệt độ vọt lên 72.5°C)');
    console.log(' [3] Tiêm lỗi Quá Nhiệt vào Tủ sạc 003 (Nhiệt độ vọt lên 72.5°C)');
    console.log(' [r] Khôi phục toàn bộ lỗi ảo (Hạ nhiệt độ phòng, Xóa cờ lỗi dòng)');
    console.log(' [q] Thoát khỏi trình giả lập');
    console.log('------------------------------------------------------------------------');
    process.stdout.write('Nhập lựa chọn của bạn: ');
}

// Bắt sự kiện bàn phím nhập CLI
readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
}

process.stdin.on('keypress', (str, key) => {
    if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
        console.log('\nĐang ngắt kết nối MQTT và thoát simulator...');
        client.end();
        process.exit();
    }

    if (key.name === '1') {
        const st = simulatedStations['002'];
        if (st.outlets['1'].is_charging) {
            st.outlets['1'].overcurrent_injected = true;
            console.log('\n✔ Đã kích hoạt tiêm dòng lớn (>16A) vào Tủ 002 - Ổ 1. Chờ kiểm tra bảo vệ...');
        } else {
            console.log('\n⚠ Lỗi: Cổng 1 của Tủ 002 phải đang sạc thì mới giả lập quá dòng được!');
        }
        setTimeout(printMenu, 1500);
    }
    else if (key.name === '2') {
        simulatedStations['002'].overtemp_injected = true;
        console.log('\n✔ Đã kích hoạt tiêm nhiệt độ cao (72.5°C) vào Tủ 002. Cả 2 cổng sạc sẽ tự động ngắt điện...');
        setTimeout(printMenu, 1500);
    }
    else if (key.name === '3') {
        simulatedStations['003'].overtemp_injected = true;
        console.log('\n✔ Đã kích hoạt tiêm nhiệt độ cao (72.5°C) vào Tủ 003. Cả 2 cổng sạc sẽ tự động ngắt điện...');
        setTimeout(printMenu, 1500);
    }
    else if (key.name === 'r') {
        Object.keys(simulatedStations).forEach(stId => {
            const st = simulatedStations[stId];
            st.overtemp_injected = false;
            st.temperature = 25.0;
            Object.keys(st.outlets).forEach(oId => {
                const o = st.outlets[oId];
                o.overcurrent_injected = false;
                if (o.status === 'OVERCURRENT' || o.status === 'OVERTEMPERATURE') {
                    o.status = 'AVAILABLE';
                    o.error = 0;
                }
            });
        });
        console.log('\n✔ Đã xóa toàn bộ lỗi ảo và hạ nhiệt độ về 25°C!');
        setTimeout(printMenu, 1500);
    }
});
