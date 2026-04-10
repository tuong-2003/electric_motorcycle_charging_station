import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, Alert, Button, ScrollView, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { FontAwesome5 } from '@expo/vector-icons';

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
  const [stations, setStations] = useState([]); // State lưu danh sách trạm
  const [selectedStation, setSelectedStation] = useState<any>(null); // State lưu trạm đang xem chi tiết
  const [history, setHistory] = useState([]); // State lưu lịch sử giao dịch
  
  // State cho luồng Quên mật khẩu qua Email
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [fpStep, setFpStep] = useState(1);
  const [fpUsername, setFpUsername] = useState('');
  const [fpOtp, setFpOtp] = useState('');
  const [fpNewPassword, setFpNewPassword] = useState('');
  const [isFpLoading, setIsFpLoading] = useState(false);
  const [fpUsernameError, setFpUsernameError] = useState(false);
  const [fpOtpError, setFpOtpError] = useState(false);
  const [fpNewPasswordError, setFpNewPasswordError] = useState(false);

  // State cho luồng Đăng ký tài khoản
  const [showRegister, setShowRegister] = useState(false);
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [isRegLoading, setIsRegLoading] = useState(false);
  const [regUsernameError, setRegUsernameError] = useState(false);
  const [regEmailError, setRegEmailError] = useState(false);
  const [regPasswordError, setRegPasswordError] = useState(false);

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
    setIsLoading(true);
    setLoginError(false);
    try {
      const response = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, rememberMe })
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
      console.log(error);
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
      console.log('Lỗi tải danh sách trạm:', error);
    }
  };

  // Hàm tải Lịch sử sạc từ Backend
  const fetchHistory = async () => {
    try {
      const response = await fetch(`${API_URL}/api/sessions/history`);
      const data = await response.json();
      if (data.success) {
        setHistory(data.data || []);
      }
    } catch (error) {
      console.log('Lỗi tải lịch sử:', error);
    }
  };

  // Tự động gọi API lịch sử mỗi khi user bấm sang tab History
  useEffect(() => {
    if (activeTab === 'history') {
      fetchHistory();
    }
  }, [activeTab]);

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
        Alert.alert('Thành công!', `Đã bắt đầu sạc xe tại Trạm ${stationId} - Ổ ${outletId}`);
        fetchProfile(authToken); // Cập nhật lại số dư ví sau khi sạc
        setSelectedStation(null); // Đóng chi tiết trạm, quay lại danh sách
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
        Alert.alert('Đã chốt hóa đơn!', result.message);
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

  // Hàm gửi yêu cầu lấy OTP qua Email
  const handleRequestOtp = async () => {
    if (!fpUsername) {
      setFpUsernameError(true);
      return Alert.alert('Thông báo', 'Vui lòng nhập tên tài khoản!');
    }
    setIsFpLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: fpUsername })
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
        setUsername(fpUsername); setFpUsername('');
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
        Alert.alert('Lỗi', data.message);
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
          <Button title="Hủy quét" onPress={() => setIsScanning(false)} color="#e74c3c" />
        </View>
      </View>
    );
  }

  if (isLoggedIn) {
    return (
      <View style={styles.mainContainer}>
        <View style={styles.tabContent}>
          {/* Màn hình Trang chủ: Danh sách trạm */}
          {activeTab === 'home' && !selectedStation && (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
              <Text style={styles.title}>⚡ EV Charger</Text>
              <Text style={styles.subtitle}>Xin chào, {username}!</Text>
              
              <TouchableOpacity style={styles.button} onPress={startScanning}>
                <Text style={styles.buttonText}>📷 Quét QR sạc xe nhanh</Text>
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
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
              <TouchableOpacity style={styles.backButton} onPress={() => setSelectedStation(null)}>
                <FontAwesome5 name="arrow-left" size={16} color="#34495e" />
                <Text style={styles.backButtonText}>Quay lại</Text>
              </TouchableOpacity>
              
              <View style={styles.stationDetailHeader}>
                <FontAwesome5 name="charging-station" size={40} color="#3498db" style={{marginBottom: 10}} />
                <Text style={styles.detailTitle}>{selectedStation.name}</Text>
                <Text style={styles.detailLocation}>{selectedStation.location}</Text>
                <Text style={styles.detailPrice}>Đơn giá: {selectedStation.unit_price.toLocaleString('vi-VN')} đ/kWh</Text>
              </View>

              <Text style={styles.sectionTitle}>Chọn ổ cắm để sạc</Text>
              
              <View style={styles.outletsContainer}>
                {[1, 2].map(outletId => (
                  <TouchableOpacity 
                    key={outletId} 
                    style={styles.outletCard}
                    onPress={() => {
                      Alert.alert(
                      'Tùy chọn sạc', 
                      `Bạn muốn làm gì với ${selectedStation.name} - Ổ ${outletId}?`,
                        [
                        { text: 'Dừng sạc (Chốt tiền)', onPress: () => stopCharge(selectedStation.station_id, outletId), style: 'destructive' },
                        { text: 'Bắt đầu sạc', onPress: () => startChargeFromList(selectedStation.station_id, outletId) },
                        { text: 'Hủy', style: 'cancel' }
                        ]
                      );
                    }}
                  >
                    <FontAwesome5 name="plug" size={30} color="#2ecc71" style={{marginBottom: 10}} />
                    <Text style={styles.outletName}>Ổ cắm {outletId}</Text>
                    <Text style={styles.outletStatus}>Sẵn sàng</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
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
                        <Text style={[styles.stationName, {color: '#e67e22', marginTop: 4}]}>
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
            <View style={{ flex: 1, justifyContent: 'center' }}>
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
                  <TouchableOpacity style={styles.walletActionButton} onPress={() => Alert.alert('Tính năng', 'Đang chuyển hướng đến cổng thanh toán...')}>
                    <View style={styles.walletActionIcon}><FontAwesome5 name="plus" size={16} color="#fff" /></View>
                    <Text style={styles.walletActionText}>Nạp tiền</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.walletActionButton} onPress={() => setActiveTab('history')}>
                    <View style={[styles.walletActionIcon, { backgroundColor: '#f39c12' }]}><FontAwesome5 name="history" size={16} color="#fff" /></View>
                    <Text style={styles.walletActionText}>Lịch sử</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <TouchableOpacity style={[styles.button, styles.logoutBtn, { width: '100%' }]} onPress={handleLogout}>
                <Text style={styles.buttonText}>Đăng xuất</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

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
          setFpUsername(''); setFpOtp(''); setFpNewPassword(''); 
          setFpUsernameError(false); setFpOtpError(false); setFpNewPasswordError(false);
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
            {fpStep === 1 ? 'Nhập tài khoản để nhận mã OTP qua email' : 'Nhập mã OTP trong email để tạo mật khẩu mới'}
          </Text>
        </View>

        {fpStep === 1 ? (
          <>
            <TextInput style={[styles.input, fpUsernameError && styles.inputError]} placeholder="Tài khoản của bạn" value={fpUsername} onChangeText={(text) => { setFpUsername(text); setFpUsernameError(false); }} autoCapitalize="none" />
            <TouchableOpacity style={[styles.button, { backgroundColor: '#e74c3c' }]} onPress={handleRequestOtp} disabled={isFpLoading}>
              {isFpLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Nhận mã OTP qua Email</Text>}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TextInput style={[styles.input, fpOtpError && styles.inputError]} placeholder="Mã OTP (6 chữ số)" value={fpOtp} onChangeText={(text) => { setFpOtp(text); setFpOtpError(false); }} keyboardType="numeric" />
            <TextInput style={[styles.input, fpNewPasswordError && styles.inputError]} placeholder="Mật khẩu mới (ít nhất 6 ký tự)" value={fpNewPassword} onChangeText={(text) => { setFpNewPassword(text); setFpNewPasswordError(false); }} secureTextEntry />
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
        <TextInput style={[styles.input, regPasswordError && styles.inputError]} placeholder="Mật khẩu (ít nhất 6 ký tự)" value={regPassword} onChangeText={(text) => { setRegPassword(text); setRegPasswordError(false); }} secureTextEntry />
        
        <TouchableOpacity style={[styles.button, { backgroundColor: '#3498db' }]} onPress={handleRegister} disabled={isRegLoading}>
          {isRegLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Hoàn tất Đăng ký</Text>}
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
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
      <TextInput 
        style={[styles.input, loginError && styles.inputError]} 
        placeholder="Mật khẩu" 
        secureTextEntry 
        value={password}
        onChangeText={(text) => { setPassword(text); setLoginError(false); }}
      />

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
  absoluteBackButton: { position: 'absolute', top: 15, left: 20, flexDirection: 'row', alignItems: 'center', paddingVertical: 10, zIndex: 10 },
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