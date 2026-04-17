import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, Alert, ScrollView, ActivityIndicator, Modal, Image, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { FontAwesome5 } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';

// Đổi đường link này thành link Render thực tế của bạn
const API_URL = 'https://electric-motorcycle-charging-station.onrender.com';

export default function App() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [balance, setBalance] = useState(0);
  const [rememberMe, setRememberMe] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState(false);
  const [activeTab, setActiveTab] = useState('home'); // 'home', 'history', 'account'
  const [stations, setStations] = useState<any[]>([]); // State lưu danh sách trạm
  const [selectedStation, setSelectedStation] = useState<any>(null); // State lưu trạm đang xem chi tiết
  const [selectedOutletModal, setSelectedOutletModal] = useState<any>(null); // State Popup cấu hình Ổ cắm Nâng cao
  const lastOutletRef = useRef<any>(null); // Giữ nội dung cũ trong suốt animation fade-out
  const [history, setHistory] = useState([]); // State lưu lịch sử giao dịch
  const [showPassword, setShowPassword] = useState(false);

  // State cho luồng Nạp Tiền VietQR Webhook
  const [topupModalVisible, setTopupModalVisible] = useState(false);
  const [qrModalVisible, setQrModalVisible] = useState(false);
  const [topupAmount, setTopupAmount] = useState('');
  const [isPollingBalance, setIsPollingBalance] = useState(false);
  const [topupHistory, setTopupHistory] = useState<any[]>([]); // [MỚI] State lưu lịch sử nạp tiền
  const [topupHistoryModalVisible, setTopupHistoryModalVisible] = useState(false); // [MỚI] State hiển thị Modal lịch sử nạp

  // State cho luồng Quên mật khẩu qua Email
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [fpStep, setFpStep] = useState(1);
  const [fpUsername, setFpUsername] = useState('');
  const [fpEmail, setFpEmail] = useState(''); // [MỚI] Ô nhập email cho bảo mật chống spam
  const [fpOtp, setFpOtp] = useState('');
  const [fpNewPassword, setFpNewPassword] = useState('');
  const [isFpLoading, setIsFpLoading] = useState(false);
  const [fpUsernameError, setFpUsernameError] = useState(false);
  const [fpEmailError, setFpEmailError] = useState(false); // [MỚI] Lỗi ô nhập email
  const [fpOtpError, setFpOtpError] = useState(false);
  const [fpNewPasswordError, setFpNewPasswordError] = useState(false);
  const [showFpPassword, setShowFpPassword] = useState(false);

  // State cho luồng Đăng ký tài khoản
  const [showRegister, setShowRegister] = useState(false);
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [isRegLoading, setIsRegLoading] = useState(false);
  const [regUsernameError, setRegUsernameError] = useState(false);
  const [regEmailError, setRegEmailError] = useState(false);
  const [regPasswordError, setRegPasswordError] = useState(false);
  const [showRegPassword, setShowRegPassword] = useState(false);

  // State cho Camera quét QR
  const [isScanning, setIsScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  // Tự động kiểm tra trạng thái đăng nhập khi người dùng mở App
  useEffect(() => {
    const checkLoginStatus = async () => {
      const token = await AsyncStorage.getItem('userToken');
      if (token) {
        setAuthToken(token);
        setIsLoggedIn(true);
        fetchProfile(token);
        fetchStations(token);
      }
    };
    checkLoginStatus();
  }, []);

  const handleLogin = async () => {
    const cleanUsername = username.trim(); // Loại bỏ dấu cách thừa khi gõ trên điện thoại
    if (!cleanUsername || !password) {
      Alert.alert('Thông báo', 'Vui lòng nhập đầy đủ tài khoản và mật khẩu!');
      return;
    }

    setIsLoading(true);
    setLoginError(false);
    try {
      const response = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: cleanUsername, password, rememberMe })
      });
      const data = await response.json();

      if (data.success) {
        setAuthToken(data.token);
        if (rememberMe) {
          await AsyncStorage.setItem('userToken', data.token);
        } else {
          await AsyncStorage.removeItem('userToken');
        }
        setIsLoggedIn(true);
        fetchProfile(data.token);
        fetchStations(data.token);
      } else {
        setLoginError(true);
        Alert.alert('Lỗi', data.message);
      }
    } catch (error) {
      setLoginError(true);
      Alert.alert('Lỗi mạng', 'Không thể kết nối đến Server');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchProfile = async (token: string) => {
    try {
      const response = await fetch(`${API_URL}/api/user/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.success) {
        setBalance(data.data.balance);
        setUsername(data.data.username); // Bổ sung dòng này để lấy tên hiển thị
      } else if (response.status === 401 || response.status === 403) {
        // Token đã hết hạn -> Xóa token và bắt đăng nhập lại
        Alert.alert('Phiên hết hạn', 'Vui lòng đăng nhập lại.');
        await AsyncStorage.removeItem('userToken');
        setAuthToken(null);
        setIsLoggedIn(false);
        setActiveTab('home');
        setUsername('');
        setPassword('');
      }
    } catch (error) {
      // Bỏ qua log lỗi mạng ngầm
    }
  };

  // Hàm tải danh sách trạm sạc từ Server
  const fetchStations = async (token: string) => {
    try {
      const response = await fetch(`${API_URL}/api/stations`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.success) {
        setStations(data.data || []);
      } else if (response.status === 401 || response.status === 403) {
        // Tránh alert 2 lần, chỉ cần âm thầm đăng xuất
        await AsyncStorage.removeItem('userToken');
        setAuthToken(null);
        setIsLoggedIn(false);
        setUsername('');
        setPassword('');
      }
    } catch (error) {
      // Bỏ qua log lỗi mạng ngầm
    }
  };

  // Tự động đồng bộ dữ liệu vào Trạm đang xem chi tiết nếu danh sách stations có cập nhật mới
  useEffect(() => {
    if (selectedStation) {
      const updated = stations.find((s: any) => s.station_id === selectedStation.station_id);
      if (updated) {
        setSelectedStation(updated);
        // Nếu Modal thông số đang mở, cập nhật luôn dữ liệu bên trong đó
        if (selectedOutletModal) {
          const updatedOutlet = updated.outlets?.find((o: any) => o.id === selectedOutletModal.id);
          if (updatedOutlet) setSelectedOutletModal(updatedOutlet);
        }
      }
    }
  }, [stations]);

  // Cơ chế Polling: Tự động tải lại dữ liệu Trạm sạc mỗi 5 giây để bắt kịp nhiệt độ mới nhất
  useEffect(() => {
    let interval: any;
    if (isLoggedIn && authToken && activeTab === 'home') {
      interval = setInterval(() => {
        fetchStations(authToken);
      }, 10000); // [TỐI ƯU] Tăng lên 10 giây để tiết kiệm pin và giảm tải máy chủ
    }
    // Dọn dẹp timer khi chuyển tab hoặc tắt app
    return () => clearInterval(interval);
  }, [isLoggedIn, authToken, activeTab]);

  // Hàm tải Lịch sử sạc từ Backend
  const fetchHistory = async () => {
    if (!authToken) return;
    try {
      const response = await fetch(`${API_URL}/api/sessions/history`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await response.json();
      if (data.success) {
        setHistory(data.data || []);
      }
    } catch (error) {
      // Bỏ qua log lỗi mạng ngầm
    }
  };

  // Tự động gọi API lịch sử mỗi khi user bấm sang tab History
  useEffect(() => {
    if (activeTab === 'history') {
      fetchHistory();
    }
  }, [activeTab]);

  // Tự động làm mới số dư ví mỗi 10 giây khi đang đăng nhập
  useEffect(() => {
    if (!isLoggedIn || !authToken) return;
    const intervalId = setInterval(() => {
      fetchProfile(authToken);
    }, 10000); // 10 giây
    return () => clearInterval(intervalId); // Dọn dẹp khi đăng xuất
  }, [isLoggedIn, authToken]);

  // [MỚI] Hàm tải lịch sử nạp tiền
  const fetchTopupHistory = async () => {
    if (!authToken) return;
    try {
      const response = await fetch(`${API_URL}/api/user/topup-history`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await response.json();
      if (data.success) {
        setTopupHistory(data.data);
      }
    } catch (error) {
      console.error('Lỗi tải lịch sử nạp:', error);
    }
  };

  // Hàm xử lý khi người dùng chọn sạc trực tiếp trên App thay vì quét QR
  const startChargeFromList = async (stationId: string, outletId: number) => {
    if (!authToken) return;
    try {
      const response = await fetch(`${API_URL}/api/charge/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ stationId, outletId })
      });

      const result = await response.json();
      if (result.success) {
        fetchProfile(authToken); // C?p nh?t l?i s? du v�
        setSelectedStation(null);
      } else {
        Alert.alert('Từ chối', result.message);
      }
    } catch (error) {
      Alert.alert('Lỗi mạng', 'Không thể kết nối đến máy chủ!');
    }
  };

  // Hàm xử lý khi người dùng bấm Dừng sạc
  const stopCharge = async (stationId: string, outletId: number) => {
    if (!authToken) return;
    try {
      const response = await fetch(`${API_URL}/api/charge/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ stationId, outletId })
      });

      const result = await response.json();
      if (result.success) {
        fetchProfile(authToken); // Cập nhật lại số dư ví sau khi bị trừ tiền
        fetchHistory(); // Làm mới lại danh sách lịch sử sạc
      } else {
        Alert.alert('Lỗi', result.message);
      }
    } catch (error) {
      Alert.alert('Lỗi mạng', 'Không thể kết nối đến máy chủ!');
    }
  };

  const handleLogout = async () => {
    await AsyncStorage.removeItem('userToken');
    setAuthToken(null);
    setIsLoggedIn(false);
    setActiveTab('home');
    setUsername('');
    setPassword('');
  };

  // Hàm polling: tự động kiểm tra số dư mỗi 5s, tối đa 12 lần (60s) sau khi user xác nhận CK
  const startBalancePolling = (token: string, previousBalance: number) => {
    setIsPollingBalance(true);
    let attempts = 0;
    const maxAttempts = 12;

    const intervalId = setInterval(async () => {
      attempts++;
      try {
        const response = await fetch(`${API_URL}/api/user/me`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (data.success && data.data.balance > previousBalance) {
          // Số dư đã tăng → dừng polling và cập nhật UI
          clearInterval(intervalId);
          setIsPollingBalance(false);
          setBalance(data.data.balance);
          Alert.alert('🎉 Nạp tiền thành công!', `Đã cộng ${(data.data.balance - previousBalance).toLocaleString('vi-VN')}đ vào ví của bạn!`);
          return;
        }
      } catch (_) { /* bỏ qua lỗi mạng tạm thời */ }

      if (attempts >= maxAttempts) {
        clearInterval(intervalId);
        setIsPollingBalance(false);
        Alert.alert('Thông báo', 'Không phát hiện giao dịch mới. Nếu đã chuyển khoản đúng nội dung, số dư sẽ được cập nhật trong ít phút.');
      }
    }, 5000); // Kiểm tra mỗi 5 giây
  };

  const copyToClipboard = async (text: string, title: string) => {
    await Clipboard.setStringAsync(text);
    Alert.alert('Đã sao chép!', `${title} đã được lưu vào khay nhớ tạm.`);
  };

  const saveQrToGallery = async () => {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Chưa cấp quyền', 'Vui lòng cho phép ứng dụng truy cập Ảnh để lưu mã QR.');
        return;
      }

      Alert.alert('Đang lưu', 'Hệ thống đang tải ảnh về máy...');
      const qrUrl = `https://img.vietqr.io/image/970422-0377326806-compact2.png?amount=${topupAmount}&addInfo=NAP%20TRAM%20${username}&accountName=HVT%20STATION`;
      const fileUri = FileSystem.documentDirectory + `vietqr_${new Date().getTime()}.png`;

      const { uri } = await FileSystem.downloadAsync(qrUrl, fileUri);
      await MediaLibrary.saveToLibraryAsync(uri);

      Alert.alert('Thành công', 'Đã lưu mã QR vào thư viện Ảnh của bạn! Hãy mở app Ngân hàng để quét.');
    } catch (e) {
      console.log(e);
      Alert.alert('Lỗi', 'Không thể lưu ảnh mã QR ngay lúc này. Vui lòng thử chụp màn hình lại!');
    }
  };

  // Hàm gửi yêu cầu lấy OTP qua Email
  const handleRequestOtp = async () => {
    let error = false;
    if (!fpUsername) { setFpUsernameError(true); error = true; }
    if (!fpEmail) { setFpEmailError(true); error = true; }

    if (error) {
      return Alert.alert('Thông báo', 'Vui lòng điền Tài khoản và Email!');
    }

    // Kiểm tra định dạng Email chuẩn
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(fpEmail)) {
      setFpEmailError(true);
      return Alert.alert('Thông báo', 'Địa chỉ Email không đúng định dạng!');
    }

    setIsFpLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: fpUsername, email: fpEmail })
      });
      const data = await response.json();
      if (data.success) {
        Alert.alert('Thành công', data.message);
        setFpStep(2); // Chuyển sang bước nhập OTP
      } else {
        Alert.alert('Lỗi', data.message);
      }
    } catch (error) {
      Alert.alert('Lỗi mạng', 'Không thể kết nối đến máy chủ!');
    } finally {
      setIsFpLoading(false);
    }
  };

  // Hàm xác nhận đặt lại mật khẩu
  const handleResetPassword = async () => {
    let hasError = false;
    if (!fpOtp) { setFpOtpError(true); hasError = true; }
    if (!fpNewPassword) { setFpNewPasswordError(true); hasError = true; }
    if (hasError) {
      return Alert.alert('Thông báo', 'Vui lòng điền đủ thông tin!');
    }

    setIsFpLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: fpUsername, otp: fpOtp, newPassword: fpNewPassword })
      });
      const data = await response.json();
      if (data.success) {
        Alert.alert('Thành công', data.message);
        setShowForgotPassword(false); setFpStep(1); setFpOtp(''); setFpNewPassword('');
        setUsername(fpUsername); setFpUsername(''); setFpEmail('');
      } else {
        Alert.alert('Lỗi', data.message);
      }
    } catch (error) {
      Alert.alert('Lỗi mạng', 'Không thể kết nối đến máy chủ!');
    } finally {
      setIsFpLoading(false);
    }
  };

  // Hàm xử lý Đăng ký tài khoản mới
  const handleRegister = async () => {
    let hasError = false;
    if (!regUsername) { setRegUsernameError(true); hasError = true; }
    if (!regEmail) { setRegEmailError(true); hasError = true; }
    if (!regPassword) { setRegPasswordError(true); hasError = true; }
    if (hasError) {
      return Alert.alert('Thông báo', 'Vui lòng nhập đủ thông tin!');
    }

    // Kiểm tra định dạng Email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(regEmail)) {
      setRegEmailError(true);
      return Alert.alert('Thông báo', 'Địa chỉ Email không hợp lệ!');
    }

    setIsRegLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: regUsername, email: regEmail, password: regPassword })
      });
      const data = await response.json();
      if (data.success) {
        Alert.alert('Thành công', data.message);
        setShowRegister(false);
        setUsername(regUsername); // Tự động điền sẵn tên user ra màn hình đăng nhập cho tiện
        setRegUsername(''); setRegEmail(''); setRegPassword('');
      } else {
        if (data.message.includes('Tên tài khoản') || data.message.includes('Email')) {
          setRegUsernameError(true);
        }
        if (data.message.includes('Email')) {
          setRegEmailError(true);
        }
        Alert.alert('Thông báo', data.message);
      }
    } catch (error) {
      Alert.alert('Lỗi mạng', 'Không thể kết nối đến máy chủ!');
    } finally {
      setIsRegLoading(false);
    }
  };

  // Hàm mở Camera
  const startScanning = async () => {
    if (!permission?.granted) {
      const { status } = await requestPermission();
      if (status !== 'granted') {
        Alert.alert('Lỗi', 'Cần cấp quyền Camera để quét mã QR trên trụ sạc!');
        return;
      }
    }
    setIsScanning(true);
  };

  // Hàm xử lý khi Camera đọc được mã QR
  const handleBarcodeScanned = async ({ type, data }: any) => {
    setIsScanning(false); // Tắt camera

    // Giả sử mã QR dán trên trạm có định dạng: "001.1" (Trạm 001, Ổ 1)
    const parts = data.split('.');
    if (parts.length !== 2) {
      Alert.alert('Mã QR không hợp lệ', 'Vui lòng quét đúng mã QR trên trụ sạc!');
      return;
    }

    const stationId = parts[0];
    const outletId = parseInt(parts[1], 10);

    if (!authToken) return;
    try {
      const response = await fetch(`${API_URL}/api/charge/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ stationId, outletId })
      });

      const result = await response.json();
      if (result.success) {
        Alert.alert('Thành công!', `Đã bắt đầu sạc xe tại Trạm ${stationId} - Ổ ${outletId}`);
        fetchProfile(authToken); // Cập nhật lại số dư ví sau khi sạc
      } else {
        Alert.alert('Từ chối', result.message);
      }
    } catch (error) {
      Alert.alert('Lỗi mạng', 'Không thể kết nối đến máy chủ!');
    }
  };

  // Giao diện Màn hình Camera Quét QR
  if (isScanning) {
    return (
      <View style={styles.container}>
        <CameraView
          style={StyleSheet.absoluteFillObject}
          facing="back"
          onBarcodeScanned={handleBarcodeScanned}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        />
        <View style={styles.overlay}>
          <Text style={styles.scanText}>Di chuyển camera vào mã QR trên trụ sạc</Text>
          <TouchableOpacity style={[styles.button, { backgroundColor: '#e74c3c', width: 150 }]} onPress={() => setIsScanning(false)}>
            <Text style={styles.buttonText}>Hủy quét</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (isLoggedIn) {
    return (
      <View style={styles.mainContainer}>
        {/* Nút Quay lại cho trang Chi tiết Trạm sạc (cố định góc trên cùng giống trang Đăng ký) */}
        {activeTab === 'home' && selectedStation && (
          <TouchableOpacity style={styles.absoluteBackButton} onPress={() => setSelectedStation(null)}>
            <FontAwesome5 name="arrow-left" size={16} color="#34495e" />
            <Text style={styles.backButtonText}>Quay lại</Text>
          </TouchableOpacity>
        )}

        <View style={styles.tabContent}>
          {/* Màn hình Trang chủ: Danh sách trạm */}
          {activeTab === 'home' && !selectedStation && (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
              <View style={styles.headerContainer}>
                <View style={styles.logoContainer}>
                  <FontAwesome5 name="charging-station" size={45} color="#3498db" />
                </View>
                <Text style={styles.mainTitle}>Trạm Sạc Xe Máy Điện</Text>
                <Text style={styles.subTitleText}>Xin chào, {username}! 👋</Text>
              </View>

              <TouchableOpacity style={styles.button} onPress={startScanning}>
                <Text style={styles.buttonText}>📷 Quét QR</Text>
              </TouchableOpacity>

              <Text style={styles.sectionTitle}>Danh sách Trạm sạc</Text>
              {stations.map((st: any) => (
                <TouchableOpacity key={st.station_id} style={styles.stationCard} onPress={() => setSelectedStation(st)}>
                  <View style={styles.stationIcon}><FontAwesome5 name="charging-station" size={24} color="#3498db" /></View>
                  <View style={styles.stationInfo}>
                    <Text style={styles.stationName}>{st.name}</Text>
                    <Text style={styles.stationLocation}>{st.location}</Text>
                  </View>
                  <View style={styles.stationStatus}>
                    <Text style={[styles.statusBadge, st.status === 'online' ? styles.statusOnline : styles.statusOffline]}>
                      {st.status === 'online' ? 'Sẵn sàng' : 'Bảo trì'}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* Màn hình Chi tiết Trạm sạc */}
          {activeTab === 'home' && selectedStation && (
            <View style={{ flex: 1, paddingTop: 40 }}>
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
                <View style={styles.stationDetailHeader}>
                  <FontAwesome5 name="charging-station" size={40} color="#3498db" style={{ marginBottom: 10 }} />
                  <Text style={styles.detailTitle}>{selectedStation.name}</Text>
                  <Text style={styles.detailLocation}>{selectedStation.location}</Text>
                  <Text style={styles.detailPrice}>Đơn giá: {selectedStation.unit_price.toLocaleString('vi-VN')} đ/kWh</Text>
                </View>

                {/* --- KHU VỰC HIỂN THỊ NHIỆT ĐỘ & ĐỘ ẨM --- */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 }}>
                  <View style={[styles.stationDetailHeader, { flex: 1, marginHorizontal: 5, padding: 15, marginBottom: 0 }]}>
                    <FontAwesome5 name="temperature-high" size={24} color="#e74c3c" style={{ marginBottom: 5 }} />
                    <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#2c3e50' }}>{selectedStation.temperature != null ? `${selectedStation.temperature} °C` : '-- °C'}</Text>
                  </View>
                  <View style={[styles.stationDetailHeader, { flex: 1, marginHorizontal: 5, padding: 15, marginBottom: 0 }]}>
                    <FontAwesome5 name="tint" size={24} color="#3498db" style={{ marginBottom: 5 }} />
                    <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#2c3e50' }}>{selectedStation.humidity != null ? `${selectedStation.humidity} %` : '-- %'}</Text>
                  </View>
                </View>

                <Text style={styles.sectionTitle}>Chọn cổng sạc</Text>

                <View style={styles.outletsContainer}>
                  {(selectedStation.outlets || [
                    { id: 1, status: 'available' },
                    { id: 2, status: 'available' }
                  ]).map((outlet: any) => {
                    let outletColor = "#2ecc71"; // Xanh mặc định
                    let statusText = "Trống";

                    if (outlet.status === 'charging_by_me') {
                      outletColor = "#e67e22"; // Cam nếu mình đang sạc
                      statusText = `Đang sạc (${Math.floor((outlet.duration_sec || 0) / 60)}p)`;
                    } else if (outlet.status === 'charging_by_other') {
                      outletColor = "#e74c3c"; // Đỏ nếu người khác sạc
                      statusText = "Đang bận";
                    }

                    return (
                      <TouchableOpacity
                        key={outlet.id}
                        style={[styles.outletCard, { borderColor: outletColor, borderWidth: 1 }]}
                        onPress={() => setSelectedOutletModal(outlet)}
                      >
                        <FontAwesome5 name="plug" size={30} color={outletColor} style={{ marginBottom: 10 }} />
                        <Text style={styles.outletName}>Cổng sạc {outlet.id}</Text>
                        <Text style={[styles.outletStatus, { color: outletColor }]}>{statusText}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Modal Cấu hình Ổ cắm Nâng cao (HUD) */}
                <Modal
                  animationType="fade"
                  transparent={true}
                  visible={selectedOutletModal !== null}
                  onRequestClose={() => setSelectedOutletModal(null)}
                >
                  <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}>
                    <View style={{ width: '90%', backgroundColor: '#fff', borderRadius: 20, padding: 25, elevation: 10 }}>
                      {(() => {
                        if (selectedOutletModal) lastOutletRef.current = selectedOutletModal;
                        const outletData = lastOutletRef.current;
                        if (!outletData) return null;
                        let badgeColor = "#2ecc71";
                        let badgeText = "Sẵn sàng sạc";
                        let actionBtnText = "TIẾN HÀNH SẠC";
                        let actionBtnColor = "#2ecc71";

                        if (outletData.status === 'charging_by_me') {
                          badgeColor = "#e67e22";
                          badgeText = `Đang sạc (${Math.floor((outletData.duration_sec || 0) / 60)} phút)`;
                          actionBtnText = "DỪNG SẠC & THANH TOÁN";
                          actionBtnColor = "#e74c3c";
                        } else if (outletData.status === 'charging_by_other') {
                          badgeColor = "#e74c3c";
                          badgeText = "Đang có người sử dụng";
                        }

                        return (
                          <View>
                            {/* Header Modal */}
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                              <Text style={{ fontSize: 22, fontWeight: 'bold' }}>Cổng sạc {outletData.id}</Text>
                              <TouchableOpacity onPress={() => setSelectedOutletModal(null)}>
                                <FontAwesome5 name="times" size={24} color="#7f8c8d" />
                              </TouchableOpacity>
                            </View>

                            {/* Icon Trạng Thái Bự */}
                            <View style={{ alignItems: 'center', marginBottom: 20 }}>
                              <FontAwesome5 name="plug" size={50} color={badgeColor} style={{ marginBottom: 15 }} />
                              <Text style={{ fontSize: 18, fontWeight: 'bold', color: badgeColor }}>{badgeText}</Text>
                            </View>

                            {/* Bảng Kỹ Thuật (HUD) V, A, W */}
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#f8f9fa', padding: 15, borderRadius: 15, marginBottom: 25 }}>
                              <View style={{ alignItems: 'center' }}>
                                <Text style={{ color: '#7f8c8d', fontSize: 13, marginBottom: 5 }}>ĐIỆN ÁP</Text>
                                <Text style={{ fontWeight: 'bold', fontSize: 18, color: '#2c3e50' }}>{outletData.voltage || 0} V</Text>
                              </View>
                              <View style={{ alignItems: 'center' }}>
                                <Text style={{ color: '#7f8c8d', fontSize: 13, marginBottom: 5 }}>DÒNG ĐIỆN</Text>
                                <Text style={{ fontWeight: 'bold', fontSize: 18, color: '#3498db' }}>{outletData.current || 0} A</Text>
                              </View>
                              <View style={{ alignItems: 'center' }}>
                                <Text style={{ color: '#7f8c8d', fontSize: 13, marginBottom: 5 }}>CÔNG SUẤT</Text>
                                <Text style={{ fontWeight: 'bold', fontSize: 18, color: '#e74c3c' }}>{outletData.power || 0} W</Text>
                              </View>
                            </View>

                            {/* Nút Điều Khiển Mạch */}
                            {outletData.status !== 'charging_by_other' ? (
                              <TouchableOpacity
                                style={{ backgroundColor: actionBtnColor, paddingVertical: 15, borderRadius: 10, alignItems: 'center' }}
                                onPress={() => {
                                  if (outletData.status === 'available') {
                                    startChargeFromList(selectedStation.station_id, outletData.id);
                                  } else {
                                    stopCharge(selectedStation.station_id, outletData.id);
                                  }
                                  setSelectedOutletModal(null);
                                }}
                              >
                                <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>{actionBtnText}</Text>
                              </TouchableOpacity>
                            ) : (
                              <View style={{ backgroundColor: '#bdc3c7', paddingVertical: 15, borderRadius: 10, alignItems: 'center' }}>
                                <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>KHÔNG KHẢ DỤNG</Text>
                              </View>
                            )}
                          </View>
                        );
                      })()}
                    </View>
                  </View>
                </Modal>
              </ScrollView>
            </View>
          )}

          {activeTab === 'history' && (
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Lịch sử sạc</Text>
              {history.length === 0 ? (
                <View style={styles.centerContent}>
                  <Text style={styles.subtitle}>Chưa có dữ liệu giao dịch.</Text>
                </View>
              ) : (
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
                  {history.map((item: any, index: number) => (
                    <View key={index} style={styles.stationCard}>
                      <View style={styles.stationInfo}>
                        <Text style={styles.stationName}>Trạm: {item.station_id}</Text>
                        <Text style={styles.stationLocation}>{item.start} ➡️ {item.end || 'Đang sạc...'}</Text>
                        <Text style={[styles.stationName, { color: '#e67e22', marginTop: 4 }]}>
                          {item.total_kwh ? parseFloat(item.total_kwh).toFixed(2) + ' kWh - ' : ''}
                          {parseInt(item.total_cost || 0).toLocaleString('vi-VN')} đ
                        </Text>
                      </View>
                      <View style={styles.stationStatus}>
                        <Text style={[styles.statusBadge, item.status === 'completed' ? styles.statusOnline : { backgroundColor: '#f39c12', color: '#fff' }]}>
                          {item.status === 'completed' ? 'Hoàn tất' : 'Đang sạc'}
                        </Text>
                      </View>
                    </View>
                  ))}
                </ScrollView>
              )}
            </View>
          )}

          {activeTab === 'account' && (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
              <Text style={styles.title}>Tài khoản</Text>
              <Text style={styles.subtitle}>{username}</Text>

              <View style={styles.walletCard}>
                <View style={styles.walletHeader}>
                  <FontAwesome5 name="wallet" size={20} color="#3498db" />
                  <Text style={styles.walletTitle}>Ví của tôi</Text>
                </View>

                <Text style={styles.walletLabel}>Số dư hiện tại</Text>
                <Text style={styles.walletAmount}>{balance.toLocaleString('vi-VN')} đ</Text>

                <View style={styles.walletActions}>
                  <TouchableOpacity style={styles.walletActionButton} onPress={() => setTopupModalVisible(true)}>
                    <View style={styles.walletActionIcon}><FontAwesome5 name="plus" size={16} color="#fff" /></View>
                    <Text style={styles.walletActionText}>Nạp tiền</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.walletActionButton} onPress={() => {
                    fetchTopupHistory();
                    setTopupHistoryModalVisible(true);
                  }}>
                    <View style={[styles.walletActionIcon, { backgroundColor: '#f39c12' }]}><FontAwesome5 name="history" size={16} color="#fff" /></View>
                    <Text style={styles.walletActionText}>Lịch sử nạp</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <TouchableOpacity style={[styles.button, styles.logoutBtn, { width: '100%' }]} onPress={handleLogout}>
                <Text style={styles.buttonText}>Đăng xuất</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>

        {/* Modal: NHẬP SỐ TIỀN NẠP */}
        <Modal
          animationType="fade"
          transparent={true}
          visible={topupModalVisible}
          onRequestClose={() => setTopupModalVisible(false)}
        >
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}>
            <View style={{ width: '85%', backgroundColor: '#fff', borderRadius: 20, padding: 25, elevation: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <Text style={{ fontSize: 20, fontWeight: 'bold' }}>Nạp tiền vào ví</Text>
                <TouchableOpacity onPress={() => setTopupModalVisible(false)}>
                  <FontAwesome5 name="times" size={24} color="#7f8c8d" />
                </TouchableOpacity>
              </View>

              <Text style={{ fontSize: 16, marginBottom: 10, color: '#34495e' }}>Nhập số tiền muốn nạp (VNĐ):</Text>
              <TextInput
                style={{ borderWidth: 1, borderColor: '#bdc3c7', borderRadius: 10, padding: 15, fontSize: 18, marginBottom: 20, textAlign: 'center' }}
                keyboardType="numeric"
                placeholder="VD: 50000"
                value={topupAmount}
                onChangeText={setTopupAmount}
              />

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 }}>
                {[50000, 100000, 200000].map(amt => (
                  <TouchableOpacity
                    key={amt}
                    style={{ backgroundColor: '#ecf0f1', padding: 10, borderRadius: 10, flex: 1, marginHorizontal: 5, alignItems: 'center' }}
                    onPress={() => setTopupAmount(amt.toString())}
                  >
                    <Text style={{ color: '#2c3e50', fontWeight: 'bold' }}>{amt / 1000}k</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={[styles.button, { width: '100%' }]}
                onPress={() => {
                  if (parseInt(topupAmount) >= 2000) {
                    setTopupModalVisible(false);
                    setQrModalVisible(true);
                  } else {
                    Alert.alert('Lỗi', 'Số tiền nạp tối thiểu là 10.000đ');
                  }
                }}
              >
                <Text style={styles.buttonText}>Tạo mã QR Nạp</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Modal: QUÉT MÃ VIETQR */}
        <Modal
          animationType="slide"
          transparent={true}
          visible={qrModalVisible}
          onRequestClose={() => setQrModalVisible(false)}
        >
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}>
            <View style={{ width: '90%', backgroundColor: '#fff', borderRadius: 20, padding: 20, elevation: 10, alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: 10 }}>
                <Text style={{ fontSize: 20, fontWeight: 'bold', color: '#2c3e50' }}>Quét mã nạp tiền</Text>
                <TouchableOpacity onPress={() => setQrModalVisible(false)}>
                  <FontAwesome5 name="times" size={24} color="#7f8c8d" />
                </TouchableOpacity>
              </View>

              <Text style={{ fontSize: 14, color: '#7f8c8d', textAlign: 'center', marginBottom: 15 }}>
                Sử dụng App Ngân hàng hoặc MoMo quét mã QR bên dưới. Tiền sẽ tự động cập nhật trong 10 giây.
              </Text>

              {/* KHU VỰC HIỂN THỊ ẢNH QR MẪU */}
              <View style={{ padding: 10, backgroundColor: '#fff', borderRadius: 15, borderWidth: 1, borderColor: '#ecf0f1', marginBottom: 15 }}>
                <Image
                  source={{ uri: `https://img.vietqr.io/image/970422-0377326806-compact2.png?amount=${topupAmount}&addInfo=NAP%20TRAM%20${username}&accountName=HVT%20STATION` }}
                  style={{ width: 220, height: 220 }}
                  resizeMode="contain"
                />
              </View>

              <TouchableOpacity
                style={{ flexDirection: 'row', backgroundColor: '#e8f4f8', padding: 10, borderRadius: 10, marginBottom: 20 }}
                onPress={saveQrToGallery}
              >
                <FontAwesome5 name="download" size={16} color="#3498db" style={{ marginRight: 8, marginTop: 2 }} />
                <Text style={{ color: '#3498db', fontWeight: 'bold' }}>Tải mã QR xuống máy</Text>
              </TouchableOpacity>

              {/* BẢNG TEXT COPY THỦ CÔNG */}
              <View style={{ width: '100%', backgroundColor: '#f8f9fa', borderRadius: 10, padding: 15, marginBottom: 15 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                  <Text style={{ color: '#7f8c8d' }}>Ngân hàng:</Text>
                  <Text style={{ fontWeight: 'bold' }}>MB Bank</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, alignItems: 'center' }}>
                  <Text style={{ color: '#7f8c8d' }}>Số tài khoản:</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{ fontWeight: 'bold', marginRight: 10 }}>0377326806</Text>
                    <TouchableOpacity onPress={() => copyToClipboard('0377326806', 'Số tài khoản')}><FontAwesome5 name="copy" size={16} color="#3498db" /></TouchableOpacity>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, alignItems: 'center' }}>
                  <Text style={{ color: '#7f8c8d' }}>Số tiền:</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{ fontWeight: 'bold', color: '#e74c3c', marginRight: 10 }}>{parseInt(topupAmount || '0').toLocaleString('vi-VN')} đ</Text>
                    <TouchableOpacity onPress={() => copyToClipboard(topupAmount, 'Số tiền')}><FontAwesome5 name="copy" size={16} color="#3498db" /></TouchableOpacity>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: '#7f8c8d' }}>Nội dung:</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{ fontWeight: 'bold', color: '#f39c12', marginRight: 10 }}>NAP TRAM {username}</Text>
                    <TouchableOpacity onPress={() => copyToClipboard(`NAP TRAM ${username}`, 'Nội dung')}><FontAwesome5 name="copy" size={16} color="#3498db" /></TouchableOpacity>
                  </View>
                </View>
              </View>

              <TouchableOpacity
                style={[styles.button, { width: '100%', backgroundColor: isPollingBalance ? '#95a5a6' : '#2ecc71' }]}
                disabled={isPollingBalance}
                onPress={() => {
                  setQrModalVisible(false);
                  if (authToken) startBalancePolling(authToken, balance);
                }}
              >
                <Text style={styles.buttonText}>
                  {isPollingBalance ? '⏳ Đang chờ xác nhận...' : 'TÔI ĐÃ CHUYỂN KHOẢN'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Modal: LỊCH SỬ NẠP TIỀN */}
        <Modal
          animationType="slide"
          transparent={true}
          visible={topupHistoryModalVisible}
          onRequestClose={() => setTopupHistoryModalVisible(false)}
        >
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
            <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 25, borderTopRightRadius: 25, height: '70%', padding: 25 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <Text style={{ fontSize: 20, fontWeight: 'bold', color: '#2c3e50' }}>Lịch sử nạp tiền</Text>
                <TouchableOpacity onPress={() => setTopupHistoryModalVisible(false)}>
                  <FontAwesome5 name="times" size={24} color="#7f8c8d" />
                </TouchableOpacity>
              </View>

              {topupHistory.length === 0 ? (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  <FontAwesome5 name="box-open" size={50} color="#bdc3c7" style={{ marginBottom: 15 }} />
                  <Text style={{ color: '#7f8c8d' }}>Chưa có giao dịch nạp tiền nào.</Text>
                </View>
              ) : (
                <ScrollView showsVerticalScrollIndicator={false}>
                  {topupHistory.map((item, index) => (
                    <View key={index} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#ecf0f1' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#2ecc71' }}>+{item.amount.toLocaleString('vi-VN')} đ</Text>
                        <Text style={{ fontSize: 12, color: '#7f8c8d', marginTop: 4 }}>{new Date(item.created_at).toLocaleString('vi-VN')}</Text>
                        <Text style={{ fontSize: 13, color: '#34495e', marginTop: 4 }} numberOfLines={1}>{item.note}</Text>
                      </View>
                      <View style={{ backgroundColor: '#e8f5e9', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 }}>
                        <Text style={{ color: '#2ecc71', fontSize: 11, fontWeight: 'bold' }}>Thành công</Text>
                      </View>
                    </View>
                  ))}
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>

        {/* Bottom Tab Bar */}
        <View style={styles.tabBar}>
          <TouchableOpacity style={styles.tabItem} onPress={() => setActiveTab('home')}>
            <FontAwesome5 name="home" size={20} color={activeTab === 'home' ? '#3498db' : '#7f8c8d'} />
            <Text style={[styles.tabText, activeTab === 'home' && styles.tabTextActive]}>Trang chủ</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tabItem} onPress={() => setActiveTab('history')}>
            <FontAwesome5 name="receipt" size={20} color={activeTab === 'history' ? '#3498db' : '#7f8c8d'} />
            <Text style={[styles.tabText, activeTab === 'history' && styles.tabTextActive]}>Lịch sử</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tabItem} onPress={() => setActiveTab('account')}>
            <FontAwesome5 name="user" size={20} color={activeTab === 'account' ? '#3498db' : '#7f8c8d'} />
            <Text style={[styles.tabText, activeTab === 'account' && styles.tabTextActive]}>Tài khoản</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Giao diện Màn hình Quên mật khẩu
  if (showForgotPassword) {
    return (
      <View style={[styles.container, { justifyContent: 'flex-start', paddingTop: 60 }]}>
        <TouchableOpacity style={styles.absoluteBackButton} onPress={() => {
          setShowForgotPassword(false); setFpStep(1);
          setFpUsername(''); setFpEmail(''); setFpOtp(''); setFpNewPassword('');
          setFpUsernameError(false); setFpEmailError(false); setFpOtpError(false); setFpNewPasswordError(false);
          setShowFpPassword(false);
        }}>
          <FontAwesome5 name="arrow-left" size={16} color="#34495e" />
          <Text style={styles.backButtonText}>Quay lại</Text>
        </TouchableOpacity>

        <View style={styles.headerContainer}>
          <View style={[styles.logoContainer, { backgroundColor: '#fdedec', shadowColor: '#e74c3c' }]}>
            <FontAwesome5 name="envelope" size={40} color="#e74c3c" />
          </View>
          <Text style={styles.mainTitle}>Khôi Phục Mật Khẩu</Text>
          <Text style={[styles.subTitleText, { textAlign: 'center', paddingHorizontal: 20 }]}>
            {fpStep === 1 ? 'Điền thông tin để nhận mã OTP' : 'Nhập mã OTP để thiết lập mật khẩu mới'}
          </Text>
        </View>

        {fpStep === 1 ? (
          <>
            <TextInput style={[styles.input, fpUsernameError && styles.inputError]} placeholder="Tên tài khoản" value={fpUsername} onChangeText={(text) => { setFpUsername(text); setFpUsernameError(false); }} autoCapitalize="none" />
            <TextInput style={[styles.input, fpEmailError && styles.inputError]} placeholder="Email liên kết" value={fpEmail} onChangeText={(text) => { setFpEmail(text); setFpEmailError(false); }} keyboardType="email-address" autoCapitalize="none" />

            <TouchableOpacity style={[styles.button, { backgroundColor: '#e74c3c', marginTop: 10 }]} onPress={handleRequestOtp} disabled={isFpLoading}>
              {isFpLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Nhận mã OTP qua Email</Text>}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TextInput style={[styles.input, fpOtpError && styles.inputError]} placeholder="Mã OTP (6 chữ số)" value={fpOtp} onChangeText={(text) => { setFpOtp(text); setFpOtpError(false); }} keyboardType="numeric" />
            <View style={styles.passwordInputContainer}>
              <TextInput style={[styles.input, styles.passwordInput, fpNewPasswordError && styles.inputError]} placeholder="Mật khẩu mới (ít nhất 6 ký tự)" value={fpNewPassword} onChangeText={(text) => { setFpNewPassword(text); setFpNewPasswordError(false); }} secureTextEntry={!showFpPassword} />
              <TouchableOpacity style={styles.eyeIcon} onPress={() => setShowFpPassword(!showFpPassword)}>
                <FontAwesome5 name={showFpPassword ? "eye" : "eye-slash"} size={18} color="#7f8c8d" />
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={[styles.button, { backgroundColor: '#2ecc71' }]} onPress={handleResetPassword} disabled={isFpLoading}>
              {isFpLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Xác nhận đổi mật khẩu</Text>}
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  }

  // Giao diện Màn hình Đăng ký
  if (showRegister) {
    return (
      <View style={[styles.container, { justifyContent: 'flex-start', paddingTop: 60 }]}>
        <TouchableOpacity style={styles.absoluteBackButton} onPress={() => {
          setShowRegister(false);
          setRegUsername(''); setRegEmail(''); setRegPassword('');
          setRegUsernameError(false); setRegEmailError(false); setRegPasswordError(false);
          setShowRegPassword(false);
        }}>
          <FontAwesome5 name="arrow-left" size={16} color="#34495e" />
          <Text style={styles.backButtonText}>Quay lại</Text>
        </TouchableOpacity>

        <View style={styles.headerContainer}>
          <View style={[styles.logoContainer, { backgroundColor: '#e1f0fa', shadowColor: '#3498db' }]}>
            <FontAwesome5 name="user-plus" size={40} color="#3498db" />
          </View>
          <Text style={styles.mainTitle}>Đăng Ký Tài Khoản</Text>
          <Text style={[styles.subTitleText, { textAlign: 'center', paddingHorizontal: 20 }]}>Tạo tài khoản mới để bắt đầu sạc xe</Text>
        </View>

        <TextInput style={[styles.input, regUsernameError && styles.inputError]} placeholder="Tên tài khoản (viết liền không dấu)" value={regUsername} onChangeText={(text) => { setRegUsername(text); setRegUsernameError(false); }} autoCapitalize="none" />
        <TextInput style={[styles.input, regEmailError && styles.inputError]} placeholder="Địa chỉ Email" value={regEmail} onChangeText={(text) => { setRegEmail(text); setRegEmailError(false); }} keyboardType="email-address" autoCapitalize="none" />
        <View style={styles.passwordInputContainer}>
          <TextInput style={[styles.input, styles.passwordInput, regPasswordError && styles.inputError]} placeholder="Mật khẩu (ít nhất 6 ký tự)" value={regPassword} onChangeText={(text) => { setRegPassword(text); setRegPasswordError(false); }} secureTextEntry={!showRegPassword} />
          <TouchableOpacity style={styles.eyeIcon} onPress={() => setShowRegPassword(!showRegPassword)}>
            <FontAwesome5 name={showRegPassword ? "eye" : "eye-slash"} size={18} color="#7f8c8d" />
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={[styles.button, { backgroundColor: '#3498db' }]} onPress={handleRegister} disabled={isRegLoading}>
          {isRegLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Hoàn tất Đăng ký</Text>}
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { justifyContent: 'flex-start', paddingTop: 60 }]}>
      <View style={styles.headerContainer}>
        <View style={styles.logoContainer}>
          <FontAwesome5 name="charging-station" size={45} color="#3498db" />
        </View>
        <Text style={styles.mainTitle}>Trạm Sạc Xe Điện</Text>
        <Text style={styles.subTitleText}>Đăng nhập để sử dụng dịch vụ</Text>
      </View>

      <TextInput
        style={[styles.input, loginError && styles.inputError]}
        placeholder="Tài khoản"
        value={username}
        onChangeText={(text) => { setUsername(text); setLoginError(false); }}
        autoCapitalize="none"
      />
      <View style={styles.passwordInputContainer}>
        <TextInput
          style={[styles.input, styles.passwordInput, loginError && styles.inputError]}
          placeholder="Mật khẩu"
          secureTextEntry={!showPassword}
          value={password}
          onChangeText={(text) => { setPassword(text); setLoginError(false); }}
        />
        <TouchableOpacity style={styles.eyeIcon} onPress={() => setShowPassword(!showPassword)}>
          <FontAwesome5 name={showPassword ? "eye" : "eye-slash"} size={18} color="#7f8c8d" />
        </TouchableOpacity>
      </View>

      <View style={styles.optionsRow}>
        <TouchableOpacity style={styles.checkboxContainer} onPress={() => setRememberMe(!rememberMe)}>
          <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]} />
          <Text style={styles.optionText}>Ghi nhớ đăng nhập</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShowForgotPassword(true)}>
          <Text style={styles.forgotPasswordText}>Quên mật khẩu?</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={isLoading}>
        {isLoading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Đăng nhập</Text>
        )}
      </TouchableOpacity>

      <View style={styles.registerRow}>
        <Text style={styles.registerText}>Chưa có tài khoản? </Text>
        <TouchableOpacity onPress={() => setShowRegister(true)}>
          <Text style={styles.registerLink}>Đăng ký ngay</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#f4f6f9' },
  mainContainer: { flex: 1, backgroundColor: '#f4f6f9', paddingTop: 40 },
  tabContent: { flex: 1, padding: 20 },
  centerContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 28, fontWeight: 'bold', textAlign: 'center', marginBottom: 30, color: '#2c3e50' },
  subtitle: { fontSize: 18, textAlign: 'center', marginBottom: 20 },
  input: { backgroundColor: '#fff', padding: 15, borderRadius: 10, marginBottom: 15, fontSize: 16 },
  inputError: { borderWidth: 1, borderColor: '#e74c3c', backgroundColor: '#fdedec' },
  passwordInputContainer: { position: 'relative', marginBottom: 15 },
  passwordInput: { marginBottom: 0, paddingRight: 45 },
  eyeIcon: { position: 'absolute', right: 0, top: 0, bottom: 0, justifyContent: 'center', paddingHorizontal: 15 },
  button: { backgroundColor: '#3498db', padding: 15, borderRadius: 10, alignItems: 'center', marginBottom: 15 },
  logoutBtn: { backgroundColor: '#e74c3c' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  walletCard: { backgroundColor: '#fff', padding: 20, borderRadius: 15, alignItems: 'center', marginBottom: 30, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, elevation: 5, width: '100%' },
  walletLabel: { color: '#7f8c8d', fontSize: 14, marginBottom: 5 },
  walletAmount: { fontSize: 32, fontWeight: 'bold', color: '#2ecc71' },
  walletHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 15, width: '100%', borderBottomWidth: 1, borderBottomColor: '#f0f0f0', paddingBottom: 10 },
  walletTitle: { fontSize: 18, fontWeight: 'bold', color: '#2c3e50', marginLeft: 10 },
  walletActions: { flexDirection: 'row', justifyContent: 'space-around', width: '100%', marginTop: 20, paddingTop: 15, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  walletActionButton: { alignItems: 'center', flex: 1 },
  walletActionIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#2ecc71', justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  walletActionText: { fontSize: 13, color: '#34495e', fontWeight: '500' },
  overlay: { position: 'absolute', bottom: 50, left: 20, right: 20, backgroundColor: 'rgba(0,0,0,0.7)', padding: 20, borderRadius: 15, alignItems: 'center' },
  scanText: { color: '#fff', fontSize: 16, marginBottom: 15, textAlign: 'center' },

  // Styles mới cho form đăng nhập nâng cao
  headerContainer: { alignItems: 'center', marginBottom: 35 },
  logoContainer: { width: 90, height: 90, backgroundColor: '#e1f0fa', borderRadius: 45, justifyContent: 'center', alignItems: 'center', marginBottom: 15, shadowColor: '#3498db', shadowOpacity: 0.2, shadowRadius: 10, elevation: 5 },
  mainTitle: { fontSize: 32, fontWeight: 'bold', color: '#2c3e50', marginBottom: 8 },
  subTitleText: { fontSize: 16, color: '#7f8c8d' },
  optionsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 25, paddingHorizontal: 5 },
  checkboxContainer: { flexDirection: 'row', alignItems: 'center' },
  checkbox: { width: 18, height: 18, borderWidth: 1.5, borderColor: '#3498db', borderRadius: 4, marginRight: 8, backgroundColor: '#fff' },
  checkboxChecked: { backgroundColor: '#3498db' },
  optionText: { color: '#34495e', fontSize: 14 },
  forgotPasswordText: { color: '#e74c3c', fontSize: 14, fontWeight: '600' },
  registerRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 30 },
  registerText: { color: '#7f8c8d', fontSize: 15 },
  registerLink: { color: '#3498db', fontSize: 15, fontWeight: 'bold' },
  tabBar: { flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e0e0e0', paddingBottom: 20, paddingTop: 10 },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabText: { fontSize: 12, color: '#7f8c8d', marginTop: 4 },
  tabTextActive: { color: '#3498db', fontWeight: 'bold' },

  // Styles cho danh sách Trạm sạc
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#2c3e50', marginTop: 20, marginBottom: 15 },
  stationCard: { flexDirection: 'row', backgroundColor: '#fff', padding: 15, borderRadius: 12, marginBottom: 15, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5, elevation: 2 },
  stationIcon: { width: 50, height: 50, backgroundColor: '#e1f0fa', borderRadius: 25, justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  stationInfo: { flex: 1 },
  stationName: { fontSize: 16, fontWeight: 'bold', color: '#2c3e50', marginBottom: 4 },
  stationLocation: { fontSize: 13, color: '#7f8c8d' },
  stationStatus: { paddingLeft: 10 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, fontSize: 12, fontWeight: 'bold', overflow: 'hidden' },
  statusOnline: { backgroundColor: '#e8f8f5', color: '#2ecc71' },
  statusOffline: { backgroundColor: '#fdedec', color: '#e74c3c' },
  backButton: { flexDirection: 'row', alignItems: 'center', marginBottom: 15, paddingVertical: 5 },
  absoluteBackButton: { position: 'absolute', top: 5, left: 20, flexDirection: 'row', alignItems: 'center', paddingVertical: 10, zIndex: 10 },
  backButtonText: { fontSize: 16, color: '#34495e', marginLeft: 8, fontWeight: '500' },
  stationDetailHeader: { alignItems: 'center', backgroundColor: '#fff', padding: 20, borderRadius: 15, marginBottom: 20, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5, elevation: 2 },
  detailTitle: { fontSize: 20, fontWeight: 'bold', color: '#2c3e50', marginBottom: 5 },
  detailLocation: { fontSize: 14, color: '#7f8c8d', marginBottom: 10, textAlign: 'center' },
  detailPrice: { fontSize: 15, color: '#e67e22', fontWeight: 'bold' },
  outletsContainer: { flexDirection: 'row', justifyContent: 'space-between' },
  outletCard: { flex: 1, backgroundColor: '#fff', padding: 20, borderRadius: 15, alignItems: 'center', marginHorizontal: 5, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5, elevation: 2 },
  outletName: { fontSize: 16, fontWeight: 'bold', color: '#2c3e50', marginBottom: 5 },
  outletStatus: { fontSize: 13, color: '#2ecc71' }
});