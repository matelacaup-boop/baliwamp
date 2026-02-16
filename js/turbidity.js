// turbidity.js — Firebase only, TODAY data only
document.addEventListener("DOMContentLoaded", () => {
    console.log("Turbidity page loaded");

    if (!window.database) {
        console.error("Firebase not initialized");
        return;
    }

    const db = window.database;

    // -------- DOM --------
    const currentEl = document.getElementById("currentTurbidity");
    const statEl = document.getElementById("currentStat");
    const avgEl = document.getElementById("avgTurbidity");
    const highEl = document.getElementById("highTurbidity");
    const lowEl = document.getElementById("lowTurbidity");
    const statusEl = document.getElementById("turbidityStatus");
    const lastUpdateEl = document.getElementById("lastUpdate");

    let currentValue = null;
    let thresholds = null;
    let historyData = [];

    // -------- CHART --------
    const ctx = document.getElementById("turbidityChart").getContext("2d");

    const turbidityChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: [],
            datasets: [{
                label: "Turbidity (NTU)",
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
                y: {
                    title: { display: true, text: "NTU" },
                    beginAtZero: true
                }
            }
        }
    });

    // -------- THRESHOLDS --------
    db.ref("thresholds/turbidity").on("value", snap => {
        if (snap.exists()) {
            thresholds = snap.val();
            updateStatus();
        }
    });

    // -------- CURRENT VALUE --------
    db.ref("sensors/turbidity").on("value", snap => {
        if (!snap.exists()) return;

        currentValue = snap.val();
        currentEl.textContent = currentValue.toFixed(1) + " NTU";
        statEl.textContent = currentValue.toFixed(1) + " NTU";

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
                if (v.turbidity !== undefined && v.time) {
                    historyData.push({
                        value: v.turbidity,
                        time: v.time
                    });
                }
            });
        }

        const today = new Date().toDateString();

        historyData = historyData
            .filter(d => new Date(d.time).toDateString() === today)
            .sort((a, b) => a.time - b.time);

        turbidityChart.data.labels = historyData.map(d =>
            new Date(d.time).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit"
            })
        );

        turbidityChart.data.datasets[0].data =
            historyData.map(d => d.value);

        turbidityChart.update();

        if (historyData.length) {
            const values = historyData.map(d => d.value);
            avgEl.textContent =
                (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1) + " NTU";
            highEl.textContent = Math.max(...values).toFixed(1) + " NTU";
            lowEl.textContent = Math.min(...values).toFixed(1) + " NTU";
        } else {
            avgEl.textContent = "--";
            highEl.textContent = "--";
            lowEl.textContent = "--";
        }
    });

    // -------- STATUS --------
    function updateStatus() {
        if (currentValue === null || !thresholds) return;

        const { safeMin, safeMax, warnMin, warnMax } = thresholds;

        let status = "SAFE";
        let cls = "status-badge status-safe";

        if (currentValue < warnMin || currentValue > warnMax) {
            status = "CRITICAL";
            cls = "status-badge status-critical";
        } else if (currentValue < safeMin || currentValue > safeMax) {
            status = "CAUTION";
            cls = "status-badge status-caution";
        }

        statusEl.textContent = status;
        statusEl.className = cls;
    }

    // -------- THEME --------
    window.toggleSettings = () => {
        document.getElementById("settingsPanel")?.classList.toggle("open");
    };

    window.setTheme = mode => {
        if (mode === "dark") {
            document.body.classList.add("dark");
            localStorage.setItem("theme", "dark");
        } else {
            document.body.classList.remove("dark");
            localStorage.setItem("theme", "light");
        }
        toggleSettings();
    };

    if (localStorage.getItem("theme") === "dark") {
        document.body.classList.add("dark");
    }
});
