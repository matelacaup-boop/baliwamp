// temp.js
document.addEventListener("DOMContentLoaded", () => {
    console.log("Temperature page loaded (Firebase + thresholds)");

    /* =========================
       ELEMENT REFERENCES
    ========================== */
    const currentTempEl = document.getElementById("currentTemp");
    const currentStatEl = document.getElementById("currentStat");
    const avgEl = document.getElementById("avgTemp");
    const highEl = document.getElementById("highTemp");
    const lowEl = document.getElementById("lowTemp");
    const statusEl = document.getElementById("tempStatus");
    const lastUpdateEl = document.getElementById("lastUpdate");

    const ctx = document.getElementById("tempChart").getContext("2d");

    /* =========================
       STATE
    ========================== */
    let currentTemp = null;
    let tempThresholds = null;
    let chart = null;

    /* =========================
       CHART
    ========================== */
    function renderChart(labels, values) {
        if (chart) chart.destroy();

        chart = new Chart(ctx, {
            type: "line",
            data: {
                labels,
                datasets: [{
                    label: "Temperature (°C)",
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
                        title: { display: true, text: "°C" }
                    }
                }
            }
        });
    }

    /* =========================
       STATS
    ========================== */
    function updateStats(values) {
        if (!values.length) {
            avgEl.textContent = "-- °C";
            highEl.textContent = "-- °C";
            lowEl.textContent = "-- °C";
            return;
        }

        const sum = values.reduce((a, b) => a + b, 0);
        avgEl.textContent = (sum / values.length).toFixed(2) + " °C";
        highEl.textContent = Math.max(...values).toFixed(2) + " °C";
        lowEl.textContent = Math.min(...values).toFixed(2) + " °C";
    }

    /* =========================
       STATUS (FROM THRESHOLDS)
    ========================== */
    function updateStatus() {
        if (currentTemp === null || !tempThresholds) return;

        const { safeMin, safeMax, warnMin, warnMax } = tempThresholds;

        let status = "SAFE";
        let className = "status-badge status-safe";

        if (currentTemp < warnMin || currentTemp > warnMax) {
            status = "CRITICAL";
            className = "status-badge status-critical";
        } 
        else if (currentTemp < safeMin || currentTemp > safeMax) {
            status = "CAUTION";
            className = "status-badge status-caution";
        }

        statusEl.textContent = status;
        statusEl.className = className;
    }

    /* =========================
       CURRENT TEMPERATURE
    ========================== */
    database.ref("sensors/temperature").on("value", snapshot => {
        const value = snapshot.val();
        if (value === null) return;

        currentTemp = value;

        currentTempEl.textContent = value.toFixed(2) + " °C";
        currentStatEl.textContent = value.toFixed(2) + " °C";

        updateStatus();
    });

    /* =========================
       THRESHOLDS
    ========================== */
    database.ref("thresholds/temperature").on("value", snapshot => {
        tempThresholds = snapshot.val();
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
            if (!h || h.temperature === undefined || !h.time) return;

            const t = new Date(h.time);
            if (t >= startOfDay) {
                labels.push(
                    t.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit"
                    })
                );
                values.push(h.temperature);
            }
        });

        renderChart(labels, values);
        updateStats(values);
    });
});
