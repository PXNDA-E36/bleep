import { BleManager, Device } from 'react-native-ble-plx';
import { PermissionsAndroid, Platform } from 'react-native';

class BLEServiceInstance {
  manager: BleManager;
  device: Device | null;

  constructor() {
    this.manager = new BleManager();
    this.device = null;
  }

  requestBluetoothPermission = async () => {
    if (Platform.OS === 'ios') {
      return true;
    }
    if (Platform.OS === 'android') {
      const apiLevel = parseInt(Platform.Version.toString(), 10);

      if (
        apiLevel < 31 &&
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      ) {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
      if (
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN &&
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
      ) {
        const result = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]);

        return (
          result['android.permission.BLUETOOTH_CONNECT'] ===
            PermissionsAndroid.RESULTS.GRANTED &&
          result['android.permission.BLUETOOTH_SCAN'] ===
            PermissionsAndroid.RESULTS.GRANTED
        );
      }
    }

    console.error('Permission have not been granted');

    return false;
  };

  initBLE = async () => {
    const hasPermission = await this.requestBluetoothPermission();
    new Promise<void>(resolve => {
      const subscription = this.manager.onStateChange(state => {
        if (state === 'Unauthorized') {
          this.requestBluetoothPermission();
        }

        if (state === 'PoweredOn') {
          subscription.remove();
          resolve();
        }
      }, true);
    });
  };

  private foundSyms = new Map<string, Device>();

  findSyms = (
    onFound: (device: Device[]) => void,
    onError?: (error: Error) => void,
  ) => {
    this.foundSyms.clear();

    this.manager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        // Handle error (scanning will be stopped automatically)
        console.log('BLE scan error:', {
          message: error.message,
          reason: (error as any).reason,
          errorCode: (error as any).errorCode,
          androidErrorCode: (error as any).androidErrorCode,
        });

        onError?.(error);
        return;
      }

      if (!device) return;

      if (device.rssi == null || device.rssi < -80) return;

      const serviceUUIDs = device.serviceUUIDs ?? [];

      const matches = serviceUUIDs.some(uuid =>
        uuid.toLowerCase().startsWith('cc720cdc-2c0f'.toLowerCase()),
      );

      if (!matches) return;

      if (!this.foundSyms.has(device.id)) {
        this.foundSyms.set(device.id, device);
        onFound(Array.from(this.foundSyms.values()));
      }

      // if (!this.foundSyms.has(device.id)) {
      //   this.foundSyms.set(device.id, device);
      //   onFound(Array.from(this.foundSyms.values()));
      // }
    });
  };

  stopScan = () => {
    this.manager.stopDeviceScan();
  };
}

export const BLEService = new BLEServiceInstance();
