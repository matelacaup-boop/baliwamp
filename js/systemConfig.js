// ===================================
// SYSTEM CONFIGURATION JAVASCRIPT
// ===================================

// Firebase references
let database;
let systemRef;
let thresholdsRef;
let sensorsRef;
let notificationsRef;

// Current configuration state
let currentConfig = {
  wifi: {
    ssid: '',
    password: '',
    connected: false
  },
  aerator: {
    autoMode: false,
    doThreshold: 5.0,
    doStopThreshold: 6.5,
    schedules: []
  },
  sampling: {
    interval: 300 // seconds (5 minutes default)
  },
  notifications: {
    email: true,
    push: true,
    criticalAlerts: true,
    warningAlerts: true,
    systemAlerts: true,
    dailyReport: false
  }
};

let scheduleCounter = 0;

// -----------------------------------------------------------------------
// WiFi connection monitoring
// We watch two Firebase paths:
//   system/wifi/connected  – boolean the ESP32 writes after connecting
//   system/wifi/ssid       – the SSID the ESP32 is currently connected to
//
// Connection-check timeout: if the ESP32 doesn't confirm success within
// WIFI_CONFIRM_TIMEOUT_MS after a save, we treat it as a failure and
// clear the stored credentials.
// -----------------------------------------------------------------------
const WIFI_CONFIRM_TIMEOUT_MS = 10000; // 10 seconds
let wifiConfirmTimer = null;
let wifiStatusListener = null;

// Default thresholds
const defaultThresholds = {
  do: {
    safeMin: 5.0,
    safeMax: 9.0,
    warnMin: 4.0,
    warnMax: 10.0
  },
  temperature: {
    safeMin: 26.0,
    safeMax: 32.0,
    warnMin: 24.0,
    warnMax: 34.0
  },
  ph: {
    safeMin: 7.5,
    safeMax: 8.5,
    warnMin: 7.0,
    warnMax: 9.0
  },
  salinity: {
    safeMin: 15.0,
    safeMax: 25.0,
    warnMin: 12.0,
    warnMax: 28.0
  },
  turbidity: {
    safeMin: 20.0,
    safeMax: 50.0,
    warnMin: 10.0,
    warnMax: 70.0
  }
};

// ===================================
// INIT
// ===================================

document.addEventListener('DOMContentLoaded', function () {
  console.log('System Configuration page loaded');

  // Initialize Firebase references
  database = firebase.database();
  systemRef    = database.ref('system');
  thresholdsRef = database.ref('thresholds');
  sensorsRef   = database.ref('sensors');
  notificationsRef = database.ref('notifications');

  // Setup tab navigation
  setupTabs();

  // Load current configuration
  loadConfiguration();

  // Setup form handlers
  setupFormHandlers();

  // Listen for real-time updates
  listenForUpdates();

  // Update interval preview
  updateIntervalPreview();

  // Start watching ESP32 WiFi connection status immediately
  watchWifiConnectionStatus();
});

// ===================================
// TAB NAVIGATION
// ===================================

function setupTabs() {
  const tabs   = document.querySelectorAll('.config-tab');
  const panels = document.querySelectorAll('.tab-panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', function () {
      const tabName = this.getAttribute('data-tab');
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      this.classList.add('active');
      document.getElementById(tabName + '-panel').classList.add('active');
    });
  });
}

// ===================================
// LOAD CONFIGURATION
// ===================================

function loadConfiguration() {
  console.log('Loading configuration from Firebase...');
  loadWiFiConfig();
  loadThresholds();
  loadAeratorConfig();
  loadSamplingConfig();
  loadNotificationSettings();
}

function loadWiFiConfig() {
  systemRef.child('wifi').once('value', (snapshot) => {
    const wifiData = snapshot.val();
    if (wifiData) {
      document.getElementById('wifiSSID').value = wifiData.ssid || '';
      currentConfig.wifi.ssid = wifiData.ssid || '';
      currentConfig.wifi.connected = wifiData.connected || false;
    }
  });
}

function loadThresholds() {
  thresholdsRef.once('value', (snapshot) => {
    const thresholds = snapshot.val() || defaultThresholds;
    console.log('Loading thresholds from Firebase:', thresholds);
    
    Object.keys(defaultThresholds).forEach(sensor => {
      const st = thresholds[sensor] || defaultThresholds[sensor];
      console.log(`Loading ${sensor} thresholds:`, st);
      
      document.getElementById(`${sensor}_safeMin`).value = st.safeMin;
      document.getElementById(`${sensor}_safeMax`).value = st.safeMax;
      document.getElementById(`${sensor}_warnMin`).value = st.warnMin;
      document.getElementById(`${sensor}_warnMax`).value = st.warnMax;
    });
  }).catch(err => {
    console.error('Error loading thresholds:', err);
    showNotification('Error loading thresholds: ' + err.message, 'error');
  });
}

function loadAeratorConfig() {
  systemRef.child('aerator').once('value', (snapshot) => {
    const aeratorData = snapshot.val();
    if (aeratorData) {
      currentConfig.aerator = aeratorData;
      const autoToggle = document.getElementById('aeratorAutoToggle');
      autoToggle.checked = aeratorData.autoMode || false;
      toggleAeratorMode(false); // Pass false to indicate this is initial load, not user change
      document.getElementById('aeratorDOThreshold').value     = aeratorData.doThreshold     || 5.0;
      document.getElementById('aeratorDOStopThreshold').value = aeratorData.doStopThreshold || 6.5;
      
      // Load schedules array
      if (aeratorData.schedules && aeratorData.schedules.length > 0) {
        aeratorData.schedules.forEach(s => addSchedule(s.startTime, s.stopTime));
      }
    }
  });
}

function loadSamplingConfig() {
  systemRef.child('sampling').once('value', (snapshot) => {
    const samplingData = snapshot.val();
    if (samplingData && samplingData.interval) {
      // Convert from milliseconds to seconds for internal use
      const intervalSeconds = Math.floor(samplingData.interval / 1000);
      currentConfig.sampling.interval = intervalSeconds;
      
      // Check if it matches a preset option
      const selectElement = document.getElementById('samplingInterval');
      const matchingOption = Array.from(selectElement.options).find(
        option => parseInt(option.value) === intervalSeconds
      );
      
      if (matchingOption) {
        // Use preset
        selectElement.value = intervalSeconds;
        document.getElementById('customIntervalSection').style.display = 'none';
      } else {
        // Use custom interval
        selectElement.value = 'custom';
        document.getElementById('customIntervalSection').style.display = 'block';
        
        // Break down into hours, minutes, seconds
        const hours = Math.floor(intervalSeconds / 3600);
        const minutes = Math.floor((intervalSeconds % 3600) / 60);
        const seconds = intervalSeconds % 60;
        
        document.getElementById('customHours').value = hours;
        document.getElementById('customMinutes').value = minutes;
        document.getElementById('customSeconds').value = seconds;
      }
      
      updateIntervalPreview();
    }
  });
}

function loadNotificationSettings() {
  notificationsRef.once('value', (snapshot) => {
    const nd = snapshot.val();
    if (nd) {
      currentConfig.notifications = nd;
      document.getElementById('emailNotificationsToggle').checked  = nd.email          !== false;
      document.getElementById('pushNotificationsToggle').checked   = nd.push           !== false;
      document.getElementById('criticalAlertsToggle').checked      = nd.criticalAlerts !== false;
      document.getElementById('warningAlertsToggle').checked       = nd.warningAlerts  !== false;
      document.getElementById('systemAlertsToggle').checked        = nd.systemAlerts   !== false;
      document.getElementById('dailyReportToggle').checked         = nd.dailyReport    === true;
    }
  });
}

// ===================================
// FORM HANDLERS
// ===================================

function setupFormHandlers() {
  document.getElementById('wifiForm').addEventListener('submit', saveWiFiConfig);
}

// Save WiFi Configuration
function saveWiFiConfig(e) {
  e.preventDefault();

  const ssid     = document.getElementById('wifiSSID').value.trim();
  const password = document.getElementById('wifiPassword').value;

  if (!ssid) {
    showNotification('Please enter a WiFi network name', 'error');
    return;
  }

  showConfirmModal(
    'Save WiFi Settings?',
    'Are you sure you want to save these WiFi settings? The ESP32 will restart to connect to the new network.',
    () => {
      const wifiConfig = {
        ssid:      ssid,
        password:  password || '',
        updatedAt: firebase.database.ServerValue.TIMESTAMP
      };

      // Show "waiting for confirmation" state immediately
      setWifiStatusChecking('Saving… waiting for ESP32 to reconnect');

      systemRef.child('wifi').update(wifiConfig)
        .then(() => {
          showNotification('WiFi settings saved! Waiting for ESP32 to confirm connection…', 'info');
          document.getElementById('wifiPassword').value = '';

          // Start a timeout: if ESP32 doesn't confirm within the window, treat as failed
          startWifiConfirmTimeout(ssid);
        })
        .catch((error) => {
          showNotification('Error saving WiFi settings: ' + error.message, 'error');
          setWifiStatusDisconnected('Failed to save settings');
        });
    }
  );
}

// ===================================
// PASSWORD VISIBILITY TOGGLE
// ===================================

/**
 * Toggles the password field between plain-text and hidden,
 * and swaps the eye / eye-slash icon accordingly.
 */
function togglePasswordVisibility() {
  const input  = document.getElementById('wifiPassword');
  const icon   = document.getElementById('passwordToggleIcon');
  const btn    = document.getElementById('passwordToggleBtn');

  const isHidden = input.type === 'password';

  if (isHidden) {
    // Show password
    input.type = 'text';
    icon.classList.replace('fa-eye', 'fa-eye-slash');
    btn.setAttribute('aria-label', 'Hide password');
    btn.setAttribute('title', 'Hide password');
  } else {
    // Hide password
    input.type = 'password';
    icon.classList.replace('fa-eye-slash', 'fa-eye');
    btn.setAttribute('aria-label', 'Show password');
    btn.setAttribute('title', 'Show password');
  }

  // Keep focus on the input for accessibility
  input.focus();
}

// ===================================
// ESP32 WIFI CONNECTION STATUS
// ===================================

/**
 * Watches system/wifi/connected and system/wifi/ssid in Firebase.
 * The ESP32 firmware should write:
 *   system/wifi/connected = true | false
 *   system/wifi/ssid      = "<connected SSID>" | ""
 * whenever its connection state changes.
 */
function watchWifiConnectionStatus() {
  // Detach any previous listener first
  if (wifiStatusListener) {
    systemRef.child('wifi').off('value', wifiStatusListener);
  }

  wifiStatusListener = systemRef.child('wifi').on('value', (snapshot) => {
    const wifiData = snapshot.val();
    if (!wifiData) {
      setWifiStatusChecking('No WiFi data available');
      return;
    }

    const isConnected = wifiData.connected === true;
    const connectedSSID = wifiData.ssid || '';

    if (isConnected) {
      // Cancel any pending timeout — connection confirmed!
      clearWifiConfirmTimeout();
      setWifiStatusConnected(connectedSSID);
    } else {
      setWifiStatusDisconnected(
        connectedSSID
          ? `Failed to connect to "${connectedSSID}"`
          : 'ESP32 is not connected to WiFi'
      );
    }
  });
}

/**
 * Starts the "waiting for ESP32 connection confirmation" timer.
 * If the ESP32 doesn't report connected = true within the timeout,
 * we clear the stored credentials and show a failure message.
 */
function startWifiConfirmTimeout(attemptedSSID) {
  clearWifiConfirmTimeout(); // clear any existing timer

  wifiConfirmTimer = setTimeout(() => {
    // Check one more time before acting
    systemRef.child('wifi/connected').once('value', (snap) => {
      const confirmed = snap.val() === true;
      if (!confirmed) {
        handleWifiConnectionFailure(attemptedSSID);
      }
    });
  }, WIFI_CONFIRM_TIMEOUT_MS);
}

function clearWifiConfirmTimeout() {
  if (wifiConfirmTimer) {
    clearTimeout(wifiConfirmTimer);
    wifiConfirmTimer = null;
  }
}

/**
 * Called when the ESP32 fails (or times-out) to confirm WiFi connection.
 * Clears the SSID and password from Firebase and the form.
 */
function handleWifiConnectionFailure(attemptedSSID) {
  console.warn('WiFi connection failed for SSID:', attemptedSSID, '— clearing credentials.');

  // 1. Clear credentials in Firebase
  systemRef.child('wifi').update({
    ssid:      '',
    password:  '',
    updatedAt: firebase.database.ServerValue.TIMESTAMP
  }).catch(err => console.error('Error clearing WiFi credentials:', err));

  // 2. Clear the form fields
  document.getElementById('wifiSSID').value     = '';
  document.getElementById('wifiPassword').value = '';

  // 3. Update status banner
  setWifiStatusDisconnected(`Could not connect to "${attemptedSSID}" — credentials cleared`);

  // 4. Show error message
  showNotification(
    `ESP32 failed to connect to "${attemptedSSID}". The SSID and password have been cleared. Please check your credentials and try again.`,
    'error'
  );
}

// ── Banner state helpers ──────────────────────────────────────────────────────

function setWifiStatusChecking(message) {
  const banner = document.getElementById('wifiConnectionStatus');
  const dot    = document.getElementById('wifiStatusDot');
  const label  = document.getElementById('wifiStatusLabel');
  const ssidEl = document.getElementById('wifiStatusSSID');
  const badge  = document.getElementById('wifiStatusBadge');
  const icon   = document.getElementById('wifiStatusIcon');
  const text   = document.getElementById('wifiStatusText');

  banner.className = 'wifi-connection-status checking';
  dot.style.background = '';   // reset to default CSS colour
  label.textContent   = message || 'Checking connection…';
  ssidEl.textContent  = '';
  badge.className     = 'wifi-status-badge';
  icon.className      = 'fas fa-circle-notch fa-spin';
  text.textContent    = 'Checking';
}

function setWifiStatusConnected(ssid) {
  const banner = document.getElementById('wifiConnectionStatus');
  const label  = document.getElementById('wifiStatusLabel');
  const ssidEl = document.getElementById('wifiStatusSSID');
  const badge  = document.getElementById('wifiStatusBadge');
  const icon   = document.getElementById('wifiStatusIcon');
  const text   = document.getElementById('wifiStatusText');

  banner.className     = 'wifi-connection-status connected';
  label.textContent    = 'ESP32 is connected to WiFi';
  ssidEl.textContent   = ssid ? `Network: ${ssid}` : '';
  badge.className      = 'wifi-status-badge';
  icon.className       = 'fas fa-check-circle';
  text.textContent     = 'Connected';
}

function setWifiStatusDisconnected(reason) {
  const banner = document.getElementById('wifiConnectionStatus');
  const label  = document.getElementById('wifiStatusLabel');
  const ssidEl = document.getElementById('wifiStatusSSID');
  const badge  = document.getElementById('wifiStatusBadge');
  const icon   = document.getElementById('wifiStatusIcon');
  const text   = document.getElementById('wifiStatusText');

  banner.className     = 'wifi-connection-status disconnected';
  label.textContent    = reason || 'ESP32 is not connected to WiFi';
  ssidEl.textContent   = '';
  badge.className      = 'wifi-status-badge';
  icon.className       = 'fas fa-times-circle';
  text.textContent     = 'Disconnected';
}

// ===================================
// MODAL & NOTIFICATION FUNCTIONS
// ===================================

/**
 * Show confirmation modal
 * @param {string} title - Modal title
 * @param {string} message - Modal message
 * @param {function} onConfirm - Callback function when confirmed
 */
function showConfirmModal(title, message, onConfirm) {
  const modal = document.getElementById('confirmModal');
  const modalTitle = document.getElementById('confirmModalTitle');
  const modalMessage = document.getElementById('confirmModalMessage');
  const cancelBtn = document.getElementById('confirmModalCancelBtn');
  const confirmBtn = document.getElementById('confirmModalConfirmBtn');
  
  if (!modal) return;
  
  // Set content
  modalTitle.textContent = title;
  modalMessage.innerHTML = message;
  
  // Show modal
  modal.classList.add('show');
  modal.style.display = 'flex';
  
  // Remove old listeners by cloning buttons
  const newCancelBtn = cancelBtn.cloneNode(true);
  const newConfirmBtn = confirmBtn.cloneNode(true);
  cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
  confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
  
  // Cancel handler
  newCancelBtn.addEventListener('click', () => {
    modal.classList.remove('show');
    setTimeout(() => modal.style.display = 'none', 150);
  });
  
  // Click outside to cancel
  const clickOutsideHandler = (e) => {
    if (e.target === modal) {
      modal.classList.remove('show');
      setTimeout(() => modal.style.display = 'none', 150);
      modal.removeEventListener('click', clickOutsideHandler);
    }
  };
  modal.addEventListener('click', clickOutsideHandler);
  
  // Confirm handler
  newConfirmBtn.addEventListener('click', async () => {
    modal.classList.remove('show');
    setTimeout(() => modal.style.display = 'none', 150);
    modal.removeEventListener('click', clickOutsideHandler);
    await onConfirm();
  });
}

/**
 * Show notification (success, error, info)
 * @param {string} message - Notification message
 * @param {string} type - Notification type: 'success', 'error', 'info'
 */
function showNotification(message, type = 'success') {
  const notification = document.getElementById('statusNotification');
  const icon = document.getElementById('statusNotificationIcon');
  const text = document.getElementById('statusNotificationText');
  
  if (!notification || !icon || !text) return;
  
  // Set icon based on type
  const iconClass = type === 'success' ? 'fa-check-circle'
                  : type === 'error'   ? 'fa-exclamation-circle'
                  : 'fa-info-circle';
  
  icon.className = `fas ${iconClass}`;
  
  // Set notification type class
  notification.className = `status-notification ${type}`;
  
  // Set message
  text.textContent = message;
  
  // Show notification
  notification.style.display = 'flex';
  setTimeout(() => notification.classList.add('show'), 10);
  
  // Hide after 5 seconds
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.style.display = 'none', 300);
  }, 5000);
}

// ===================================
// SAVE / RESET FUNCTIONS
// ===================================

function saveThresholds() {
  console.log('saveThresholds() called');
  console.log('thresholdsRef:', thresholdsRef);
  
  const thresholds = {};

  // Validate all thresholds first
  for (const sensor of Object.keys(defaultThresholds)) {
    const safeMinEl = document.getElementById(`${sensor}_safeMin`);
    const safeMaxEl = document.getElementById(`${sensor}_safeMax`);
    const warnMinEl = document.getElementById(`${sensor}_warnMin`);
    const warnMaxEl = document.getElementById(`${sensor}_warnMax`);
    
    console.log(`Reading ${sensor} inputs:`, {
      safeMin: safeMinEl ? safeMinEl.value : 'NOT FOUND',
      safeMax: safeMaxEl ? safeMaxEl.value : 'NOT FOUND',
      warnMin: warnMinEl ? warnMinEl.value : 'NOT FOUND',
      warnMax: warnMaxEl ? warnMaxEl.value : 'NOT FOUND'
    });
    
    if (!safeMinEl || !safeMaxEl || !warnMinEl || !warnMaxEl) {
      showNotification(`Error: Could not find input fields for ${sensor}`, 'error');
      console.error(`Missing input elements for sensor: ${sensor}`);
      return;
    }

    const safeMin = parseFloat(safeMinEl.value);
    const safeMax = parseFloat(safeMaxEl.value);
    const warnMin = parseFloat(warnMinEl.value);
    const warnMax = parseFloat(warnMaxEl.value);

    // Validation
    if (isNaN(safeMin) || isNaN(safeMax) || isNaN(warnMin) || isNaN(warnMax)) {
      showNotification(`Invalid ${sensor} thresholds: All values must be numbers`, 'error');
      console.error(`NaN values for ${sensor}:`, { safeMin, safeMax, warnMin, warnMax });
      return;
    }

    if (safeMin >= safeMax) {
      showNotification(`Invalid ${sensor} thresholds: Safe Min (${safeMin}) must be less than Safe Max (${safeMax})`, 'error');
      return;
    }
    if (warnMin >= warnMax) {
      showNotification(`Invalid ${sensor} thresholds: Warning Min (${warnMin}) must be less than Warning Max (${warnMax})`, 'error');
      return;
    }

    thresholds[sensor] = { 
      safeMin: safeMin, 
      safeMax: safeMax, 
      warnMin: warnMin, 
      warnMax: warnMax 
    };
  }

  console.log('All thresholds validated successfully:', thresholds);

  showConfirmModal(
    'Save Sensor Thresholds?',
    'Are you sure you want to save all sensor threshold changes?',
    () => {
      console.log('Attempting to save to Firebase...');
      
      // Use update instead of set to preserve any other data and ensure proper write
      thresholdsRef.update(thresholds)
        .then(() => {
          showNotification('All sensor thresholds saved successfully!', 'success');
          console.log('✓ Thresholds saved to Firebase successfully:', thresholds);
        })
        .catch(err => {
          showNotification('Error saving thresholds: ' + err.message, 'error');
          console.error('✗ Error saving thresholds to Firebase:', err);
          console.error('Error details:', {
            code: err.code,
            message: err.message,
            stack: err.stack
          });
        });
    }
  );
}

function resetThresholds() {
  showConfirmModal(
    'Reset to Default Values?',
    'Are you sure you want to reset all thresholds to default values?',
    () => {
      Object.keys(defaultThresholds).forEach(sensor => {
        const d = defaultThresholds[sensor];
        document.getElementById(`${sensor}_safeMin`).value = d.safeMin;
        document.getElementById(`${sensor}_safeMax`).value = d.safeMax;
        document.getElementById(`${sensor}_warnMin`).value = d.warnMin;
        document.getElementById(`${sensor}_warnMax`).value = d.warnMax;
      });

      showNotification('Thresholds reset to default values. Click "Save" to apply.', 'info');
    }
  );
}

function saveNotificationSettings() {
  const notificationConfig = {
    email:          document.getElementById('emailNotificationsToggle').checked,
    push:           document.getElementById('pushNotificationsToggle').checked,
    criticalAlerts: document.getElementById('criticalAlertsToggle').checked,
    warningAlerts:  document.getElementById('warningAlertsToggle').checked,
    systemAlerts:   document.getElementById('systemAlertsToggle').checked,
    dailyReport:    document.getElementById('dailyReportToggle').checked,
    updatedAt:      firebase.database.ServerValue.TIMESTAMP
  };

  showConfirmModal(
    'Save Notification Settings?',
    'Are you sure you want to save the notification settings?',
    () => {
      notificationsRef.set(notificationConfig)
        .then(() => {
          currentConfig.notifications = notificationConfig;
          showNotification('Notification settings saved successfully!', 'success');
        })
        .catch(err => showNotification('Error saving notification settings: ' + err.message, 'error'));
    }
  );
}

function toggleAeratorMode(saveToFirebase) {
  const autoToggle   = document.getElementById('aeratorAutoToggle');
  const autoSettings = document.getElementById('aeratorAutoSettings');
  const modeLabel    = document.getElementById('aeratorModeLabel');
  const modeDesc     = document.getElementById('aeratorModeDescription');

  const isAutoMode = autoToggle.checked;

  if (isAutoMode) {
    autoSettings.style.display = 'block';
    modeLabel.textContent = 'Automatic Mode';
    modeDesc.textContent  = 'Aerator is controlled automatically based on DO levels and schedule';
  } else {
    autoSettings.style.display = 'none';
    modeLabel.textContent = 'Manual Mode';
    modeDesc.textContent  = 'Aerator is controlled manually from the dashboard';
  }

  // Only save to Firebase if explicitly requested (saveToFirebase === true)
  if (saveToFirebase === true) {
    systemRef.child('aerator/autoMode').set(isAutoMode)
      .then(() => {
        currentConfig.aerator.autoMode = isAutoMode;
        showNotification(
          `Aerator mode changed to ${isAutoMode ? 'Automatic' : 'Manual'}`,
          'success'
        );
      })
      .catch(err => {
        showNotification('Error saving aerator mode: ' + err.message, 'error');
        // Revert the toggle if save failed
        autoToggle.checked = !isAutoMode;
      });
  }
}

function saveAeratorConfig() {
  const autoMode         = document.getElementById('aeratorAutoToggle').checked;
  const doThreshold      = parseFloat(document.getElementById('aeratorDOThreshold').value);
  const doStopThreshold  = parseFloat(document.getElementById('aeratorDOStopThreshold').value);

  if (autoMode && doThreshold >= doStopThreshold) {
    showNotification('Stop threshold must be higher than start threshold', 'error');
    return;
  }

  const schedules = [];
  document.querySelectorAll('.schedule-item').forEach(item => {
    const startTime = item.querySelector('.schedule-start').value;
    const stopTime  = item.querySelector('.schedule-stop').value;
    if (startTime && stopTime) schedules.push({ startTime, stopTime });
  });

  showConfirmModal(
    'Save Aerator Configuration?',
    'Are you sure you want to save the aerator configuration changes?',
    () => {
      const aeratorConfig = {
        autoMode,
        doThreshold,
        doStopThreshold,
        schedules,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
      };

      systemRef.child('aerator').set(aeratorConfig)
        .then(() => {
          currentConfig.aerator = aeratorConfig;
          showNotification('Aerator configuration saved successfully!', 'success');
        })
        .catch(err => showNotification('Error saving aerator configuration: ' + err.message, 'error'));
    }
  );
}

function addSchedule(startTime = '06:00', stopTime = '18:00') {
  scheduleCounter++;
  const container   = document.getElementById('scheduleContainer');
  const scheduleDiv = document.createElement('div');
  scheduleDiv.className = 'schedule-item';
  scheduleDiv.id = `schedule-${scheduleCounter}`;

  scheduleDiv.innerHTML = `
    <div class="schedule-item-header">Schedule #${scheduleCounter}</div>
    <div style="display:flex;gap:12px;align-items:flex-end;width:100%;">
      <div class="form-group" style="flex:1;margin:0;">
        <label>Start Time</label>
        <input type="time" class="schedule-start" value="${startTime}">
      </div>
      <div class="form-group" style="flex:1;margin:0;">
        <label>Stop Time</label>
        <input type="time" class="schedule-stop" value="${stopTime}">
      </div>
      <button type="button" class="btn-remove" onclick="removeSchedule(${scheduleCounter})">
        <i class="fas fa-trash"></i>
      </button>
    </div>
  `;

  container.appendChild(scheduleDiv);
}

function removeSchedule(id) {
  const el = document.getElementById(`schedule-${id}`);
  if (el) el.remove();
}

function saveSamplingInterval() {
  let intervalSeconds;
  
  const selectedValue = document.getElementById('samplingInterval').value;
  
  if (selectedValue === 'custom') {
    // Get custom interval values
    const hours = parseInt(document.getElementById('customHours').value) || 0;
    const minutes = parseInt(document.getElementById('customMinutes').value) || 0;
    const seconds = parseInt(document.getElementById('customSeconds').value) || 0;
    
    intervalSeconds = (hours * 3600) + (minutes * 60) + seconds;
    
    // Validation - changed minimum from 60 to 1 second
    if (intervalSeconds < 1) {
      showNotification('Sampling interval must be at least 1 second', 'error');
      return;
    }
    
    if (intervalSeconds > 86400) {
      showNotification('Sampling interval cannot exceed 24 hours', 'error');
      return;
    }
  } else {
    intervalSeconds = parseInt(selectedValue);
  }

  showConfirmModal(
    'Save Sampling Interval?',
    'Are you sure you want to save the sampling interval changes?',
    () => {
      // Convert seconds to milliseconds for Firebase
      const intervalMilliseconds = intervalSeconds * 1000;

      const samplingConfig = {
        interval: intervalMilliseconds,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
      };

      systemRef.child('sampling').set(samplingConfig)
        .then(() => {
          currentConfig.sampling.interval = intervalSeconds;
          showNotification('Sampling interval saved successfully!', 'success');
          updateIntervalPreview();
        })
        .catch(err => showNotification('Error saving sampling interval: ' + err.message, 'error'));
    }
  );
}

function updateIntervalPreview() {
  const selectedValue = document.getElementById('samplingInterval').value;
  const preview = document.getElementById('samplingIntervalPreview');
  
  let intervalSeconds;
  
  if (selectedValue === 'custom') {
    const hours = parseInt(document.getElementById('customHours').value) || 0;
    const minutes = parseInt(document.getElementById('customMinutes').value) || 0;
    const seconds = parseInt(document.getElementById('customSeconds').value) || 0;
    
    intervalSeconds = (hours * 3600) + (minutes * 60) + seconds;
  } else {
    intervalSeconds = parseInt(selectedValue);
  }
  
  // Build human-readable time string
  const hours = Math.floor(intervalSeconds / 3600);
  const minutes = Math.floor((intervalSeconds % 3600) / 60);
  const seconds = intervalSeconds % 60;
  
  let timeText = '';
  
  if (hours > 0) {
    timeText += hours + ' hour' + (hours > 1 ? 's' : '');
  }
  if (minutes > 0) {
    if (timeText) timeText += ', ';
    timeText += minutes + ' minute' + (minutes > 1 ? 's' : '');
  }
  if (seconds > 0 || !timeText) {
    if (timeText) timeText += ', ';
    timeText += seconds + ' second' + (seconds > 1 ? 's' : '');
  }

  preview.textContent = `Data will be recorded every ${timeText}`;
}

function toggleCustomInterval() {
  const selectedValue = document.getElementById('samplingInterval').value;
  const customSection = document.getElementById('customIntervalSection');
  
  if (selectedValue === 'custom') {
    customSection.style.display = 'block';
  } else {
    customSection.style.display = 'none';
  }
  
  updateIntervalPreview();
}

// ===================================
// REAL-TIME UPDATES
// ===================================

function listenForUpdates() {
  systemRef.on('value', () => {
    console.log('System configuration updated');
  });
}

// ===================================
// UTILITY FUNCTIONS
// ===================================

function formatTimestamp(timestamp) {
  if (!timestamp) return '--';
  const date     = new Date(timestamp);
  const diffMs   = Date.now() - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays  = Math.floor(diffMs / 86400000);

  if (diffMins  < 1)  return 'Just now';
  if (diffMins  < 60) return `${diffMins} min${diffMins  > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays  < 7)  return `${diffDays} day${diffDays  > 1 ? 's' : ''} ago`;
  return date.toLocaleString();
}

console.log('System Configuration script loaded successfully');

// ===================================
// DEBUG / TEST FUNCTIONS
// ===================================

/**
 * Test function to verify Firebase write access
 * Call this from browser console: testFirebaseWrite()
 */
function testFirebaseWrite() {
  console.log('Testing Firebase write access...');
  
  const testData = {
    testWrite: true,
    timestamp: firebase.database.ServerValue.TIMESTAMP
  };
  
  thresholdsRef.child('_test').set(testData)
    .then(() => {
      console.log('✓ Firebase write test SUCCESSFUL');
      console.log('Test data written to: thresholds/_test');
      return thresholdsRef.child('_test').remove();
    })
    .then(() => {
      console.log('✓ Test data cleaned up');
    })
    .catch(err => {
      console.error('✗ Firebase write test FAILED:', err);
      console.error('Error details:', {
        code: err.code,
        message: err.message
      });
    });
}

/**
 * Debug function to display current threshold input values
 * Call this from browser console: debugThresholdInputs()
 */
function debugThresholdInputs() {
  console.log('=== Current Threshold Input Values ===');
  Object.keys(defaultThresholds).forEach(sensor => {
    const safeMin = document.getElementById(`${sensor}_safeMin`);
    const safeMax = document.getElementById(`${sensor}_safeMax`);
    const warnMin = document.getElementById(`${sensor}_warnMin`);
    const warnMax = document.getElementById(`${sensor}_warnMax`);
    
    console.log(`${sensor}:`, {
      safeMin: safeMin ? safeMin.value : 'ELEMENT NOT FOUND',
      safeMax: safeMax ? safeMax.value : 'ELEMENT NOT FOUND',
      warnMin: warnMin ? warnMin.value : 'ELEMENT NOT FOUND',
      warnMax: warnMax ? warnMax.value : 'ELEMENT NOT FOUND'
    });
  });
}

// Make test functions globally accessible
window.testFirebaseWrite = testFirebaseWrite;
window.debugThresholdInputs = debugThresholdInputs;