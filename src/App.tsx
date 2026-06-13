/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import { NewAppScreen } from '@react-native/new-app-screen';
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

    const selectDevice = (device: Device) => {
        BLEService.stopScan();
        console.log('Selected device:', device.name ?? device.localName ?? device.id);

        // later:
        // symBle.connectToSym(device);
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
                {devices.map(device => (
                    <Pressable
                        key={device.id}
                        style={styles.deviceItem}
                        onPress={() => selectDevice(device)}
                    >
                        <Text style={styles.deviceName}>
                            {device.name ?? device.localName ?? 'Unnamed'}
                        </Text>

                        <Text style={styles.deviceId}>{device.serviceUUIDs}</Text>
                        <Text style={styles.deviceId}>{device.rssi}</Text>
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
