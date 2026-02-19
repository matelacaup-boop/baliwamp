// ==========================================
// WATER QUALITY ANALYTICS SCRIPT
// Uses simple-statistics for trend analysis and anomaly detection
// ==========================================

// Configuration for optimal bangus cultivation ranges
const OPTIMAL_RANGES = {
  do: { min: 5, max: 8, critical: 3, unit: 'mg/L', label: 'Dissolved Oxygen' },
  salinity: { min: 10, max: 25, critical: 35, unit: 'ppt', label: 'Salinity' },
  temperature: { min: 26, max: 32, critical: 35, unit: '°C', label: 'Temperature' },
  ph: { min: 7.5, max: 8.5, critical: 6.0, unit: '', label: 'pH Level' },
  turbidity: { min: 30, max: 60, critical: 20, unit: 'cm', label: 'Turbidity' }
};

let analyticsData = [];
let trendChart = null;
let correlationChart6h = null;
let correlationChart12h = null;
let correlationChart24h = null;

// ==========================================
// INITIALIZATION
// ==========================================

window.addEventListener('load', function() {
  initializeAnalytics();
});

function initializeAnalytics() {
  loadAnalyticsData();
}

// ==========================================
// DATA LOADING
// ==========================================

/**
 * Load analytics data from Firebase history node
 */
function loadAnalyticsData() {
  // Read time range from whichever tab's select is currently visible
  const trendsRange = document.getElementById('trendsTimeRange');
  const corrRange   = document.getElementById('corrTimeRange');
  const activeTrends = document.getElementById('tabPanelTrends')?.classList.contains('active');
  const timeRange = activeTrends
    ? (trendsRange?.value || '7d')
    : (corrRange?.value   || '7d');
  
  const now = Date.now();
  const hours = timeRange === '24h' ? 24 : timeRange === '7d' ? 168 : 
                timeRange === '30d' ? 720 : 2160;
  const startTime = now - (hours * 60 * 60 * 1000);
  
  // Show loading state in all panels
  const insightsList = document.getElementById('insightsList');
  insightsList.innerHTML = `
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <p>Loading data from Firebase...</p>
    </div>
  `;
  const correlationInsightsList = document.getElementById('correlationInsightsList');
  if (correlationInsightsList) {
    correlationInsightsList.innerHTML = `
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <p>Analyzing correlations...</p>
      </div>
    `;
  }
  const forecastContent = document.getElementById('forecastContent');
  if (forecastContent) {
    forecastContent.innerHTML = `
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <p>Loading forecast data...</p>
      </div>
    `;
  }
  
  firebase.database().ref('history')
    .orderByChild('time')
    .startAt(startTime)
    .once('value')
    .then(snapshot => {
      analyticsData = [];
      
      snapshot.forEach(child => {
        const data = child.val();
        
        if (data.time && data.temperature !== undefined && data.ph !== undefined && 
            data.salinity !== undefined && data.turbidity !== undefined && data.do !== undefined) {
          
          analyticsData.push({
            timestamp: new Date(data.time),
            do: parseFloat(data.do),
            salinity: parseFloat(data.salinity),
            temperature: parseFloat(data.temperature),
            ph: parseFloat(data.ph),
            turbidity: parseFloat(data.turbidity)
          });
        }
      });
      
      analyticsData.sort((a, b) => a.timestamp - b.timestamp);
      
      console.log(`Loaded ${analyticsData.length} records from Firebase`);
      
      if (analyticsData.length === 0) {
        insightsList.innerHTML = `
          <div class="insight-item">
            <div class="insight-icon">ℹ️</div>
            <div class="insight-content">
              <div class="insight-message">No data available for the selected time range.</div>
              <span class="insight-severity info">No Data</span>
            </div>
          </div>
        `;
        if (correlationInsightsList) {
          correlationInsightsList.innerHTML = `
            <div class="insight-item">
              <div class="insight-icon">🔗</div>
              <div class="insight-content">
                <div class="insight-message">No data available for correlation analysis.</div>
                <span class="insight-severity info">No Data</span>
              </div>
            </div>
          `;
        }
        if (forecastContent) {
          forecastContent.innerHTML = `
            <div class="forecast-empty">
              <i class="fas fa-database"></i>
              <h3>No Data Available</h3>
              <p>No data found for the selected time range.</p>
            </div>
          `;
        }
        return;
      }
      
      runStatisticalAnalysis();
      createTrendChart();
      createCorrelationCharts();
      updateEmptyState();
    })
    .catch(error => {
      console.error('Error loading analytics data:', error);
      insightsList.innerHTML = `
        <div class="insight-item">
          <div class="insight-icon">⚠️</div>
          <div class="insight-content">
            <div class="insight-message">Error loading data: ${error.message}</div>
            <span class="insight-severity danger">Error</span>
          </div>
        </div>
      `;
    });
}

// ==========================================
// PARAMETER FILTER HELPERS
// ==========================================

/**
 * Map from param key → checkbox element ID
 */
const PARAM_CHECKBOX_IDS = {
  do:          'paramDO',
  salinity:    'paramSalinity',
  temperature: 'paramTemperature',
  ph:          'paramPH',
  turbidity:   'paramTurbidity'
};

/**
 * Returns array of currently-checked param keys e.g. ['do','temperature']
 * Falls back to all params if checkboxes don't exist yet (initial load).
 */
function getActiveParams() {
  const active = [];
  Object.entries(PARAM_CHECKBOX_IDS).forEach(([param, id]) => {
    const el = document.getElementById(id);
    if (!el || el.checked) active.push(param); // treat missing as checked
  });
  return active;
}

/**
 * Called whenever a parameter pill checkbox changes.
 * Only updates:
 *   1. The correlation chart (shows/hides dataset lines)
 *   2. The correlation insights panel below the chart
 * Trends and anomalies in the main insights panel are unaffected.
 */
function onParamFilterChange() {
  if (analyticsData.length === 0) return;
  const activeParams = getActiveParams();

  // Rebuild every currently-visible correlation chart with the new param filter
  ['6h', '12h', '24h'].forEach(chartId => {
    const section = document.getElementById(`section${chartId}`);
    if (section && section.style.display !== 'none') {
      createCorrelationChart(chartId, parseInt(chartId), activeParams);
    }
  });

  // Re-compute and display only the correlation insights panel
  const correlationInsights = analyzeSensorCorrelations(activeParams);
  displayCorrelationInsights(correlationInsights, activeParams);
}

// ==========================================
// STATISTICAL ANALYSIS
// ==========================================

/**
 * Run all statistical analyses and route results to correct tabs:
 *   - Trends tab:       trends, anomalies  → Statistical Insights & Patterns panel
 *   - Correlation tab:  correlations       → Parameter Correlation Insights panel
 *   - Forecast tab:     predictions        → Parameter Forecast panel
 */
function runStatisticalAnalysis() {
  const activeParams = getActiveParams();

  // --- Trends + Anomalies → Statistical Insights & Patterns panel (Trends tab) ---
  const analyticsInsights = [];

  Object.keys(OPTIMAL_RANGES).forEach(param => {
    const trendInsight = analyzeTrend(param);
    if (trendInsight) analyticsInsights.push(trendInsight);
  });
  analyticsInsights.push(...detectAnomalies());

  // --- Correlations → Correlation Insights panel (Correlation tab), filtered by active params ---
  const correlationInsights = analyzeSensorCorrelations(activeParams);

  // --- Forecast → Forecast tab ---
  const forecastInsights = generatePredictions();

  displayAnalyticsInsights(analyticsInsights);
  displayCorrelationInsights(correlationInsights, activeParams);
  displayForecastInsights(forecastInsights);
}

/**
 * Analyze trend using Linear Regression
 */
function analyzeTrend(parameter) {
  const values = analyticsData.map(d => d[parameter]);
  const indices = values.map((_, i) => i);
  const points = indices.map((x, i) => [x, values[i]]);
  const regression = ss.linearRegression(points);
  const slope = regression.m;
  
  const trendsRange = document.getElementById('trendsTimeRange');
  const corrRange   = document.getElementById('corrTimeRange');
  const activeTrends = document.getElementById('tabPanelTrends')?.classList.contains('active');
  const timeRange = activeTrends
    ? (trendsRange?.value || '7d')
    : (corrRange?.value   || '7d');
  const hours = timeRange === '24h' ? 24 : timeRange === '7d' ? 168 : timeRange === '30d' ? 720 : 2160;
  const hourlyChange = slope * (analyticsData.length / hours);
  
  if (Math.abs(hourlyChange) > 0.03) {
    return {
      type: slope > 0 ? 'trend-up' : 'trend-down',
      icon: slope > 0 ? '📈' : '📉',
      message: `${OPTIMAL_RANGES[parameter].label} is ${slope > 0 ? 'increasing' : 'decreasing'} by ${Math.abs(hourlyChange).toFixed(3)} ${OPTIMAL_RANGES[parameter].unit}/hour`,
      severity: Math.abs(hourlyChange) > 0.1 ? 'warning' : 'info',
      insightType: 'trend'
    };
  }
  
  return null;
}

/**
 * Detect anomalies using Z-Score analysis
 */
function detectAnomalies() {
  const insights = [];
  const recentData = analyticsData.slice(-24);
  
  Object.keys(OPTIMAL_RANGES).forEach(param => {
    const allValues = analyticsData.map(d => d[param]);
    const mean = ss.mean(allValues);
    const stdDev = ss.standardDeviation(allValues);
    
    recentData.forEach(reading => {
      const zScore = (reading[param] - mean) / stdDev;
      
      if (Math.abs(zScore) > 2.5) {
        insights.push({
          type: 'anomaly',
          icon: '⚡',
          message: `Unusual ${OPTIMAL_RANGES[param].label} detected: ${reading[param].toFixed(1)} ${OPTIMAL_RANGES[param].unit} (${Math.abs(zScore).toFixed(1)} standard deviations from normal)`,
          severity: 'warning',
          timestamp: reading.timestamp.toLocaleString(),
          insightType: 'anomaly'
        });
      }
    });
  });
  
  return insights.slice(0, 3);
}

/**
 * Analyze sensor-to-sensor correlations.
 * Only computes pairs where BOTH parameters are in activeParams.
 * @param {string[]} activeParams - active param keys; defaults to all if omitted
 */
function analyzeSensorCorrelations(activeParams) {
  const insights = [];
  const threshold = parseFloat(document.getElementById('correlationThreshold')?.value || 0.5);
  if (!activeParams) activeParams = Object.keys(OPTIMAL_RANGES);

  const sensorPairs = [
    {
      param1: 'temperature', param2: 'do',
      positiveExplanation: 'When water temperature rises, dissolved oxygen levels also increase',
      negativeExplanation: 'When water temperature rises, dissolved oxygen levels decrease',
      positiveImpact: 'Unusual for this pair — monitor closely as aerator activity or algae photosynthesis may be elevating DO despite warming water',
      negativeImpact: 'This is critical for fish health — warm water naturally holds less dissolved oxygen'
    },
    {
      param1: 'salinity', param2: 'do',
      positiveExplanation: 'Higher salinity correlates with higher dissolved oxygen',
      negativeExplanation: 'Higher salinity correlates with lower dissolved oxygen',
      positiveImpact: 'Unusual pattern — biological activity or aeration may be compensating for salt-induced oxygen reduction',
      negativeImpact: 'Salt water holds less oxygen — high salinity can reduce oxygen availability for fish'
    },
    {
      param1: 'ph', param2: 'do',
      positiveExplanation: 'Higher pH correlates with higher dissolved oxygen',
      negativeExplanation: 'Higher pH correlates with lower dissolved oxygen',
      positiveImpact: 'Likely driven by algae photosynthesis — algae consume CO₂ (raising pH) and produce oxygen simultaneously',
      negativeImpact: 'May indicate decomposition activity — organic breakdown can lower both pH and oxygen levels'
    },
    {
      param1: 'turbidity', param2: 'do',
      positiveExplanation: 'Cloudier water correlates with higher dissolved oxygen',
      negativeExplanation: 'Cloudier water correlates with lower dissolved oxygen',
      positiveImpact: 'Suspended algae or plankton may be producing oxygen through photosynthesis',
      negativeImpact: 'High turbidity may be blocking sunlight, reducing photosynthesis and depleting oxygen'
    },
    {
      param1: 'temperature', param2: 'ph',
      positiveExplanation: 'Higher temperatures correlate with higher pH',
      negativeExplanation: 'Higher temperatures correlate with lower pH',
      positiveImpact: 'Warm water can accelerate algae photosynthesis, which consumes CO₂ and raises pH',
      negativeImpact: 'Warmer water speeds up decomposition, producing CO₂ and lowering pH'
    },
    {
      param1: 'temperature', param2: 'salinity',
      positiveExplanation: 'Warmer water correlates with higher salinity',
      negativeExplanation: 'Warmer water correlates with lower salinity',
      positiveImpact: 'Evaporation in warmer conditions may be concentrating salt levels',
      negativeImpact: 'Could indicate freshwater inflow or rainfall diluting salinity as temperatures drop'
    },
    {
      param1: 'temperature', param2: 'turbidity',
      positiveExplanation: 'Higher temperatures correlate with cloudier water',
      negativeExplanation: 'Higher temperatures correlate with clearer water',
      positiveImpact: 'Warm water promotes algae and plankton growth, increasing water cloudiness',
      negativeImpact: 'May indicate sediment settling or reduced biological activity in cooler periods'
    },
    {
      param1: 'salinity', param2: 'ph',
      positiveExplanation: 'Higher salinity correlates with higher pH',
      negativeExplanation: 'Higher salinity correlates with lower pH',
      positiveImpact: 'Saltwater buffering capacity can help maintain or raise alkalinity',
      negativeImpact: 'High salt concentrations may introduce acidic ions that lower pH'
    },
    {
      param1: 'salinity', param2: 'turbidity',
      positiveExplanation: 'Higher salinity correlates with cloudier water',
      negativeExplanation: 'Higher salinity correlates with clearer water',
      positiveImpact: 'Salt may be causing flocculation, clumping particles and increasing cloudiness',
      negativeImpact: 'Higher salinity may be causing particles to settle, improving water clarity'
    },
    {
      param1: 'ph', param2: 'turbidity',
      positiveExplanation: 'Higher pH correlates with cloudier water',
      negativeExplanation: 'Higher pH correlates with clearer water',
      positiveImpact: 'Algae blooms raise pH through photosynthesis while also increasing turbidity',
      negativeImpact: 'Clear, alkaline water may indicate low biological activity and good filtration'
    }
  ];
  
  sensorPairs.forEach(pair => {
    // Skip this pair if either parameter is not currently active
    if (!activeParams.includes(pair.param1) || !activeParams.includes(pair.param2)) return;

    const values1 = analyticsData.map(d => d[pair.param1]);
    const values2 = analyticsData.map(d => d[pair.param2]);
    const correlation = ss.sampleCorrelation(values1, values2);
    
    if (Math.abs(correlation) > threshold) {
      const stdDev1 = ss.standardDeviation(values1);
      const stdDev2 = ss.standardDeviation(values2);
      const mean1 = ss.mean(values1);
      const mean2 = ss.mean(values2);
      const cv1 = (stdDev1 / mean1) * 100;
      const cv2 = (stdDev2 / mean2) * 100;
      
      if (cv1 < 2 || cv2 < 2) return;
      
      let strength = '';
      if (Math.abs(correlation) > 0.8) strength = 'Very Strong';
      else if (Math.abs(correlation) > 0.7) strength = 'Strong';
      else if (Math.abs(correlation) > 0.5) strength = 'Moderate';
      else strength = 'Weak';
      
      const direction = correlation > 0 ? 'positive' : 'inverse';
      const percentage = Math.abs(correlation * 100).toFixed(0);
      
      let message = correlation > 0
        ? `${strength} relationship: ${pair.positiveExplanation}`
        : `${strength} relationship: ${pair.negativeExplanation}`;

      const impactText = correlation > 0 ? pair.positiveImpact : pair.negativeImpact;
      let detail = `${percentage}% ${direction} correlation. ${impactText}`;
      if (cv1 < 5 || cv2 < 5) {
        const lowVarParam = cv1 < cv2 ? OPTIMAL_RANGES[pair.param1].label : OPTIMAL_RANGES[pair.param2].label;
        detail += ` Note: ${lowVarParam} has limited variation in this period, which may affect correlation accuracy.`;
      }
      
      insights.push({
        type: 'correlation',
        icon: '🔗',
        message: message,
        severity: 'info',
        detail: detail,
        correlationValue: Math.abs(correlation),
        insightType: 'correlation'
      });
    }
  });
  
  insights.sort((a, b) => b.correlationValue - a.correlationValue);
  return insights;
}

/**
 * Generate predictions for the next N hours.
 * Returns insights sorted weak → severe (info → warning → danger).
 */
function generatePredictions() {
  const insights = [];
  
  const hoursAhead = parseInt(document.getElementById('predictionWindow')?.value || 6);
  const dataRangeHours = parseInt(document.getElementById('predictionDataRange')?.value || 48);
  const minimumDataPoints = Math.min(24, dataRangeHours);
  
  if (analyticsData.length < minimumDataPoints) {
    return [{
      type: 'info',
      icon: 'ℹ️',
      message: `Need at least ${minimumDataPoints} hours of data for predictions. Currently have ${analyticsData.length} data points.`,
      severity: 'info',
      detail: 'Predictions will become available as more data is collected.',
      priority: 3
    }];
  }
  
  Object.keys(OPTIMAL_RANGES).forEach(param => {
    const dataPointsToUse = Math.min(analyticsData.length, dataRangeHours);
    const recent = analyticsData.slice(-dataPointsToUse);
    const values = recent.map((d, i) => [i, d[param]]);
    
    const regression = ss.linearRegression(values);
    const futureIndex = values.length + (hoursAhead * (values.length / dataRangeHours));
    const predictedValue = regression.m * futureIndex + regression.b;
    
    const config = OPTIMAL_RANGES[param];
    const currentValue = analyticsData[analyticsData.length - 1][param];
    const change = predictedValue - currentValue;
    const percentChange = Math.abs((change / currentValue) * 100);
    
    const residuals = values.map(point => {
      const predicted = regression.m * point[0] + regression.b;
      return Math.abs(point[1] - predicted);
    });
    const avgError = ss.mean(residuals);
    const confidence = Math.max(0, Math.min(100, 100 - (avgError / currentValue * 100)));
    
    let accuracyNote = '';
    if (hoursAhead <= 6) accuracyNote = `High confidence (${confidence.toFixed(0)}%)`;
    else if (hoursAhead <= 12) accuracyNote = `Medium confidence (${confidence.toFixed(0)}%)`;
    else accuracyNote = `Lower confidence (${confidence.toFixed(0)}%) - longer predictions are less certain`;
    
    if (Math.abs(regression.m) > 0.005 || predictedValue < config.critical || predictedValue > config.critical * 1.5) {
      
      // CRITICAL — will reach dangerous levels (priority 1 = most severe)
      if (predictedValue < config.critical || predictedValue > config.critical * 1.5) {
        insights.push({
          type: 'prediction-critical',
          icon: '🚨',
          message: `CRITICAL: ${config.label} predicted to reach ${predictedValue.toFixed(1)} ${config.unit} in ${hoursAhead} hours`,
          severity: 'danger',
          detail: `Current: ${currentValue.toFixed(1)} ${config.unit}. ${change > 0 ? 'Increasing' : 'Decreasing'} and may become dangerous for fish. ${accuracyNote}`,
          priority: 1
        });
      }
      // WARNING — will leave optimal range (priority 2)
      else if (predictedValue < config.min || predictedValue > config.max) {
        insights.push({
          type: 'prediction-warning',
          icon: '⚠️',
          message: `${config.label} expected to reach ${predictedValue.toFixed(1)} ${config.unit} in ${hoursAhead} hours`,
          severity: 'warning',
          detail: `Currently at ${currentValue.toFixed(1)} ${config.unit}. Trending ${change > 0 ? 'upward' : 'downward'} and may leave optimal range. ${accuracyNote}`,
          priority: 2
        });
      }
      // INFO — significant change but still safe (priority 3 = least severe)
      else if (percentChange > 3) {
        const direction = change > 0 ? 'increase' : 'decrease';
        insights.push({
          type: 'prediction-info',
          icon: '🔮',
          message: `${config.label} forecasted to ${direction} to ${predictedValue.toFixed(1)} ${config.unit} in ${hoursAhead} hours`,
          severity: 'info',
          detail: `A ${percentChange.toFixed(1)}% ${direction} from current level (${currentValue.toFixed(1)} ${config.unit}). Expected to remain within optimal range. ${accuracyNote}`,
          priority: 3
        });
      }
    }
  });
  
  // Sort severe → weak (lowest priority number = most severe; render critical first, then warning, then info)
  insights.sort((a, b) => (a.priority || 999) - (b.priority || 999));
  
  return insights;
}

// ==========================================
// DISPLAY: TRENDS TAB — Statistical Insights & Patterns
// ==========================================

/**
 * Display ONLY trends and anomalies in the Statistical Insights & Patterns panel (Trends tab).
 * Correlations are shown separately in the Correlation Insights panel (Correlation tab).
 */
function displayAnalyticsInsights(insights) {
  const insightsList = document.getElementById('insightsList');

  // Apply type filter (trends only / anomalies only / all)
  const severityFilter = document.getElementById('severityFilter')?.value || 'all';
  let filtered = insights;
  if (severityFilter === 'anomaly') {
    filtered = insights.filter(i => i.insightType === 'anomaly');
  } else if (severityFilter === 'trend') {
    filtered = insights.filter(i => i.insightType === 'trend');
  }
  // 'all' shows both trends and anomalies

  if (filtered.length === 0) {
    insightsList.innerHTML = `
      <div class="insight-item">
        <div class="insight-icon">✅</div>
        <div class="insight-content">
          <div class="insight-message">
            ${severityFilter !== 'all'
              ? 'No insights match your current filter. Try changing the filter above.'
              : 'Water quality parameters are stable. No significant trends or anomalies detected.'}
          </div>
          <span class="insight-severity success">All Clear</span>
        </div>
      </div>
    `;
    return;
  }

  insightsList.innerHTML = filtered.map(insight => `
    <div class="insight-item">
      <div class="insight-icon">${insight.icon}</div>
      <div class="insight-content">
        <div class="insight-message">${insight.message}</div>
        ${insight.detail ? `<div style="font-size:0.85rem;color:#64748b;margin-top:0.5rem;line-height:1.4;">${insight.detail}</div>` : ''}
        <span class="insight-severity ${insight.severity}">${insight.severity}</span>
        ${insight.timestamp ? `<div style="font-size:0.8rem;color:#64748b;margin-top:0.25rem;">Detected at: ${insight.timestamp}</div>` : ''}
      </div>
    </div>
  `).join('');
}

// ==========================================
// DISPLAY: CORRELATION TAB — Correlation Insights Panel
// ==========================================

/**
 * Display correlation insights in the dedicated panel (Correlation tab).
 * Shows only pairs where BOTH parameters are in activeParams.
 * @param {array}    insights     - correlation insight objects from analyzeSensorCorrelations()
 * @param {string[]} activeParams - currently selected param keys
 */
function displayCorrelationInsights(insights, activeParams) {
  const list = document.getElementById('correlationInsightsList');
  if (!list) return;

  // Build a readable label for the selected parameters
  const paramLabels = activeParams.map(p => OPTIMAL_RANGES[p].label);
  const selectionNote = activeParams.length === Object.keys(OPTIMAL_RANGES).length
    ? 'All parameters selected'
    : `Showing: ${paramLabels.join(', ')}`;

  if (insights.length === 0) {
    list.innerHTML = `
      <div style="background:rgba(255,255,255,0.5);padding:0.65rem 1rem;border-radius:8px;margin-bottom:0.85rem;font-size:0.82rem;color:#64748b;">
        🔍 ${selectionNote}
      </div>
      <div class="insight-item">
        <div class="insight-icon">🔗</div>
        <div class="insight-content">
          <div class="insight-message">
            ${activeParams.length < 2
              ? 'Select at least 2 parameters to see correlation insights.'
              : 'No significant correlations detected between the selected parameters.'}
          </div>
          <span class="insight-severity info">No Correlations</span>
        </div>
      </div>
    `;
    return;
  }

  list.innerHTML = `
    <div style="background:rgba(255,255,255,0.5);padding:0.65rem 1rem;border-radius:8px;margin-bottom:0.85rem;font-size:0.82rem;color:#92400e;font-weight:600;">
      🔗 ${insights.length} correlation${insights.length !== 1 ? 's' : ''} found &nbsp;·&nbsp; <span style="font-weight:400;color:#64748b;">${selectionNote}</span>
    </div>
  ` + insights.map(insight => `
    <div class="insight-item">
      <div class="insight-icon">${insight.icon}</div>
      <div class="insight-content">
        <div class="insight-message">${insight.message}</div>
        ${insight.detail ? `<div style="font-size:0.85rem;color:#64748b;margin-top:0.5rem;line-height:1.4;">${insight.detail}</div>` : ''}
        <span class="insight-severity ${insight.severity}">${insight.severity}</span>
      </div>
    </div>
  `).join('');
}

// ==========================================
// DISPLAY: FORECAST TAB
// ==========================================

/**
 * Display forecast insights in the Forecast tab, grouped weak → severe.
 * Updates the tab badge count (critical alerts get a red badge).
 */
function displayForecastInsights(insights) {
  const forecastContent = document.getElementById('forecastContent');
  const forecastBadge = document.getElementById('forecastBadge');
  
  if (!forecastContent) return;
  
  // Update tab badge
  if (forecastBadge) {
    const dangerCount = insights.filter(i => i.severity === 'danger').length;
    const warningCount = insights.filter(i => i.severity === 'warning').length;
    
    forecastBadge.textContent = insights.length;
    forecastBadge.className = 'tab-badge';
    if (dangerCount > 0) forecastBadge.classList.add('badge-danger');
    else if (warningCount > 0) forecastBadge.classList.add('badge-warning');
  }
  
  if (insights.length === 0) {
    forecastContent.innerHTML = `
      <div class="forecast-empty">
        <i class="fas fa-check-circle" style="color: #10b981;"></i>
        <h3>No Forecasted Issues</h3>
        <p>All parameters are predicted to remain stable within their optimal ranges.</p>
      </div>
    `;
    return;
  }
  
  // Group by severity: danger → warning → info (most severe first)
  const infoGroup    = insights.filter(i => i.severity === 'info');
  const warningGroup = insights.filter(i => i.severity === 'warning');
  const dangerGroup  = insights.filter(i => i.severity === 'danger');
  
  const hoursAhead = document.getElementById('predictionWindow')?.value || 6;
  
  let html = '';
  
  // --- Critical section (most severe — shown first) ---
  if (dangerGroup.length > 0) {
    html += `
      <div class="forecast-severity-section">
        <div class="forecast-severity-label label-critical">
          <i class="fas fa-skull-crossbones"></i>
          Critical Alerts — Forecasted in ${hoursAhead}h (dangerous levels)
        </div>
        ${dangerGroup.map(insight => renderForecastCard(insight)).join('')}
      </div>
    `;
  }
  
  // --- Warning section ---
  if (warningGroup.length > 0) {
    html += `
      <div class="forecast-severity-section">
        <div class="forecast-severity-label label-warning">
          <i class="fas fa-exclamation-triangle"></i>
          Warnings — Forecasted in ${hoursAhead}h (may leave optimal range)
        </div>
        ${warningGroup.map(insight => renderForecastCard(insight)).join('')}
      </div>
    `;
  }
  
  // --- Info section (least severe — shown last) ---
  if (infoGroup.length > 0) {
    html += `
      <div class="forecast-severity-section">
        <div class="forecast-severity-label label-info">
          <i class="fas fa-info-circle"></i>
          Informational — Forecasted in ${hoursAhead}h (within safe range)
        </div>
        ${infoGroup.map(insight => renderForecastCard(insight)).join('')}
      </div>
    `;
  }
  
  forecastContent.innerHTML = html;
}

/**
 * Render a single forecast card
 */
function renderForecastCard(insight) {
  const borderColor = insight.severity === 'danger' ? '#dc2626'
                    : insight.severity === 'warning' ? '#f59e0b'
                    : '#3b82f6';
  const iconBg = insight.severity === 'danger' ? '#fee2e2'
               : insight.severity === 'warning' ? '#fed7aa'
               : '#dbeafe';
  
  return `
    <div class="insight-item" style="background: white; border-left: 4px solid ${borderColor}; margin-bottom: 0.65rem;">
      <div class="insight-icon" style="background: ${iconBg};">${insight.icon}</div>
      <div class="insight-content">
        <div class="insight-message">${insight.message}</div>
        ${insight.detail ? `<div style="font-size:0.85rem;color:#64748b;margin-top:0.5rem;line-height:1.4;">${insight.detail}</div>` : ''}
        <span class="insight-severity ${insight.severity}">${insight.severity}</span>
      </div>
    </div>
  `;
}

// ==========================================
// LEGACY displayInsights — kept as a compatibility fallback.
// Routes insights to the correct display functions.
// ==========================================
function displayInsights(insights) {
  const forecastTypes = ['prediction-critical', 'prediction-warning', 'prediction-info', 'info'];
  const correlationInsights = insights.filter(i => i.insightType === 'correlation');
  const analyticsInsights   = insights.filter(i => !forecastTypes.includes(i.type) && i.insightType !== 'correlation');
  const forecastInsights    = insights.filter(i =>  forecastTypes.includes(i.type));

  displayAnalyticsInsights(analyticsInsights);
  displayCorrelationInsights(correlationInsights, getActiveParams());
  displayForecastInsights(forecastInsights);
}

// ==========================================
// CHART CREATION
// ==========================================

function createTrendChart() {
  const ctx = document.getElementById('trendChart').getContext('2d');
  
  if (trendChart) trendChart.destroy();
  
  const labels = analyticsData.map(d => d.timestamp.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit'
  }));
  
  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Dissolved Oxygen (mg/L)',
          data: analyticsData.map(d => d.do),
          borderColor: '#0ea5e9',
          backgroundColor: 'rgba(14, 165, 233, 0.1)',
          tension: 0.4, fill: false,
          yAxisID: 'y',
          paramKey: 'do'
        },
        {
          label: 'Salinity (ppt)',
          data: analyticsData.map(d => d.salinity),
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          tension: 0.4, fill: false,
          yAxisID: 'y1',
          paramKey: 'salinity'
        },
        {
          label: 'Temperature (°C)',
          data: analyticsData.map(d => d.temperature),
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245, 158, 11, 0.1)',
          tension: 0.4, fill: false,
          yAxisID: 'y2',
          paramKey: 'temperature'
        },
        {
          label: 'pH',
          data: analyticsData.map(d => d.ph),
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          tension: 0.4, fill: false,
          yAxisID: 'y3',
          paramKey: 'ph'
        },
        {
          label: 'Turbidity (cm)',
          data: analyticsData.map(d => d.turbidity),
          borderColor: '#8b5cf6',
          backgroundColor: 'rgba(139, 92, 246, 0.1)',
          tension: 0.4, fill: false,
          yAxisID: 'y4',
          paramKey: 'turbidity'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 2.5,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { usePointStyle: true, padding: 20, font: { family: 'Inter', size: 12 } }
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.9)',
          padding: 12,
          titleFont: { family: 'Inter', size: 14 },
          bodyFont: { family: 'Inter', size: 12 }
        }
      },
      scales: {
        y: {
          position: 'left',
          title: { display: true, text: 'DO (mg/L)', font: { family: 'Inter', size: 11 } },
          beginAtZero: false,
          grid: { color: 'rgba(226, 232, 240, 0.5)' },
          ticks: { font: { family: 'Inter' } }
        },
        y1: {
          position: 'right',
          title: { display: true, text: 'Salinity (ppt)', font: { family: 'Inter', size: 11 } },
          beginAtZero: false,
          grid: { drawOnChartArea: false },
          ticks: { font: { family: 'Inter' } }
        },
        y2: {
          position: 'right',
          title: { display: true, text: 'Temp (°C)', font: { family: 'Inter', size: 11 } },
          beginAtZero: false,
          grid: { drawOnChartArea: false },
          ticks: { font: { family: 'Inter' } }
        },
        y3: {
          position: 'right',
          title: { display: true, text: 'pH', font: { family: 'Inter', size: 11 } },
          beginAtZero: false,
          grid: { drawOnChartArea: false },
          ticks: { font: { family: 'Inter' } }
        },
        y4: {
          position: 'right',
          title: { display: true, text: 'Turbidity (cm)', font: { family: 'Inter', size: 11 } },
          beginAtZero: false,
          grid: { drawOnChartArea: false },
          ticks: { font: { family: 'Inter' } }
        },
        x: {
          grid: { display: false },
          ticks: { maxRotation: 45, minRotation: 45, font: { family: 'Inter', size: 10 } }
        }
      }
    }
  });
}

function createCorrelationCharts() {
  const activeParams = getActiveParams();
  if (document.getElementById('show6h')?.checked)  createCorrelationChart('6h',  6,  activeParams);
  if (document.getElementById('show12h')?.checked) createCorrelationChart('12h', 12, activeParams);
  if (document.getElementById('show24h')?.checked) createCorrelationChart('24h', 24, activeParams);
}

function toggleTimeWindow(chartId) {
  const section  = document.getElementById(`section${chartId}`);
  const checkbox = document.getElementById(`show${chartId}`);
  
  if (checkbox.checked) {
    section.style.display = 'block';
    createCorrelationChart(chartId, parseInt(chartId), getActiveParams());
  } else {
    section.style.display = 'none';
    const chart = chartId === '6h' ? correlationChart6h
                : chartId === '12h' ? correlationChart12h : correlationChart24h;
    if (chart) {
      chart.destroy();
      if (chartId === '6h')  correlationChart6h  = null;
      else if (chartId === '12h') correlationChart12h = null;
      else if (chartId === '24h') correlationChart24h = null;
    }
  }
  updateEmptyState();
}

function updateEmptyState() {
  const emptyState = document.getElementById('emptyStateMessage');
  const show6h  = document.getElementById('show6h')?.checked  || false;
  const show12h = document.getElementById('show12h')?.checked || false;
  const show24h = document.getElementById('show24h')?.checked || false;
  if (emptyState) emptyState.style.display = (!show6h && !show12h && !show24h) ? 'block' : 'none';
}

function createCorrelationChart(chartId, hours, activeParams) {
  if (!activeParams) activeParams = getActiveParams();

  const canvasId = `correlationChart${chartId}`;
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) { console.error(`Canvas ${canvasId} not found`); return; }
  
  const chartVar = chartId === '6h' ? correlationChart6h
                 : chartId === '12h' ? correlationChart12h : correlationChart24h;
  if (chartVar) chartVar.destroy();
  
  const now = new Date();
  const startTime = new Date(now - hours * 60 * 60 * 1000);
  const windowData = analyticsData.filter(d => d.timestamp >= startTime);
  
  const countElement = document.getElementById(`count${chartId}`);
  if (countElement) countElement.textContent = `${windowData.length} readings`;
  
  if (windowData.length === 0) {
    if (countElement) {
      countElement.textContent = 'No data';
      countElement.style.background = '#fee2e2';
      countElement.style.color = '#991b1b';
    }
    return;
  }
  
  const labels = windowData.map(d => d.timestamp.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: hours <= 6 ? '2-digit' : undefined,
    hour12: true
  }));

  // All possible datasets — hidden flag driven by activeParams
  const pt = hours <= 6 ? 3 : 2;
  const allDatasets = [
    { paramKey: 'do',          label: 'DO',          data: windowData.map(d => d.do),          borderColor: '#0ea5e9', backgroundColor: 'rgba(14,165,233,0.1)',  yAxisID: 'y'  },
    { paramKey: 'salinity',    label: 'Salinity',    data: windowData.map(d => d.salinity),    borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)',   yAxisID: 'y1' },
    { paramKey: 'temperature', label: 'Temperature', data: windowData.map(d => d.temperature), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)',  yAxisID: 'y2' },
    { paramKey: 'ph',          label: 'pH',          data: windowData.map(d => d.ph),          borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)',  yAxisID: 'y3' },
    { paramKey: 'turbidity',   label: 'Turbidity',   data: windowData.map(d => d.turbidity),   borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.1)',  yAxisID: 'y4' }
  ];

  const datasets = allDatasets.map(ds => ({
    label: ds.label,
    data: ds.data,
    borderColor: ds.borderColor,
    backgroundColor: ds.backgroundColor,
    borderWidth: 2,
    pointRadius: pt,
    pointHoverRadius: 5,
    tension: 0.3,
    yAxisID: ds.yAxisID,
    hidden: !activeParams.includes(ds.paramKey)
  }));

  const newChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 2.2,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { usePointStyle: true, padding: 15, font: { family: 'Inter', size: 11 } } },
        tooltip: {
          backgroundColor: 'rgba(15,23,42,0.95)',
          padding: 12,
          titleFont: { family: 'Inter', size: 13 },
          bodyFont: { family: 'Inter', size: 12 },
          displayColors: true,
          callbacks: {
            label: function(context) {
              let label = context.dataset.label || '';
              if (label) label += ': ';
              label += context.parsed.y.toFixed(2);
              const units = { 'DO': ' mg/L', 'Salinity': ' ppt', 'Temperature': ' °C', 'pH': '', 'Turbidity': ' cm' };
              label += units[context.dataset.label] || '';
              return label;
            }
          }
        },
        zoom: {
          pan: { enabled: true, mode: 'x', modifierKey: null },
          zoom: { wheel: { enabled: true, speed: 0.1 }, pinch: { enabled: true }, mode: 'x' },
          limits: { x: { min: 'original', max: 'original' } }
        }
      },
      scales: {
        y:  { position: 'left',  title: { display: true, text: 'DO (mg/L)',       font: { family: 'Inter', size: 11 } }, grid: { color: 'rgba(226,232,240,0.5)' } },
        y1: { position: 'right', title: { display: true, text: 'Salinity (ppt)', font: { family: 'Inter', size: 11 } }, grid: { drawOnChartArea: false } },
        y2: { position: 'right', title: { display: true, text: 'Temp (°C)',      font: { family: 'Inter', size: 11 } }, grid: { drawOnChartArea: false } },
        y3: { position: 'right', title: { display: true, text: 'pH',             font: { family: 'Inter', size: 11 } }, grid: { drawOnChartArea: false } },
        y4: { position: 'right', title: { display: true, text: 'Turbidity (cm)', font: { family: 'Inter', size: 11 } }, grid: { drawOnChartArea: false } },
        x:  { grid: { display: false }, ticks: { maxRotation: 45, minRotation: 45, font: { family: 'Inter', size: 10 } } }
      }
    }
  });
  
  if (chartId === '6h')       correlationChart6h  = newChart;
  else if (chartId === '12h') correlationChart12h = newChart;
  else if (chartId === '24h') correlationChart24h = newChart;
}

function resetZoom(chartId) {
  const chart = chartId === '6h' ? correlationChart6h
              : chartId === '12h' ? correlationChart12h : correlationChart24h;
  if (chart && chart.resetZoom) chart.resetZoom();
}

// ==========================================
// USER INTERACTIONS
// ==========================================

function changeChartType(type) {
  const buttons = document.querySelectorAll('.chart-controls button');
  buttons.forEach(btn => btn.classList.remove('active'));
  event.target.classList.add('active');
  
  trendChart.data.datasets.forEach(dataset => {
    dataset.fill = (type === 'area');
  });
  trendChart.update();
}

function updateChartParameter() {
  const param = document.getElementById('trendsParamFilter')?.value || 'all';
  
  trendChart.data.datasets.forEach(dataset => {
    dataset.hidden = param === 'all' ? false : dataset.paramKey !== param;
  });
  trendChart.update();
}

/**
 * Re-run analysis without reloading from Firebase.
 * Called when any settings dropdown changes.
 */
function updateAnalytics() {
  if (analyticsData.length > 0) {
    runStatisticalAnalysis();
  }
}


// ==========================================
// SUMMARY TAB — Min / Avg / Max Bar Charts
// ==========================================

// One Chart.js instance per parameter, keyed by paramKey
const summaryCharts = {};

// Colours per parameter (matches pill/correlation chart scheme)
const SUMMARY_COLORS = {
  do:          { border: '#0ea5e9', min: 'rgba(14,165,233,0.35)',  avg: 'rgba(14,165,233,0.75)',  max: 'rgba(14,165,233,1)'   },
  salinity:    { border: '#ef4444', min: 'rgba(239,68,68,0.35)',   avg: 'rgba(239,68,68,0.75)',   max: 'rgba(239,68,68,1)'    },
  temperature: { border: '#f59e0b', min: 'rgba(245,158,11,0.35)',  avg: 'rgba(245,158,11,0.75)',  max: 'rgba(245,158,11,1)'   },
  ph:          { border: '#10b981', min: 'rgba(16,185,129,0.35)',  avg: 'rgba(16,185,129,0.75)',  max: 'rgba(16,185,129,1)'   },
  turbidity:   { border: '#8b5cf6', min: 'rgba(139,92,246,0.35)', avg: 'rgba(139,92,246,0.75)', max: 'rgba(139,92,246,1)'   }
};

// Checkbox ID map for summary tab
const SUMMARY_CHECKBOX_IDS = {
  do:          'summaryParamDO',
  salinity:    'summaryParamSalinity',
  temperature: 'summaryParamTemperature',
  ph:          'summaryParamPH',
  turbidity:   'summaryParamTurbidity'
};

/** Returns the list of param keys currently checked in the Summary tab */
function getSummaryActiveParams() {
  return Object.entries(SUMMARY_CHECKBOX_IDS)
    .filter(([, id]) => document.getElementById(id)?.checked)
    .map(([param]) => param);
}

/**
 * Set default dates: today as end date, 7 days ago as start date.
 * Called once on page load.
 */
function initSummaryDefaults() {
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 6);

  const fmt = d => d.toISOString().slice(0, 10);
  const sd = document.getElementById('summaryStartDate');
  const ed = document.getElementById('summaryEndDate');
  if (sd && !sd.value) sd.value = fmt(weekAgo);
  if (ed && !ed.value) ed.value = fmt(today);
}

/**
 * Main entry: query Firebase for the selected date+time window,
 * aggregate by date, then render charts.
 */
function loadSummaryData() {
  const startDateVal = document.getElementById('summaryStartDate')?.value;
  const endDateVal   = document.getElementById('summaryEndDate')?.value;
  const startTimeVal = document.getElementById('summaryStartTime')?.value || '00:00';
  const endTimeVal   = document.getElementById('summaryEndTime')?.value   || '23:59';

  const statusMsg = document.getElementById('summaryStatusMsg');
  const container = document.getElementById('summaryChartsContainer');

  if (!startDateVal || !endDateVal) {
    showSummaryStatus('Please select both a start and end date.', 'warn');
    return;
  }

  const startTs = new Date(`${startDateVal}T${startTimeVal}:00`).getTime();
  const endTs   = new Date(`${endDateVal}T${endTimeVal}:59`).getTime();

  if (startTs > endTs) {
    showSummaryStatus('Start date/time must be before end date/time.', 'warn');
    return;
  }

  if (statusMsg) statusMsg.style.display = 'none';
  if (container) container.innerHTML = `
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <p>Loading summary data...</p>
    </div>`;

  firebase.database().ref('history')
    .orderByChild('time')
    .startAt(startTs)
    .endAt(endTs)
    .once('value')
    .then(snapshot => {
      const rawRows = [];
      snapshot.forEach(child => {
        const d = child.val();
        if (d.time && d.do !== undefined && d.salinity !== undefined &&
            d.temperature !== undefined && d.ph !== undefined && d.turbidity !== undefined) {
          rawRows.push({
            timestamp: new Date(d.time),
            do:          parseFloat(d.do),
            salinity:    parseFloat(d.salinity),
            temperature: parseFloat(d.temperature),
            ph:          parseFloat(d.ph),
            turbidity:   parseFloat(d.turbidity)
          });
        }
      });

      if (rawRows.length === 0) {
        if (container) container.innerHTML = '';
        showSummaryStatus(
          `<i class="fas fa-info-circle"></i> No readings found between
           <strong>${startDateVal} ${startTimeVal}</strong> and
           <strong>${endDateVal} ${endTimeVal}</strong>.`,
          'info'
        );
        return;
      }

      // Aggregate: group by date string (YYYY-MM-DD), compute min/avg/max per param
      const byDate = {};
      rawRows.forEach(row => {
        const dateKey = row.timestamp.toISOString().slice(0, 10);
        if (!byDate[dateKey]) {
          byDate[dateKey] = { do: [], salinity: [], temperature: [], ph: [], turbidity: [] };
        }
        Object.keys(OPTIMAL_RANGES).forEach(param => {
          byDate[dateKey][param].push(row[param]);
        });
      });

      // Build sorted date list covering every calendar day in range (gaps → null)
      const allDates = [];
      const cur = new Date(startDateVal);
      const end = new Date(endDateVal);
      while (cur <= end) {
        allDates.push(cur.toISOString().slice(0, 10));
        cur.setDate(cur.getDate() + 1);
      }

      // Build aggregated summary per date per param
      // Value is { min, avg, max } or null if no data that day
      const summaryData = {};
      Object.keys(OPTIMAL_RANGES).forEach(param => {
        summaryData[param] = allDates.map(date => {
          const vals = byDate[date]?.[param];
          if (!vals || vals.length === 0) return null;
          const sum = vals.reduce((a, b) => a + b, 0);
          return {
            min: Math.min(...vals),
            avg: parseFloat((sum / vals.length).toFixed(3)),
            max: Math.max(...vals)
          };
        });
      });

      // Friendly label: "Jul 1"
      const labels = allDates.map(d => {
        const [, m, day] = d.split('-');
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return `${months[parseInt(m) - 1]} ${parseInt(day)}`;
      });

      const totalReadings = rawRows.length;
      showSummaryStatus(
        `<i class="fas fa-check-circle"></i>
         Showing <strong>${totalReadings} readings</strong> from
         <strong>${startDateVal} ${startTimeVal}</strong> to
         <strong>${endDateVal} ${endTimeVal}</strong>
         across <strong>${allDates.length} day${allDates.length !== 1 ? 's' : ''}</strong>.`,
        'info'
      );

      // Store for re-render on checkbox change
      window._summaryState = { labels, summaryData, allDates };
      renderSummaryCharts();
    })
    .catch(err => {
      showSummaryStatus(`Error loading data: ${err.message}`, 'warn');
    });
}

/**
 * Render (or re-render) one grouped bar chart per active parameter.
 * Called on load and whenever a pill checkbox changes.
 */
function renderSummaryCharts() {
  const state = window._summaryState;
  const container = document.getElementById('summaryChartsContainer');
  if (!container) return;

  if (!state) {
    // No data loaded yet — show prompt
    container.innerHTML = `
      <div class="summary-no-data">
        <i class="fas fa-calendar-alt" style="font-size:2rem;opacity:0.35;display:block;margin-bottom:0.75rem;"></i>
        Select a date range and click <strong>Refresh</strong> to load summary data.
      </div>`;
    return;
  }

  const { labels, summaryData } = state;
  const activeParams = getSummaryActiveParams();

  if (activeParams.length === 0) {
    container.innerHTML = `
      <div class="summary-no-data">
        No parameters selected. Check at least one parameter above.
      </div>`;
    return;
  }

  // Destroy charts for params that are now hidden
  Object.keys(summaryCharts).forEach(param => {
    if (!activeParams.includes(param)) {
      summaryCharts[param]?.destroy();
      delete summaryCharts[param];
    }
  });

  // Build HTML skeleton for all active params first
  container.innerHTML = activeParams.map(param => `
    <div class="analytics-card summary-chart-card" id="summaryCard_${param}">
      <div class="card-header" style="border-bottom:none;margin-bottom:0.5rem;padding-bottom:0;">
        <div>
          <div class="summary-chart-title">
            <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${SUMMARY_COLORS[param].border};"></span>
            ${OPTIMAL_RANGES[param].label}
            <span style="font-size:0.78rem;font-weight:500;color:#64748b;">(${OPTIMAL_RANGES[param].unit || 'unitless'})</span>
          </div>
          <div class="card-subtitle">
            Min / Avg / Max per day &nbsp;·&nbsp;
            Safe range: ${OPTIMAL_RANGES[param].min} – ${OPTIMAL_RANGES[param].max} ${OPTIMAL_RANGES[param].unit}
          </div>
        </div>
      </div>
      <canvas id="summaryChart_${param}" style="max-height:320px;"></canvas>
    </div>
  `).join('');

  // Build each chart
  activeParams.forEach(param => {
    const ctx = document.getElementById(`summaryChart_${param}`)?.getContext('2d');
    if (!ctx) return;

    if (summaryCharts[param]) {
      summaryCharts[param].destroy();
      delete summaryCharts[param];
    }

    const data      = summaryData[param];          // array of {min,avg,max} | null
    const colors    = SUMMARY_COLORS[param];
    const cfg       = OPTIMAL_RANGES[param];

    // Build datasets — null becomes 0 with a noData flag for tooltip
    const minData = data.map(d => d === null ? 0 : d.min);
    const avgData = data.map(d => d === null ? 0 : d.avg);
    const maxData = data.map(d => d === null ? 0 : d.max);
    const noData  = data.map(d => d === null);     // bool array for tooltip

    summaryCharts[param] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Min',
            data: minData,
            backgroundColor: colors.min,
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: 4
          },
          {
            label: 'Avg',
            data: avgData,
            backgroundColor: colors.avg,
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: 4
          },
          {
            label: 'Max',
            data: maxData,
            backgroundColor: colors.max,
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        aspectRatio: 2.8,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { usePointStyle: true, padding: 18, font: { family: 'Inter', size: 12 } }
          },
          tooltip: {
            backgroundColor: 'rgba(15,23,42,0.93)',
            padding: 12,
            titleFont: { family: 'Inter', size: 13, weight: '600' },
            bodyFont:  { family: 'Inter', size: 12 },
            callbacks: {
              label: function(context) {
                const idx = context.dataIndex;
                if (noData[idx]) return `${context.dataset.label}: No data`;
                const unit = cfg.unit ? ` ${cfg.unit}` : '';
                return `${context.dataset.label}: ${context.parsed.y.toFixed(2)}${unit}`;
              }
            }
          },
          // Dashed safe-range annotation lines
          annotation: {
            annotations: {
              safeMin: {
                type: 'line',
                yMin: cfg.min,
                yMax: cfg.min,
                borderColor: '#10b981',
                borderWidth: 2,
                borderDash: [6, 4],
                label: {
                  display: true,
                  content: `Safe Min: ${cfg.min}${cfg.unit ? ' ' + cfg.unit : ''}`,
                  position: 'start',
                  backgroundColor: 'rgba(16,185,129,0.12)',
                  color: '#047857',
                  font: { family: 'Inter', size: 11, weight: '600' },
                  padding: { x: 8, y: 4 },
                  borderRadius: 4
                }
              },
              safeMax: {
                type: 'line',
                yMin: cfg.max,
                yMax: cfg.max,
                borderColor: '#f59e0b',
                borderWidth: 2,
                borderDash: [6, 4],
                label: {
                  display: true,
                  content: `Safe Max: ${cfg.max}${cfg.unit ? ' ' + cfg.unit : ''}`,
                  position: 'start',
                  backgroundColor: 'rgba(245,158,11,0.12)',
                  color: '#b45309',
                  font: { family: 'Inter', size: 11, weight: '600' },
                  padding: { x: 8, y: 4 },
                  borderRadius: 4
                }
              },
              critical: {
                type: 'line',
                yMin: cfg.critical,
                yMax: cfg.critical,
                borderColor: '#dc2626',
                borderWidth: 2,
                borderDash: [4, 3],
                label: {
                  display: true,
                  content: `Critical: ${cfg.critical}${cfg.unit ? ' ' + cfg.unit : ''}`,
                  position: 'end',
                  backgroundColor: 'rgba(220,38,38,0.12)',
                  color: '#b91c1c',
                  font: { family: 'Inter', size: 11, weight: '600' },
                  padding: { x: 8, y: 4 },
                  borderRadius: 4
                }
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: false,
            grid: { color: 'rgba(226,232,240,0.5)' },
            ticks: { font: { family: 'Inter', size: 11 } },
            title: {
              display: true,
              text: cfg.unit || param,
              font: { family: 'Inter', size: 11 }
            }
          },
          x: {
            grid: { display: false },
            ticks: { font: { family: 'Inter', size: 11 }, maxRotation: 45 }
          }
        }
      }
    });
  });
}

/** Show/hide the status info bar above the charts */
function showSummaryStatus(html, type) {
  const el = document.getElementById('summaryStatusMsg');
  if (!el) return;
  el.className = 'summary-status-info';
  if (type === 'warn') {
    el.style.background    = '#fffbeb';
    el.style.borderColor   = '#fcd34d';
    el.style.color         = '#92400e';
  } else {
    el.style.background    = '';
    el.style.borderColor   = '';
    el.style.color         = '';
  }
  el.innerHTML   = html;
  el.style.display = 'flex';
}

// Initialise defaults when page loads
window.addEventListener('load', function() {
  initSummaryDefaults();
});
