import {
  buildPracticeSet,
  buildDiagnosisExport,
  buildStudyPlan,
  defaultDailyCount,
  emptyFilters,
  formatQuestionForDisplay,
  formatPercent,
  gradeAnswer,
  latestAttemptByQuestion,
  memoryCardsByQuestion,
  questionSourceLabel,
  summarizeMemory,
  summarizeModules,
  summarizeProgressPayload,
  summarizeAttempts,
  uniqueSorted,
} from "./core.mjs";
import {
  addAttempt,
  clearProgressData,
  exportProgress,
  getBookmarks,
  getAttempts,
  importProgress,
  toggleBookmark,
} from "./db.mjs";

const state = {
  bank: null,
  attempts: [],
  bookmarks: [],
  filteredQuestions: [],
  currentIndex: 0,
  selectedAnswer: "",
  submitted: false,
  retryQuestionId: "",
  mode: "continue",
  dailyCount: defaultDailyCount,
  queuePage: 0,
  queuePageSize: 75,
  questionStartedAt: Date.now(),
  currentView: "practice",
  filters: { ...emptyFilters },
  pendingProgress: null,
};

const $ = (id) => document.getElementById(id);
const viewTitles = {
  practice: "选择题",
  wrong: "错题",
  stats: "统计",
  cases: "案例分析",
  essays: "论文",
  data: "数据",
};

async function init() {
  try {
    const response = await fetch("./data/bank.json");
    state.bank = await response.json();
    state.attempts = await getAttempts();
    state.bookmarks = await getBookmarks();
    initFilters();
    applyFilters();
    bindEvents();
    renderAll();
  } catch (error) {
    showNotice(`初始化失败：${error.message}`, "error");
  }
}

function bindEvents() {
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  document.querySelectorAll(".type-button").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.typeView));
  });
  $("applyFilters").addEventListener("click", () => {
    readFilters();
    applyFilters();
    renderPractice();
  });
  $("dailyCount").addEventListener("change", () => {
    readFilters();
    if (state.mode === "review") {
      applyFilters();
      renderPractice();
      renderOverview();
    }
  });
  document.querySelectorAll(".mode-button").forEach((button) => {
    button.addEventListener("click", () => runMode(button.dataset.mode));
  });
  $("keywordFilter").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      readFilters();
      applyFilters();
      renderPractice();
    }
  });
  $("prevQuestion").addEventListener("click", prevQuestion);
  $("nextQuestion").addEventListener("click", nextQuestion);
  $("toggleFavorite").addEventListener("click", toggleCurrentFavorite);
  $("queuePrevPage").addEventListener("click", () => changeQueuePage(-1));
  $("queueNextPage").addEventListener("click", () => changeQueuePage(1));
  $("exportDiagnosis").addEventListener("click", downloadDiagnosis);
  $("importProgressTop").addEventListener("click", chooseProgressFile);
  $("exportProgressTop").addEventListener("click", downloadProgress);
  $("exportProgress").addEventListener("click", downloadProgress);
  $("selectProgressFile").addEventListener("click", chooseProgressFile);
  $("applyProgressImport").addEventListener("click", applyPendingProgress);
  $("importProgress").addEventListener("change", importProgressFile);
  $("clearProgress").addEventListener("click", clearProgress);
}

function initFilters() {
  fillSelect($("sourceFilter"), [
    ["all", "全部来源"],
    ["real", "真题"],
    ["mock", "模拟题"],
  ]);
  fillSelect($("termFilter"), [["all", "全部年份/卷"], ...uniqueSorted(state.bank.choices, "term").map((x) => [x, x])]);
  fillSelect($("moduleFilter"), [["all", "全部模块"], ...uniqueSorted(state.bank.choices, "module").map((x) => [x, moduleLabel(x)])]);
}

function fillSelect(select, rows) {
  select.innerHTML = rows.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("");
}

function readFilters() {
  state.dailyCount = Math.max(5, Math.min(75, Number($("dailyCount").value || defaultDailyCount)));
  state.filters = {
    sourceType: $("sourceFilter").value,
    term: $("termFilter").value,
    module: $("moduleFilter").value,
    status: $("statusFilter").value,
    keyword: $("keywordFilter").value,
  };
}

function applyFilters() {
  state.filteredQuestions = buildPracticeSet(state.bank.choices, state.attempts, {
    mode: state.mode,
    filters: state.filters,
    dailyCount: state.dailyCount,
    bookmarkedIds: state.bookmarks.map((item) => item.questionId),
  });
  state.currentIndex = 0;
  state.selectedAnswer = "";
  state.submitted = false;
  state.retryQuestionId = "";
  state.queuePage = 0;
  state.questionStartedAt = Date.now();
}

function renderAll() {
  $("bankCount").textContent = `${state.bank.choices.length} 选择题`;
  $("attemptCount").textContent = `${state.attempts.length}`;
  renderModeCounts();
  renderChapterBoard();
  renderOverview();
  renderPractice();
  renderStats();
  renderWrong();
  renderCases();
  renderEssays();
}

function renderOverview() {
  $("studyPlanList").innerHTML = buildStudyPlan({ dailyCount: state.dailyCount }).map((item) => `
    <div class="plan-step">
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.detail)}</span>
    </div>
  `).join("");
  const realTerms = state.bank.manifest.scope.real_terms || [];
  const mockTerms = state.bank.manifest.scope.mock_terms || [];
  const realCount = state.bank.manifest.counts.choice_real || state.bank.choices.filter((item) => item.sourceType === "real").length;
  const mockCount = state.bank.manifest.counts.choice_mock || state.bank.choices.filter((item) => item.sourceType === "mock").length;
  const realRange = realTerms.length ? `${realTerms[0]} 至 ${realTerms.at(-1)}，共 ${realTerms.length} 个批次` : "暂无真题";
  $("sourceSummary").textContent = `${state.bank.choices.length} 道选择题，${state.bank.cases.length} 道案例，${state.bank.essays.length} 道论文`;
  $("sourceDetail").textContent = `真题 ${realCount} 道：${realRange}；模拟 ${mockCount} 道：${mockTerms.length} 套。每题下方显示年份、题号、模块和来源文件。`;
}

function renderModeCounts() {
  const memory = summarizeMemory(state.bank.choices, state.attempts);
  const terms = uniqueSorted(state.bank.choices.filter((item) => item.sourceType === "real"), "term");
  $("continueModeCount").textContent = `${memory.new} 未做`;
  $("reviewModeCount").textContent = `${memory.due} 到期`;
  $("specialModeCount").textContent = `${uniqueSorted(state.bank.choices, "module").length} 模块`;
  $("examModeCount").textContent = `${terms.length} 套`;
  $("wrongModeCount").textContent = `${memory.wrong} 错题`;
  $("favoriteModeCount").textContent = `${state.bookmarks.length} 收藏`;
  $("allModeCount").textContent = `${state.bank.choices.length} 题`;
}

function renderChapterBoard() {
  const modules = summarizeModules(state.bank.choices, state.attempts);
  $("chapterList").innerHTML = modules.map((item) => `
    <button class="chapter-item ${state.mode === "special" && state.filters.module === item.module ? "active" : ""}" data-chapter="${escapeHtml(item.module)}" type="button">
      <span>
        <b>${moduleLabel(item.module)}</b>
        <small>${item.answered}/${item.total} 已做 · 正确率 ${formatPercent(item.accuracy)}</small>
      </span>
      <strong>${item.wrong} 错</strong>
      <em>${item.due} 待复习</em>
      <i><mark style="width: ${Math.round(item.progress * 100)}%"></mark></i>
    </button>
  `).join("");
  document.querySelectorAll("[data-chapter]").forEach((button) => {
    button.addEventListener("click", () => runChapter(button.dataset.chapter));
  });
}

function renderPractice() {
  syncModeButtons();
  syncChapterButtons();
  $("queueSummary").textContent = `${state.filteredQuestions.length} 道题`;
  $("modeLabel").textContent = modeLabel(state.mode);
  renderQueue();
  const question = currentQuestion();
  if (!question) {
    const empty = emptyPracticeMessage();
    $("questionMeta").textContent = empty.meta;
    $("questionStem").textContent = empty.title;
    $("optionList").innerHTML = "";
    $("questionProgress").textContent = "0/0";
    $("toggleFavorite").textContent = "收藏本题";
    $("toggleFavorite").classList.remove("marked");
    $("answerResult").hidden = true;
    $("sourceBox").innerHTML = "";
    return;
  }
  const display = formatQuestionForDisplay(question);
  const memory = memoryCardsByQuestion(state.bank.choices, state.attempts).get(question.id);
  const bookmarked = isBookmarked(question.id);
  const latestAttempt = shouldAnswerFresh(question) ? null : latestAttemptByQuestion(state.attempts).get(question.id);
  const answerForDisplay = state.submitted ? state.selectedAnswer : latestAttempt?.answer || "";
  const shouldReveal = state.submitted || Boolean(latestAttempt);
  const gradedForDisplay = shouldReveal ? gradeAnswer(question, answerForDisplay) : null;
  $("questionProgress").textContent = `${state.currentIndex + 1}/${state.filteredQuestions.length}`;
  $("questionMeta").innerHTML = `
    <span>${escapeHtml(questionSourceLabel(question))}</span>
    <span>${escapeHtml(moduleLabel(question.module))}</span>
    ${memory ? `<span class="memory-chip memory-${memory.state}">${escapeHtml(memory.label)}</span>` : ""}
    ${bookmarked ? `<span class="bookmark-chip">已收藏</span>` : ""}
    ${display.analysisKind !== "available" ? `<span class="meta-warn">${display.analysisKind === "source-only" ? "PDF抽取题" : "解析待补"}</span>` : ""}
  `;
  $("questionStem").innerHTML = renderRichText(display.stem);
  $("optionList").innerHTML = ["A", "B", "C", "D"].map((key) => {
    const classes = ["option"];
    if (shouldReveal) classes.push("locked");
    if (answerForDisplay === key) classes.push("selected");
    if (shouldReveal && key === question.answer) classes.push("correct-choice");
    if (shouldReveal && answerForDisplay === key && key !== question.answer) classes.push("wrong-choice");
    return `<button class="${classes.join(" ")}" data-answer="${key}" type="button"><b>${key}</b><span class="option-text">${renderInlineText(display.options[key] || "")}</span></button>`;
  }).join("");
  document.querySelectorAll(".option").forEach((button) => {
    button.addEventListener("click", () => {
      if (shouldReveal) return;
      submitCurrentAnswer(button.dataset.answer);
    });
  });
  if (gradedForDisplay) {
    renderAnswerResult(display, gradedForDisplay, { review: Boolean(latestAttempt) && !state.submitted });
  } else {
    $("answerResult").hidden = true;
    $("answerResult").innerHTML = "";
  }
  $("toggleFavorite").textContent = bookmarked ? "取消收藏" : "收藏本题";
  $("toggleFavorite").classList.toggle("marked", bookmarked);
  $("sourceBox").innerHTML = `
    <div><b>来源</b><span>${escapeHtml(questionSourceLabel(question))}</span></div>
    <div><b>模块</b><span>${moduleLabel(question.module)}${question.knowledge ? ` · ${escapeHtml(question.knowledge)}` : ""}</span></div>
    <div><b>记忆</b><span>${memorySummary(memory)}</span></div>
    <div><b>标记</b><span>${bookmarked ? "已加入收藏题，可在收藏题模式重刷" : "未收藏，可手动标记重点题"}</span></div>
    <div><b>原始文件</b><span>${escapeHtml(question.sourceFile || "")}</span></div>
  `;
}

function renderQueue() {
  const latest = latestAttemptByQuestion(state.attempts);
  const queueAttempts = state.filteredQuestions.map((question) => latest.get(question.id)).filter(Boolean);
  const correct = queueAttempts.filter((attempt) => attempt.correct).length;
  const wrong = queueAttempts.filter((attempt) => attempt.correct === false).length;
  const unanswered = Math.max(0, state.filteredQuestions.length - queueAttempts.length);
  const pageCount = Math.max(1, Math.ceil(state.filteredQuestions.length / state.queuePageSize));
  state.queuePage = Math.min(Math.max(0, state.queuePage), pageCount - 1);
  const start = state.queuePage * state.queuePageSize;
  const end = Math.min(start + state.queuePageSize, state.filteredQuestions.length);
  $("queueSummary").textContent = `${state.filteredQuestions.length} 道题 · 已答 ${queueAttempts.length}`;
  $("queuePageLabel").textContent = state.filteredQuestions.length ? `${start + 1}-${end} / ${state.filteredQuestions.length}` : "0 / 0";
  $("queuePrevPage").disabled = state.queuePage === 0;
  $("queueNextPage").disabled = state.queuePage >= pageCount - 1;
  $("queueLegend").innerHTML = `
    <span><i class="legend-current"></i>当前</span>
    <span><i class="legend-ok"></i>正确 ${correct}</span>
    <span><i class="legend-bad"></i>错误 ${wrong}</span>
    <span><i></i>未答 ${unanswered}</span>
  `;
  $("questionQueue").innerHTML = state.filteredQuestions.slice(start, end).map((question, pageIndex) => {
    const index = start + pageIndex;
    const attempt = latest.get(question.id);
    const status = attempt ? (attempt.correct ? "ok" : "bad") : "";
    const active = index === state.currentIndex ? " active" : "";
    const title = attempt ? `${index + 1}：${attempt.correct ? "正确" : "错误"}` : `${index + 1}：未答`;
    return `<button class="queue-item ${status}${active}" data-index="${index}" title="${escapeHtml(title)}" type="button">${index + 1}</button>`;
  }).join("");
  document.querySelectorAll(".queue-item").forEach((button) => {
    button.addEventListener("click", () => {
      state.currentIndex = Number(button.dataset.index);
      state.selectedAnswer = "";
      state.submitted = false;
      state.retryQuestionId = "";
      state.queuePage = Math.floor(state.currentIndex / state.queuePageSize);
      state.questionStartedAt = Date.now();
      renderPractice();
    });
  });
}

async function submitCurrentAnswer(answer) {
  const question = currentQuestion();
  state.selectedAnswer = answer;
  if (!question || !state.selectedAnswer) {
    showNotice("先选一个答案。", "warn");
    return;
  }
  const graded = gradeAnswer(question, state.selectedAnswer);
  const attempt = {
    questionId: question.id,
    sourceType: question.sourceType,
    term: question.term,
    module: question.module,
    knowledge: question.knowledge || "",
    answer: graded.answer,
    correctAnswer: graded.correctAnswer,
    correct: graded.correct,
    durationMs: Date.now() - state.questionStartedAt,
    answeredAt: new Date().toISOString(),
  };
  await addAttempt(attempt);
  state.attempts = await getAttempts();
  state.submitted = true;
  state.retryQuestionId = "";
  renderPractice();
  renderStats();
  renderWrong();
  renderModeCounts();
  renderChapterBoard();
  $("attemptCount").textContent = `${state.attempts.length}`;
}

function renderAnswerResult(question, graded, options = {}) {
  const result = $("answerResult");
  result.hidden = false;
  result.className = `answer-result ${graded.correct ? "correct" : "wrong"}`;
  result.innerHTML = `
    <div class="answer-title">
      <h4>${options.review ? "上次作答" : graded.correct ? "回答正确" : "回答错误"}</h4>
      <span>你的答案 ${escapeHtml(graded.answer)} · 正确答案 ${escapeHtml(graded.correctAnswer)}</span>
    </div>
    <div class="analysis-body ${question.analysisKind !== "available" ? "analysis-muted" : ""}">${renderRichText(question.analysis || "暂无解析")}</div>
    ${options.review ? `<button class="retry-answer" type="button">再次作答</button>` : ""}
  `;
  result.querySelector(".retry-answer")?.addEventListener("click", () => {
    const question = currentQuestion();
    state.retryQuestionId = question?.id || "";
    state.selectedAnswer = "";
    state.submitted = false;
    state.questionStartedAt = Date.now();
    renderPractice();
  });
}

function prevQuestion() {
  if (!state.filteredQuestions.length) return;
  state.currentIndex = (state.currentIndex - 1 + state.filteredQuestions.length) % state.filteredQuestions.length;
  state.selectedAnswer = "";
  state.submitted = false;
  state.retryQuestionId = "";
  state.queuePage = Math.floor(state.currentIndex / state.queuePageSize);
  state.questionStartedAt = Date.now();
  renderPractice();
}

function nextQuestion() {
  if (!state.filteredQuestions.length) return;
  state.currentIndex = (state.currentIndex + 1) % state.filteredQuestions.length;
  state.selectedAnswer = "";
  state.submitted = false;
  state.retryQuestionId = "";
  state.queuePage = Math.floor(state.currentIndex / state.queuePageSize);
  state.questionStartedAt = Date.now();
  renderPractice();
}

function changeQueuePage(delta) {
  const pageCount = Math.max(1, Math.ceil(state.filteredQuestions.length / state.queuePageSize));
  state.queuePage = Math.min(Math.max(0, state.queuePage + delta), pageCount - 1);
  renderQueue();
}

function renderStats() {
  const summary = summarizeAttempts(state.attempts);
  const answered = latestAttemptByQuestion(state.attempts).size;
  $("metricTotal").textContent = String(summary.total);
  $("metricAccuracy").textContent = formatPercent(summary.accuracy);
  $("metricWrong").textContent = String(summary.wrong);
  $("metricAnswered").textContent = String(answered);
  const modules = Object.entries(summary.byModule)
    .sort((a, b) => a[1].accuracy - b[1].accuracy || b[1].total - a[1].total);
  $("moduleStats").innerHTML = modules.length ? modules.map(([module, stat]) => `
    <div class="stat-row">
      <span>${moduleLabel(module)}</span>
      <strong>${formatPercent(stat.accuracy)}</strong>
      <small>${stat.correct}/${stat.total}</small>
    </div>
  `).join("") : `<p class="muted">还没有作答记录。</p>`;
}

function renderWrong() {
  const latest = latestAttemptByQuestion(state.attempts);
  const questionMap = new Map(state.bank.choices.map((q) => [q.id, q]));
  const wrong = [...latest.values()].filter((attempt) => !attempt.correct);
  $("wrongList").innerHTML = wrong.length ? wrong.map((attempt) => {
    const question = questionMap.get(attempt.questionId);
    if (!question) return "";
    return itemCard(question, `
      <p>你的答案：<b>${escapeHtml(attempt.answer)}</b>；正确答案：<b>${escapeHtml(attempt.correctAnswer)}</b></p>
      <button data-retry="${question.id}" type="button">重刷这题</button>
    `);
  }).join("") : `<p class="muted">现在没有错题。</p>`;
  document.querySelectorAll("[data-retry]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.retry;
      state.filters = { ...emptyFilters };
      syncFilterControls();
      state.filteredQuestions = state.bank.choices.filter((q) => q.id === id);
      state.currentIndex = 0;
      state.selectedAnswer = "";
      state.submitted = false;
      state.retryQuestionId = id;
      state.queuePage = 0;
      state.questionStartedAt = Date.now();
      switchView("practice");
      renderPractice();
    });
  });
}

function renderCases() {
  $("caseList").innerHTML = state.bank.cases.slice(0, 120).map((item) => `
    <article class="item-card">
      <div class="question-meta">${escapeHtml(item.term)} · ${moduleLabel(item.module)}</div>
      <h4>${escapeHtml(item.title)}</h4>
      <p>${escapeHtml(item.description || "暂无题干描述")}</p>
      <details>
        <summary>查看问题与参考答案</summary>
        ${(item.subQuestions || []).map((sub) => `<h5>${escapeHtml(sub.question_label)}</h5><p>${escapeHtml(sub.prompt || "")}</p><p class="analysis">${escapeHtml(sub.reference_answer || "暂无参考答案")}</p>`).join("")}
      </details>
    </article>
  `).join("");
}

function renderEssays() {
  $("essayList").innerHTML = state.bank.essays.slice(0, 120).map((item) => `
    <article class="item-card">
      <div class="question-meta">${escapeHtml(item.term)} · ${moduleLabel(item.module)}</div>
      <h4>${escapeHtml(item.title)}</h4>
      <p>${escapeHtml(item.prompt || "")}</p>
      <details>
        <summary>查看写作要点</summary>
        <p class="analysis">${escapeHtml(item.writingPoints || "暂无写作要点")}</p>
      </details>
    </article>
  `).join("");
}

function itemCard(question, extra = "") {
  const display = formatQuestionForDisplay(question);
  return `
    <article class="item-card">
      <div class="question-meta">${escapeHtml(question.term)} · 第 ${question.questionNo || "-"} 题 · ${moduleLabel(question.module)}</div>
      <h4>${escapeHtml(display.stem)}</h4>
      ${extra}
    </article>
  `;
}

function switchView(view) {
  state.currentView = view;
  $("viewTitle").textContent = viewTitles[view] || "练题";
  document.querySelectorAll(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  syncTypeButtons();
  document.querySelectorAll(".view").forEach((section) => section.classList.remove("active-view"));
  $(`${view}View`).classList.add("active-view");
}

function currentQuestion() {
  return state.filteredQuestions[state.currentIndex] || null;
}

function emptyPracticeMessage() {
  if (state.mode === "review") {
    return {
      meta: "记忆复习 · 暂无到期题",
      title: "今天没有到期复习题，可以继续顺序练习或重刷错题。",
    };
  }
  if (state.mode === "wrong") {
    return {
      meta: "错题重刷 · 暂无错题",
      title: "当前没有错题，继续练习后这里会自动收集。",
    };
  }
  if (state.mode === "favorite") {
    return {
      meta: "收藏题 · 暂无标记",
      title: "还没有收藏题。做题时点击“收藏本题”，这里会形成重点题清单。",
    };
  }
  return {
    meta: "没有符合条件的题目",
    title: "请调整筛选条件",
  };
}

function syncFilterControls() {
  $("dailyCount").value = String(state.dailyCount);
  $("sourceFilter").value = state.filters.sourceType;
  $("termFilter").value = state.filters.term;
  $("moduleFilter").value = state.filters.module;
  $("statusFilter").value = state.filters.status;
  $("keywordFilter").value = state.filters.keyword;
}

function runMode(mode) {
  state.mode = mode;
  if (mode === "continue") {
    state.filters.status = "all";
  }
  if (mode === "review") {
    state.filters.status = "due";
  }
  if (mode === "daily") {
    state.filters.status = "unanswered";
  }
  if (mode === "exam") {
    state.filters.sourceType = "real";
    state.filters.module = "all";
    state.filters.status = "all";
    state.filters.keyword = "";
  }
  if (mode === "wrong") {
    state.filters.module = "all";
    state.filters.status = "wrong";
  }
  if (mode === "favorite") {
    state.filters.module = "all";
    state.filters.status = "all";
    state.filters.keyword = "";
  }
  if (mode === "special" && state.filters.module === "all") {
    state.filters.module = summarizeAttempts(state.attempts).weakModules[0]?.module || "architecture";
  }
  if (mode === "special") {
    state.filters.status = "all";
  }
  if (mode === "all") {
    state.filters.status = "all";
  }
  syncFilterControls();
  applyFilters();
  state.retryQuestionId = ["review", "wrong", "favorite"].includes(mode) ? state.filteredQuestions[0]?.id || "" : "";
  state.queuePage = 0;
  switchView("practice");
  renderPractice();
}

function runChapter(module) {
  state.mode = "special";
  state.filters = {
    ...state.filters,
    module,
    status: "all",
    keyword: "",
  };
  syncFilterControls();
  applyFilters();
  state.queuePage = 0;
  switchView("practice");
  renderPractice();
}

function syncModeButtons() {
  document.querySelectorAll(".mode-button").forEach((button) => button.classList.toggle("active", button.dataset.mode === state.mode));
}

function syncChapterButtons() {
  document.querySelectorAll("[data-chapter]").forEach((button) => {
    button.classList.toggle("active", state.mode === "special" && button.dataset.chapter === state.filters.module);
  });
}

function syncTypeButtons() {
  document.querySelectorAll(".type-button").forEach((button) => {
    const active = button.dataset.typeView === state.currentView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function shouldAnswerFresh(question) {
  if (state.retryQuestionId === question.id) return true;
  return ["review", "wrong", "favorite"].includes(state.mode);
}

async function toggleCurrentFavorite() {
  const question = currentQuestion();
  if (!question) return;
  await toggleBookmark(question.id);
  state.bookmarks = await getBookmarks();
  if (state.mode === "favorite" && !isBookmarked(question.id)) {
    applyFilters();
  }
  renderPractice();
  renderModeCounts();
}

function isBookmarked(questionId) {
  return state.bookmarks.some((bookmark) => bookmark.questionId === questionId);
}

function memorySummary(memory) {
  if (!memory || memory.state === "new") return "未做过，进入顺序练习后开始记录";
  const base = `${memory.label} · ${memory.correctCount} 对 / ${memory.wrongCount} 错 · 连对 ${memory.streak}`;
  if (!memory.dueAt) return base;
  return `${base} · 下次复习 ${formatDateTime(memory.dueAt)}`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知";
  return `${date.getMonth() + 1}-${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

async function downloadDiagnosis() {
  const diagnosis = buildDiagnosisExport({ bank: state.bank, attempts: state.attempts, bookmarks: state.bookmarks });
  downloadJson("ai-diagnosis.json", diagnosis);
}

async function downloadProgress() {
  downloadJson("ruankao-progress.json", await exportProgress());
}

function chooseProgressFile() {
  $("importProgress").click();
}

async function importProgressFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    state.pendingProgress = payload;
    renderProgressPreview(summarizeProgressPayload(payload), file.name);
    $("applyProgressImport").disabled = false;
    switchView("data");
    showNotice("已读取进度 JSON，请确认后应用。", "ok");
  } catch (error) {
    state.pendingProgress = null;
    $("applyProgressImport").disabled = true;
    showNotice(`导入失败：${error.message}`, "error");
  } finally {
    event.target.value = "";
  }
}

async function applyPendingProgress() {
  if (!state.pendingProgress) {
    showNotice("先选择一个进度 JSON。", "warn");
    return;
  }
  if (!confirm("确定用这个 JSON 替换当前浏览器里的练习进度吗？")) return;
  state.attempts = await importProgress(state.pendingProgress);
  state.bookmarks = await getBookmarks();
  state.pendingProgress = null;
  $("applyProgressImport").disabled = true;
  applyFilters();
  renderAll();
  showNotice("进度已应用。", "ok");
}

async function clearProgress() {
  if (!confirm("确定清空所有本地作答记录吗？")) return;
  await clearProgressData();
  state.attempts = [];
  state.bookmarks = [];
  state.pendingProgress = null;
  $("applyProgressImport").disabled = true;
  renderAll();
  showNotice("本地记录已清空。", "ok");
}

function renderProgressPreview(summary, filename = "") {
  $("progressPreview").innerHTML = `
    <div class="progress-preview-grid">
      <span><b>文件</b>${escapeHtml(filename || "未命名 JSON")}</span>
      <span><b>作答记录</b>${summary.attempts}</span>
      <span><b>覆盖题目</b>${summary.answeredQuestions}</span>
      <span><b>错题</b>${summary.wrong}</span>
      <span><b>收藏题</b>${summary.bookmarks}</span>
      <span><b>最近作答</b>${summary.latestAt ? escapeHtml(formatDateTime(summary.latestAt)) : "暂无"}</span>
    </div>
  `;
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function showNotice(message, kind = "ok") {
  const notice = $("notice");
  notice.textContent = message;
  notice.className = `notice ${kind}`;
  notice.hidden = false;
  window.setTimeout(() => {
    notice.hidden = true;
  }, 2800);
}

function moduleLabel(module) {
  const labels = {
    architecture: "架构设计",
    software_engineering: "软件工程",
    computer_foundation: "计算机基础",
    database: "数据库",
    network: "网络",
    security: "安全",
    project_management: "项目管理",
    legal_ip: "知识产权",
    new_technology: "新技术",
    embedded: "嵌入式",
    english: "英语",
    other: "其他",
  };
  return labels[module] || module || "未分类";
}

function modeLabel(mode) {
  const labels = {
    continue: "继续练习",
    review: "记忆复习",
    daily: "每日练习",
    special: "章节练习",
    exam: "真题套卷",
    wrong: "错题重刷",
    favorite: "收藏题",
    all: "题库浏览",
  };
  return labels[mode] || "练题";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderInlineText(value) {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

function renderRichText(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const blocks = text.split(/\n{2,}/).filter(Boolean);
  return blocks.map((block) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (looksLikeMarkdownTable(lines)) return renderMarkdownTable(lines);
    return `<p>${lines.map(escapeHtml).join("<br>")}</p>`;
  }).join("");
}

function looksLikeMarkdownTable(lines) {
  return lines.length >= 2 && lines[0].includes("|") && /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(lines[1]);
}

function renderMarkdownTable(lines) {
  const rows = lines
    .filter((_, index) => index !== 1)
    .map((line) => line.split("|").map((cell) => cell.trim()).filter((cell, index, arr) => cell || index > 0 && index < arr.length - 1));
  const [head = [], ...body] = rows;
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${head.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr></thead>
        <tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

init();
