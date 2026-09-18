/**
 * Band scan: asks the receiver to walk the band, then lists the stations
 * it found, strongest first. Tapping a station tunes straight to it.
 *
 * The receiver mutes its audio and stops sending telemetry while it scans,
 * which is why the panel says so out loud: silence there is expected.
 */
export default function ScanPanel({ connected, scan, mode, firmware, onScan, onTune }) {
  const isFm = mode === 'FM';

  // Scan and channel mode came with firmware 2.34; older ones ignore them
  const tooOld = /^v\d/.test(firmware) && parseFloat(firmware.slice(1)) < 2.34;
  const ready = connected && !tooOld;

  // The receiver reports frequencies the same way it reports the tuned
  // frequency: 10 kHz units in FM, kHz everywhere else
  const toHz = (freq) => (isFm ? freq * 10000 : freq * 1000);

  const label = (freq) => {
    const hz = toHz(freq);
    return isFm
      ? `${(hz / 1000000).toFixed(2)} МГц`
      : `${(hz / 1000).toFixed(0)} кГц`;
  };

  let status;
  if (tooOld) status = 'Скан появится после обновления прошивки приёмника.';
  else if (scan.state === 'running') status = 'Сканирую. Приёмник молчит, это нормально.';
  else if (scan.state === 'timeout') status = 'Приёмник не ответил на скан.';
  else if (scan.state === 'done' && scan.found === 0) status = 'Ничего не нашлось.';
  else if (scan.state === 'done') status = `Нашлось станций: ${scan.found}. Список ниже.`;
  else status = 'Скан идёт по всему диапазону, это 10–15 секунд.';

  return (
    <div className="bg-icom-panel rounded-lg p-3 border border-icom-accent/30">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h3 aria-hidden="true" className="text-xs font-digital text-icom-text-dim">
          SCAN
        </h3>
        <button
          aria-label="Сканировать диапазон"
          onClick={onScan}
          disabled={!ready || scan.state === 'running'}
          className="px-4 py-2 rounded font-digital text-sm bg-icom-accent/20 border border-icom-accent text-icom-accent hover:bg-icom-accent/30 active:bg-icom-accent/40 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
        >
          {scan.state === 'running' ? 'ИДЁТ…' : 'СКАНИРОВАТЬ'}
        </button>
      </div>

      <div role="status" className="text-xs text-icom-text-dim font-digital">
        {status}
      </div>

      {scan.stations.length > 0 && (
        <ul className="mt-2 space-y-1">
          {scan.stations.map((station, index) => (
            <li key={`${station.freq}-${index}`}>
              <button
                aria-label={`Настроиться на ${label(station.freq)}, уровень ${station.rssi}`}
                onClick={() => onTune?.(station, label(station.freq))}
                className="w-full flex items-center justify-between px-3 py-2 rounded bg-icom-display/50 border border-icom-accent/20 hover:bg-icom-accent/20 active:bg-icom-accent/30 transition-all"
              >
                <span className="font-digital text-icom-accent text-sm">{label(station.freq)}</span>
                <span aria-hidden="true" className="font-digital text-icom-text-dim text-xs">
                  {station.rssi}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
