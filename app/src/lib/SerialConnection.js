/**
 * SerialConnection - Manages Serial communication with ATS Mini
 * Supports both Web Serial API (desktop) and USB Serial for Android (Capacitor)
 *
 * Supported Commands:
 * - R/r: Rotate encoder up/down
 * - B/b: Next/previous band
 * - M/m: Next/previous mode
 * - V/v: Volume up/down
 * - L/l: Backlight up/down
 * - A/a: AGC/Attenuator up/down
 * - I/i: Calibration up/down
 * - W/w: Next/previous bandwidth
 * - S/s: Next/previous step
 * - e: Encoder button press
 * - O/o: Sleep on/off
 * - t: Toggle receiver monitor/log
 * - C: Take screenshot
 * - $: Show memory slots
 * - #: Set memory slot (format: #01,VHF,107900000,FM)
 * - T: Toggle theme editor
 * - @: Get current theme
 * - !: Set theme (hex color list)
 * - k: Scan the current band, report the stations found
 * - F: Tune to frequency (format: F7529), value in kHz, or 10 kHz for FM
 * - c: Toggle channel mode (the encoder cycles through the saved channels)
 */

// Dynamic import for Capacitor (only available after installation)
let Capacitor, Serial;
try {
  const cap = await import('@capacitor/core');
  Capacitor = cap.Capacitor;
  const serial = await import('@adeunis/capacitor-serial');
  Serial = serial.Serial;
} catch (e) {
  // Capacitor not installed, web-only mode
  console.log('[Serial] Running in web-only mode');
}

export class SerialConnection {
  constructor() {
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.connected = false;
    this.monitorCallback = null;
    this.errorCallback = null;
    this.connectionCallback = null;
    this.rawDataCallback = null;
    this.scanCallback = null;
    this.noticeCallback = null;
    this.buffer = '';
    this.isAndroid = Capacitor ? Capacitor.getPlatform() === 'android' : false;
    this.readCallbackId = null;
  }

  /**
   * Check if Serial is supported
   */
  static isSupported() {
    if (Capacitor && Capacitor.getPlatform() === 'android') {
      return true; // Android with USB Serial plugin
    }
    return 'serial' in navigator; // Web Serial API
  }

  /**
   * Connect to the ATS Mini device
   * @param {number} baudRate - Baud rate (default: 115200)
   */
  async connect(baudRate = 115200) {
    try {
      if (this.isAndroid) {
        return await this.connectAndroid(baudRate);
      } else {
        return await this.connectWeb(baudRate);
      }
    } catch (error) {
      console.error('Connection error:', error);
      if (this.errorCallback) {
        this.errorCallback(error);
      }
      return false;
    }
  }

  /**
   * Connect using Web Serial API (Desktop browsers)
   */
  async connectWeb(baudRate) {
    // Request port from user
    this.port = await navigator.serial.requestPort();

    // Open port with specified baud rate
    await this.port.open({
      baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: 'none'
    });

    this.connected = true;

    // Get writer for sending commands
    this.writer = this.port.writable.getWriter();

    // Start reading data
    this.startReadingWeb();

    if (this.connectionCallback) {
      this.connectionCallback(true);
    }

    return true;
  }

  /**
   * Connect using USB Serial plugin (Android)
   * Tries common USB serial chip types
   */
  async connectAndroid(baudRate) {
    const SerialDriverEnum = (await import('@adeunis/capacitor-serial')).SerialDriverEnum;

    // Try without specific device parameters first (will show device picker)
    try {
      const permissionResponse = await Serial.requestSerialPermissions();

      if (!permissionResponse.granted) {
        throw new Error('Permission denied by user');
      }
    } catch (error) {
      // If that fails, try with common CH340 chip (common in Chinese devices)
      const permissionResponse = await Serial.requestSerialPermissions({
        driver: SerialDriverEnum.CH34X_SERIAL_DRIVER
      });

      if (!permissionResponse.granted) {
        throw new Error('Permission denied by user');
      }
    }

    // Open the connection
    await Serial.openConnection({
      baudRate: baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: 0, // 0 = NONE
      dtr: true,
      rts: false
    });

    this.connected = true;

    // Register callback for incoming data
    this.readCallbackId = await Serial.registerReadCallback((message, error) => {
      if (error) {
        console.error('[Serial] Read error:', error);
        if (this.errorCallback) {
          this.errorCallback(error);
        }
        return;
      }

      if (message && message.data) {
        this.buffer += message.data;

        // Process complete lines
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.trim()) {
            this.processReceivedData(line.trim());
          }
        }
      }
    });

    if (this.connectionCallback) {
      this.connectionCallback(true);
    }

    return true;
  }

  /**
   * Disconnect from the device
   */
  async disconnect() {
    try {
      if (this.isAndroid) {
        await this.disconnectAndroid();
      } else {
        await this.disconnectWeb();
      }

      this.connected = false;

      if (this.connectionCallback) {
        this.connectionCallback(false);
      }
    } catch (error) {
      console.error('Disconnect error:', error);
      if (this.errorCallback) {
        this.errorCallback(error);
      }
    }
  }

  /**
   * Disconnect Web Serial
   */
  async disconnectWeb() {
    if (this.reader) {
      await this.reader.cancel();
      this.reader = null;
    }

    if (this.writer) {
      await this.writer.close();
      this.writer = null;
    }

    if (this.port) {
      await this.port.close();
      this.port = null;
    }
  }

  /**
   * Disconnect Android USB Serial
   */
  async disconnectAndroid() {
    if (this.readCallbackId) {
      await Serial.unregisterReadCallback();
      this.readCallbackId = null;
    }

    await Serial.closeConnection();
  }

  /**
   * Start reading data from Web Serial
   */
  async startReadingWeb() {
    try {
      this.reader = this.port.readable.getReader();
      const decoder = new TextDecoder();

      while (this.connected) {
        const { value, done } = await this.reader.read();
        if (done) {
          break;
        }

        // Decode the received data
        const text = decoder.decode(value);
        this.buffer += text;

        // Process complete lines
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.trim()) {
            this.processReceivedData(line.trim());
          }
        }
      }
    } catch (error) {
      console.error('Reading error:', error);
      if (this.errorCallback) {
        this.errorCallback(error);
      }
    } finally {
      if (this.reader) {
        this.reader.releaseLock();
      }
    }
  }

  /**
   * Process received data from the device
   * @param {string} data - Received data line
   */
  processReceivedData(data) {
    // Call raw data callback for debugging
    if (this.rawDataCallback) {
      this.rawDataCallback(data);
    }

    // Log all received data to console for debugging
    console.log('[ATS Mini RX]:', data);

    // Scan results, one line per event
    if (data.startsWith('SCAN,')) {
      this.processScanData(data);
      return;
    }

    // Plain-text messages from the firmware
    if (data.startsWith('Error:')) {
      if (this.noticeCallback) {
        this.noticeCallback({ type: 'error', text: data.slice(6).trim() });
      }
      return;
    }
    if (data === 'No channels saved') {
      if (this.noticeCallback) {
        this.noticeCallback({ type: 'notice', text: 'no-channels' });
      }
      return;
    }

    // Check if it's monitor mode data (comma-separated values)
    if (data.includes(',')) {
      const values = data.split(',');
      console.log('[ATS Mini] Parsed values:', values.length, 'values:', values);

      if (values.length >= 15) {
        // Parse monitor data - FORMATO OFICIAL según documentación:
        // 0: APP_VERSION (F/W version) - Ej: 201 = v2.01
        // 1: currentFrequency - FM = 10 kHz, AM/SSB = 1 kHz
        // 2: currentBFO - SSB = Hz
        // 3: bandCal - BFO calibration
        // 4: bandName - Band (VHF, 41M, etc.)
        // 5: currentMode - Mode (FM/LSB/USB/AM)
        // 6: currentStepIdx - Step
        // 7: bandwidthIdx - Bandwidth
        // 8: agcIdx - AGC/Attn
        // 9: volume - Volume (0-63, 0=Mute)
        // 10: remoteRssi - RSSI (0-127 dBuV)
        // 11: remoteSnr - SNR (0-127 dB)
        // 12: tuningCapacitor - Antenna Capacitor (0-6143)
        // 13: remoteVoltage - ADC value (Voltage = Value x 1.702 / 1000)
        // 14: remoteSeqnum - Sequence number (0-255)

        // Parse firmware version
        const appVersion = parseInt(values[0]);
        const firmwareVersion = appVersion > 200 ? `v${Math.floor(appVersion/100)}.${appVersion%100}` : 'v2.x';

        // Parse frequency
        // FM mode: value in 10 kHz units (9520 = 95.20 MHz)
        // AM/SSB mode: value in 1 kHz units (7529 = 7.529 MHz)
        const freqValue = parseFloat(values[1]);
        let frequencyHz;
        if (values[5] === 'FM') {
          // FM: multiply by 10000 (10 kHz units to Hz)
          frequencyHz = freqValue * 10000;
        } else {
          // AM/SSB: multiply by 1000 (1 kHz units to Hz)
          frequencyHz = freqValue * 1000;
        }

        // Parse voltage (ADC value)
        const adcValue = parseFloat(values[13]);
        const voltage = adcValue * 1.702 / 1000;

        const monitorData = {
          firmware: firmwareVersion,
          frequency: frequencyHz,
          band: values[4],
          mode: values[5],
          rssi: parseInt(values[10]), // RSSI (0-127 dBuV)
          snr: parseInt(values[11]) || 0, // SNR (0-127 dB)
          voltage: voltage,
          step: values[6],
          bandwidth: values[7],
          agc: values[8], // AGC/Attenuator index
          volume: parseInt(values[9]),
          backlight: 5, // Not available in monitor data
          calibration: parseInt(values[3]) || 0, // BFO calibration
          sleep: false, // Not available in monitor data
          memory: values[14], // Sequence number
          bfo: parseInt(values[2]) || 0, // BFO for SSB
          tuningCapacitor: parseInt(values[12]) || 0, // Antenna tuning
          // Firmware 2.33 and up: channel mode and the selected channel
          channelMode: values.length > 16 ? values[15] === '1' : false,
          channel: values.length > 16 ? (parseInt(values[16]) || 0) : 0
        };

        console.log('[ATS Mini] Monitor data parsed:', monitorData);

        if (this.monitorCallback) {
          this.monitorCallback(monitorData);
        }
      } else {
        console.warn('[ATS Mini] Insufficient data fields:', values.length, 'expected 15');
      }
    }
  }

  /**
   * Process one line of scan results
   *
   * Lines look like:
   *   SCAN,START                  scan has begun, the receiver goes quiet
   *   SCAN,BEGIN,<step>,<start>   the station list starts here
   *   SCAN,F,<freq>,<rssi>,<snr>  one station, frequencies in band units
   *   SCAN,END,<count>            list finished, <count> stations sent
   *
   * @param {string} data - Received data line
   */
  processScanData(data) {
    if (!this.scanCallback) return;

    const [, kind, a, b, c] = data.split(',');

    switch (kind) {
      case 'START':
        this.scanCallback({ type: 'start' });
        break;
      case 'BEGIN':
        this.scanCallback({ type: 'begin', step: Number(a), startFreq: Number(b) });
        break;
      case 'F':
        this.scanCallback({ type: 'station', freq: Number(a), rssi: Number(b), snr: Number(c) });
        break;
      case 'END':
        this.scanCallback({ type: 'end', count: Number(a) || 0 });
        break;
      default:
        break;
    }
  }

  /**
   * Send a command to the device
   * @param {string} command - Command to send
   */
  async sendCommand(command) {
    if (!this.connected) {
      throw new Error('Not connected to device');
    }

    try {
      console.log('[ATS Mini TX]:', command);

      if (this.isAndroid) {
        // Android: Use @adeunis/capacitor-serial
        await Serial.write({ data: command });
      } else {
        // Web: Use Web Serial API
        if (!this.writer) {
          throw new Error('Writer not available');
        }
        const encoder = new TextEncoder();
        await this.writer.write(encoder.encode(command));
      }
    } catch (error) {
      console.error('Send command error:', error);
      if (this.errorCallback) {
        this.errorCallback(error);
      }
    }
  }

  // ==================== Control Commands ====================

  async rotateUp() { await this.sendCommand('R'); }
  async rotateDown() { await this.sendCommand('r'); }

  async nextBand() { await this.sendCommand('B'); }
  async prevBand() { await this.sendCommand('b'); }

  async nextMode() { await this.sendCommand('M'); }
  async prevMode() { await this.sendCommand('m'); }

  async volumeUp() { await this.sendCommand('V'); }
  async volumeDown() { await this.sendCommand('v'); }

  async backlightUp() { await this.sendCommand('L'); }
  async backlightDown() { await this.sendCommand('l'); }

  async agcUp() { await this.sendCommand('A'); }
  async agcDown() { await this.sendCommand('a'); }

  async calibrationUp() { await this.sendCommand('I'); }
  async calibrationDown() { await this.sendCommand('i'); }

  async nextBandwidth() { await this.sendCommand('W'); }
  async prevBandwidth() { await this.sendCommand('w'); }

  async nextStep() { await this.sendCommand('S'); }
  async prevStep() { await this.sendCommand('s'); }

  async encoderPress() { await this.sendCommand('e'); }

  async toggleSleep() { await this.sendCommand('O'); }
  async sleepOn() { await this.sendCommand('O'); }
  async sleepOff() { await this.sendCommand('o'); }

  async toggleMonitor() { await this.sendCommand('t'); }

  async takeScreenshot() { await this.sendCommand('C'); }

  async showMemorySlots() { await this.sendCommand('$'); }

  async setMemorySlot(slot, band, frequency, mode) {
    // Format: #01,VHF,107900000,FM
    const slotStr = String(slot).padStart(2, '0');
    const command = `#${slotStr},${band},${frequency},${mode}`;
    console.log('[ATS Mini] Setting memory slot:', { slot: slotStr, band, frequency, mode });
    console.log('[ATS Mini] Command:', command);
    await this.sendCommand(command);
  }

  // ==================== Scan and Channel Commands ====================

  /**
   * Scan the current band. Takes 10-15 seconds, during which the receiver
   * is muted and sends no telemetry at all: the stations arrive afterwards,
   * through the onScanData() callback.
   */
  async scanBand() { await this.sendCommand('k'); }

  /**
   * Switch the receiver in and out of channel mode. While it is on, the
   * encoder cycles through the saved channels. The state is reported back
   * in the telemetry (channelMode and channel).
   */
  async toggleChannelMode() { await this.sendCommand('c'); }

  /**
   * Tune straight to a frequency, without stepping through everything
   * in between. The receiver takes the value in band units: kHz for
   * AM and SSB, 10 kHz for FM.
   *
   * @param {number} hz - Frequency in Hz
   * @param {string} mode - Current modulation (FM, AM, LSB, USB)
   */
  async setFrequencyTo(hz, mode) {
    const units = mode === 'FM' ? Math.round(hz / 10000) : Math.round(hz / 1000);
    await this.sendCommand(`F${units}\n`);
  }

  async toggleThemeEditor() { await this.sendCommand('T'); }

  async getCurrentTheme() { await this.sendCommand('@'); }

  async setTheme(colors) {
    const command = `!${colors}\n`;
    await this.sendCommand(command);
  }

  // ==================== Callback Setters ====================

  onMonitorData(callback) {
    this.monitorCallback = callback;
  }

  onRawData(callback) {
    this.rawDataCallback = callback;
  }

  /**
   * Called for every line of the band scan: start, station, end
   */
  onScanData(callback) {
    this.scanCallback = callback;
  }

  /**
   * Called for plain-text messages from the firmware, such as errors
   */
  onNotice(callback) {
    this.noticeCallback = callback;
  }

  onError(callback) {
    this.errorCallback = callback;
  }

  onConnectionChange(callback) {
    this.connectionCallback = callback;
  }
}
