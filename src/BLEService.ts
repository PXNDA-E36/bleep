import { BleManager, Device, Subscription } from 'react-native-ble-plx';
import { PermissionsAndroid, Platform } from 'react-native';
import { Buffer } from 'buffer';

export interface BatteryPayload {
  lampBattery: number;
  sensorBatteries: number[];
}

const LAMP_SERVICE_UUID = '01973b7a-35a8-741b-9c72-8655d201c8ec';
const NOTIFY_UUID = '01973b7a-35a8-77f8-ad32-996d1cfd5796';
const WRITE_UUID = '01973b7a-35a8-7e32-95a0-e900d4a65171';

class BLEServiceInstance {
  manager: BleManager;
  device: Device | null;
  foundSyms = new Map<string, Device>();

  // BLE States
  notifySubscription: Subscription | null = null; // Active notif listner
  sensorCount: number = 0; // Latest sensor count
  batteryPayload: BatteryPayload | null = null; // Latest battery payload

  // Callbacks
  onPairingCompleteCallback?: () => void;
  onPairingDataCallback?: (rawValue: string) => void;
  onBatteryDataCallback?: (data: BatteryPayload) => void;
  onErrorCallback?: (error: Error) => void;

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

    console.error('Permissions have not been granted');
    return false;
  };

  initBLE = async () => {
    await this.requestBluetoothPermission();

    await new Promise<void>(resolve => {
      const subscription = this.manager.onStateChange(state => {
        if (state === 'PoweredOn') {
          subscription.remove();
          resolve();
        }
      }, true);
    });
  };

  findSyms = (
    onFound: (device: Device[]) => void,
    onError?: (error: Error) => void,
  ) => {
    this.foundSyms.clear();

    this.manager.startDeviceScan(null, null, (error, device) => {
      if (error) {
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
      const customUuidPrefixes = ['01973b7a-35a8', 'cc720cdc-2c0f'];

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

  connectToSym = async (device: Device) => {
    this.stopScan();

    const connectedDevice = await device.connect();
    this.device = await connectedDevice.discoverAllServicesAndCharacteristics();

    return this.device;
  };

  // Main notif handler
  // Subscribes to NOTIFY_UUID and dispatches byte responses by featureID (byte 0).
  subscribeToNotifications = (onError?: (error: Error) => void) => {
    if (!this.device) {
      throw new Error('No connected device');
    }

    // Clean up previous subscription if existing
    if (this.notifySubscription) {
      this.notifySubscription.remove();
    }

    this.notifySubscription = this.device.monitorCharacteristicForService(
      LAMP_SERVICE_UUID,
      NOTIFY_UUID,
      (error, characteristic) => {
        if (error) {
          console.error('Notification error:', error);
          this.onErrorCallback?.(error);
          onError?.(error);
          return;
        }

        const rawValue = characteristic?.value;
        if (!rawValue) return;

        const bytes = Buffer.from(rawValue, 'base64');
        if (bytes.length === 0) return;

        const featureID = bytes[0];

        switch (featureID) {
          // Sensor pairing
          case 5: {
            const status = bytes[1];
            this.onPairingDataCallback?.(rawValue);

            // Status 0 indicates scan/pairing has completed
            if (status === 0) {
              console.log('Pairing scan completed (Feature 5, Status 0).');
              this.onPairingCompleteCallback?.();
            }
            break;
          }

          // Sensor count
          case 7:
          case 251: {
            this.sensorCount = bytes[1];
            console.log(`Updated sensor count: ${this.sensorCount}`);
            break;
          }

          // Battery status
          case 250: {
            const extractedValues: number[] = [];

            for (
              let i = 1;
              i + 2 < bytes.length && extractedValues.length < 5;
              i += 3
            ) {
              const percent = bytes[i + 1]; // Byte holding just battery percent
              extractedValues.push(percent);
            }

            if (extractedValues.length > 0) {
              this.batteryPayload = {
                lampBattery: extractedValues[0],
                sensorBatteries: extractedValues.slice(1),
              };

              this.onBatteryDataCallback?.(this.batteryPayload);
            }
            break;
          }

          default:
            console.log(`Unhandled featureID: ${featureID}`);
            break;
        }
      },
    );

    return this.notifySubscription;
  };

  // Triggers pairing mode (sends command 'AQUB')
  startPairingMode = async (
    onData?: (rawValue: string) => void,
    onError?: (error: Error) => void,
  ): Promise<void> => {
    if (!this.device) {
      throw new Error('No connected device');
    }

    this.onPairingDataCallback = onData;
    this.onErrorCallback = onError;

    return new Promise<void>(async (resolve, reject) => {
      this.onPairingCompleteCallback = () => {
        // Clear onPairingCompleteCallback
        this.onPairingCompleteCallback = undefined;

        // Resovle promise
        resolve();
      };

      try {
        await new Promise<void>(res => setTimeout(res, 150));

        await this.device.writeCharacteristicWithResponseForService(
          LAMP_SERVICE_UUID,
          WRITE_UUID,
          'AQUB',
        );
      } catch (err) {
        this.onErrorCallback?.(err as Error);
        reject(err);
      }
    });
  };

  // Requests battery status (sends command 'AQYB')
  requestBatteryPercent = async (
    onData?: (data: BatteryPayload) => void,
    onError?: (error: Error) => void,
  ) => {
    if (!this.device) {
      throw new Error('No connected device');
    }

    this.onBatteryDataCallback = onData;
    this.onErrorCallback = onError;

    try {
      await new Promise<void>(res => setTimeout(res, 150));
      await this.device.writeCharacteristicWithResponseForService(
        LAMP_SERVICE_UUID,
        WRITE_UUID,
        'AQYB',
      );
    } catch (err) {
      this.onErrorCallback?.(err as Error);
      onError?.(err as Error);
    }
  };

  // Sequential sequence handler: setup subscription -> pairing -> battery
  runFullSequence = async (
    onPairingData?: (rawValue: string) => void,
    onBatteryData?: (data: BatteryPayload) => void,
    onError?: (error: Error) => void,
  ) => {
    try {
      this.subscribeToNotifications(onError);

      console.log('Starting pairing scan...');
      await this.startPairingMode(onPairingData, onError);

      console.log('Pairing complete. Requesting battery percent...');
      await this.requestBatteryPercent(onBatteryData, onError);
    } catch (error) {
      console.error('Sequence execution failed:', error);
      onError?.(error as Error);
    }
  };

  changeName = async (inputString: string) => {
    const defaultUUID = '00001800-0000-1000-8000-00805f9b34fb';
    const nameUUID = '00002a00-0000-1000-8000-00805f9b34fb';

    if (!this.device) {
      throw new Error('No connected device');
    }

    await this.device.writeCharacteristicWithResponseForService(
      defaultUUID,
      nameUUID,
      Buffer.from(inputString, 'utf8').toString('base64'),
    );
  };

  // Getters
  getSensorCount = () => this.sensorCount;
  getLatestBatteryPayload = () => this.batteryPayload;

  // Cleanup helper
  unsubscribeNotifications = () => {
    this.notifySubscription?.remove();
    this.notifySubscription = null;
  };
}

export const BLEService = new BLEServiceInstance();
