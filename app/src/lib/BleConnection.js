import { BleClient, textToDataView, dataViewToText } from '@capacitor-community/bluetooth-le';
import { SerialConnection } from './SerialConnection';

// The receiver exposes a Nordic UART service over Bluetooth LE: one
// characteristic to write commands into, one to be notified from. The
// commands and the telemetry are byte-for-byte the same as over USB, so all
// the parsing and every command method is inherited from SerialConnection —
// only the transport below is different.
const SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const RX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // phone -> receiver
const TX_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // receiver -> phone

// The firmware advertises itself under this name (RECEIVER_NAME)
const DEVICE_NAME_PREFIX = 'ATS-Mini';

// The plugin shows its own device list while it scans, so these strings have to
// be Russian as well — a screen reader would otherwise read them in English.
const DISPLAY_STRINGS = {
  scanning: 'Идёт поиск…',
  cancel: 'Отмена',
  availableDevices: 'Найденные устройства',
  noDeviceFound: 'Ничего не найдено',
};

export class BleConnection extends SerialConnection {
  constructor() {
    super();
    this.deviceId = null;
    this.isBle = true;
  }

  /**
   * Ask Android for the runtime permissions and build the adapter inside the
   * plugin. initialize() has to come first: until it has run, every other call —
   * isEnabled() included — is rejected with "Bluetooth LE not initialized.",
   * which is easy to mistake for Bluetooth being switched off.
   */
  static async prepare() {
    await BleClient.initialize({ androidNeverForLocation: true });
    await BleClient.setDisplayStrings(DISPLAY_STRINGS);
  }

  /** True when the phone's Bluetooth is on and usable by the app. */
  static async isSupported() {
    try {
      await BleConnection.prepare();
      return await BleClient.isEnabled();
    } catch (error) {
      console.error('[BLE] Bluetooth is not ready:', error);
      return false;
    }
  }

  /**
   * Ask the system for a device and connect to it. The list of found devices is
   * a native Android dialog, so a screen reader reads it — the strings in it are
   * ours (see DISPLAY_STRINGS), which is why they are set up front.
   */
  async connect() {
    await BleConnection.prepare();

    const device = await BleClient.requestDevice({
      namePrefix: DEVICE_NAME_PREFIX,
      optionalServices: [SERVICE_UUID],
    });

    await BleClient.connect(device.deviceId, (id) => {
      if (id === this.deviceId) {
        this.connected = false;
        if (this.connectionCallback) this.connectionCallback(false);
      }
    });

    this.deviceId = device.deviceId;
    this.buffer = '';

    await BleClient.startNotifications(device.deviceId, SERVICE_UUID, TX_UUID, (value) => {
      this.buffer += dataViewToText(value);

      // Process complete lines, keep the tail for the next notification
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          this.processReceivedData(line.trim());
        }
      }
    });

    this.connected = true;
    if (this.connectionCallback) this.connectionCallback(true);

    // Monitor mode is switched on by the caller, exactly as on the USB path —
    // doing it here too would toggle it twice and switch it back off.
    return true;
  }

  async disconnect() {
    try {
      if (this.deviceId) {
        await BleClient.stopNotifications(this.deviceId, SERVICE_UUID, TX_UUID);
        await BleClient.disconnect(this.deviceId);
        this.deviceId = null;
      }
    } catch (error) {
      console.error('[BLE] Disconnect error:', error);
    }

    this.connected = false;
    this.buffer = '';
    if (this.connectionCallback) this.connectionCallback(false);
  }

  async sendCommand(command) {
    if (!this.connected || !this.deviceId) {
      throw new Error('Not connected to device');
    }

    try {
      console.log('[ATS Mini TX/BLE]:', command);
      await BleClient.write(this.deviceId, SERVICE_UUID, RX_UUID, textToDataView(command));
    } catch (error) {
      console.error('Send command error:', error);
      if (this.errorCallback) this.errorCallback(error);
    }
  }
}
