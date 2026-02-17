// do.js
document.addEventListener("DOMContentLoaded", () => {
    console.log("DO page loaded (Firebase + thresholds)");

    /* =========================
       ELEMENT REFERENCES
    ========================== */
    const currentDOEl = document.getElementById("currentDO");
    const currentStatEl = document.getElementById("currentStat");
    const avgEl = document.getElementById("avgDO");
    const highEl = document.getElementById("highDO");
    const lowEl = document.getElementById("lowDO");
    const statusEl = document.getElementById("doStatus");
    const lastUpdateEl = document.getElementById("lastUpdate");

    const ctx = document.getElementById("doChart").getContext("2d");

    /* =========================
       STATE
    ========================== */
    let currentDO = null;
    let doThresholds = null;
    let chart = null;

    /* =========================
       CHART SETUP
    ========================== */
    function renderChart(labels, values) {
        if (chart) chart.destroy();

        chart = new Chart(ctx, {
            type: "line",
            data: {
                labels,
                datasets: [{
                    label: "Dissolved Oxygen (mg/L)",
                    data: values,
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: true }
                },
                scales: {
                    x: {
                        title: { display: true, text: "Time" }
                    },
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: "mg/L" }
                    }
                }
            }
        });
    }

    /* =========================
       STATS CALCULATION
    ========================== */
    function updateStats(values) {
        if (!values.length) {
            avgEl.textContent = "-- mg/L";
            highEl.textContent = "-- mg/L";
            lowEl.textContent = "-- mg/L";
            return;
        }

        const sum = values.reduce((a, b) => a + b, 0);
        avgEl.textContent = (sum / values.length).toFixed(2) + " mg/L";
        highEl.textContent = Math.max(...values).toFixed(2) + " mg/L";
        lowEl.textContent = Math.min(...values).toFixed(2) + " mg/L";
    }

    /* =========================
       STATUS LOGIC (THRESHOLDS)
    ========================== */
    function updateStatus() {
        if (currentDO === null || !doThresholds) return;

        const { safeMin, safeMax, warnMin, warnMax } = doThresholds;

        let status = "SAFE";
        let className = "status-badge status-safe";

        if (currentDO < warnMin || currentDO > warnMax) {
            status = "CRITICAL";
            className = "status-badge status-critical";
        } else if (currentDO < safeMin || currentDO > safeMax) {
            status = "CAUTION";
            className = "status-badge status-caution";
        }

        statusEl.textContent = status;
        statusEl.className = className;
    }

    /* =========================
       LIVE SENSOR VALUE
    ========================== */
    database.ref("sensors/do").on("value", snapshot => {
        const value = snapshot.val();
        if (value === null) return;

        currentDO = value;

        currentDOEl.textContent = value.toFixed(2) + " mg/L";
        currentStatEl.textContent = value.toFixed(2) + " mg/L";

        updateStatus();
    });

    /* =========================
       THRESHOLDS
    ========================== */
    database.ref("thresholds/do").on("value", snapshot => {
        doThresholds = snapshot.val();
        updateStatus();
    });

    /* =========================
       LAST UPDATE (DATE + TIME)
    ========================== */
    database.ref("sensors/lastUpdate").on("value", snapshot => {
        const ts = snapshot.val();
        if (!ts) {
            lastUpdateEl.textContent = "--";
            return;
        }

        lastUpdateEl.textContent = new Date(ts).toLocaleString(undefined, {
            year: "numeric",
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        });
    });

    /* =========================
       HISTORY (TODAY)
    ========================== */
    database.ref("history").limitToLast(300).on("value", snapshot => {
        const labels = [];
        const values = [];

        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        snapshot.forEach(child => {
            const h = child.val();
            if (!h || h.do === undefined || !h.time) return;

            const t = new Date(h.time);
            if (t >= startOfDay) {
                labels.push(
                    t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                );
                values.push(h.do);
            }
        });

        renderChart(labels, values);
        updateStats(values);
    });
});
