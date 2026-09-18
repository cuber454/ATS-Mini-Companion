import { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { SerialConnection } from '../lib/SerialConnection';
import { BleConnection } from '../lib/BleConnection';
import Display from './Display';
import RadioControl from './RadioControl';
import ScanPanel from './ScanPanel';
import MemoryPanel from './MemoryPanel';
import DebugConsole from './DebugConsole';

// Messages the firmware sends in English, shown to the user in Russian
const NOTICES = {
  'Frequency is outside the current band': 'Частота вне текущего диапазона',
  'Invalid frequency': 'Неверная частота',
  'no-channels': 'Ни одного канала не сохранено — сначала заполни память',
};

export default function ATSController() {
  // Bluetooth is the way the receiver is normally reached on a phone, so it is
  // the default there; in a desktop browser the cable is the realistic option.
  const [transport, setTransport] = useState(() =>
    Capacitor?.getPlatform?.() === 'android' ? 'ble' : 'usb'
  );
  const [serial, setSerial] = useState(null);
  const [connected, setConnected] = useState(false);
  const [baudRate, setBaudRate] = useState(115200);
  const [activeTab, setActiveTab] = useState('radio');
  const [monitorData, setMonitorData] = useState({
    firmware: '---',
    frequency: 0,
    band: 'FM',
    mode: 'FM',
    rssi: 0,
    snr: 0,
    voltage: 0,
    step: 10,
    bandwidth: 'AUTO',
    agc: 'AUTO',
    volume: 50,
    backlight: 5,
    calibration: 0,
    sleep: false,
    memory: '---'
  });
  const [error, setError] = useState(null);
  const [rawData, setRawData] = useState([]);
  const [lastUpdate, setLastUpdate] = useState(null);
  // state: idle | running | done | timeout
  const [scan, setScan] = useState({ state: 'idle', stations: [], found: null });

  useEffect(() => {
    // Each transport is its own client; switching rebuilds it
    const client = transport === 'ble' ? new BleConnection() : new SerialConnection();

    // Setup callbacks
    client.onMonitorData((data) => {
      setMonitorData(data);
      setLastUpdate(new Date().toLocaleTimeString());
    });

    client.onRawData((data) => {
      const timestamp = new Date().toLocaleTimeString();
      setRawData(prev => [...prev.slice(-100), { time: timestamp, data }]);
    });

    client.onScanData((event) => {
      setScan((prev) => {
        switch (event.type) {
          case 'start':
            return { state: 'running', stations: [], found: null };
          case 'station':
            return { ...prev, stations: [...prev.stations, event] };
          case 'end':
            return { ...prev, state: 'done', found: event.count };
          default:
            return prev;
        }
      });
    });

    client.onNotice((notice) => {
      setError(NOTICES[notice.text] || notice.text);
      setTimeout(() => setError(null), 5000);
    });

    client.onError((err) => {
      setError(err.message);
      setTimeout(() => setError(null), 5000);
    });

    client.onConnectionChange((status) => {
      setConnected(status);
    });

    setSerial(client);

    return () => {
      if (client.connected) {
        client.disconnect();
      }
    };
  }, [transport]);

  // A scan that never reports back must not leave the button stuck
  useEffect(() => {
    if (scan.state !== 'running') return;
    const timer = setTimeout(() => {
      setScan((prev) => (prev.state === 'running' ? { ...prev, state: 'timeout' } : prev));
    }, 60000);
    return () => clearTimeout(timer);
  }, [scan.state]);

  const handleScan = () => {
    if (!connected) return;
    setScan({ state: 'running', stations: [], found: null });
    serial?.scanBand();
  };

  const handleConnect = async () => {
    if (!serial) return;

    if (connected) {
      await serial.disconnect();
      return;
    }

    if (transport === 'usb' && !SerialConnection.isSupported()) {
      setError('Веб-версия Serial API недоступна. Нужен Chrome или Edge.');
      return;
    }

    if (transport === 'ble' && !(await BleConnection.isSupported())) {
      setError('Bluetooth выключен или приложению не разрешён доступ к нему.');
      return;
    }

    try {
      const success = await (transport === 'ble' ? serial.connect() : serial.connect(baudRate));
      if (success) {
        // Enable monitor mode — the same line the USB path uses
        setTimeout(() => {
          serial.toggleMonitor();
        }, 1000);
      }
    } catch (err) {
      // "No device found" means the search finished with an empty list, which is
      // a different problem from a connection that failed partway — say which.
      const notFound = String(err?.message || err).toLowerCase().includes('no device found');
      setError(transport === 'ble'
        ? (notFound
          ? 'Приёмник не найден. Проверь, что он включён и Bluetooth в нём не выключен в меню.'
          : 'Не удалось подключиться по Bluetooth. Проверь, что приёмник включён и Bluetooth в нём не выключен в меню.')
        : 'Не удалось подключиться по кабелю.');
      console.error('[ATS Mini] Connect error:', err);
    }
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <div className="max-w-7xl mx-auto w-full flex flex-col h-full p-2 sm:p-3">
        {/* Header */}
        <div className="bg-icom-panel rounded-lg p-3 mb-2 border border-icom-accent/30 shadow-lg flex-shrink-0">
          <div className="flex items-center gap-3">
            <div aria-hidden="true" className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-icom-green' : 'bg-icom-red'} ${connected ? 'led-indicator' : ''}`}></div>
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-icom-text font-digital">ATS MINI Companion App</h1>
            </div>
          </div>
        </div>

        {/* Tab Menu */}
        <div className="grid grid-cols-5 gap-1 mb-2 flex-shrink-0">
          <button
            aria-label="Подключение"
            aria-pressed={activeTab === 'connect'}
            onClick={() => setActiveTab('connect')}
            className={`px-2 py-2 rounded font-digital text-[10px] sm:text-xs transition-all ${
              activeTab === 'connect'
                ? 'bg-icom-accent text-icom-bg'
                : 'bg-icom-panel text-icom-text border border-icom-accent/30 hover:bg-icom-accent/20'
            }`}
          >
            <span className="hidden sm:inline">CONNECT</span>
            <span className="sm:hidden">CON</span>
          </button>
          <button
            aria-label="Радио"
            aria-pressed={activeTab === 'radio'}
            onClick={() => setActiveTab('radio')}
            className={`px-2 py-2 rounded font-digital text-[10px] sm:text-xs transition-all ${
              activeTab === 'radio'
                ? 'bg-icom-accent text-icom-bg'
                : 'bg-icom-panel text-icom-text border border-icom-accent/30 hover:bg-icom-accent/20'
            }`}
          >
            <span className="hidden sm:inline">RADIO</span>
            <span className="sm:hidden">RAD</span>
          </button>
          <button
            aria-label="Память"
            aria-pressed={activeTab === 'memory'}
            onClick={() => setActiveTab('memory')}
            className={`px-2 py-2 rounded font-digital text-[10px] sm:text-xs transition-all ${
              activeTab === 'memory'
                ? 'bg-icom-accent text-icom-bg'
                : 'bg-icom-panel text-icom-text border border-icom-accent/30 hover:bg-icom-accent/20'
            }`}
          >
            <span className="hidden sm:inline">MEMORY</span>
            <span className="sm:hidden">MEM</span>
          </button>
          <button
            aria-label="Отладка"
            aria-pressed={activeTab === 'debug'}
            onClick={() => setActiveTab('debug')}
            className={`px-2 py-2 rounded font-digital text-[10px] sm:text-xs transition-all ${
              activeTab === 'debug'
                ? 'bg-icom-accent text-icom-bg'
                : 'bg-icom-panel text-icom-text border border-icom-accent/30 hover:bg-icom-accent/20'
            }`}
          >
            <span className="hidden sm:inline">DEBUG</span>
            <span className="sm:hidden">DBG</span>
          </button>
          <button
            aria-label="О приложении"
            aria-pressed={activeTab === 'about'}
            onClick={() => setActiveTab('about')}
            className={`px-2 py-2 rounded font-digital text-[10px] sm:text-xs transition-all ${
              activeTab === 'about'
                ? 'bg-icom-accent text-icom-bg'
                : 'bg-icom-panel text-icom-text border border-icom-accent/30 hover:bg-icom-accent/20'
            }`}
          >
            <span className="hidden sm:inline">ABOUT</span>
            <span className="sm:hidden">ABT</span>
          </button>
        </div>

        {/* Errors and firmware messages, shown on every tab */}
        {error && (
          <div role="alert" className="mb-2 flex-shrink-0 bg-red-600/20 border border-red-600 text-red-400 px-4 py-3 rounded text-sm">
            {error}
          </div>
        )}

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'connect' && (
            <div className="bg-icom-panel rounded-lg p-6 border border-icom-accent/30 max-w-2xl mx-auto mt-8">
              <h2 className="text-xl font-bold text-icom-accent font-digital mb-4">Serial Connection</h2>

              <div className="space-y-4">
                <div>
                  <div className="block text-sm text-icom-text-dim font-digital mb-2">Способ подключения</div>
                  <div role="group" aria-label="Способ подключения" className="grid grid-cols-2 gap-2">
                    <button
                      aria-label="Подключение по Bluetooth"
                      aria-pressed={transport === 'ble'}
                      onClick={() => setTransport('ble')}
                      disabled={connected}
                      className={`px-4 py-3 rounded font-digital text-sm border transition-all disabled:opacity-50 ${
                        transport === 'ble'
                          ? 'bg-icom-accent text-icom-bg border-icom-accent'
                          : 'bg-icom-panel text-icom-text border border-icom-accent/30 hover:bg-icom-accent/20'
                      }`}
                    >
                      BLUETOOTH
                    </button>
                    <button
                      aria-label="Подключение по кабелю"
                      aria-pressed={transport === 'usb'}
                      onClick={() => setTransport('usb')}
                      disabled={connected}
                      className={`px-4 py-3 rounded font-digital text-sm border transition-all disabled:opacity-50 ${
                        transport === 'usb'
                          ? 'bg-icom-accent text-icom-bg border-icom-accent'
                          : 'bg-icom-panel text-icom-text border border-icom-accent/30 hover:bg-icom-accent/20'
                      }`}
                    >
                      КАБЕЛЬ
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-icom-text-dim font-digital">
                    {transport === 'ble'
                      ? 'Приёмник виден как ATS-Mini. Bluetooth в нём должен быть включён.'
                      : 'Нужен кабель USB и Chrome или Edge.'}
                  </p>
                </div>

                {transport === 'usb' && (
                  <div>
                    <label className="block text-sm text-icom-text-dim font-digital mb-2">Baud Rate</label>
                    <select
                      aria-label="Скорость порта"
                      value={baudRate}
                      onChange={(e) => setBaudRate(Number(e.target.value))}
                      disabled={connected}
                      className="w-full bg-icom-display text-icom-text px-4 py-3 rounded text-sm border border-icom-accent-dim focus:border-icom-accent focus:outline-none disabled:opacity-50"
                    >
                      <option value={9600}>9600 baud</option>
                      <option value={115200}>115200 baud</option>
                    </select>
                  </div>
                )}

                <button
                  aria-label={connected ? 'Отключиться от приёмника' : 'Подключиться к приёмнику'}
                  onClick={handleConnect}
                  className={`w-full px-6 py-3 rounded font-semibold text-base transition-all ${
                    connected
                      ? 'bg-red-600 hover:bg-red-700 text-white'
                      : 'bg-icom-accent hover:bg-icom-accent-dim text-icom-bg'
                  } shadow-lg font-digital`}
                >
                  {connected ? 'DISCONNECT' : 'CONNECT TO ATS MINI'}
                </button>

                {connected && lastUpdate && (
                  <div role="status" className="text-center text-sm text-icom-green border-t border-icom-accent/20 pt-4">
                    ✓ Connected • Last update: {lastUpdate}
                  </div>
                )}

                <div className="bg-icom-display/30 rounded p-4 text-sm text-icom-text-dim border border-icom-accent/20">
                  <p className="font-digital mb-2">ℹ️ Requirements:</p>
                  <ul className="list-disc ml-5 space-y-1">
                    <li>Bluetooth: receiver switched on, Bluetooth enabled in its menu, visible as ATS-Mini</li>
                    <li>Cable: Chrome or Edge browser (Web Serial API), receiver connected via USB</li>
                    <li>Cable: correct baud rate selected (usually 115200)</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'radio' && (
            <div className="space-y-2 h-full">
              {/* Display */}
              <Display data={monitorData} connected={connected} serial={serial} />

              {/* Radio Control */}
              <RadioControl
                serial={serial}
                connected={connected}
                frequency={monitorData.frequency}
                currentBand={monitorData.band}
                currentMode={monitorData.mode}
                bandwidth={monitorData.bandwidth}
                step={monitorData.step}
                volume={monitorData.volume}
                agc={monitorData.agc}
                sleep={monitorData.sleep}
                channelMode={monitorData.channelMode}
                channel={monitorData.channel}
                firmware={monitorData.firmware}
              />

              {/* Band scan */}
              <ScanPanel
                serial={serial}
                connected={connected}
                scan={scan}
                mode={monitorData.mode}
                firmware={monitorData.firmware}
                onScan={handleScan}
              />
            </div>
          )}

          {activeTab === 'memory' && (
            <MemoryPanel
              serial={serial}
              connected={connected}
              currentMemory={monitorData.memory}
              frequency={monitorData.frequency}
              band={monitorData.band}
              mode={monitorData.mode}
            />
          )}

          {activeTab === 'debug' && (
            <DebugConsole serial={serial} connected={connected} rawData={rawData} />
          )}

          {activeTab === 'about' && (
            <div className="space-y-4 max-w-4xl mx-auto">
              {/* Header */}
              <div className="bg-icom-panel rounded-lg p-6 border border-icom-accent/30">
                <h2 className="text-2xl font-bold text-icom-accent font-digital mb-2">ATS MINI Companion App</h2>
                <p className="text-sm text-icom-text-dim">Version 1.0.0</p>
                <p className="text-base text-icom-text mt-4">
                  Web-based control application for the ATS Mini radio receiver
                </p>
                <p className="text-sm text-icom-text-dim mt-2">
                  Developed by <strong className="text-icom-accent">Miguel Cañadas - EA5IYR</strong>
                </p>
              </div>

              {/* How it works */}
              <div className="bg-icom-panel rounded-lg p-6 border border-icom-accent/30">
                <h3 className="text-lg font-bold text-icom-accent font-digital mb-3">How it works</h3>
                <div className="space-y-2 text-sm text-icom-text">
                  <p>
                    This web application communicates with the ATS Mini through a USB Serial connection using the browser's Web Serial API.
                  </p>
                  <p>
                    Once connected, the application sends commands to the receiver and receives real-time data about frequency, signal, operating mode, and other parameters.
                  </p>
                  <p>
                    Monitor mode is activated automatically, allowing you to visualize all receiver parameters and control all functions from the web interface.
                  </p>
                </div>
              </div>

              {/* Radio Features */}
              <div className="bg-icom-panel rounded-lg p-6 border border-icom-accent/30">
                <h3 className="text-lg font-bold text-icom-accent font-digital mb-3">ATS Mini Features</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-icom-text">
                  <div>
                    <p className="text-icom-accent font-digital mb-1">Hardware</p>
                    <ul className="list-disc ml-5 space-y-1 text-xs">
                      <li>Microcontroller: ESP32-S3</li>
                      <li>Receiver chip: SI4732</li>
                      <li>Integrated OLED display</li>
                      <li>Rotary encoder for tuning</li>
                    </ul>
                  </div>
                  <div>
                    <p className="text-icom-accent font-digital mb-1">Supported bands</p>
                    <ul className="list-disc ml-5 space-y-1 text-xs">
                      <li>FM: 64-108 MHz</li>
                      <li>AM: MW and SW</li>
                      <li>SSB: LSB/USB</li>
                      <li>Multiple shortwave bands</li>
                    </ul>
                  </div>
                  <div>
                    <p className="text-icom-accent font-digital mb-1">Functions</p>
                    <ul className="list-disc ml-5 space-y-1 text-xs">
                      <li>100 programmable memories</li>
                      <li>Automatic/manual AGC</li>
                      <li>Bandwidth control</li>
                      <li>S-Meter and SNR indicators</li>
                    </ul>
                  </div>
                  <div>
                    <p className="text-icom-accent font-digital mb-1">Connectivity</p>
                    <ul className="list-disc ml-5 space-y-1 text-xs">
                      <li>USB Serial (115200 baud)</li>
                      <li>Full remote control</li>
                      <li>Real-time monitoring</li>
                      <li>Text-based commands</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Troubleshooting */}
              <div className="bg-icom-panel rounded-lg p-6 border border-icom-accent/30">
                <h3 className="text-lg font-bold text-icom-accent font-digital mb-3">Troubleshooting</h3>
                <div className="space-y-3">
                  <div>
                    <p className="text-icom-accent font-digital text-sm mb-1">❌ Cannot connect</p>
                    <ul className="list-disc ml-5 space-y-1 text-xs text-icom-text">
                      <li>Make sure you're using Chrome or Edge</li>
                      <li>Ensure the ATS Mini is connected via USB</li>
                      <li>Try baudrate 115200 (recommended)</li>
                      <li>Close other applications using the serial port</li>
                    </ul>
                  </div>
                  <div>
                    <p className="text-icom-accent font-digital text-sm mb-1">❌ No data received</p>
                    <ul className="list-disc ml-5 space-y-1 text-xs text-icom-text">
                      <li>Monitor mode activates automatically on connect</li>
                      <li>Wait a few seconds after connecting</li>
                      <li>Check the debug console for raw data</li>
                      <li>Restart the ATS Mini by disconnecting and reconnecting</li>
                    </ul>
                  </div>
                  <div>
                    <p className="text-icom-accent font-digital text-sm mb-1">❌ Controls not responding</p>
                    <ul className="list-disc ml-5 space-y-1 text-xs text-icom-text">
                      <li>Check that you're connected (green indicator in header)</li>
                      <li>Verify that monitor mode is active</li>
                      <li>Try disconnecting and reconnecting</li>
                      <li>Check the debug console to see if commands are being sent</li>
                    </ul>
                  </div>
                  <div>
                    <p className="text-icom-accent font-digital text-sm mb-1">❌ Frequency not updating</p>
                    <ul className="list-disc ml-5 space-y-1 text-xs text-icom-text">
                      <li>Use the VFO + and - controls to adjust frequency</li>
                      <li>You can click on the display frequency to enter it manually</li>
                      <li>The tuning step (STEP) determines the increment for each adjustment</li>
                      <li>Mouse wheel over the VFO also changes frequency</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="bg-icom-display/30 rounded-lg p-4 border border-icom-accent/20 text-center">
                <p className="text-xs text-icom-text-dim">
                  For more information about the ATS Mini hardware, visit:<br/>
                  <a href="https://esp32-si4732.github.io/ats-mini/" target="_blank" rel="noopener noreferrer" className="text-icom-accent hover:text-icom-green underline">
                    https://esp32-si4732.github.io/ats-mini/
                  </a>
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
