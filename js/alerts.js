// ========================================
// ALERTS PAGE JAVASCRIPT - NATIVE NOTIFICATIONS ONLY
// ========================================

// ── Global State ─────────────────────────────────────────────────────────────
let activeAlerts = [];
let historyAlerts = [];
let currentTab = 'active';
let thresholds = {};
let alertsListenersSetup = false;

// Notification state
let notifBadgeCount = 0;
let notifPermissionGranted = (Notification.permission === 'granted');

// ── Detect base path (localhost vs GitHub Pages) ──────────────────────────────
const BASE_PATH = (function () {
  const parts = window.location.pathname.split('/');
  if (window.location.hostname.endsWith('github.io') && parts[1]) {
    return '/' + parts[1]; // e.g. "/emailba"
  }
  return ''; // localhost or custom domain
})();

const SW_URL     = BASE_PATH + '/firebase-messaging-sw.js';
const ALERTS_URL = BASE_PATH + '/html/alerts.html';

console.log('[Alerts] BASE_PATH:', BASE_PATH);
console.log('[Alerts] SW_URL:', SW_URL);


// ════════════════════════════════════════════════════════════════════
//  SECTION 1 — NOTIFICATION SYSTEM (native only, no toasts)
// ════════════════════════════════════════════════════════════════════

// ── 1A. Entry point ───────────────────────────────────────────────────────────
function initPushNotifications() {
  if (!('Notification' in window)) {
    console.warn('[Notif] Notifications not supported.');
    return;
  }
  if (!('serviceWorker' in navigator)) {
    console.warn('[Notif] Service Workers not supported.');
    return;
  }

  console.log('[Notif] Permission status:', Notification.permission);

  if (Notification.permission === 'granted') {
    notifPermissionGranted = true;
    registerServiceWorker();
  } else if (Notification.permission === 'default') {
    showNotifPermissionBanner();
  } else {
    console.warn('[Notif] Permission denied. User must reset in browser settings.');
  }
}

// ── 1B. Register Service Worker ───────────────────────────────────────────────
async function registerServiceWorker() {
  try {
    // Register the SW file
    await navigator.serviceWorker.register(SW_URL, {
      scope: BASE_PATH + '/'
    });

    // Use .ready instead of .register() result — guarantees SW is fully active
    // This is why showNotification() works reliably
    console.log('[Notif] Waiting for SW to be ready...');
    const reg = await navigator.serviceWorker.ready;
    console.log('[Notif] SW ready. Scope:', reg.scope);

  } catch (err) {
    console.error('[Notif] SW registration FAILED:', err.message);
  }
}

// ── 1C. Permission request ────────────────────────────────────────────────────
async function requestNotifPermission() {
  try {
    const permission = await Notification.requestPermission();
    console.log('[Notif] User chose:', permission);

    if (permission === 'granted') {
      notifPermissionGranted = true;
      removeNotifPermissionBanner();
      await registerServiceWorker();
    } else {
      removeNotifPermissionBanner();
    }
  } catch (err) {
    console.error('[Notif] requestPermission error:', err);
  }
}

// ── 1D. Main trigger ──────────────────────────────────────────────────────────
function triggerAlertNotification(alert) {
  const title = alert.severity === 'critical'
    ? `🚨 CRITICAL: ${(alert.parameter || 'Parameter').toUpperCase()} Alert`
    : `⚠️ WARNING: ${(alert.parameter || 'Parameter').toUpperCase()} Alert`;

  const body = alert.message
    || `${alert.parameter} is out of range. Value: ${alert.value} ${getParameterUnit(alert.parameter)}`;

  showNativeNotification(title, body, alert.severity, alert.parameter);
  incrementNotifBadge();
}

// ── 1E. Native browser notification ──────────────────────────────────────────
async function showNativeNotification(title, body, severity, parameter) {
  if (!notifPermissionGranted) return;

  try {
    // navigator.serviceWorker.ready waits until SW is fully active — never null
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification(title, {
      body,
      tag:                `bangus-alert-${parameter}`,
      renotify:           true,
      requireInteraction: severity === 'critical' // critical stays until dismissed
    });
    console.log('[Notif] Native notification sent:', title);
  } catch (err) {
    console.error('[Notif] SW notification failed, using fallback:', err);
    // Fallback: plain Notification API (no SW)
    try {
      new Notification(title, { body });
    } catch (e) {
      console.error('[Notif] Fallback also failed:', e);
    }
  }
}

// ── 1F. Permission banner ─────────────────────────────────────────────────────
function showNotifPermissionBanner() {
  if (document.getElementById('notifPermBanner')) return;

  const banner = document.createElement('div');
  banner.id = 'notifPermBanner';
  banner.className = 'notif-perm-banner';
  banner.innerHTML = `
    <div class="notif-perm-banner__content">
      <i class="fas fa-bell notif-perm-banner__icon"></i>
      <div class="notif-perm-banner__text">
        <strong>Enable Notifications</strong>
        <span>Get real-time alerts when water quality parameters go out of range.</span>
      </div>
      <div class="notif-perm-banner__actions">
        <button class="notif-perm-banner__allow" onclick="requestNotifPermission()">Enable</button>
        <button class="notif-perm-banner__deny"  onclick="removeNotifPermissionBanner()">Not Now</button>
      </div>
    </div>
  `;

  document.body.insertBefore(banner, document.body.firstChild);
  console.log('[Notif] Permission banner shown.');
}

function removeNotifPermissionBanner() {
  const banner = document.getElementById('notifPermBanner');
  if (!banner) return;
  banner.style.transition = 'opacity 0.3s ease';
  banner.style.opacity = '0';
  setTimeout(() => banner.remove(), 300);
}

// ── 1G. Bell badge ────────────────────────────────────────────────────────────
function incrementNotifBadge() {
  notifBadgeCount++;
  renderNotifBadge();
}

function resetNotifBadge() {
  notifBadgeCount = 0;
  renderNotifBadge();
}

function renderNotifBadge() {
  const badge = document.getElementById('notifBadge');
  if (!badge) return;
  if (notifBadgeCount > 0) {
    badge.textContent = notifBadgeCount > 99 ? '99+' : notifBadgeCount;
    badge.style.display = 'flex';
    badge.classList.remove('notif-badge--pulse');
    void badge.offsetWidth;
    badge.classList.add('notif-badge--pulse');
  } else {
    badge.style.display = 'none';
  }
}


// ════════════════════════════════════════════════════════════════════
//  SECTION 2 — PAGE INITIALIZATION
// ════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', function () {
  initPushNotifications();
  resetNotifBadge();
  initializeAlertsPage();
  setupDateFilters();
});

function initializeAlertsPage() {
  if (typeof firebase === 'undefined' || !firebase.database) {
    console.error('[Alerts] Firebase not available.');
    showFirebaseError();
    return;
  }

  loadThresholds()
    .then(() => {
      loadActiveAlerts();
      loadHistoryAlerts();
      setupRealtimeAlertListeners();
    })
    .catch(err => {
      console.error('[Alerts] Failed to load thresholds:', err);
      showFirebaseError();
    });
}

function showFirebaseError() {
  const msg = `
    <div class="no-alerts">
      <i class="fas fa-exclamation-triangle" style="color:#e74c3c;"></i>
      <p>Firebase Connection Required</p>
      <span>Please ensure Firebase is properly configured and connected</span>
    </div>`;
  const al = document.getElementById('activeAlertsList');
  const hl = document.getElementById('historyAlertsList');
  if (al) al.innerHTML = msg;
  if (hl) hl.innerHTML = msg;
}


// ════════════════════════════════════════════════════════════════════
//  SECTION 3 — FIREBASE DATA LOADING
// ════════════════════════════════════════════════════════════════════

function loadThresholds() {
  return new Promise((resolve, reject) => {
    firebase.database().ref('thresholds').once('value')
      .then(snap => {
        if (snap.exists()) { thresholds = snap.val(); resolve(); }
        else reject('No thresholds configured');
      })
      .catch(reject);
  });
}

function loadActiveAlerts() {
  if (alertsListenersSetup) return;
  alertsListenersSetup = true;

  const alertsRef = firebase.database().ref('alerts/active');
  setupActiveAlertsListeners();

  alertsRef.once('value', snap => {
    const list = document.getElementById('activeAlertsList');
    if (!list) return;

    activeAlerts = [];
    if (snap.exists()) {
      snap.forEach(child => activeAlerts.push({ id: child.key, ...child.val() }));
    }

    if (activeAlerts.length > 0) {
      list.innerHTML = activeAlerts.map(a => createAlertCard(a, true)).join('');
      const btn = document.getElementById('acknowledgeAllBtn');
      if (btn) btn.disabled = false;
    } else {
      list.innerHTML = emptyActiveHTML();
    }

    updateActiveAlertsCount();
  });
}

function setupActiveAlertsListeners() {
  const alertsRef = firebase.database().ref('alerts/active');
  let initialLoadDone = false;

  alertsRef.on('child_added', snap => {
    if (!initialLoadDone) return;

    const alert = { id: snap.key, ...snap.val() };
    if (!activeAlerts.find(a => a.id === alert.id)) {
      activeAlerts.push(alert);
      addAlertCard(alert);
      updateActiveAlertsCount();

      // ── FIRE NATIVE NOTIFICATION ───────────────────────────────
      triggerAlertNotification(alert);
    }
  });

  alertsRef.on('child_changed', snap => {
    const updated = { id: snap.key, ...snap.val() };
    const idx = activeAlerts.findIndex(a => a.id === updated.id);
    if (idx !== -1) { activeAlerts[idx] = updated; updateAlertCard(updated); }
  });

  alertsRef.on('child_removed', snap => {
    activeAlerts = activeAlerts.filter(a => a.id !== snap.key);
    removeAlertCard(snap.key);
    updateActiveAlertsCount();
  });

  setTimeout(() => {
    initialLoadDone = true;
    console.log('[Alerts] Real-time listener active.');
  }, 1000);
}

function loadHistoryAlerts() {
  firebase.database().ref('alerts/history')
    .orderByChild('timestamp')
    .limitToLast(100)
    .on('value', snap => {
      historyAlerts = [];
      if (snap.exists()) {
        snap.forEach(child => historyAlerts.push({ id: child.key, ...child.val() }));
        historyAlerts.sort((a, b) => b.timestamp - a.timestamp);
      }
      displayHistoryAlerts();
    }, err => console.error('[Alerts] History error:', err));
}


// ════════════════════════════════════════════════════════════════════
//  SECTION 4 — DOM MANIPULATION
// ════════════════════════════════════════════════════════════════════

function switchTab(tabName) {
  currentTab = tabName;
  document.querySelectorAll('.alerts-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  const activeTab  = document.getElementById('activeTab');
  const historyTab = document.getElementById('alertsHistoryTab');

  if (tabName === 'active') {
    if (activeTab)  { activeTab.classList.add('active');     activeTab.style.display = 'block'; }
    if (historyTab) { historyTab.classList.remove('active'); historyTab.style.display = 'none'; }
  } else {
    if (activeTab)  { activeTab.classList.remove('active');  activeTab.style.display = 'none'; }
    if (historyTab) { historyTab.classList.add('active');    historyTab.style.display = 'block'; }
    displayHistoryAlerts();
  }
}

function addAlertCard(alert) {
  const list = document.getElementById('activeAlertsList');
  if (!list) return;

  const noAlerts = list.querySelector('.no-alerts');
  if (noAlerts) noAlerts.remove();

  const tmp = document.createElement('div');
  tmp.innerHTML = createAlertCard(alert, true);
  const card = tmp.firstElementChild;

  card.style.opacity = '0';
  card.style.transform = 'translateY(-10px)';
  list.insertBefore(card, list.firstChild);

  setTimeout(() => {
    card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    card.style.opacity = '1';
    card.style.transform = 'translateY(0)';
  }, 10);

  const btn = document.getElementById('acknowledgeAllBtn');
  if (btn) btn.disabled = false;
}

function updateAlertCard(alert) {
  const card = document.querySelector(`[data-alert-id="${alert.id}"]`);
  if (!card) return;

  const severity = alert.severity || 'warning';
  const unit     = getParameterUnit(alert.parameter);

  const old = card.className.match(/alert-card (warning|critical)/)?.[1];
  if (old && old !== severity) {
    card.classList.remove(old); card.classList.add(severity);
    card.style.animation = 'pulse 0.5s ease-in-out';
    setTimeout(() => { card.style.animation = ''; }, 500);
  }

  const badge = card.querySelector('.alert-severity-badge');
  if (badge) { badge.className = `alert-severity-badge ${severity}`; badge.textContent = severity; }

  const vals = card.querySelectorAll('.alert-info-value');
  if (vals[0]) {
    vals[0].className = `alert-info-value ${severity}-value`;
    vals[0].style.backgroundColor = 'rgba(14,165,233,0.2)';
    vals[0].textContent = `${alert.value || '--'} ${unit}`;
    setTimeout(() => { vals[0].style.backgroundColor = ''; }, 300);
  }
  if (vals[1]) vals[1].textContent = `${alert.threshold || '--'} ${unit}`;
  if (vals[2]) vals[2].textContent = severity.charAt(0).toUpperCase() + severity.slice(1);

  const ts = card.querySelector('.alert-timestamp');
  if (ts) ts.innerHTML = `<i class="fas fa-clock"></i> ${formatTimestamp(alert.timestamp)}`;

  const msg = card.querySelector('.alert-title');
  if (msg && alert.message) msg.textContent = alert.message;
}

function removeAlertCard(alertId) {
  const card = document.querySelector(`[data-alert-id="${alertId}"]`);
  if (!card) return;

  card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
  card.style.opacity = '0';
  card.style.transform = 'translateX(20px)';

  setTimeout(() => {
    card.remove();
    const list = document.getElementById('activeAlertsList');
    if (list && activeAlerts.length === 0) {
      list.innerHTML = emptyActiveHTML();
      const btn = document.getElementById('acknowledgeAllBtn');
      if (btn) btn.disabled = true;
    }
  }, 300);
}

function updateActiveAlertsCount() {
  const count = activeAlerts.length;
  const badge = document.getElementById('activeAlertsCount');
  if (badge) {
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline-block' : 'none';
  }
}

function displayHistoryAlerts() {
  const list = document.getElementById('historyAlertsList');
  if (!list) return;
  const filtered = filterHistoryAlerts();
  list.innerHTML = filtered.length > 0
    ? filtered.map(a => createAlertCard(a, false)).join('')
    : `<div class="no-alerts">
         <i class="fas fa-inbox"></i>
         <p>No alert history available</p>
         <span>Past alerts will appear here once acknowledged or resolved</span>
       </div>`;
}

function displayActiveAlerts() {
  const list = document.getElementById('activeAlertsList');
  if (!list) return;
  const filtered = filterActiveAlerts();
  const btn = document.getElementById('acknowledgeAllBtn');

  if (filtered.length === 0) {
    list.innerHTML = emptyActiveHTML();
    if (btn) btn.disabled = true;
    return;
  }
  if (btn) btn.disabled = false;
  list.innerHTML = filtered.map(a => createAlertCard(a, true)).join('');
}


// ════════════════════════════════════════════════════════════════════
//  SECTION 5 — CARD TEMPLATE
// ════════════════════════════════════════════════════════════════════

function createAlertCard(alert, isActive) {
  const severity  = alert.severity  || 'warning';
  const parameter = alert.parameter || 'Unknown';
  const value     = alert.value     || '--';
  const threshold = alert.threshold || '--';
  const unit      = getParameterUnit(parameter);

  let statusBadge = '';
  if (!isActive) {
    if      (alert.dismissed)    statusBadge = '<span class="alert-severity-badge dismissed">Dismissed</span>';
    else if (alert.acknowledged) statusBadge = '<span class="alert-severity-badge resolved">Acknowledged</span>';
    else if (alert.autoResolved) statusBadge = '<span class="alert-severity-badge auto-resolved">Auto-Resolved</span>';
  } else {
    statusBadge = `<span class="alert-severity-badge ${severity}">${severity}</span>`;
  }

  let actions = '';
  if (isActive) {
    actions = `
      <div class="alert-actions">
        <button class="alert-btn alert-btn-acknowledge" onclick="acknowledgeAlert('${alert.id}')">
          <i class="fas fa-check"></i> Acknowledge
        </button>
        <button class="alert-btn alert-btn-dismiss" onclick="dismissAlert('${alert.id}')">
          <i class="fas fa-times"></i> Dismiss
        </button>
      </div>`;
  } else if (alert.dismissed) {
    actions = `<div class="alert-acknowledged dismissed">
      <i class="fas fa-times-circle"></i> Dismissed on ${formatTimestamp(alert.dismissedAt)}
    </div>`;
  } else if (alert.acknowledged) {
    actions = `<div class="alert-acknowledged">
      <i class="fas fa-check-circle"></i> Acknowledged on ${formatTimestamp(alert.acknowledgedAt)}
    </div>`;
  } else if (alert.autoResolved) {
    actions = `<div class="alert-acknowledged auto-resolved">
      <i class="fas fa-magic"></i> Auto-resolved on ${formatTimestamp(alert.acknowledgedAt)}
      <span class="auto-resolve-note">${alert.resolvedMessage || 'Parameter returned to normal'}</span>
    </div>`;
  }

  const cardClass = !isActive && (alert.acknowledged || alert.dismissed || alert.autoResolved)
    ? 'resolved' : severity;

  return `
    <div class="alert-card ${cardClass}" data-alert-id="${alert.id}">
      <div class="alert-header">
        <div class="alert-title-group">
          <div class="alert-icon"><i class="${getParameterIcon(parameter)}"></i></div>
          <div class="alert-title-text">
            <h3 class="alert-title">${alert.message || `${parameter} ${severity.toUpperCase()}`}</h3>
            <p class="alert-parameter">${parameter.toUpperCase()}</p>
          </div>
        </div>
        ${statusBadge}
      </div>
      <div class="alert-body">
        <div class="alert-info-item">
          <span class="alert-info-label">Current Value</span>
          <span class="alert-info-value ${severity}-value">${value} ${unit}</span>
        </div>
        <div class="alert-info-item">
          <span class="alert-info-label">Threshold</span>
          <span class="alert-info-value">${threshold} ${unit}</span>
        </div>
        <div class="alert-info-item">
          <span class="alert-info-label">Severity</span>
          <span class="alert-info-value">${severity.charAt(0).toUpperCase() + severity.slice(1)}</span>
        </div>
      </div>
      <div class="alert-footer">
        <div class="alert-timestamp"><i class="fas fa-clock"></i> ${formatTimestamp(alert.timestamp)}</div>
        ${actions}
      </div>
    </div>`;
}


// ════════════════════════════════════════════════════════════════════
//  SECTION 6 — ALERT ACTIONS
// ════════════════════════════════════════════════════════════════════

function acknowledgeAlert(alertId) {
  const alert = activeAlerts.find(a => a.id === alertId);
  if (!alert) return;

  const card = document.querySelector(`[data-alert-id="${alertId}"]`);
  if (card) {
    card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    card.style.opacity = '0'; card.style.transform = 'translateX(20px)';
  }

  firebase.database().ref('alerts/history').push().set({
    parameter: alert.parameter, value: alert.value, threshold: alert.threshold,
    severity: alert.severity, message: alert.message, timestamp: alert.timestamp,
    acknowledged: true, acknowledgedAt: Date.now()
  })
  .then(() => firebase.database().ref('alerts/active/' + alertId).remove())
  .catch(err => {
    console.error('Acknowledge error:', err);
    if (card) { card.style.opacity = '1'; card.style.transform = 'translateX(0)'; }
    window.alert('Failed to acknowledge. Please try again.');
  });
}

function dismissAlert(alertId) {
  if (!confirm('Dismiss this alert without acknowledging it?')) return;

  const alert = activeAlerts.find(a => a.id === alertId);
  if (!alert) return;

  const card = document.querySelector(`[data-alert-id="${alertId}"]`);
  if (card) {
    card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    card.style.opacity = '0'; card.style.transform = 'translateX(-20px)';
  }

  firebase.database().ref('alerts/history').push().set({
    parameter: alert.parameter, value: alert.value, threshold: alert.threshold,
    severity: alert.severity, message: alert.message, timestamp: alert.timestamp,
    acknowledged: false, dismissed: true, dismissedAt: Date.now()
  })
  .then(() => firebase.database().ref('alerts/active/' + alertId).remove())
  .catch(err => {
    console.error('Dismiss error:', err);
    if (card) { card.style.opacity = '1'; card.style.transform = 'translateX(0)'; }
    window.alert('Failed to dismiss. Please try again.');
  });
}

function acknowledgeAll() {
  if (activeAlerts.length === 0) return;
  if (!confirm(`Acknowledge all ${activeAlerts.length} active alerts?`)) return;

  const acknowledgedTime = Date.now();
  const promises = [];

  document.querySelectorAll('.alert-card').forEach(c => {
    c.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    c.style.opacity = '0'; c.style.transform = 'scale(0.95)';
  });

  activeAlerts.forEach(alert => {
    promises.push(
      firebase.database().ref('alerts/history').push().set({
        parameter: alert.parameter, value: alert.value, threshold: alert.threshold,
        severity: alert.severity, message: alert.message, timestamp: alert.timestamp,
        acknowledged: true, acknowledgedAt: acknowledgedTime
      })
    );
    promises.push(firebase.database().ref('alerts/active/' + alert.id).remove());
  });

  Promise.all(promises).catch(err => {
    console.error('AcknowledgeAll error:', err);
    document.querySelectorAll('.alert-card').forEach(c => {
      c.style.opacity = '1'; c.style.transform = 'scale(1)';
    });
    window.alert('Failed to acknowledge all. Please try again.');
  });
}


// ════════════════════════════════════════════════════════════════════
//  SECTION 7 — THRESHOLD MONITORING
// ════════════════════════════════════════════════════════════════════

function setupRealtimeAlertListeners() {
  let lastCheckTime = Date.now();
  let previousReadings = {};

  firebase.database().ref('sensors').on('value', snap => {
    if (!snap.exists()) return;
    const data = snap.val();

    let lastUpdate = 0;
    if (data.lastUpdate) {
      lastUpdate = typeof data.lastUpdate === 'string'
        ? new Date(data.lastUpdate).getTime()
        : data.lastUpdate;
    }

    if (lastUpdate > lastCheckTime) {
      if (checkIfValuesChanged(data, previousReadings)) {
        checkThresholds(data);
        previousReadings = { ...data };
      }
      lastCheckTime = lastUpdate;
    }
  });
}

function checkIfValuesChanged(newData, oldData) {
  if (Object.keys(oldData).length === 0) return true;
  for (const p of ['do', 'temperature', 'salinity', 'turbidity', 'ph']) {
    const nv = newData[p], ov = oldData[p];
    if (nv !== undefined && ov !== undefined && Math.abs(nv - ov) > 0.01) return true;
  }
  return false;
}

function checkThresholds(sensorData) {
  if (!sensorData || Object.keys(thresholds).length === 0) return;

  Object.keys(thresholds).forEach(param => {
    const value = sensorData[param];
    if (value === undefined || value === null) return;
    const t = thresholds[param];
    if (!t) return;

    let severity = null, thresholdValue = '', message = '';

    if      (value < t.warnMin) { severity = 'critical'; thresholdValue = `Critical Min: ${t.warnMin}`; message = `${param.toUpperCase()} critically low - below critical minimum`; }
    else if (value > t.warnMax) { severity = 'critical'; thresholdValue = `Critical Max: ${t.warnMax}`; message = `${param.toUpperCase()} critically high - above critical maximum`; }
    else if (value < t.safeMin) { severity = 'warning';  thresholdValue = `Warning Range: ${t.warnMin}-${t.safeMin}`; message = `${param.toUpperCase()} in warning zone (below safe minimum)`; }
    else if (value > t.safeMax) { severity = 'warning';  thresholdValue = `Warning Range: ${t.safeMax}-${t.warnMax}`; message = `${param.toUpperCase()} in warning zone (above safe maximum)`; }

    if (severity) createOrUpdateAlert(param, value, thresholdValue, severity, message);
    else          autoResolveAlert(param);
  });
}

function createOrUpdateAlert(parameter, value, threshold, severity, message) {
  const existing = activeAlerts.find(a => a.parameter === parameter);

  if (existing) {
    firebase.database().ref('alerts/active/' + existing.id).update({
      value: typeof value === 'number' ? value.toFixed(2) : value,
      threshold, severity, message, timestamp: Date.now()
    });
    return;
  }

  const ref = firebase.database().ref('alerts/active').push();
  const newAlert = {
    parameter,
    value: typeof value === 'number' ? value.toFixed(2) : value,
    threshold, severity, message, timestamp: Date.now()
  };

  ref.set(newAlert).then(() => {
    triggerAlertNotification({ ...newAlert, id: ref.key });
  });
}

function autoResolveAlert(parameter) {
  const alert = activeAlerts.find(a => a.parameter === parameter);
  if (!alert) return;

  firebase.database().ref('alerts/history').push().set({
    parameter: alert.parameter, value: alert.value, threshold: alert.threshold,
    severity: alert.severity, message: alert.message, timestamp: alert.timestamp,
    acknowledged: true, acknowledgedAt: Date.now(),
    autoResolved: true, resolvedMessage: 'Parameter returned to normal range'
  })
  .then(() => firebase.database().ref('alerts/active/' + alert.id).remove());
}


// ════════════════════════════════════════════════════════════════════
//  SECTION 8 — FILTERS & EXPORT
// ════════════════════════════════════════════════════════════════════

function filterActiveAlerts() {
  const severity  = document.getElementById('severityFilter')?.value  || 'all';
  const parameter = document.getElementById('parameterFilter')?.value || 'all';
  return activeAlerts.filter(a =>
    (severity  === 'all' || a.severity  === severity) &&
    (parameter === 'all' || a.parameter === parameter)
  );
}

function filterHistoryAlerts() {
  const from  = document.getElementById('dateFromFilter')?.value || '';
  const to    = document.getElementById('dateToFilter')?.value   || '';
  const sev   = document.getElementById('historySeverityFilter')?.value  || 'all';
  const param = document.getElementById('historyParameterFilter')?.value || 'all';
  return historyAlerts.filter(a => {
    if (from && a.timestamp < new Date(from).setHours(0,0,0,0))    return false;
    if (to   && a.timestamp > new Date(to).setHours(23,59,59,999)) return false;
    if (sev   !== 'all' && a.severity  !== sev)   return false;
    if (param !== 'all' && a.parameter !== param) return false;
    return true;
  });
}

function filterAlerts()  { displayActiveAlerts(); }
function filterHistory() { displayHistoryAlerts(); }

function exportHistory() {
  const filtered = filterHistoryAlerts();
  if (!filtered.length) { window.alert('No alerts to export'); return; }

  const headers = ['Timestamp','Parameter','Severity','Value','Threshold','Message','Acknowledged','Dismissed'];
  let csv = headers.join(',') + '\n';
  filtered.forEach(a => {
    csv += [
      new Date(a.timestamp).toLocaleString(), a.parameter, a.severity,
      a.value, a.threshold, a.message || '',
      a.acknowledged ? 'Yes' : 'No', a.dismissed ? 'Yes' : 'No'
    ].map(c => `"${c}"`).join(',') + '\n';
  });

  const url  = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const link = Object.assign(document.createElement('a'), {
    href: url, download: `alerts_history_${new Date().toISOString().split('T')[0]}.csv`
  });
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function setupDateFilters() {
  const today   = new Date();
  const weekAgo = new Date(today - 7 * 86400000);
  const to   = document.getElementById('dateToFilter');
  const from = document.getElementById('dateFromFilter');
  if (to)   to.value   = today.toISOString().split('T')[0];
  if (from) from.value = weekAgo.toISOString().split('T')[0];
}


// ════════════════════════════════════════════════════════════════════
//  SECTION 9 — UTILITY HELPERS
// ════════════════════════════════════════════════════════════════════

function getParameterIcon(parameter) {
  return { do:'fas fa-wind', temperature:'fas fa-thermometer-half',
           salinity:'fas fa-tint', turbidity:'fas fa-eye', ph:'fas fa-flask'
  }[(parameter||'').toLowerCase()] || 'fas fa-exclamation-triangle';
}

function getParameterUnit(parameter) {
  return { do:'mg/L', temperature:'°C', salinity:'ppt', turbidity:'NTU', ph:'' }
    [(parameter||'').toLowerCase()] || '';
}

function formatTimestamp(timestamp) {
  if (!timestamp) return 'Unknown';
  const diff = Date.now() - new Date(timestamp);
  if (diff < 60000)    return 'Just now';
  if (diff < 3600000)  { const m = Math.floor(diff/60000);    return `${m} minute${m>1?'s':''} ago`; }
  if (diff < 86400000) { const h = Math.floor(diff/3600000);  return `${h} hour${h>1?'s':''} ago`; }
  if (diff < 604800000){ const d = Math.floor(diff/86400000); return `${d} day${d>1?'s':''} ago`; }
  return new Date(timestamp).toLocaleDateString('en-US', {
    month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit'
  });
}

function emptyActiveHTML() {
  return `<div class="no-alerts">
    <i class="fas fa-check-circle"></i>
    <p>No active alerts at this time</p>
    <span>Your pond water quality is within normal parameters</span>
  </div>`;
}

console.log('[Alerts] Loaded. BASE_PATH:', BASE_PATH, '| Permission:', Notification.permission);
