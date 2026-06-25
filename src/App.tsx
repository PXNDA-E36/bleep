import {
    StatusBar,
    StyleSheet,
    useColorScheme,
    View,
    Button,
    Pressable,
    Text,
    ScrollView,
    Alert,
    ActivityIndicator,
} from 'react-native';
import {
    SafeAreaProvider,
    useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { Device } from 'react-native-ble-plx';
import { useState } from 'react';
import { BLEService } from './BLEService.ts';
import { OTAService } from './OTAService.ts';
import { pick, types, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import RNFS from 'react-native-fs';
import { Buffer } from 'buffer';

function App() {
    const isDarkMode = useColorScheme() === 'dark';

    return (
        <SafeAreaProvider>
            <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
            <AppContent />
        </SafeAreaProvider>
    );
}

function AppContent() {
    const safeAreaInsets = useSafeAreaInsets();

    const [devices, setDevices] = useState<Device[]>([]);
    const [connectedDevices, setConnectedDevices] = useState<Device[]>([]);

    const [isFlashing, setIsFlashing] = useState<boolean>(false);
    const [flashProgress, setFlashProgress] = useState<number>(0);
    const [flashingDeviceId, setFlashingDeviceId] = useState<string | null>(null);

    const startScan = async () => {
        if (isFlashing) return;

        BLEService.stopScan();

        setDevices([]);

        await BLEService.initBLE();

        BLEService.findSyms(
            foundDevices => {
                setDevices(foundDevices);
            },
            error => {
                console.error(error);
            },
        )
    }

    const selectDevice = async (device: Device) => {
        if (isFlashing) return;

        BLEService.stopScan();

        console.log('Selected device:', device.name ?? device.localName ?? device.id);

        const connectedDevice = await BLEService.connectToSym(device);

        if (connectedDevice.serviceUUIDs?.includes('01973b7a-35a8-741b-9c72-8655d201c8ec')) {
            BLEService.pairingMode(
                notif => console.log('Notification:', notif),
                error => console.error(error)
            )

        }

        setConnectedDevices(prev => {
            if (prev.some(d => d.id === connectedDevice.id)) return prev;
            return [...prev, connectedDevice];
        });
    };

    const loadFirmwareFile = async (): Promise<Uint8Array | null> => {
        try {
            const [res] = await pick({
                type: [types.allFiles],
            });

            if (res.name && !res.name.toLowerCase().endsWith('.bin')) {
                Alert.alert('Warning', 'This file does not have a .bin extension.', [
                    { text: 'Cancel', style: 'cancel' },
                ]);
            }

            console.log(`Loading file: ${res.name} (${res.size} bytes)`);

            const base64Content = await RNFS.readFile(res.uri, 'base64');
            return new Uint8Array(Buffer.from(base64Content, 'base64'));
        } catch (err: unknown) {
            if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) {
                console.log('User cancelled operation');
                return null;
            }

            throw err;
        }
    };

    const flashDevice = async (device: Device) => {
        if (isFlashing) return;

        try {
            const firmwareBinary = await loadFirmwareFile();

            if (firmwareBinary === null) {
                console.log("Flash aborted: No file selected.");
                return;
            }

            setIsFlashing(true);
            setFlashingDeviceId(device.id);
            setFlashProgress(0);

            BLEService.stopScan();

            await OTAService.flashDevice(device, firmwareBinary, (progress) => {
                setFlashProgress(progress);
            });

            Alert.alert('Success', 'Firmware flashed successfully! The device is now rebooting.');

            setConnectedDevices(prev => prev.filter(d => d.id !== device.id));
        } catch (error: any) {
            console.error('OTA Flash Lifecycle Failure:', error);

            Alert.alert('Flash Failure', error?.message || 'An unexpected error halted the process.');
        } finally {
            setIsFlashing(false);
            setFlashingDeviceId(null);
        }
    };
    return (
        <View style={[
            styles.container,
            {
                paddingTop: safeAreaInsets.top,
                paddingBottom: safeAreaInsets.bottom,
            },
        ]}>
            <View style={styles.buttonContainer}>
                <Button
                    title="Find Syms"
                    onPress={startScan}
                    disabled={isFlashing}
                />
            </View>

            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
                {connectedDevices.length === 0 ? (
                    <Text style={styles.deviceName}>None connected</Text>
                ) : (
                    connectedDevices.map(device => (
                        <View key={device.id} style={styles.deviceItem}>
                            <Text style={styles.deviceName}>
                                {device.name ?? device.localName ?? 'Unnamed Device'}
                            </Text>

                            <Text style={styles.deviceId}>Connected</Text>
                        </View>
                    ))
                )}

                {devices.map(device => (
                    <Pressable key={device.id} style={styles.deviceItem}>
                        <Text style={styles.deviceName}>{device.name ?? "Unnamed device"}</Text>
                        <Text style={styles.deviceId}>{device.serviceUUIDs}</Text>
                        <Text style={styles.deviceId}>{device.rssi}</Text>

                        <View style={styles.buttonRow}>
                            <Button
                                title="Connect"
                                onPress={() => selectDevice(device)}
                            />

                            <Button
                                title="Flash"
                                onPress={() => flashDevice(device)}
                            />

                            {isFlashing && flashingDeviceId === device.id && (
                                <View style={styles.progressContainer}>
                                    <ActivityIndicator size="small" color="#0000ff" />
                                    <Text style={styles.progressText}>Flashing: {flashProgress}%</Text>
                                </View>
                            )}
                        </View>
                    </Pressable>
                ))}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        paddingHorizontal: 16,
    },
    buttonContainer: {
        alignItems: 'center',
        marginTop: 24,
        marginBottom: 16,
    },
    buttonRow: {
        flexDirection: 'row',
        justifyContent: 'space-evenly',
        marginTop: 10,
    },
    list: {
        flex: 1,
        width: '100%',
    },
    listContent: {
        paddingBottom: 24,
    },
    deviceItem: {
        padding: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#ccc',
    },
    deviceName: {
        fontSize: 16,
        fontWeight: '600',
        textAlign: 'center',
    },
    deviceId: {
        marginTop: 4,
        fontSize: 12,
        textAlign: 'center',
    },
    progressContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 12,
        padding: 8,
        backgroundColor: '#e3f2fd',
        borderRadius: 4,
    },
    progressText: {
        marginLeft: 8,
        fontSize: 14,
        fontWeight: '600',
        color: '#0d47a1',
    },
});

export default App;
