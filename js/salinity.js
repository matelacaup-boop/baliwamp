// salinity.js — Firebase only, TODAY data only
document.addEventListener("DOMContentLoaded", () => {
    console.log("Salinity page loaded");

    if (!window.database) {
        console.error("Firebase not initialized");
        return;
    }

    const db = window.database;

    // -------- DOM --------
    const currentEl = document.getElementById("currentSalinity");
    const statEl = document.getElementById("currentStat");
    const avgEl = document.getElementById("avgSalinity");
    const highEl = document.getElementById("highSalinity");
    const lowEl = document.getElementById("lowSalinity");
    const statusEl = document.getElementById("salinityStatus");
    const lastUpdateEl = document.getElementById("lastUpdate");

    let currentSalinity = null;
    let thresholds = null;
    let historyData = [];

    // -------- CHART --------
    const ctx = document.getElementById("salinityChart").getContext("2d");

    const salinityChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: [],
            datasets: [{
                label: "Salinity (ppt)",
                data: [],
                borderWidth: 3,
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: {
                x: { title: { display: true, text: "Time" } },
                y: { title: { display: true, text: "ppt" } }
            }
        }
    });

    // -------- THRESHOLDS --------
    db.ref("thresholds/salinity").on("value", snap => {
        if (snap.exists()) {
            thresholds = snap.val();
            updateStatus();
        }
    });

    // -------- CURRENT VALUE --------
    db.ref("sensors/salinity").on("value", snap => {
        if (!snap.exists()) return;

        currentSalinity = snap.val();
        currentEl.textContent = currentSalinity.toFixed(1) + " ppt";
        statEl.textContent = currentSalinity.toFixed(1) + " ppt";

        updateStatus();
    });

    // -------- LAST UPDATE --------
    db.ref("sensors/lastUpdate").on("value", snap => {
        if (!snap.exists()) {
            lastUpdateEl.textContent = "--";
            return;
        }
        lastUpdateEl.textContent = new Date(snap.val()).toLocaleString();
    });

    // -------- HISTORY (TODAY ONLY) --------
    db.ref("history").limitToLast(500).on("value", snap => {
        historyData = [];

        if (snap.exists()) {
            snap.forEach(child => {
                const v = child.val();
                if (v.salinity !== undefined && v.time) {
                    historyData.push({
                        value: v.salinity,
                        time: v.time
                    });
                }
            });
        }

        const today = new Date().toDateString();

        historyData = historyData
            .filter(d => new Date(d.time).toDateString() === today)
            .sort((a, b) => a.time - b.time);

        salinityChart.data.labels = historyData.map(d =>
            new Date(d.time).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit"
            })
        );

        salinityChart.data.datasets[0].data =
            historyData.map(d => d.value);

        salinityChart.update();

        if (historyData.length) {
            const values = historyData.map(d => d.value);
            avgEl.textContent = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1) + " ppt";
            highEl.textContent = Math.max(...values).toFixed(1) + " ppt";
            lowEl.textContent = Math.min(...values).toFixed(1) + " ppt";
        } else {
            avgEl.textContent = "--";
            highEl.textContent = "--";
            lowEl.textContent = "--";
        }
    });

    // -------- STATUS --------
    function updateStatus() {
        if (currentSalinity === null || !thresholds) return;

        const { safeMin, safeMax, warnMin, warnMax } = thresholds;

        let status = "SAFE";
        let cls = "status-badge status-safe";

        if (currentSalinity < warnMin || currentSalinity > warnMax) {
            status = "CRITICAL";
            cls = "status-badge status-critical";
        } else if (currentSalinity < safeMin || currentSalinity > safeMax) {
            status = "CAUTION";
            cls = "status-badge status-caution";
        }

        statusEl.textContent = status;
        statusEl.className = cls;
    }
});
