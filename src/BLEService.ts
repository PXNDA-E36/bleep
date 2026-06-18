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
    await this.requestBluetoothPermission();

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

      const bluetoothBaseUUID = '-0000-1000-8000-00805f9b34fb';

      const customUuidPrefixes = [
        '01973b7a-35a8', // esp-ble-role-coex / Sym
        'cc720cdc-2c0f', // DeepSym8b
      ];

      const serviceUUIDs = device.serviceUUIDs ?? [];

      const customUUIDs = serviceUUIDs.filter(
        uuid => !uuid.toLowerCase().endsWith(bluetoothBaseUUID),
      );

      const matches = customUUIDs.some(uuid =>
        customUuidPrefixes.some(prefix =>
          uuid.toLowerCase().startsWith(prefix.toLowerCase()),
        ),
      );
      if (!matches) return;

      if (!this.foundSyms.has(device.id)) {
        this.foundSyms.set(device.id, device);
        onFound(Array.from(this.foundSyms.values()));
      }
    });
  };

  stopScan = () => {
    this.manager.stopDeviceScan();
  };

  connectToSym = async (
    device: Device,
    onData?: (value: string | null) => void,
    onError?: (error: Error) => void,
  ) => {
    const lampUUID = '01973b7a-35a8-741b-9c72-8655d201c8ec';
    const subcribeUUID = '01973b7a-35a8-77f8-ad32-996d1cfd5796';
    const writeUUID = '01973b7a-35a8-7e32-95a0-e900d4a65171';

    this.stopScan();

    const connectedDevice = await device.connect();

    this.device = await connectedDevice.discoverAllServicesAndCharacteristics();

    this.device.monitorCharacteristicForService(
      lampUUID,
      subcribeUUID,
      (error, characteristic) => {
        if (error) {
          console.error('Subscribe error:', error);
          onError?.(error);
          return;
        }

        console.log('Received:', characteristic?.value);
        onData?.(characteristic?.value ?? null);
      },
    );

    await this.device.writeCharacteristicWithResponseForService(
      lampUUID,
      writeUUID,
      'AQUB',
    );

    return this.device;
  };
}

export const BLEService = new BLEServiceInstance();
