// Client-side script for the standalone balance HTML report.
//
// This script powers metric switching, profile filtering, rerun-command copy,
// and chart/matrix rerendering in the generated HTML report.

const reportPayload = JSON.parse(document.getElementById("report-data").textContent || "{}");
const rawRows = Array.isArray(reportPayload.rows) ? reportPayload.rows : [];
const rerunCommand = typeof reportPayload.rerunCommand === "string" ? reportPayload.rerunCommand : "";
const profileOrder = [...new Set(rawRows.map((row) => row.profileKey))];
const zoneOrder = [...new Set(rawRows.map((row) => row.combatZoneId))];
const rowByKey = Object.create(null);
const zoneNameById = Object.create(null);

for (const row of rawRows) {
  rowByKey[row.combatZoneId + "::" + row.profileKey] = row;
  zoneNameById[row.combatZoneId] = row.combatZoneName || row.combatZoneId;
}

const metricMeta = {
  xpPerMinute: { label: "XP/分", decimals: 1, suffix: "", higherIsBetter: true },
  gpPerMinute: { label: "GP/分", decimals: 1, suffix: "", higherIsBetter: true },
  wavesPerMinute: { label: "波次/分", decimals: 2, suffix: "", higherIsBetter: true },
  winRate: { label: "胜率", decimals: 1, suffix: "%", higherIsBetter: true },
  dps: { label: "DPS", decimals: 2, suffix: "", higherIsBetter: true },
  damageTakenPerTick: { label: "受击DPS", decimals: 2, suffix: "", higherIsBetter: false },
  deathRate: { label: "死亡率/波", decimals: 2, suffix: "", higherIsBetter: false },
};

const state = {
  metric: "xpPerMinute",
  profileQuery: "",
  selectedProfiles: new Set(profileOrder),
};

const profileSearchEl = document.getElementById("profile-search");
const profileOptionsEl = document.getElementById("profile-options");
const metricToggleEl = document.getElementById("metric-toggle");
const summaryGridEl = document.getElementById("summary-grid");
const legendEl = document.getElementById("legend");
const chartRootEl = document.getElementById("chart-root");
const bestGridEl = document.getElementById("best-grid");
const matrixRootEl = document.getElementById("matrix-root");
const rerunCommandEl = document.getElementById("rerun-command");
const copyCommandBtn = document.getElementById("copy-command");
const copyCommandStatusEl = document.getElementById("copy-command-status");

profileSearchEl.addEventListener("input", () => {
  state.profileQuery = profileSearchEl.value;
  renderProfileOptions();
  renderBody();
});

document.getElementById("select-visible").addEventListener("click", () => {
  for (const profileId of getFilteredProfiles()) {
    state.selectedProfiles.add(profileId);
  }
  renderProfileOptions();
  renderBody();
});

document.getElementById("clear-visible").addEventListener("click", () => {
  for (const profileId of getFilteredProfiles()) {
    state.selectedProfiles.delete(profileId);
  }
  renderProfileOptions();
  renderBody();
});

document.getElementById("reset-profiles").addEventListener("click", () => {
  state.selectedProfiles = new Set(profileOrder);
  renderProfileOptions();
  renderBody();
});

profileOptionsEl.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  const profileId = target.getAttribute("data-profile-id");
  if (!profileId) return;

  if (target.checked) {
    state.selectedProfiles.add(profileId);
  } else {
    state.selectedProfiles.delete(profileId);
  }
  renderBody();
});

if (rerunCommandEl) {
  rerunCommandEl.textContent = rerunCommand || "当前报表没有记录复跑命令。";
}

if (copyCommandBtn) {
  copyCommandBtn.addEventListener("click", async () => {
    if (!rerunCommand) {
      setCopyStatus("没有可复制的命令");
      return;
    }

    const copied = await copyText(rerunCommand);
    setCopyStatus(copied ? "已复制到剪贴板" : "复制失败，请手动复制");
  });
}

function renderMetricToggle() {
  metricToggleEl.innerHTML = Object.entries(metricMeta)
    .map(([metricKey, meta]) => {
      const activeClass = state.metric === metricKey ? "active" : "";
      return "<button type=\"button\" data-metric=\"" + escapeHtml(metricKey) + "\" class=\"" + activeClass + "\">" + escapeHtml(meta.label) + "</button>";
    })
    .join("");

  metricToggleEl.querySelectorAll("button[data-metric]").forEach((button) => {
    button.addEventListener("click", () => {
      const metricKey = button.getAttribute("data-metric");
      if (!metricKey || metricKey === state.metric) return;
      state.metric = metricKey;
      renderMetricToggle();
      renderBody();
    });
  });
}

function renderProfileOptions() {
  const filteredProfiles = getFilteredProfiles();
  if (filteredProfiles.length === 0) {
    profileOptionsEl.innerHTML = "<div class=\"empty\">没有匹配这个 profile id 的结果。</div>";
    return;
  }

  profileOptionsEl.innerHTML = filteredProfiles
    .map((profileId) => {
      const checked = state.selectedProfiles.has(profileId) ? "checked" : "";
      return "<label class=\"profile-option\">"
        + "<input type=\"checkbox\" data-profile-id=\"" + escapeHtml(profileId) + "\" " + checked + " />"
        + "<span class=\"profile-color\" style=\"background:" + escapeHtml(colorForProfile(profileId)) + "\"></span>"
        + "<span>" + escapeHtml(profileId) + "</span>"
        + "</label>";
    })
    .join("");
}

function renderBody() {
  const selectedProfiles = getSelectedProfiles();
  const metricKey = state.metric;
  const meta = metricMeta[metricKey];

  renderSummary(selectedProfiles, metricKey, meta);
  renderLegend(selectedProfiles);
  renderChart(selectedProfiles, metricKey, meta);
  renderBestCards(selectedProfiles, metricKey, meta);
  renderMatrix(selectedProfiles, metricKey, meta);
}

function renderSummary(selectedProfiles, metricKey, meta) {
  const visibleRows = getVisibleRows(selectedProfiles);
  const values = visibleRows.map((row) => asNumber(row[metricKey]));
  const bestValue = pickBestValue(values, meta.higherIsBetter);
  const avgValue = values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;

  summaryGridEl.innerHTML = [
    summaryCard("当前指标", meta.label, selectedProfiles.length + " 个 profile 已选中"),
    summaryCard("可见战斗区", String(zoneOrder.length), "横轴按战斗区顺序展开"),
    summaryCard(meta.higherIsBetter ? "最高值" : "最低值", formatMetric(bestValue, meta), "当前视图中的最优指标值"),
    summaryCard("均值", formatMetric(avgValue, meta), "所有可见点位的平均值"),
  ].join("");
}

function renderLegend(selectedProfiles) {
  if (selectedProfiles.length === 0) {
    legendEl.innerHTML = "";
    return;
  }

  legendEl.innerHTML = selectedProfiles
    .map((profileId) => {
      return "<div class=\"legend-item\">"
        + "<span class=\"dot\" style=\"background:" + escapeHtml(colorForProfile(profileId)) + "\"></span>"
        + "<span>" + escapeHtml(profileId) + "</span>"
        + "</div>";
    })
    .join("");
}

function renderChart(selectedProfiles, metricKey, meta) {
  if (selectedProfiles.length === 0) {
    chartRootEl.innerHTML = "<div class=\"empty\">没有选中的 profile，无法绘图。</div>";
    return;
  }

  const allValues = [];
  for (const zoneId of zoneOrder) {
    for (const profileId of selectedProfiles) {
      const row = rowByKey[zoneId + "::" + profileId];
      allValues.push(row ? asNumber(row[metricKey]) : 0);
    }
  }

  const maxValue = Math.max(1, ...allValues);
  const axisTicks = 4;
  const chartHeight = 320;
  const chartWidth = Math.max(720, zoneOrder.length * 120);
  const paddingTop = 16;
  const paddingRight = 16;
  const paddingBottom = 20;
  const paddingLeft = 12;
  const plotHeight = chartHeight - paddingTop - paddingBottom;
  const plotWidth = chartWidth - paddingLeft - paddingRight;
  const stepX = zoneOrder.length > 1 ? plotWidth / (zoneOrder.length - 1) : 0;

  const gridLines = [];
  const axisLabels = [];
  for (let i = 0; i <= axisTicks; i++) {
    const ratio = i / axisTicks;
    const y = paddingTop + plotHeight - ratio * plotHeight;
    const value = maxValue * ratio;
    gridLines.push("<line x1=\"" + paddingLeft + "\" y1=\"" + y.toFixed(2) + "\" x2=\"" + (paddingLeft + plotWidth) + "\" y2=\"" + y.toFixed(2) + "\" class=\"grid-line\" />");
    axisLabels.push("<div class=\"y-axis-label\" style=\"bottom:" + (ratio * 100).toFixed(2) + "%\">" + escapeHtml(formatMetric(value, meta)) + "</div>");
  }

  const seriesSvg = selectedProfiles.map((profileId) => {
    const color = colorForProfile(profileId);
    const points = zoneOrder.map((zoneId, index) => {
      const row = rowByKey[zoneId + "::" + profileId];
      const value = row ? asNumber(row[metricKey]) : 0;
      const x = zoneOrder.length > 1 ? paddingLeft + stepX * index : paddingLeft + plotWidth / 2;
      const y = paddingTop + plotHeight - (value / maxValue) * plotHeight;
      return {
        row,
        value,
        x,
        y,
        zoneId,
        zoneName: zoneNameById[zoneId] || zoneId,
      };
    });

    const pointsAttr = points
      .map((point) => point.x.toFixed(2) + "," + point.y.toFixed(2))
      .join(" ");

    const circles = points.map((point) => {
      const row = point.row;
      const tooltip = profileId
        + "\n" + point.zoneName
        + "\n" + meta.label + ": " + formatMetric(point.value, meta)
        + "\nXP/分: " + formatMetric(row ? row.xpPerMinute : 0, metricMeta.xpPerMinute)
        + "\nGP/分: " + formatMetric(row ? row.gpPerMinute : 0, metricMeta.gpPerMinute)
        + "\n波次/分: " + formatMetric(row ? row.wavesPerMinute : 0, metricMeta.wavesPerMinute)
        + "\n胜率: " + formatMetric(row ? row.winRate : 0, metricMeta.winRate);
      return "<circle cx=\"" + point.x.toFixed(2) + "\" cy=\"" + point.y.toFixed(2) + "\" r=\"4.5\" fill=\"" + escapeHtml(color) + "\" stroke=\"rgba(15,23,42,0.95)\" stroke-width=\"2\"><title>" + escapeHtml(tooltip) + "</title></circle>";
    }).join("");

    return "<g>"
      + "<polyline points=\"" + pointsAttr + "\" fill=\"none\" stroke=\"" + escapeHtml(color) + "\" stroke-width=\"3\" stroke-linejoin=\"round\" stroke-linecap=\"round\" />"
      + circles
      + "</g>";
  }).join("");

  const labelsHtml = zoneOrder.map((zoneId) => {
    const zoneName = zoneNameById[zoneId] || zoneId;
    return "<div class=\"x-axis-label\">"
      + "<div class=\"x-axis-name\">" + escapeHtml(zoneName) + "</div>"
      + "<div class=\"x-axis-id\">" + escapeHtml(zoneId) + "</div>"
      + "</div>";
  }).join("");

  chartRootEl.innerHTML = "<div class=\"chart-wrapper line-chart-wrapper\">"
    + "<div class=\"y-axis\">" + axisLabels.join("") + "</div>"
    + "<div class=\"chart-scroll\">"
    + "<div class=\"line-chart-content\" style=\"width:" + chartWidth + "px\">"
    + "<svg class=\"line-chart-svg\" viewBox=\"0 0 " + chartWidth + " " + chartHeight + "\" preserveAspectRatio=\"none\">"
    + gridLines.join("")
    + seriesSvg
    + "</svg>"
    + "<div class=\"x-axis-grid\" style=\"grid-template-columns: repeat(" + zoneOrder.length + ", minmax(100px, 1fr));\">" + labelsHtml + "</div>"
    + "</div>"
    + "</div>"
    + "</div>";
}

function renderBestCards(selectedProfiles, metricKey, meta) {
  if (selectedProfiles.length === 0) {
    bestGridEl.innerHTML = "<div class=\"empty\">没有选中的 profile，无法汇总最佳刷图点。</div>";
    return;
  }

  bestGridEl.innerHTML = selectedProfiles.map((profileId) => {
    let bestRow = null;
    for (const zoneId of zoneOrder) {
      const row = rowByKey[zoneId + "::" + profileId];
      if (!row) continue;
      if (!bestRow || isBetterValue(asNumber(row[metricKey]), asNumber(bestRow[metricKey]), meta.higherIsBetter)) {
        bestRow = row;
      }
    }

    if (!bestRow) {
      return "<div class=\"best-card\">"
        + "<span class=\"label\">" + escapeHtml(profileId) + "</span>"
        + "<div class=\"title\">无数据</div>"
        + "<div class=\"sub\">这个 profile 没有可见结果。</div>"
        + "</div>";
    }

    return "<div class=\"best-card\">"
      + "<span class=\"label\">" + escapeHtml(profileId) + "</span>"
      + "<div class=\"title\">" + escapeHtml(bestRow.combatZoneName) + "</div>"
      + "<div class=\"metric\">" + escapeHtml(formatMetric(bestRow[metricKey], meta)) + "</div>"
      + "<div class=\"sub\">"
      + escapeHtml(meta.label) + " · 胜率 " + escapeHtml(formatMetric(bestRow.winRate, metricMeta.winRate))
      + " · 波次/分 " + escapeHtml(formatMetric(bestRow.wavesPerMinute, metricMeta.wavesPerMinute))
      + " · " + escapeHtml(formatLevelUpEstimate(bestRow))
      + "</div>"
      + "</div>";
  }).join("");
}

function renderMatrix(selectedProfiles, metricKey, meta) {
  if (selectedProfiles.length === 0) {
    matrixRootEl.innerHTML = "<div class=\"empty\">没有选中的 profile，无法显示矩阵。</div>";
    return;
  }

  const headHtml = selectedProfiles
    .map((profileId) => "<th>" + escapeHtml(profileId) + "</th>")
    .join("");

  const bodyHtml = zoneOrder.map((zoneId) => {
    const zoneName = zoneNameById[zoneId] || zoneId;
    const cellsHtml = selectedProfiles.map((profileId) => {
      const row = rowByKey[zoneId + "::" + profileId];
      if (!row) {
        return "<td><div class=\"cell-main\">-</div><div class=\"cell-sub\">无数据</div></td>";
      }
      return "<td>"
        + "<div class=\"cell-main\">" + escapeHtml(formatMetric(row[metricKey], meta)) + "</div>"
        + "<div class=\"cell-sub\">"
        + "XP/分 " + escapeHtml(formatMetric(row.xpPerMinute, metricMeta.xpPerMinute))
        + " · GP/分 " + escapeHtml(formatMetric(row.gpPerMinute, metricMeta.gpPerMinute))
        + "<br />波次/分 " + escapeHtml(formatMetric(row.wavesPerMinute, metricMeta.wavesPerMinute))
        + " · 胜率 " + escapeHtml(formatMetric(row.winRate, metricMeta.winRate))
        + "</div>"
        + "</td>";
    }).join("");

    return "<tr>"
      + "<th>" + escapeHtml(zoneName) + "<div class=\"cell-sub\">" + escapeHtml(zoneId) + "</div></th>"
      + cellsHtml
      + "</tr>";
  }).join("");

  matrixRootEl.innerHTML = "<div class=\"table-scroll\">"
    + "<table>"
    + "<thead><tr><th>战斗区</th>" + headHtml + "</tr></thead>"
    + "<tbody>" + bodyHtml + "</tbody>"
    + "</table>"
    + "</div>";
}

function summaryCard(label, value, sub) {
  return "<div class=\"summary-card\">"
    + "<span class=\"label\">" + escapeHtml(label) + "</span>"
    + "<div class=\"value\">" + escapeHtml(value) + "</div>"
    + "<div class=\"sub\">" + escapeHtml(sub) + "</div>"
    + "</div>";
}

function getFilteredProfiles() {
  const query = state.profileQuery.trim().toLowerCase();
  if (!query) return profileOrder.slice();
  return profileOrder.filter((profileId) => profileId.toLowerCase().includes(query));
}

function getSelectedProfiles() {
  return getFilteredProfiles().filter((profileId) => state.selectedProfiles.has(profileId));
}

function getVisibleRows(selectedProfiles) {
  const rows = [];
  for (const zoneId of zoneOrder) {
    for (const profileId of selectedProfiles) {
      const row = rowByKey[zoneId + "::" + profileId];
      if (row) rows.push(row);
    }
  }
  return rows;
}

function pickBestValue(values, higherIsBetter) {
  if (values.length === 0) return 0;
  return values.reduce((best, value) => {
    return isBetterValue(value, best, higherIsBetter) ? value : best;
  });
}

function isBetterValue(nextValue, currentValue, higherIsBetter) {
  return higherIsBetter ? nextValue > currentValue : nextValue < currentValue;
}

function colorForProfile(profileId) {
  const index = profileOrder.indexOf(profileId);
  const hue = Math.round((index * 360) / Math.max(profileOrder.length, 1));
  return "hsl(" + hue + " 72% 56%)";
}

function formatMetric(value, meta) {
  return formatNumber(value, meta.decimals) + meta.suffix;
}

function formatLevelUpEstimate(row) {
  const minutes = row.minutesToNextLevel;
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) {
    return "预计升级时间：无法估算";
  }
  return "预计 " + formatNumber(minutes, 1) + " 分钟升到 Lv" + String(asNumber(row.finalLevel) + 1);
}

function formatNumber(value, decimals) {

  const safe = asNumber(value);
  return safe.toFixed(decimals);
}

function asNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function setCopyStatus(message) {
  if (!copyCommandStatusEl) return;
  copyCommandStatusEl.textContent = message;
  window.setTimeout(() => {
    if (copyCommandStatusEl.textContent === message) {
      copyCommandStatusEl.textContent = "";
    }
  }, 2200);
}

async function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      // fallback below
    }
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "true");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch (error) {
    copied = false;
  }
  document.body.removeChild(textArea);
  return copied;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

renderMetricToggle();
renderProfileOptions();
renderBody();
