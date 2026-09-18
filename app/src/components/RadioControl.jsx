import { useRef, useEffect } from 'react';

export default function RadioControl({ serial, connected, frequency, currentBand, currentMode, bandwidth, step, volume, agc, sleep, channelMode, channel, firmware }) {
  // Channel mode came with firmware 2.34; older ones ignore the command
  const tooOld = /^v\d/.test(firmware) && parseFloat(firmware.slice(1)) < 2.34;

  const longPressTimerRef = useRef(null);
  const isLongPressingRef = useRef(false);
  const longPressDirectionRef = useRef(null);
  const lastFrequencyRef = useRef(frequency);
  const waitingForChangeRef = useRef(false);

  // Watch for frequency changes to trigger next command
  useEffect(() => {
    // If frequency changed and we're waiting for it
    if (frequency !== lastFrequencyRef.current && waitingForChangeRef.current) {
      // Update last frequency
      lastFrequencyRef.current = frequency;

      // Mark as not waiting anymore
      waitingForChangeRef.current = false;

      // If still long pressing, send next command after a small delay
      if (isLongPressingRef.current && connected) {
        setTimeout(() => {
          handleStepButton(longPressDirectionRef.current);
        }, 50); // Small delay to avoid overwhelming the system
      }
    }
  }, [frequency, connected]);

  const handleStepButton = (direction) => {
    if (!connected || waitingForChangeRef.current) return;

    // Store current frequency and mark that we're waiting for change
    lastFrequencyRef.current = frequency;
    waitingForChangeRef.current = true;

    // Send command
    if (direction === 'up') {
      serial?.rotateUp();
    } else {
      serial?.rotateDown();
    }
  };

  const handleStepButtonDown = (direction) => {
    if (!connected) return;

    // First immediate press
    handleStepButton(direction);

    // Set long press state
    longPressDirectionRef.current = direction;

    // Start long press timer (600ms delay before continuous)
    longPressTimerRef.current = setTimeout(() => {
      isLongPressingRef.current = true;
      // The continuous sending is handled by the useEffect when frequency changes
    }, 600);
  };

  const handleStepButtonUp = () => {
    // Clear timer
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    // Stop long press
    isLongPressingRef.current = false;
    longPressDirectionRef.current = null;
    waitingForChangeRef.current = false;
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
      isLongPressingRef.current = false;
      waitingForChangeRef.current = false;
    };
  }, []);

  const handleBandChange = (direction) => {
    if (!connected) return;
    if (direction === 'next') {
      serial?.nextBand();
    } else {
      serial?.prevBand();
    }
  };

  const handleModeChange = (direction) => {
    if (!connected) return;
    if (direction === 'next') {
      serial?.nextMode();
    } else {
      serial?.prevMode();
    }
  };

  const handleBandwidthChange = (direction) => {
    if (!connected) return;
    if (direction === 'next') {
      serial?.nextBandwidth();
    } else {
      serial?.prevBandwidth();
    }
  };

  const handleStepChange = (direction) => {
    if (!connected) return;
    if (direction === 'next') {
      serial?.nextStep();
    } else {
      serial?.prevStep();
    }
  };

  const handleVolumeChange = (direction) => {
    if (!connected) return;
    if (direction === 'up') {
      serial?.volumeUp();
    } else {
      serial?.volumeDown();
    }
  };

  const handleBacklightChange = (direction) => {
    if (!connected) return;
    if (direction === 'up') {
      serial?.backlightUp();
    } else {
      serial?.backlightDown();
    }
  };

  const handleAGCChange = (direction) => {
    if (!connected) return;
    if (direction === 'up') {
      serial?.agcUp();
    } else {
      serial?.agcDown();
    }
  };

  return (
    <div className="space-y-3">
      {/* Channel mode: with it on, the knob on the receiver itself cycles
          through the saved channels instead of tuning the frequency */}
      <div className="bg-icom-panel rounded-lg p-3 border border-icom-accent/30 flex items-center justify-between gap-3">
        <div>
          <div aria-hidden="true" className="text-[10px] font-digital text-icom-text-dim">CHANNELS</div>
          <div role="status" className="text-sm font-digital text-icom-green">
            {tooOld
              ? 'Появится после обновления прошивки'
              : channelMode ? `Канал ${channel}` : 'Обычная настройка'}
          </div>
        </div>
        <button
          aria-label="Режим каналов"
          aria-pressed={channelMode}
          onClick={() => serial?.toggleChannelMode()}
          disabled={!connected || tooOld}
          className={`px-4 py-2 rounded font-digital text-sm border transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
            channelMode
              ? 'bg-icom-green/20 border-icom-green text-icom-green'
              : 'bg-icom-accent/20 border-icom-accent text-icom-accent hover:bg-icom-accent/30'
          }`}
        >
          {channelMode ? 'ВКЛ' : 'ВЫКЛ'}
        </button>
      </div>

      {/* Frequency Control Section */}
      <div className="bg-icom-panel rounded-lg p-3 sm:p-4 border border-icom-accent/30">
        <div className="text-center mb-3">
          <h3 className="text-base sm:text-lg font-digital text-icom-accent">FREQUENCY CONTROL</h3>
        </div>

        {/* Horizontal buttons: − | MENU | + */}
        <div className="flex items-center justify-center gap-3 sm:gap-4 mb-3">
          <button
            aria-label="Частота ниже"
            onPointerDown={() => handleStepButtonDown('down')}
            onPointerUp={handleStepButtonUp}
            onPointerLeave={handleStepButtonUp}
            onTouchStart={() => handleStepButtonDown('down')}
            onTouchEnd={handleStepButtonUp}
            disabled={!connected}
            className="flex-1 max-w-xs h-16 sm:h-20 rounded-lg bg-gradient-to-br from-icom-accent/20 to-icom-accent-dim/20 border-2 border-icom-accent hover:from-icom-accent/30 hover:to-icom-accent-dim/30 active:from-icom-accent/40 active:to-icom-accent-dim/40 disabled:opacity-30 disabled:cursor-not-allowed transition-all hover:shadow-icom flex items-center justify-center text-3xl sm:text-4xl text-icom-accent font-bold"
          >
            −
          </button>

          <button
            aria-label="Меню приёмника"
            onClick={() => serial?.encoderPress()}
            disabled={!connected}
            className="flex-1 max-w-xs h-16 sm:h-20 rounded-lg bg-gradient-to-r from-icom-amber/20 to-orange-600/20 border-2 border-icom-amber text-icom-amber hover:from-icom-amber/30 hover:to-orange-600/30 active:from-icom-amber/40 active:to-orange-600/40 disabled:opacity-30 disabled:cursor-not-allowed transition-all hover:shadow-icom font-digital text-sm sm:text-base font-bold flex flex-col items-center justify-center gap-1"
          >
            <span className="text-xl sm:text-2xl" aria-hidden="true">⚙️</span>
            <span aria-hidden="true">MENU</span>
          </button>

          <button
            aria-label="Частота выше"
            onPointerDown={() => handleStepButtonDown('up')}
            onPointerUp={handleStepButtonUp}
            onPointerLeave={handleStepButtonUp}
            onTouchStart={() => handleStepButtonDown('up')}
            onTouchEnd={handleStepButtonUp}
            disabled={!connected}
            className="flex-1 max-w-xs h-16 sm:h-20 rounded-lg bg-gradient-to-br from-icom-accent/20 to-icom-accent-dim/20 border-2 border-icom-accent hover:from-icom-accent/30 hover:to-icom-accent-dim/30 active:from-icom-accent/40 active:to-icom-accent-dim/40 disabled:opacity-30 disabled:cursor-not-allowed transition-all hover:shadow-icom flex items-center justify-center text-3xl sm:text-4xl text-icom-accent font-bold"
          >
            +
          </button>
        </div>

        {/* Band and Mode */}
        <div className="grid grid-cols-2 gap-2">
          {/* Band */}
          <div className="bg-icom-display/50 rounded-lg p-2 border border-icom-accent/20">
            <div className="text-[10px] text-icom-text-dim text-center mb-1 font-digital">BAND</div>
            <div className="flex items-center gap-1">
              <button
                aria-label="Диапазон ниже"
                onClick={() => handleBandChange('prev')}
                disabled={!connected}
                className="w-7 h-7 rounded bg-icom-accent/20 border border-icom-accent/40 text-icom-accent hover:bg-icom-accent/30 active:bg-icom-accent/40 disabled:opacity-30 text-xs font-bold"
              >
                ◄
              </button>
              <div className="flex-1 text-center text-sm sm:text-base font-digital text-icom-green">
                {currentBand || '---'}
              </div>
              <button
                aria-label="Диапазон выше"
                onClick={() => handleBandChange('next')}
                disabled={!connected}
                className="w-7 h-7 rounded bg-icom-accent/20 border border-icom-accent/40 text-icom-accent hover:bg-icom-accent/30 active:bg-icom-accent/40 disabled:opacity-30 text-xs font-bold"
              >
                ►
              </button>
            </div>
          </div>

          {/* Mode */}
          <div className="bg-icom-display/50 rounded-lg p-2 border border-icom-accent/20">
            <div className="text-[10px] text-icom-text-dim text-center mb-1 font-digital">MODE</div>
            <div className="flex items-center gap-1">
              <button
                aria-label="Модуляция ниже"
                onClick={() => handleModeChange('prev')}
                disabled={!connected}
                className="w-7 h-7 rounded bg-icom-accent/20 border border-icom-accent/40 text-icom-accent hover:bg-icom-accent/30 active:bg-icom-accent/40 disabled:opacity-30 text-xs font-bold"
              >
                ◄
              </button>
              <div className="flex-1 text-center text-sm sm:text-base font-digital text-icom-green">
                {currentMode || '---'}
              </div>
              <button
                aria-label="Модуляция выше"
                onClick={() => handleModeChange('next')}
                disabled={!connected}
                className="w-7 h-7 rounded bg-icom-accent/20 border border-icom-accent/40 text-icom-accent hover:bg-icom-accent/30 active:bg-icom-accent/40 disabled:opacity-30 text-xs font-bold"
              >
                ►
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Radio Controls */}
      <div className="bg-icom-panel rounded-lg p-3 border border-icom-accent/30">
        {/* BW/Step/AGC Grid */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          {/* Bandwidth */}
          <div className="bg-icom-display/50 rounded-lg p-2 border border-icom-accent/20">
            <div className="text-[10px] text-icom-text-dim text-center mb-1 font-digital">BW</div>
            <div className="flex items-center gap-1">
              <button
                aria-label="Полоса пропускания ниже"
                onClick={() => handleBandwidthChange('prev')}
                disabled={!connected}
                className="w-7 h-7 rounded bg-icom-accent/20 border border-icom-accent/40 text-icom-accent hover:bg-icom-accent/30 active:bg-icom-accent/40 disabled:opacity-30 text-xs font-bold"
              >
                ◄
              </button>
              <div className="flex-1 text-center text-base sm:text-lg font-digital text-icom-amber">
                {bandwidth || '---'}
              </div>
              <button
                aria-label="Полоса пропускания выше"
                onClick={() => handleBandwidthChange('next')}
                disabled={!connected}
                className="w-7 h-7 rounded bg-icom-accent/20 border border-icom-accent/40 text-icom-accent hover:bg-icom-accent/30 active:bg-icom-accent/40 disabled:opacity-30 text-xs font-bold"
              >
                ►
              </button>
            </div>
          </div>

          {/* Step */}
          <div className="bg-icom-display/50 rounded-lg p-2 border border-icom-accent/20">
            <div className="text-[10px] text-icom-text-dim text-center mb-1 font-digital">STEP</div>
            <div className="flex items-center gap-1">
              <button
                aria-label="Шаг настройки меньше"
                onClick={() => handleStepChange('prev')}
                disabled={!connected}
                className="w-7 h-7 rounded bg-icom-accent/20 border border-icom-accent/40 text-icom-accent hover:bg-icom-accent/30 active:bg-icom-accent/40 disabled:opacity-30 text-xs font-bold"
              >
                ◄
              </button>
              <div className="flex-1 text-center text-base sm:text-lg font-digital text-icom-amber">
                {step || '---'}
              </div>
              <button
                aria-label="Шаг настройки больше"
                onClick={() => handleStepChange('next')}
                disabled={!connected}
                className="w-7 h-7 rounded bg-icom-accent/20 border border-icom-accent/40 text-icom-accent hover:bg-icom-accent/30 active:bg-icom-accent/40 disabled:opacity-30 text-xs font-bold"
              >
                ►
              </button>
            </div>
          </div>

          {/* AGC */}
          <div className="bg-icom-display/50 rounded-lg p-2 border border-icom-accent/20">
            <div className="text-[10px] text-icom-text-dim text-center mb-1 font-digital">AGC/ATTN</div>
            <div className="flex items-center gap-1">
              <button
                aria-label="АРУ ниже"
                onClick={() => handleAGCChange('down')}
                disabled={!connected}
                className="w-7 h-7 rounded bg-icom-accent/20 border border-icom-accent/40 text-icom-accent hover:bg-icom-accent/30 active:bg-icom-accent/40 disabled:opacity-30 text-xs font-bold"
              >
                ◄
              </button>
              <div className="flex-1 text-center text-base sm:text-lg font-digital text-icom-accent">
                {agc || '---'}
              </div>
              <button
                aria-label="АРУ выше"
                onClick={() => handleAGCChange('up')}
                disabled={!connected}
                className="w-7 h-7 rounded bg-icom-accent/20 border border-icom-accent/40 text-icom-accent hover:bg-icom-accent/30 active:bg-icom-accent/40 disabled:opacity-30 text-xs font-bold"
              >
                ►
              </button>
            </div>
          </div>
        </div>

        {/* Volume/Backlight */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {/* Volume */}
          <div className="bg-icom-display/50 rounded-lg p-2 border border-icom-accent/20">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-icom-text-dim font-digital">VOLUME</span>
              <span className="text-xs text-icom-accent font-digital">{volume}</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                aria-label="Громкость ниже"
                onClick={() => handleVolumeChange('down')}
                disabled={!connected}
                className="w-7 h-7 rounded bg-icom-accent/20 border border-icom-accent/40 hover:bg-icom-accent/30 active:bg-icom-accent/40 disabled:opacity-30 flex items-center justify-center text-base text-icom-accent font-bold"
              >
                −
              </button>
              <div className="flex-1 bg-icom-display rounded-full h-3 overflow-hidden border border-icom-accent/30">
                <div
                  className="h-full bg-gradient-to-r from-icom-accent to-icom-green transition-all"
                  style={{ width: `${(volume / 63) * 100}%` }}
                ></div>
              </div>
              <button
                aria-label="Громкость выше"
                onClick={() => handleVolumeChange('up')}
                disabled={!connected}
                className="w-7 h-7 rounded bg-icom-accent/20 border border-icom-accent/40 hover:bg-icom-accent/30 active:bg-icom-accent/40 disabled:opacity-30 flex items-center justify-center text-base text-icom-accent font-bold"
              >
                +
              </button>
            </div>
          </div>

          {/* Backlight */}
          <div className="bg-icom-display/50 rounded-lg p-2 border border-icom-accent/20">
            <div className="text-[10px] text-icom-text-dim text-center mb-1 font-digital">BACKLIGHT</div>
            <div className="flex items-center justify-center gap-2">
              <button
                aria-label="Подсветка тусклее"
                onClick={() => handleBacklightChange('down')}
                disabled={!connected}
                className="flex-1 py-2 rounded bg-icom-accent/20 border border-icom-accent/40 hover:bg-icom-accent/30 active:bg-icom-accent/40 disabled:opacity-30 flex items-center justify-center text-base text-icom-accent font-bold"
              >
                −
              </button>
              <button
                aria-label="Подсветка ярче"
                onClick={() => handleBacklightChange('up')}
                disabled={!connected}
                className="flex-1 py-2 rounded bg-icom-accent/20 border border-icom-accent/40 hover:bg-icom-accent/30 active:bg-icom-accent/40 disabled:opacity-30 flex items-center justify-center text-base text-icom-accent font-bold"
              >
                +
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
