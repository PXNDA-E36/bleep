/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import {
    StatusBar,
    StyleSheet,
    useColorScheme,
    View,
    Button,
    Pressable,
    Text,
    ScrollView
} from 'react-native';
import {
    SafeAreaProvider,
    useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { Device } from 'react-native-ble-plx';
import { useState } from 'react';
import { BLEService } from './BLEService.ts';


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

    const startScan = async () => {
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

    return (
        <View style={[
            styles.container,
            {
                paddingTop: safeAreaInsets.top,
                paddingBottom: safeAreaInsets.bottom,
            },
        ]}>
            <View style={styles.buttonContainer}>
                <Button title="Find Syms" onPress={startScan} />
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
                    <Pressable style={styles.deviceItem}>
                        <Text>{device.name ?? "Unnamed device"}</Text>

                        <View style={styles.buttonRow}>
                            <Button
                                title="Connect"
                                onPress={() => selectDevice(device)}
                            />

                            <Button
                                title="Flash"
                            // onPress={() => flashDevice(device)}
                            />
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
});

export default App;
