// ph.js — Firebase-based, NO live data
document.addEventListener("DOMContentLoaded", () => {
    console.log("pH page loaded");

    if (!window.database) {
        console.error("Firebase not initialized");
        return;
    }

    const db = window.database;

    // -------- DOM ELEMENTS --------
    const currentEl = document.getElementById("currentPH");
    const statEl = document.getElementById("currentStat");
    const avgEl = document.getElementById("avgPH");
    const highEl = document.getElementById("highPH");
    const lowEl = document.getElementById("lowPH");
    const statusEl = document.getElementById("phStatus");
    const lastUpdateEl = document.getElementById("lastUpdate");

    let currentPH = null;
    let thresholds = null;
    let historyData = [];

    // -------- CHART --------
    const ctx = document.getElementById("phChart").getContext("2d");

    const phChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: [],
            datasets: [{
                label: "pH Level",
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
                x: {
                    title: { display: true, text: "Time" }
                },
                y: {
                    title: { display: true, text: "pH Level" },
                    min: 4,
                    max: 10
                }
            }
        }
    });

    // -------- THRESHOLDS --------
    db.ref("thresholds/ph").on("value", snap => {
        if (snap.exists()) {
            thresholds = snap.val();
            updateStatus();
        }
    });

    // -------- CURRENT PH --------
    db.ref("sensors/ph").on("value", snap => {
        if (!snap.exists()) return;

        currentPH = snap.val();
        currentEl.textContent = currentPH.toFixed(2);
        statEl.textContent = currentPH.toFixed(2);

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
    db.ref("history").limitToLast(300).on("value", snap => {
        historyData = [];

        if (snap.exists()) {
            snap.forEach(child => {
                const v = child.val();
                if (v.ph !== undefined && v.time) {
                    historyData.push({
                        value: v.ph,
                        time: v.time
                    });
                }
            });
        }

        const today = new Date().toDateString();

        historyData = historyData
            .filter(d => new Date(d.time).toDateString() === today)
            .sort((a, b) => a.time - b.time);

        phChart.data.labels = historyData.map(d =>
            new Date(d.time).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit"
            })
        );

        phChart.data.datasets[0].data =
            historyData.map(d => d.value);

        phChart.update();

        if (historyData.length) {
            const values = historyData.map(d => d.value);
            avgEl.textContent = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2);
            highEl.textContent = Math.max(...values).toFixed(2);
            lowEl.textContent = Math.min(...values).toFixed(2);
        } else {
            avgEl.textContent = "--";
            highEl.textContent = "--";
            lowEl.textContent = "--";
        }
    });

    // -------- STATUS LOGIC --------
    function updateStatus() {
        if (currentPH === null || !thresholds) return;

        const { safeMin, safeMax, warnMin, warnMax } = thresholds;

        let status = "SAFE";
        let cls = "status-badge status-safe";

        if (currentPH < warnMin || currentPH > warnMax) {
            status = "CRITICAL";
            cls = "status-badge status-critical";
        } else if (currentPH < safeMin || currentPH > safeMax) {
            status = "CAUTION";
            cls = "status-badge status-caution";
        }

        statusEl.textContent = status;
        statusEl.className = cls;
    }
});
