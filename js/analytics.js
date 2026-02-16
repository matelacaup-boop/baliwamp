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

// Initialize analytics when page loads
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
  const timeRange = document.getElementById('timeRange').value;
  
  // Calculate time range in milliseconds
  const now = Date.now();
  const hours = timeRange === '24h' ? 24 : timeRange === '7d' ? 168 : 
                timeRange === '30d' ? 720 : 2160;
  const startTime = now - (hours * 60 * 60 * 1000);
  
  // Show loading state
  const insightsList = document.getElementById('insightsList');
  insightsList.innerHTML = `
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <p>Loading data from Firebase...</p>
    </div>
  `;
  
  // Fetch from Firebase history node
  firebase.database().ref('history')
    .orderByChild('time')
    .startAt(startTime)
    .once('value')
    .then(snapshot => {
      analyticsData = [];
      
      snapshot.forEach(child => {
        const data = child.val();
        
        // Only include records that have all required fields
        if (data.time && data.temperature !== undefined && data.ph !== undefined && 
            data.salinity !== undefined && data.turbidity !== undefined && data.do !== undefined) {
          
          analyticsData.push({
            timestamp: new Date(data.time), // Convert timestamp to Date object
            do: parseFloat(data.do),
            salinity: parseFloat(data.salinity),
            temperature: parseFloat(data.temperature),
            ph: parseFloat(data.ph),
            turbidity: parseFloat(data.turbidity)
          });
        }
      });
      
      // Sort by timestamp (oldest to newest)
      analyticsData.sort((a, b) => a.timestamp - b.timestamp);
      
      console.log(`Loaded ${analyticsData.length} records from Firebase`);
      
      // Check if we have data
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
        return;
      }
      
      // Run analytics after data is loaded
      runStatisticalAnalysis();
      createTrendChart();
      createCorrelationCharts(); // Create all 3 time window charts
      
      // Show empty state since no charts are selected by default
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
// STATISTICAL ANALYSIS (Using simple-statistics)
// ==========================================

/**
 * Run statistical analysis on the loaded data
 * Uses Linear Regression, Z-Score, Correlation, and Predictions
 */
function runStatisticalAnalysis() {
  const insights = [];
  
  // 1. Trend Detection using Linear Regression
  Object.keys(OPTIMAL_RANGES).forEach(param => {
    const trendInsight = analyzeTrend(param);
    if (trendInsight) insights.push(trendInsight);
  });
  
  // 2. Anomaly Detection using Z-Score
  const anomalies = detectAnomalies();
  insights.push(...anomalies);
  
  // 3. Sensor-to-Sensor Correlation Analysis (NEW)
  const correlations = analyzeSensorCorrelations();
  insights.push(...correlations);
  
  // 4. Predictions/Forecasting (NEW)
  const predictions = generatePredictions();
  insights.push(...predictions);
  
  // Display insights
  displayInsights(insights);
}

/**
 * Analyze trend using Linear Regression
 * @param {string} parameter - The parameter to analyze (do, salinity, etc.)
 * @returns {object|null} - Insight object or null if no significant trend
 */
function analyzeTrend(parameter) {
  const values = analyticsData.map(d => d[parameter]);
  const indices = values.map((_, i) => i);
  
  // Prepare data points for regression [x, y]
  const points = indices.map((x, i) => [x, values[i]]);
  
  // Calculate linear regression using simple-statistics
  const regression = ss.linearRegression(points);
  const slope = regression.m; // m = slope, b = y-intercept
  
  // Calculate hourly change rate
  const timeRange = document.getElementById('timeRange').value;
  const hours = timeRange === '24h' ? 24 : timeRange === '7d' ? 168 : timeRange === '30d' ? 720 : 2160;
  const hourlyChange = slope * (analyticsData.length / hours);
  
  // Only report significant trends (threshold: 0.03)
  if (Math.abs(hourlyChange) > 0.03) {
    return {
      type: slope > 0 ? 'trend-up' : 'trend-down',
      icon: slope > 0 ? '📈' : '📉',
      message: `${OPTIMAL_RANGES[parameter].label} is ${slope > 0 ? 'increasing' : 'decreasing'} by ${Math.abs(hourlyChange).toFixed(3)} ${OPTIMAL_RANGES[parameter].unit}/hour`,
      severity: Math.abs(hourlyChange) > 0.1 ? 'warning' : 'info'
    };
  }
  
  return null;
}

/**
 * Detect anomalies using Z-Score analysis
 * @returns {array} - Array of anomaly insight objects
 */
function detectAnomalies() {
  const insights = [];
  const recentData = analyticsData.slice(-24); // Last 24 hours
  
  Object.keys(OPTIMAL_RANGES).forEach(param => {
    const allValues = analyticsData.map(d => d[param]);
    
    // Calculate mean and standard deviation using simple-statistics
    const mean = ss.mean(allValues);
    const stdDev = ss.standardDeviation(allValues);
    
    // Check recent readings for anomalies
    recentData.forEach(reading => {
      // Calculate Z-score: (value - mean) / standard deviation
      const zScore = (reading[param] - mean) / stdDev;
      
      // Z-score threshold: |z| > 2.5 indicates unusual reading
      // This means the value is 2.5+ standard deviations from the mean
      // Only ~1% of normal data falls beyond this range
      if (Math.abs(zScore) > 2.5) {
        insights.push({
          type: 'anomaly',
          icon: '⚡',
          message: `Unusual ${OPTIMAL_RANGES[param].label} detected: ${reading[param].toFixed(1)} ${OPTIMAL_RANGES[param].unit} (${Math.abs(zScore).toFixed(1)} standard deviations from normal)`,
          severity: 'warning',
          timestamp: reading.timestamp.toLocaleString()
        });
      }
    });
  });
  
  // Limit to most recent 3 anomalies to avoid clutter
  return insights.slice(0, 3);
}

/**
 * Analyze sensor-to-sensor correlations
 * Shows how different parameters affect each other
 * Now analyzes ALL 10 possible sensor combinations
 * @returns {array} - Array of correlation insight objects
 */
function analyzeSensorCorrelations() {
  const insights = [];
  const threshold = parseFloat(document.getElementById('correlationThreshold')?.value || 0.5);
  
  // Define ALL sensor pairs with user-friendly explanations
  const sensorPairs = [
    // DO Relationships
    {
      param1: 'temperature',
      param2: 'do',
      positiveExplanation: 'When water temperature rises, dissolved oxygen levels also increase',
      negativeExplanation: 'When water temperature rises, dissolved oxygen levels decrease',
      impact: 'This is critical for fish health - warm water typically holds less oxygen'
    },
    {
      param1: 'salinity',
      param2: 'do',
      positiveExplanation: 'Higher salinity leads to higher dissolved oxygen',
      negativeExplanation: 'Higher salinity leads to lower dissolved oxygen',
      impact: 'Salt content affects oxygen availability for fish'
    },
    {
      param1: 'ph',
      param2: 'do',
      positiveExplanation: 'Higher pH levels correlate with higher dissolved oxygen',
      negativeExplanation: 'Higher pH levels correlate with lower dissolved oxygen',
      impact: 'Water chemistry balance affects oxygen levels'
    },
    {
      param1: 'turbidity',
      param2: 'do',
      positiveExplanation: 'Cloudier water (higher turbidity) has more dissolved oxygen',
      negativeExplanation: 'Cloudier water (higher turbidity) has less dissolved oxygen',
      impact: 'Water clarity can indicate algae/plankton levels that affect oxygen'
    },
    
    // Temperature Relationships
    {
      param1: 'temperature',
      param2: 'ph',
      positiveExplanation: 'Higher temperatures lead to higher pH levels',
      negativeExplanation: 'Higher temperatures lead to lower pH levels',
      impact: 'Temperature changes can affect water acidity'
    },
    {
      param1: 'temperature',
      param2: 'salinity',
      positiveExplanation: 'Warmer water shows higher salinity readings',
      negativeExplanation: 'Warmer water shows lower salinity readings',
      impact: 'Temperature affects salt concentration and evaporation rates'
    },
    {
      param1: 'temperature',
      param2: 'turbidity',
      positiveExplanation: 'Higher temperatures increase water cloudiness',
      negativeExplanation: 'Higher temperatures decrease water cloudiness',
      impact: 'Warm water can promote algae growth affecting clarity'
    },
    
    // Salinity Relationships
    {
      param1: 'salinity',
      param2: 'ph',
      positiveExplanation: 'Higher salinity leads to higher pH levels',
      negativeExplanation: 'Higher salinity leads to lower pH levels',
      impact: 'Salt content influences water chemistry balance'
    },
    {
      param1: 'salinity',
      param2: 'turbidity',
      positiveExplanation: 'Higher salinity increases water cloudiness',
      negativeExplanation: 'Higher salinity decreases water cloudiness',
      impact: 'Salt concentration affects particle suspension'
    },
    
    // pH Relationships
    {
      param1: 'ph',
      param2: 'turbidity',
      positiveExplanation: 'Higher pH levels correlate with cloudier water',
      negativeExplanation: 'Higher pH levels correlate with clearer water',
      impact: 'Alkalinity affects particle behavior in water'
    }
  ];
  
  // Analyze each sensor pair
  sensorPairs.forEach(pair => {
    const values1 = analyticsData.map(d => d[pair.param1]);
    const values2 = analyticsData.map(d => d[pair.param2]);
    
    // Calculate Pearson correlation coefficient using simple-statistics
    const correlation = ss.sampleCorrelation(values1, values2);
    
    // DEBUG: Log correlation details for DO relationships
    if (pair.param2 === 'do' && Math.abs(correlation) > 0.5) {
      console.log(`\n=== CORRELATION DEBUG: ${pair.param1} vs DO ===`);
      console.log(`${pair.param1} values:`, values1.slice(0, 10), '...'); // First 10 values
      console.log(`DO values:`, values2.slice(0, 10), '...');
      console.log(`${pair.param1} - Min: ${Math.min(...values1).toFixed(2)}, Max: ${Math.max(...values1).toFixed(2)}, Avg: ${(values1.reduce((a,b) => a+b) / values1.length).toFixed(2)}`);
      console.log(`DO - Min: ${Math.min(...values2).toFixed(2)}, Max: ${Math.max(...values2).toFixed(2)}, Avg: ${(values2.reduce((a,b) => a+b) / values2.length).toFixed(2)}`);
      console.log(`Correlation coefficient: ${correlation.toFixed(4)} (${(Math.abs(correlation) * 100).toFixed(1)}%)`);
      console.log(`Standard deviation - ${pair.param1}: ${ss.standardDeviation(values1).toFixed(2)}, DO: ${ss.standardDeviation(values2).toFixed(2)}`);
    }
    
    // Only report correlations above threshold
    if (Math.abs(correlation) > threshold) {
      // Check if either variable has very low variance (nearly constant)
      const stdDev1 = ss.standardDeviation(values1);
      const stdDev2 = ss.standardDeviation(values2);
      const mean1 = ss.mean(values1);
      const mean2 = ss.mean(values2);
      
      // Coefficient of variation (CV) - if < 5%, variable is nearly constant
      const cv1 = (stdDev1 / mean1) * 100;
      const cv2 = (stdDev2 / mean2) * 100;
      
      // Skip correlation if either variable is too stable (< 2% variation)
      if (cv1 < 2 || cv2 < 2) {
        console.warn(`Skipping correlation for ${pair.param1} vs ${pair.param2}: One variable is too stable (CV1=${cv1.toFixed(1)}%, CV2=${cv2.toFixed(1)}%)`);
        return; // Skip this correlation - it's meaningless
      }
      
      let strength = '';
      if (Math.abs(correlation) > 0.8) strength = 'Very Strong';
      else if (Math.abs(correlation) > 0.7) strength = 'Strong';
      else if (Math.abs(correlation) > 0.5) strength = 'Moderate';
      else strength = 'Weak';
      
      const direction = correlation > 0 ? 'positive' : 'inverse';
      const percentage = Math.abs(correlation * 100).toFixed(0);
      
      // User-friendly message
      let message = '';
      if (correlation > 0) {
        message = `${strength} relationship: ${pair.positiveExplanation}`;
      } else {
        message = `${strength} relationship: ${pair.negativeExplanation}`;
      }
      
      // Add warning if one variable has low variation
      let detail = `${percentage}% ${direction} correlation. ${pair.impact}`;
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
        correlationValue: Math.abs(correlation)
      });
    }
  });
  
  // Sort by correlation strength (strongest first)
  insights.sort((a, b) => b.correlationValue - a.correlationValue);
  
  return insights;
}

/**
 * Generate predictions for the next few hours
 * Uses linear regression to forecast future values
 * Now customizable based on user settings
 * @returns {array} - Array of prediction insight objects
 */
function generatePredictions() {
  const insights = [];
  
  // Get user-selected settings
  const hoursAhead = parseInt(document.getElementById('predictionWindow')?.value || 6);
  const dataRangeHours = parseInt(document.getElementById('predictionDataRange')?.value || 48);
  
  // Calculate minimum data points needed
  const minimumDataPoints = Math.min(24, dataRangeHours);
  
  // Only predict if we have enough data
  if (analyticsData.length < minimumDataPoints) {
    return [{
      type: 'info',
      icon: 'ℹ️',
      message: `Need at least ${minimumDataPoints} hours of data for predictions. Currently have ${analyticsData.length} data points.`,
      severity: 'info',
      detail: 'Predictions will become available as more data is collected.'
    }];
  }
  
  // Analyze each parameter for predictions
  Object.keys(OPTIMAL_RANGES).forEach(param => {
    // Use the specified data range for prediction
    const dataPointsToUse = Math.min(analyticsData.length, dataRangeHours);
    const recent = analyticsData.slice(-dataPointsToUse);
    const values = recent.map((d, i) => [i, d[param]]);
    
    // Calculate linear regression
    const regression = ss.linearRegression(values);
    
    // Predict future value
    const futureIndex = values.length + (hoursAhead * (values.length / dataRangeHours));
    const predictedValue = regression.m * futureIndex + regression.b;
    
    const config = OPTIMAL_RANGES[param];
    const currentValue = analyticsData[analyticsData.length - 1][param];
    const change = predictedValue - currentValue;
    const percentChange = Math.abs((change / currentValue) * 100);
    
    // Calculate confidence based on data consistency
    const residuals = values.map(point => {
      const predicted = regression.m * point[0] + regression.b;
      return Math.abs(point[1] - predicted);
    });
    const avgError = ss.mean(residuals);
    const confidence = Math.max(0, Math.min(100, 100 - (avgError / currentValue * 100)));
    
    // Only report predictions with significant changes or critical levels
    if (Math.abs(regression.m) > 0.005 || predictedValue < config.critical || predictedValue > config.critical * 1.5) {
      
      // Determine accuracy warning based on prediction window
      let accuracyNote = '';
      if (hoursAhead <= 6) {
        accuracyNote = `High confidence (${confidence.toFixed(0)}%)`;
      } else if (hoursAhead <= 12) {
        accuracyNote = `Medium confidence (${confidence.toFixed(0)}%)`;
      } else {
        accuracyNote = `Lower confidence (${confidence.toFixed(0)}%) - longer predictions are less certain`;
      }
      
      // Critical prediction - will reach dangerous levels
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
      // Warning prediction - will leave optimal range
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
      // Info prediction - significant change but still safe
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
  
  // Sort predictions by priority (critical first)
  insights.sort((a, b) => (a.priority || 999) - (b.priority || 999));
  
  return insights;
}

/**
 * Display insights in the UI with severity filtering
 * Splits into Critical Alerts (top) and General Insights (bottom)
 * @param {array} insights - Array of insight objects
 */
function displayInsights(insights) {
  const criticalAlertsList = document.getElementById('criticalAlertsList');
  const criticalAlertsPanel = document.getElementById('criticalAlertsPanel');
  const insightsList = document.getElementById('insightsList');
  
  // Apply severity filter
  const severityFilter = document.getElementById('severityFilter')?.value || 'all';
  let filteredInsights = insights;
  
  if (severityFilter === 'danger') {
    filteredInsights = insights.filter(i => i.severity === 'danger');
  } else if (severityFilter === 'warning-up') {
    filteredInsights = insights.filter(i => i.severity === 'danger' || i.severity === 'warning');
  } else if (severityFilter === 'info-up') {
    filteredInsights = insights.filter(i => i.severity !== 'success');
  }
  
  // Split insights by severity
  const criticalInsights = filteredInsights.filter(i => i.severity === 'danger' || i.severity === 'warning');
  const generalInsights = filteredInsights.filter(i => i.severity === 'info' || i.severity === 'success');
  
  // === CRITICAL ALERTS PANEL (TOP) ===
  if (criticalInsights.length > 0) {
    criticalAlertsPanel.style.display = 'block';
    
    const criticalCount = criticalInsights.filter(i => i.severity === 'danger').length;
    const warningCount = criticalInsights.filter(i => i.severity === 'warning').length;
    
    let countText = '';
    if (criticalCount > 0 && warningCount > 0) {
      countText = `${criticalCount} Critical, ${warningCount} Warning`;
    } else if (criticalCount > 0) {
      countText = `${criticalCount} Critical Alert${criticalCount > 1 ? 's' : ''}`;
    } else {
      countText = `${warningCount} Warning${warningCount > 1 ? 's' : ''}`;
    }
    
    criticalAlertsList.innerHTML = `
      <div style="background: rgba(255, 255, 255, 0.9); padding: 0.75rem 1rem; border-radius: 8px; margin-bottom: 1rem; font-size: 0.9rem; color: #991b1b; font-weight: 600;">
        ⚠️ ${countText} Requiring Attention
      </div>
    ` + criticalInsights.map(insight => `
      <div class="insight-item" style="background: white; border-left: 4px solid ${insight.severity === 'danger' ? '#dc2626' : '#f59e0b'};">
        <div class="insight-icon" style="background: ${insight.severity === 'danger' ? '#fee2e2' : '#fed7aa'};">${insight.icon}</div>
        <div class="insight-content">
          <div class="insight-message">${insight.message}</div>
          ${insight.detail ? `<div style="font-size: 0.85rem; color: #64748b; margin-top: 0.5rem; line-height: 1.4;">${insight.detail}</div>` : ''}
          <span class="insight-severity ${insight.severity}">${insight.severity}</span>
          ${insight.timestamp ? `<div style="font-size: 0.8rem; color: #64748b; margin-top: 0.25rem;">Detected at: ${insight.timestamp}</div>` : ''}
        </div>
      </div>
    `).join('');
  } else {
    criticalAlertsPanel.style.display = 'none';
  }
  
  // === GENERAL INSIGHTS PANEL (BOTTOM) ===
  if (generalInsights.length === 0 && criticalInsights.length === 0) {
    insightsList.innerHTML = `
      <div class="insight-item">
        <div class="insight-icon">✅</div>
        <div class="insight-content">
          <div class="insight-message">No insights match your current filter settings. ${severityFilter !== 'all' ? 'Try changing the severity filter to see more insights.' : 'Water quality parameters are stable.'}</div>
          <span class="insight-severity success">All Clear</span>
        </div>
      </div>
    `;
    return;
  }
  
  if (generalInsights.length > 0) {
    // Add count header
    const totalCount = insights.length;
    const showingCount = generalInsights.length;
    const filterNote = severityFilter !== 'all' ? ` (filtered from ${totalCount} total)` : '';
    
    insightsList.innerHTML = `
      <div style="background: rgba(255, 255, 255, 0.5); padding: 0.75rem 1rem; border-radius: 8px; margin-bottom: 1rem; font-size: 0.9rem; color: #92400e; font-weight: 600;">
        📊 Showing ${showingCount} insight${showingCount !== 1 ? 's' : ''}${filterNote}
      </div>
    ` + generalInsights.map(insight => `
      <div class="insight-item">
        <div class="insight-icon">${insight.icon}</div>
        <div class="insight-content">
          <div class="insight-message">${insight.message}</div>
          ${insight.detail ? `<div style="font-size: 0.85rem; color: #64748b; margin-top: 0.5rem; line-height: 1.4;">${insight.detail}</div>` : ''}
          <span class="insight-severity ${insight.severity}">${insight.severity}</span>
          ${insight.timestamp ? `<div style="font-size: 0.8rem; color: #64748b; margin-top: 0.25rem;">Detected at: ${insight.timestamp}</div>` : ''}
        </div>
      </div>
    `).join('');
  } else if (criticalInsights.length > 0) {
    // Only critical alerts, no general insights
    insightsList.innerHTML = `
      <div class="insight-item">
        <div class="insight-icon">ℹ️</div>
        <div class="insight-content">
          <div class="insight-message">All insights are critical alerts (shown above). No additional patterns or correlations detected at this time.</div>
          <span class="insight-severity info">Info</span>
        </div>
      </div>
    `;
  }
}

// ==========================================
// CHART CREATION
// ==========================================

/**
 * Create trend analysis chart
 */
function createTrendChart() {
  const ctx = document.getElementById('trendChart').getContext('2d');
  
  // Destroy existing chart if it exists
  if (trendChart) {
    trendChart.destroy();
  }
  
  // Prepare labels
  const labels = analyticsData.map(d => d.timestamp.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit'
  }));
  
  // Create chart
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
          tension: 0.4,
          fill: false
        },
        {
          label: 'Temperature (°C)',
          data: analyticsData.map(d => d.temperature),
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245, 158, 11, 0.1)',
          tension: 0.4,
          fill: false
        },
        {
          label: 'pH',
          data: analyticsData.map(d => d.ph),
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          tension: 0.4,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 2.5,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            usePointStyle: true,
            padding: 20,
            font: { family: 'Inter', size: 12 }
          }
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
          beginAtZero: false,
          grid: { color: 'rgba(226, 232, 240, 0.5)' },
          ticks: { font: { family: 'Inter' } }
        },
        x: {
          grid: { display: false },
          ticks: {
            maxRotation: 45,
            minRotation: 45,
            font: { family: 'Inter', size: 10 }
          }
        }
      }
    }
  });
}

/**
 * Create all multi-parameter correlation charts (user-selected time windows)
 * Shows 6h, 12h, and 24h views with zoom/pan capability
 */
function createCorrelationCharts() {
  // Only create charts that are checked
  if (document.getElementById('show6h')?.checked) {
    createCorrelationChart('6h', 6);
  }
  if (document.getElementById('show12h')?.checked) {
    createCorrelationChart('12h', 12);
  }
  if (document.getElementById('show24h')?.checked) {
    createCorrelationChart('24h', 24);
  }
}

/**
 * Toggle visibility of a time window chart
 * @param {string} chartId - '6h', '12h', or '24h'
 */
function toggleTimeWindow(chartId) {
  const section = document.getElementById(`section${chartId}`);
  const checkbox = document.getElementById(`show${chartId}`);
  
  if (checkbox.checked) {
    // Show and create chart
    section.style.display = 'block';
    createCorrelationChart(chartId, parseInt(chartId));
  } else {
    // Hide chart
    section.style.display = 'none';
    
    // Destroy chart to save memory
    const chart = chartId === '6h' ? correlationChart6h : 
                  chartId === '12h' ? correlationChart12h : correlationChart24h;
    if (chart) {
      chart.destroy();
      if (chartId === '6h') correlationChart6h = null;
      else if (chartId === '12h') correlationChart12h = null;
      else if (chartId === '24h') correlationChart24h = null;
    }
  }
  
  // Update empty state visibility
  updateEmptyState();
}

/**
 * Show/hide empty state message based on whether any charts are selected
 */
function updateEmptyState() {
  const emptyState = document.getElementById('emptyStateMessage');
  const show6h = document.getElementById('show6h')?.checked || false;
  const show12h = document.getElementById('show12h')?.checked || false;
  const show24h = document.getElementById('show24h')?.checked || false;
  
  // Show empty state only if nothing is selected
  if (!show6h && !show12h && !show24h) {
    if (emptyState) emptyState.style.display = 'block';
  } else {
    if (emptyState) emptyState.style.display = 'none';
  }
}

/**
 * Create a single correlation chart for a specific time window
 * @param {string} chartId - '6h', '12h', or '24h'
 * @param {number} hours - Number of hours to display
 */
function createCorrelationChart(chartId, hours) {
  const canvasId = `correlationChart${chartId}`;
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  
  if (!ctx) {
    console.error(`Canvas ${canvasId} not found`);
    return;
  }
  
  // Destroy existing chart if it exists
  const chartVar = chartId === '6h' ? correlationChart6h : 
                   chartId === '12h' ? correlationChart12h : correlationChart24h;
  if (chartVar) {
    chartVar.destroy();
  }
  
  // Get data for this time window
  const now = new Date();
  const startTime = new Date(now - hours * 60 * 60 * 1000);
  const windowData = analyticsData.filter(d => d.timestamp >= startTime);
  
  // Update data count badge
  const countElement = document.getElementById(`count${chartId}`);
  if (countElement) {
    countElement.textContent = `${windowData.length} readings`;
  }
  
  // If no data, show message
  if (windowData.length === 0) {
    console.warn(`No data available for the last ${hours} hours`);
    if (countElement) {
      countElement.textContent = 'No data';
      countElement.style.background = '#fee2e2';
      countElement.style.color = '#991b1b';
    }
    return;
  }
  
  console.log(`${chartId} chart: Showing ${windowData.length} data points from last ${hours} hours`);
  
  // Format labels based on time window
  const labels = windowData.map(d => d.timestamp.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: hours <= 6 ? '2-digit' : undefined,
    hour12: true
  }));
  
  // Create chart with zoom plugin
  const newChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'DO',
          data: windowData.map(d => d.do),
          borderColor: '#0ea5e9',
          backgroundColor: 'rgba(14, 165, 233, 0.1)',
          borderWidth: 2,
          pointRadius: hours <= 6 ? 3 : 2,
          pointHoverRadius: 5,
          tension: 0.3,
          yAxisID: 'y'
        },
        {
          label: 'Salinity',
          data: windowData.map(d => d.salinity),
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          borderWidth: 2,
          pointRadius: hours <= 6 ? 3 : 2,
          pointHoverRadius: 5,
          tension: 0.3,
          yAxisID: 'y1'
        },
        {
          label: 'Temperature',
          data: windowData.map(d => d.temperature),
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245, 158, 11, 0.1)',
          borderWidth: 2,
          pointRadius: hours <= 6 ? 3 : 2,
          pointHoverRadius: 5,
          tension: 0.3,
          yAxisID: 'y2'
        },
        {
          label: 'pH',
          data: windowData.map(d => d.ph),
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          borderWidth: 2,
          pointRadius: hours <= 6 ? 3 : 2,
          pointHoverRadius: 5,
          tension: 0.3,
          yAxisID: 'y3'
        },
        {
          label: 'Turbidity',
          data: windowData.map(d => d.turbidity),
          borderColor: '#8b5cf6',
          backgroundColor: 'rgba(139, 92, 246, 0.1)',
          borderWidth: 2,
          pointRadius: hours <= 6 ? 3 : 2,
          pointHoverRadius: 5,
          tension: 0.3,
          yAxisID: 'y4'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 2.2,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            usePointStyle: true,
            padding: 15,
            font: { family: 'Inter', size: 11 }
          }
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          padding: 12,
          titleFont: { family: 'Inter', size: 13 },
          bodyFont: { family: 'Inter', size: 12 },
          displayColors: true,
          callbacks: {
            label: function(context) {
              let label = context.dataset.label || '';
              if (label) {
                label += ': ';
              }
              label += context.parsed.y.toFixed(2);
              const units = {
                'DO': ' mg/L',
                'Salinity': ' ppt',
                'Temperature': ' °C',
                'pH': '',
                'Turbidity': ' cm'
              };
              label += units[context.dataset.label] || '';
              return label;
            }
          }
        },
        zoom: {
          pan: {
            enabled: true,
            mode: 'x',
            modifierKey: null,
          },
          zoom: {
            wheel: {
              enabled: true,
              speed: 0.1
            },
            pinch: {
              enabled: true
            },
            mode: 'x',
          },
          limits: {
            x: {
              min: 'original',
              max: 'original'
            }
          }
        }
      },
      scales: {
        y: { 
          position: 'left', 
          title: { 
            display: true, 
            text: 'DO (mg/L)', 
            font: { family: 'Inter', size: 11 } 
          },
          grid: { color: 'rgba(226, 232, 240, 0.5)' }
        },
        y1: { 
          position: 'right', 
          title: { 
            display: true, 
            text: 'Salinity (ppt)', 
            font: { family: 'Inter', size: 11 } 
          }, 
          grid: { drawOnChartArea: false } 
        },
        y2: { 
          position: 'right', 
          title: { 
            display: true, 
            text: 'Temp (°C)', 
            font: { family: 'Inter', size: 11 } 
          }, 
          grid: { drawOnChartArea: false } 
        },
        y3: { 
          position: 'right', 
          title: { 
            display: true, 
            text: 'pH', 
            font: { family: 'Inter', size: 11 } 
          }, 
          grid: { drawOnChartArea: false } 
        },
        y4: { 
          position: 'right', 
          title: { 
            display: true, 
            text: 'Turbidity (cm)', 
            font: { family: 'Inter', size: 11 } 
          }, 
          grid: { drawOnChartArea: false } 
        },
        x: {
          grid: { display: false },
          ticks: {
            maxRotation: 45,
            minRotation: 45,
            font: { family: 'Inter', size: 10 }
          }
        }
      }
    }
  });
  
  // Store chart reference
  if (chartId === '6h') correlationChart6h = newChart;
  else if (chartId === '12h') correlationChart12h = newChart;
  else if (chartId === '24h') correlationChart24h = newChart;
}

/**
 * Reset zoom for a specific chart
 * @param {string} chartId - '6h', '12h', or '24h'
 */
function resetZoom(chartId) {
  const chart = chartId === '6h' ? correlationChart6h : 
                chartId === '12h' ? correlationChart12h : correlationChart24h;
  
  if (chart && chart.resetZoom) {
    chart.resetZoom();
  }
}

// ==========================================
// USER INTERACTIONS
// ==========================================

/**
 * Change chart type (line or area)
 * @param {string} type - 'line' or 'area'
 */
function changeChartType(type) {
  const buttons = document.querySelectorAll('.chart-controls button');
  buttons.forEach(btn => btn.classList.remove('active'));
  event.target.classList.add('active');
  
  if (type === 'area') {
    trendChart.data.datasets.forEach(dataset => {
      dataset.fill = true;
    });
  } else {
    trendChart.data.datasets.forEach(dataset => {
      dataset.fill = false;
    });
  }
  trendChart.update();
}

/**
 * Update chart based on parameter filter
 */
function updateChartParameter() {
  const param = document.getElementById('parameterFilter').value;
  
  if (param === 'all') {
    trendChart.data.datasets.forEach(dataset => dataset.hidden = false);
  } else {
    trendChart.data.datasets.forEach(dataset => {
      const datasetParam = dataset.label.toLowerCase();
      dataset.hidden = !datasetParam.includes(param);
    });
  }
  trendChart.update();
}

/**
 * Update analytics when settings change
 * Re-runs analysis without reloading data from Firebase
 */
function updateAnalytics() {
  if (analyticsData.length > 0) {
    runStatisticalAnalysis();
  }
}