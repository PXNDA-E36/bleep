import { Device, Subscription } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import { Platform } from 'react-native';

const OTA_SERVICE_UUID = '00008018-0000-1000-8000-00805f9b34fb';
const COMMAND_CHAR_UUID = '00008022-0000-1000-8000-00805f9b34fb';
const RECV_FW_CHAR_UUID = '00008020-0000-1000-8000-00805f9b34fb';
const PROGRESS_BAR_CHAR_UUID = '00008021-0000-1000-8000-00805f9b34fb';

class OTAServiceInstance {
  private computeCrc16(data: Uint8Array): number {
    let crc = 0x0000; // Init 0x0000

    for (let i = 0; i < data.length; i++) {
      crc ^= data[i] << 8;

      for (let j = 0; j < 8; j++) {
        if ((crc & 0x8000) !== 0) {
          crc = ((crc << 1) ^ 0x1021) & 0xffff;
        } else {
          crc = (crc << 1) & 0xffff;
        }
      }
    }

    return crc;
  }

  private buildCommandFrame(cmdId: number, commandPayload: Uint8Array): string {
    const frame = new Uint8Array(20);

    frame[0] = cmdId & 0xff;
    frame[1] = (cmdId >> 8) & 0xff;

    frame.set(commandPayload.subarray(0, 16), 2);

    const crc = this.computeCrc16(frame.subarray(0, 18));

    frame[18] = crc & 0xff;
    frame[19] = (crc >> 8) & 0xff;

    return Buffer.from(frame).toString('base64');
  }

  flashDevice = async (
    device: Device,
    firmwareBinary: Uint8Array,
    onProgress: (progress: number) => void,
  ): Promise<void> => {
    try {
      const isConnected = await device.isConnected();

      if (!isConnected) {
        console.log(`Device [${device.id}] is disconnected. Connecting...`);

        await device.connect();

        console.log('Connected. Discovering services and characteristics...');

        await device.discoverAllServicesAndCharacteristics();
      } else {
        console.log(
          `Device [${device.id}] is already connected. Ensuring services are discovered...`,
        );

        await device.discoverAllServicesAndCharacteristics();
      }
    } catch (connError) {
      console.error(
        'OTA Setup Error: Failed to establish secure GATT link with target device.',
        connError,
      );

      throw new Error('OTA aborted: Could not connect to the BLE device.');
    }

    let attMTU = 247;

    if (Platform.OS === 'android') {
      try {
        const negotiatedDevice = await device.requestMTU(517);
        attMTU = negotiatedDevice.mtu ?? attMTU;
        console.log(`Android MTU set to: ${attMTU}`);
      } catch (err) {
        console.warn('MTU negotiation failed, falling back to 247', err);
      }
    }

    const maxPacketSize = attMTU - 3;
    const usableFwPayloadPerPacket = maxPacketSize - 3;
    const sectorSize = 4096;
    const totalLength = firmwareBinary.length;
    const totalSectors = Math.ceil(totalLength / sectorSize);

    let onCommandAckReceived:
      | ((status: number, repliedTo: number) => void)
      | null = null;

    let onSectorAckReceived:
      | ((sectorIdx: number, status: number, expectedIdx: number) => void)
      | null = null;

    let bleSubscriptions: Subscription[] = [];

    try {
      bleSubscriptions.push(
        device.monitorCharacteristicForService(
          OTA_SERVICE_UUID,
          COMMAND_CHAR_UUID,
          (err, char) => {
            if (err || !char?.value) return;

            const buf = Buffer.from(char.value, 'base64');

            if (buf.readUInt16LE(0) === 0x0003) {
              const repliedTo = buf.readUInt16LE(2);

              const status = buf.readUInt16LE(4);

              if (onCommandAckReceived) {
                (
                  onCommandAckReceived as (
                    status: number,
                    repliedTo: number,
                  ) => void
                )(status, repliedTo);
              }
            }
          },
        ),
      );

      bleSubscriptions.push(
        device.monitorCharacteristicForService(
          OTA_SERVICE_UUID,
          RECV_FW_CHAR_UUID,
          (err, char) => {
            if (err || !char?.value) return;

            const buf = Buffer.from(char.value, 'base64');

            if (buf.length >= 6) {
              const sectorIdx = buf.readUInt16LE(0);
              const status = buf.readUInt16LE(2);
              const expectedIdx = buf.readUInt16LE(4);

              if (onSectorAckReceived) {
                (
                  onSectorAckReceived as (
                    sectorIdx: number,
                    status: number,
                    expectedIdx: number,
                  ) => void
                )(sectorIdx, status, expectedIdx);
              }
            }
          },
        ),
      );

      bleSubscriptions.push(
        device.monitorCharacteristicForService(
          OTA_SERVICE_UUID,
          PROGRESS_BAR_CHAR_UUID,
          (err, char) => {
            if (err || !char?.value) return;

            const buf = Buffer.from(char.value, 'base64');

            let reportedProgress = 0;

            if (buf.length === 1) {
              reportedProgress = buf.readUInt8(0);
            } else if (buf.length >= 2) {
              reportedProgress = buf.readUInt16LE(0);
            }

            onProgress(reportedProgress);
          },
        ),
      );

      const waitCommandAck = (targetCmdId: number) =>
        new Promise<void>((resolve, reject) => {
          onCommandAckReceived = (status, repliedTo) => {
            if (repliedTo === targetCmdId) {
              if (status === 0x0000) resolve();
              else
                reject(
                  new Error(
                    `Command 0x${targetCmdId.toString(
                      16,
                    )} rejected: 0x${status.toString(16)}`,
                  ),
                );
            }
          };
        });

      const waitSectorAck = (targetSectorIdx: number) =>
        new Promise<{ status: number; expectedIdx: number }>(resolve => {
          onSectorAckReceived = (sectorIdx, status, expectedIdx) => {
            if (sectorIdx === targetSectorIdx) resolve({ status, expectedIdx });
          };
        });

      console.log(`Sending START Command for ${totalLength} bytes...`);

      const startPayload = new Uint8Array(16);
      startPayload[0] = totalLength & 0xff;
      startPayload[1] = (totalLength >> 8) & 0xff;
      startPayload[2] = (totalLength >> 16) & 0xff;
      startPayload[3] = (totalLength >> 24) & 0xff;

      await device.writeCharacteristicWithResponseForService(
        OTA_SERVICE_UUID,
        COMMAND_CHAR_UUID,
        this.buildCommandFrame(0x0001, startPayload),
      );

      await waitCommandAck(0x0001);

      let currentSectorIdx = 0;

      while (currentSectorIdx < totalSectors) {
        const sectorStart = currentSectorIdx * sectorSize;
        const sectorEnd = Math.min(sectorStart + sectorSize, totalLength);
        const sectorData = firmwareBinary.subarray(sectorStart, sectorEnd);
        const sectorCrc = this.computeCrc16(sectorData);

        let sectorOffset = 0;
        let packetSeq = 0;

        while (sectorOffset < sectorData.length) {
          const remainingSectorBytes = sectorData.length - sectorOffset;
          const isLastPacketOfSector =
            remainingSectorBytes <= usableFwPayloadPerPacket;

          let packetFrame: Uint8Array;

          if (!isLastPacketOfSector) {
            const chunk = sectorData.subarray(
              sectorOffset,
              sectorOffset + usableFwPayloadPerPacket,
            );

            packetFrame = new Uint8Array(3 + chunk.length);
            packetFrame[0] = currentSectorIdx & 0xff;
            packetFrame[1] = (currentSectorIdx >> 8) & 0xff;
            packetFrame[2] = packetSeq & 0xff;
            packetFrame.set(chunk, 3);

            sectorOffset += usableFwPayloadPerPacket;
            packetSeq++;
          } else {
            const chunk = sectorData.subarray(sectorOffset);
            packetFrame = new Uint8Array(3 + chunk.length + 2);
            packetFrame[0] = currentSectorIdx & 0xff;
            packetFrame[1] = (currentSectorIdx >> 8) & 0xff;
            packetFrame[2] = 0xff;
            packetFrame.set(chunk, 3);

            const crcOffset = 3 + chunk.length;
            packetFrame[crcOffset] = sectorCrc & 0xff;
            packetFrame[crcOffset + 1] = (sectorCrc >> 8) & 0xff;

            sectorOffset += chunk.length;
          }

          await device.writeCharacteristicWithoutResponseForService(
            OTA_SERVICE_UUID,
            RECV_FW_CHAR_UUID,
            Buffer.from(packetFrame).toString('base64'),
          );
        }

        const ack = await waitSectorAck(currentSectorIdx);

        if (ack.status === 0x0000) {
          currentSectorIdx++;
        } else if (ack.status === 0x0002) {
          console.warn(
            `Rewinding execution pointer to device expected index: ${ack.expectedIdx}`,
          );

          currentSectorIdx = ack.expectedIdx;
        } else {
          throw new Error(
            `Sector validation aborted with status error: 0x${ack.status.toString(
              16,
            )}`,
          );
        }
      }
      console.log('Sending STOP Command...');
      const stopPayload = new Uint8Array(16);

      await device.writeCharacteristicWithResponseForService(
        OTA_SERVICE_UUID,
        COMMAND_CHAR_UUID,
        this.buildCommandFrame(0x0002, stopPayload),
      );

      try {
        await waitCommandAck(0x0002);
        console.log('Firmware update finalized cleanly.');
      } catch (rebootErr) {
        console.log(
          'Link connection closed via expected firmware target system reboot.',
          rebootErr,
        );
      }
    } finally {
      bleSubscriptions.forEach(sub => sub.remove());
    }
  };
}

export const OTAService = new OTAServiceInstance();
