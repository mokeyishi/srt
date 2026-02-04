const primaryFile = document.getElementById("primaryFile");
const secondaryFile = document.getElementById("secondaryFile");
const primaryText = document.getElementById("primaryText");
const secondaryText = document.getElementById("secondaryText");
const compareButton = document.getElementById("compareButton");
const exportButton = document.getElementById("exportButton");
const resultsContainer = document.getElementById("results");
const summaryContainer = document.getElementById("summary");

let comparisonState = null;

const readFileToText = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, "utf-8");
  });

const normalizeEnglish = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]/gi, "")
    .trim();

const parseSrt = (content) => {
  const blocks = content
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.map((block) => {
    const lines = block.split("\n").map((line) => line.trim());
    const index = parseInt(lines[0], 10);
    const time = lines[1] || "";
    const textLines = lines.slice(2).filter(Boolean);
    const english = textLines.length > 0 ? textLines[textLines.length - 1] : "";
    return {
      index,
      time,
      english,
      englishNormalized: normalizeEnglish(english),
      textLines,
    };
  });
};

const buildSrt = (entries) =>
  entries
    .map((entry) => {
      const lines = [entry.index, entry.time, ...entry.textLines];
      return lines.join("\n");
    })
    .join("\n\n");

const collectInputText = async (fileInput, textArea) => {
  if (textArea.value.trim()) {
    return textArea.value;
  }
  if (fileInput.files.length > 0) {
    return readFileToText(fileInput.files[0]);
  }
  return "";
};

const createBadge = (label, type) => {
  const badge = document.createElement("span");
  badge.className = `badge ${type}`;
  badge.textContent = label;
  return badge;
};

const renderResults = (state) => {
  resultsContainer.innerHTML = "";

  if (!state || state.results.length === 0) {
    resultsContainer.textContent = "暂无检测结果。";
    return;
  }

  state.results.forEach((item) => {
    const row = document.createElement("div");
    row.className = "result-item";

    const index = document.createElement("div");
    index.textContent = item.index;

    const primaryTime = document.createElement("div");
    primaryTime.textContent = item.primaryTime || "-";

    const secondaryTime = document.createElement("div");
    secondaryTime.textContent = item.secondaryTime || "-";
    if (item.timeMismatch) {
      secondaryTime.classList.add("time-mismatch");
    }

    const english = document.createElement("div");
    english.textContent = item.english || "(无英文字幕)";

    const status = document.createElement("div");
    status.appendChild(createBadge(item.statusLabel, item.statusType));

    const action = document.createElement("div");
    if (item.canSync) {
      const button = document.createElement("button");
      button.className = "sync-button";
      button.textContent = "同步时间轴";
      button.addEventListener("click", () => {
        state.secondaryEntries[item.index].time =
          state.primaryEntries[item.index].time;
        item.secondaryTime = state.secondaryEntries[item.index].time;
        item.timeMismatch = false;
        item.statusLabel = "已同步";
        item.statusType = "success";
        item.canSync = false;
        renderResults(state);
      });
      action.appendChild(button);
    }

    row.append(index, primaryTime, secondaryTime, english, status, action);
    resultsContainer.appendChild(row);
  });
};

const updateSummary = (state) => {
  if (!state) {
    summaryContainer.textContent = "";
    return;
  }

  summaryContainer.innerHTML = `
    <strong>检测完成：</strong>
    共 ${state.results.length} 条字幕；
    时间轴不一致 ${state.stats.mismatch} 条；
    英文不一致 ${state.stats.englishMismatch} 条；
    序号缺失 ${state.stats.missing} 条。
  `;
};

compareButton.addEventListener("click", async () => {
  const primaryContent = await collectInputText(primaryFile, primaryText);
  const secondaryContent = await collectInputText(secondaryFile, secondaryText);

  if (!primaryContent || !secondaryContent) {
    summaryContainer.textContent = "请确保两份字幕内容都已提供。";
    return;
  }

  const primaryEntriesList = parseSrt(primaryContent);
  const secondaryEntriesList = parseSrt(secondaryContent);
  const primaryEntries = {};
  const secondaryEntries = {};

  primaryEntriesList.forEach((entry) => {
    primaryEntries[entry.index] = entry;
  });
  secondaryEntriesList.forEach((entry) => {
    secondaryEntries[entry.index] = entry;
  });

  const results = [];
  const stats = {
    mismatch: 0,
    englishMismatch: 0,
    missing: 0,
  };

  secondaryEntriesList.forEach((entry) => {
    const baseEntry = primaryEntries[entry.index];
    if (!baseEntry) {
      stats.missing += 1;
      results.push({
        index: entry.index,
        primaryTime: "-",
        secondaryTime: entry.time,
        english: entry.english,
        statusLabel: "序号缺失",
        statusType: "error",
        timeMismatch: false,
        canSync: false,
      });
      return;
    }

    if (entry.englishNormalized !== baseEntry.englishNormalized) {
      stats.englishMismatch += 1;
      results.push({
        index: entry.index,
        primaryTime: baseEntry.time,
        secondaryTime: entry.time,
        english: entry.english,
        statusLabel: "英文不一致",
        statusType: "error",
        timeMismatch: false,
        canSync: false,
      });
      return;
    }

    if (entry.time !== baseEntry.time) {
      stats.mismatch += 1;
      results.push({
        index: entry.index,
        primaryTime: baseEntry.time,
        secondaryTime: entry.time,
        english: entry.english,
        statusLabel: "时间轴不一致",
        statusType: "warning",
        timeMismatch: true,
        canSync: true,
      });
      return;
    }

    results.push({
      index: entry.index,
      primaryTime: baseEntry.time,
      secondaryTime: entry.time,
      english: entry.english,
      statusLabel: "一致",
      statusType: "success",
      timeMismatch: false,
      canSync: false,
    });
  });

  comparisonState = {
    primaryEntries,
    secondaryEntries,
    results,
    stats,
  };

  exportButton.disabled = false;
  updateSummary(comparisonState);
  renderResults(comparisonState);
});

exportButton.addEventListener("click", () => {
  if (!comparisonState) {
    return;
  }
  const ordered = Object.values(comparisonState.secondaryEntries).sort(
    (a, b) => a.index - b.index
  );
  const content = buildSrt(ordered);
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "corrected.srt";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

primaryFile.addEventListener("change", async () => {
  if (primaryFile.files.length > 0) {
    primaryText.value = await readFileToText(primaryFile.files[0]);
  }
});

secondaryFile.addEventListener("change", async () => {
  if (secondaryFile.files.length > 0) {
    secondaryText.value = await readFileToText(secondaryFile.files[0]);
  }
});
