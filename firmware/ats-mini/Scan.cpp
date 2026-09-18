#include "Common.h"
#include "Utils.h"
#include "Menu.h"

// Tuning delays after rx.setFrequency()
#define TUNE_DELAY_DEFAULT 30
#define TUNE_DELAY_FM      60
#define TUNE_DELAY_AM_SSB  80

#define SCAN_POLL_TIME    10 // Tuning status polling interval (msecs)
#define SCAN_POINTS      200 // Number of frequencies to scan

#define SCAN_REPORT_MAX   20 // Number of stations reported to the remote

#define SCAN_OFF    0   // Scanner off, no data
#define SCAN_RUN    1   // Scanner running
#define SCAN_DONE   2   // Scanner done, valid data in scanData[]

static struct
{
  uint8_t rssi;
  uint8_t snr;
} scanData[SCAN_POINTS];

static uint32_t scanTime = millis();
static uint8_t  scanStatus = SCAN_OFF;

static uint16_t scanStartFreq;
static uint16_t scanStep;
static uint16_t scanCount;
static uint8_t  scanMinRSSI;
static uint8_t  scanMaxRSSI;
static uint8_t  scanMinSNR;
static uint8_t  scanMaxSNR;

static inline uint8_t min(uint8_t a, uint8_t b) { return(a<b? a:b); }
static inline uint8_t max(uint8_t a, uint8_t b) { return(a>b? a:b); }

float scanGetRSSI(uint16_t freq)
{
  // Input frequency must be in range of existing data
  if((scanStatus!=SCAN_DONE) || (freq<scanStartFreq) || (freq>=scanStartFreq+scanStep*scanCount))
    return(0.0);

  uint8_t result = scanData[(freq - scanStartFreq) / scanStep].rssi;
  return((result - scanMinRSSI) / (float)(scanMaxRSSI - scanMinRSSI + 1));
}

float scanGetSNR(uint16_t freq)
{
  // Input frequency must be in range of existing data
  if((scanStatus!=SCAN_DONE) || (freq<scanStartFreq) || (freq>=scanStartFreq+scanStep*scanCount))
    return(0.0);

  uint8_t result = scanData[(freq - scanStartFreq) / scanStep].snr;
  return((result - scanMinSNR) / (float)(scanMaxSNR - scanMinSNR + 1));
}

static void scanInit(uint16_t centerFreq, uint16_t step)
{
  scanStep    = step;
  scanCount   = 0;
  scanMinRSSI = 255;
  scanMaxRSSI = 0;
  scanMinSNR  = 255;
  scanMaxSNR  = 0;
  scanStatus  = SCAN_RUN;
  scanTime    = millis();

  const Band *band = getCurrentBand();
  int freq = scanStep * (centerFreq / scanStep - SCAN_POINTS / 2);

  // Adjust to band boundaries
  if(freq + scanStep * (SCAN_POINTS - 1) > band->maximumFreq)
    freq = band->maximumFreq - scanStep * (SCAN_POINTS - 1);
  if(freq < band->minimumFreq)
    freq = band->minimumFreq;
  scanStartFreq = freq;

  // Clear scan data
  memset(scanData, 0, sizeof(scanData));
}

static bool scanTickTime()
{
  // Scan must be on
  if((scanStatus!=SCAN_RUN) || (scanCount>=SCAN_POINTS)) return(false);

  // Wait for the right time
  if(millis() - scanTime < SCAN_POLL_TIME) return(true);

  // This is our current frequency to scan
  uint16_t freq = scanStartFreq + scanStep * scanCount;

  // Poll for the tuning status
  rx.getStatus(0, 0);
  if(!rx.getTuneCompleteTriggered())
  {
    scanTime = millis();
    return(true);
  }

  // If frequency not yet set, set it and wait until next call to measure
  if(rx.getCurrentFrequency() != freq)
  {
    rx.setFrequency(freq); // Implies tuning delay
    scanTime = millis() - SCAN_POLL_TIME;
    return(true);
  }

  // Measure RSSI/SNR values
  rx.getCurrentReceivedSignalQuality();
  scanData[scanCount].rssi = rx.getCurrentRSSI();
  scanData[scanCount].snr  = rx.getCurrentSNR();

  // Measure range of values
  scanMinRSSI = min(scanData[scanCount].rssi, scanMinRSSI);
  scanMaxRSSI = max(scanData[scanCount].rssi, scanMaxRSSI);
  scanMinSNR  = min(scanData[scanCount].snr, scanMinSNR);
  scanMaxSNR  = max(scanData[scanCount].snr, scanMaxSNR);

  // Next frequency to scan
  freq += scanStep;

  // Set next frequency to scan or expire scan
  if((++scanCount >= SCAN_POINTS) || !isFreqInBand(getCurrentBand(), freq) || checkStopSeeking())
    scanStatus = SCAN_DONE;
  else
    rx.setFrequency(freq); // Implies tuning delay

  // Save last scan time
  scanTime = millis() - SCAN_POLL_TIME;

  // Return current scan status
  return(scanStatus==SCAN_RUN);
}

//
// Report the stations found by the last scan, strongest first.
//
// A station is a group of neighbouring scan points rising above the noise
// floor by at least a third of the dynamic range seen during the scan; the
// strongest point of the group is taken as its frequency.
//
void scanReportStations()
{
  if(scanStatus != SCAN_DONE)
  {
    Serial.println("SCAN,END,0");
    return;
  }

  Serial.printf("SCAN,BEGIN,%u,%u\r\n", scanStep, scanStartFreq);

  // A flat band means there is nothing to report: no signal stands out
  if(scanMaxRSSI <= scanMinRSSI + 2)
  {
    Serial.println("SCAN,END,0");
    return;
  }

  uint8_t threshold = scanMinRSSI + (scanMaxRSSI - scanMinRSSI) / 3;

  // Stations found, kept sorted by signal strength
  uint16_t freqs[SCAN_REPORT_MAX];
  uint8_t  rssis[SCAN_REPORT_MAX];
  uint8_t  snrs[SCAN_REPORT_MAX];
  uint8_t  count = 0;

  for(uint16_t i=0 ; i<scanCount ; )
  {
    // Skip the noise floor
    if(scanData[i].rssi < threshold)
    {
      i++;
      continue;
    }

    // Take the strongest point of this group of adjacent points
    uint16_t best = i;
    while((i < scanCount) && (scanData[i].rssi >= threshold))
    {
      if(scanData[i].rssi > scanData[best].rssi) best = i;
      i++;
    }

    // Insert the station, keeping the list sorted by signal strength
    uint8_t pos = count < SCAN_REPORT_MAX ? count : SCAN_REPORT_MAX - 1;
    while(pos && (rssis[pos-1] < scanData[best].rssi))
    {
      freqs[pos] = freqs[pos-1];
      rssis[pos] = rssis[pos-1];
      snrs[pos]  = snrs[pos-1];
      pos--;
    }
    freqs[pos] = scanStartFreq + scanStep * best;
    rssis[pos] = scanData[best].rssi;
    snrs[pos]  = scanData[best].snr;
    if(count < SCAN_REPORT_MAX) count++;
  }

  for(uint8_t i=0 ; i<count ; i++)
    Serial.printf("SCAN,F,%u,%u,%u\r\n", freqs[i], rssis[i], snrs[i]);

  Serial.printf("SCAN,END,%u\r\n", count);
}

//
// Run entire scan once
//
void scanRun(uint16_t centerFreq, uint16_t step)
{
  // Set tuning delay
  rx.setMaxDelaySetFrequency(currentMode == FM ? TUNE_DELAY_FM : TUNE_DELAY_AM_SSB);
  // Mute the audio
  muteOn(MUTE_TEMP, true);
  // Flag is set by rotary encoder and cleared on seek/scan entry
  seekStop = false;
  // Save current frequency
  uint16_t curFreq = rx.getFrequency();
  // Scan the whole range
  for(scanInit(centerFreq, step) ; scanTickTime(););
  // Restore current frequency
  rx.setFrequency(curFreq);
  // Unmute the audio
  muteOn(MUTE_TEMP, false);
  // Restore tuning delay
  rx.setMaxDelaySetFrequency(TUNE_DELAY_DEFAULT);
}
