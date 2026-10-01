(function () {
  'use strict';

  const DATA = window.DRUG_TYPING_DATA;
  const IS_TEST_MODE = document.body.dataset.mode === 'test';
  const previousButton = document.getElementById('previousCard');
  let testSnapshots = [];
  const SCOPE_STORAGE_KEY = IS_TEST_MODE ? 'drug-typing-recall-test-cards-v9' : 'drug-typing-cards-v9';
  const FEATURE_LANGUAGE_STORAGE_KEY = 'drug-recall-feature-language-v2';
  if (!DATA || !Array.isArray(DATA.cards)) {
    document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif">학습 데이터를 불러오지 못했습니다. data.js가 index.html과 같은 폴더에 있는지 확인해 주세요.</p>';
    return;
  }

  const cards = DATA.cards.flatMap((card) => card.occurrences.map((item) => ({
    ...card, id: `${card.id}@${item.lectureId}`, code: item.code,
    lecture: item.lectureTitle, feature: card.recallBullets.join(" "), lectureNumbers: [item.lectureId],
    lectureOrder: item.lectureOrder, sequence: item.sequence, orderEvidence: item.orderEvidence,
  })));
  const lectures = DATA.lectures.map((item) => ({
    key: item.id, title: `${item.courseLectureNumber}강. ${item.title}`, topic: "",
    macro: item.category, categoryId: item.categoryId,
  }));
  const els = {
    answerForm: document.getElementById('answerForm'),
    answerInput: document.getElementById('answerInput'),
    answerButton: document.getElementById('answerButton'),
    passButton: document.getElementById('passCard'),
    questionCard: document.getElementById('questionCard'),
    koreanPrompt: document.getElementById('koreanPrompt'),
    questionLabel: document.getElementById('questionLabel'),
    tableContext: document.getElementById('tableContext'),
    featureLanguage: document.getElementById('featureLanguage'),
    scopeFeatureLanguage: document.getElementById('scopeFeatureLanguage'),
    macroBadge: document.getElementById('macroBadge'),
    lectureBadge: document.getElementById('lectureBadge'),
    questionCounter: document.getElementById('questionCounter'),
    feedback: document.getElementById('feedback'),
    restartDeck: document.getElementById('restartDeck'),
    changeScope: document.getElementById('changeScope'),
    recentList: document.getElementById('recentList'),
    recentCount: document.getElementById('recentCount'),
    emptyState: document.getElementById('emptyState'),
    progressText: document.getElementById('progressText'),
    progressBar: document.getElementById('progressBar'),
    correctCount: document.getElementById('correctCount'),
    wrongCount: document.getElementById('wrongCount'),
    skippedCount: document.getElementById('skippedCount'),
    accuracyValue: document.getElementById('accuracyValue'),
    streakValue: document.getElementById('streakValue'),
    completionCard: document.getElementById('completionCard'),
    completionSummary: document.getElementById('completionSummary'),
    repeatRound: document.getElementById('repeatRound'),
    scopeSummary: document.getElementById('scopeSummary'),
    scopeDialog: document.getElementById('scopeDialog'),
    scopeForm: document.getElementById('scopeForm'),
    lectureOptions: document.getElementById('lectureOptions'),
    scopeCount: document.getElementById('scopeCount'),
    scopeCancel: document.getElementById('scopeCancel'),
    scopeClose: document.getElementById('scopeClose'),
    applyScope: document.getElementById('applyScope'),
    openScope: document.getElementById('openScope'),
    openHelp: document.getElementById('openHelp'),
    helpDialog: document.getElementById('helpDialog'),
  };

  const allCardIds = cards.map((card) => String(card.id));
  const validCardIds = new Set(allCardIds);
  let activeCardIds = new Set(allCardIds);
  let draftCardIds = new Set(allCardIds);
  const writingMode = 'feature-to-name';
  let orderMode = 'random';
  let featureLanguage = 'mixed';
  let setupComplete = false;
  let deck = [];
  let questions = [];
  let enteredAnswers = new Set();
  let questionMistake = false;
  const canonicalCards = new Map(DATA.cards.map((card) => [card.slug, card]));
  let position = 0;
  let correct = 0;
  let wrong = 0;
  let skipped = 0;
  let streak = 0;
  let recent = [];
  let advanceTimer = null;
  let locked = true;

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function scientificKey(value) {
    return String(value).normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function answerForCard(card) {
    return card.answers.map((answer) => answer.name).join(", ");
  }

  function answerKeys(card) {
    return [card.name, ...(card.aliases || [])].map(scientificKey);
  }

  function buildCharacterDiff(learnerAnswer, correctAnswer, ignoreCase) {
    const learnerChars = Array.from(String(learnerAnswer).trim());
    const correctChars = Array.from(String(correctAnswer).trim());
    const learnerKeys = learnerChars.map((char) => ignoreCase ? char.toLowerCase() : char);
    const correctKeys = correctChars.map((char) => ignoreCase ? char.toLowerCase() : char);
    const rows = learnerChars.length + 1;
    const columns = correctChars.length + 1;
    const distance = Array.from({ length: rows }, () => Array(columns).fill(0));
    for (let row = 0; row < rows; row += 1) distance[row][0] = row;
    for (let column = 0; column < columns; column += 1) distance[0][column] = column;
    for (let row = 1; row < rows; row += 1) {
      for (let column = 1; column < columns; column += 1) {
        const substitution = learnerKeys[row - 1] === correctKeys[column - 1] ? 0 : 1;
        distance[row][column] = Math.min(
          distance[row - 1][column] + 1,
          distance[row][column - 1] + 1,
          distance[row - 1][column - 1] + substitution,
        );
      }
    }

    const operations = [];
    let row = learnerChars.length;
    let column = correctChars.length;
    while (row > 0 || column > 0) {
      if (row > 0 && column > 0 && learnerKeys[row - 1] === correctKeys[column - 1]
        && distance[row][column] === distance[row - 1][column - 1]) {
        operations.unshift({ type: 'equal', learner: learnerChars[row - 1], correct: correctChars[column - 1] });
        row -= 1;
        column -= 1;
      } else if (row > 0 && column > 0 && distance[row][column] === distance[row - 1][column - 1] + 1) {
        operations.unshift({ type: 'change', learner: learnerChars[row - 1], correct: correctChars[column - 1] });
        row -= 1;
        column -= 1;
      } else if (row > 0 && distance[row][column] === distance[row - 1][column] + 1) {
        operations.unshift({ type: 'change', learner: learnerChars[row - 1], correct: '' });
        row -= 1;
      } else {
        operations.unshift({ type: 'change', learner: '', correct: correctChars[column - 1] });
        column -= 1;
      }
    }

    function renderSide(side) {
      let html = '';
      let buffer = '';
      let bufferChanged = false;
      const flush = () => {
        if (!buffer) return;
        const escaped = escapeHtml(buffer);
        html += bufferChanged ? `<mark class="spelling-diff">${escaped}</mark>` : escaped;
        buffer = '';
      };
      operations.forEach((operation) => {
        const value = operation[side];
        if (!value) return;
        const changed = operation.type === 'change';
        if (buffer && changed !== bufferChanged) flush();
        bufferChanged = changed;
        buffer += value;
      });
      flush();
      return html;
    }

    return {
      distance: distance[learnerChars.length][correctChars.length],
      learnerHtml: renderSide('learner'),
      correctHtml: renderSide('correct'),
    };
  }

  function cardLectureKeys(card) {
    return card.lectureNumbers.length ? card.lectureNumbers.map(String) : ['unassigned'];
  }

  function cardInScope(card) {
    return activeCardIds.has(String(card.id));
  }

  function scopeIndices() {
    return cards.map((_, index) => index).filter((index) => cardInScope(cards[index]));
  }

  function shuffle(values) {
    const output = [...values];
    for (let i = output.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [output[i], output[j]] = [output[j], output[i]];
    }
    return output;
  }

  function currentCard() {
    return position < deck.length ? questions[deck[position]] : null;
  }

  function setInputEnabled(enabled) {
    locked = !enabled;
    els.answerInput.disabled = !enabled;
    els.answerButton.disabled = !enabled;
    els.passButton.disabled = !enabled;
    els.restartDeck.disabled = !setupComplete;
    if (previousButton) previousButton.disabled = !setupComplete || position === 0;
  }

  function setFeedback(message, type) {
    els.feedback.textContent = message || '';
    els.feedback.className = `feedback${type ? ` ${type}` : ''}`;
  }

  function startRound() {
    testSnapshots = [];
    clearTimeout(advanceTimer);
    const selected = scopeIndices().map((index) => cards[index]).sort((a, b) =>
      a.lectureOrder - b.lectureOrder || a.sequence - b.sequence);
    const selectedSlugs = new Set(selected.map((card) => card.slug));
    questions = DATA.recallGroups.flatMap((group) => {
      const slugs = group.memberSlugs.filter((slug) => selectedSlugs.has(slug));
      if (!slugs.length) return [];
      const first = selected.find((card) => slugs.includes(card.slug));
      return [{ ...first, id: group.id, recallBullets: group.bullets,
        mixedBullets: group.mixedBullets, mixedTableContext: group.mixedTableContext,
        tableContext: group.tableContext, tablePage: group.tablePage, tableNumber: group.tableNumber, tableRow: group.tableRow, tableReferences: group.tableReferences, sourcePolicy: group.sourcePolicy,
        answers: slugs.map((slug) => canonicalCards.get(slug)),
        koreanName: group.title, scientificName: slugs.map((slug) => canonicalCards.get(slug).name).join(', '),
      }];
    });
    const indices = questions.map((_, index) => index);
    deck = orderMode === 'random' ? shuffle(indices) : indices.sort((a, b) =>
      questions[a].lectureOrder - questions[b].lectureOrder || questions[a].sequence - questions[b].sequence);
    enteredAnswers = new Set();
    questionMistake = false;
    position = 0;
    correct = 0;
    wrong = 0;
    skipped = 0;
    streak = 0;
    recent = [];
    els.completionCard.hidden = true;
    els.questionCard.hidden = false;
    els.answerForm.hidden = false;
    els.answerInput.value = '';
    setFeedback('');
    renderRecent();
    renderStats();
    renderQuestion();
    setInputEnabled(true);
    els.answerInput.focus();
  }

  function renderFeatureWording(card) {
    if (!card) return;
    const mixed = featureLanguage === 'mixed';
    const bullets = mixed ? (card.mixedBullets || card.recallBullets) : card.recallBullets;
    const context = mixed ? (card.mixedTableContext || card.tableContext) : card.tableContext;
    const references = card.tableReferences && card.tableReferences.length ? card.tableReferences :
      (card.tablePage ? [{ page: card.tablePage, table: card.tableNumber, row: card.tableRow }] : []);
    if (els.tableContext) els.tableContext.textContent = references.length ?
      `${context} · ${references.map(ref => `자료 ${ref.page}쪽, 표 ${ref.table} · ${ref.row + 1}행`).join(' / ')}` : "강의록 특징";
    els.koreanPrompt.replaceChildren(...bullets.map((text) => {
      const item = document.createElement('li');
      item.textContent = text;
      return item;
    }));
  }

  function setFeatureLanguage(value) {
    featureLanguage = value === 'mixed' ? 'mixed' : 'korean';
    els.featureLanguage.value = featureLanguage;
    els.scopeFeatureLanguage.value = featureLanguage;
    try { localStorage.setItem(FEATURE_LANGUAGE_STORAGE_KEY, featureLanguage); } catch (_) { /* optional */ }
    if (setupComplete) renderFeatureWording(currentCard());
  }

  function renderQuestion() {
    if (IS_TEST_MODE && position < deck.length && !testSnapshots[position]) {
      testSnapshots[position] = { correct, wrong, skipped, streak, recent: recent.map(item => ({ ...item })) };
    }
    const card = currentCard();
    if (!card) {
      finishRound();
      return;
    }
    els.questionCard.classList.remove('correct', 'wrong', 'skipped');
    els.macroBadge.textContent = card.macro;
    els.lectureBadge.textContent = `${card.code} · ${card.lecture}`;
    els.questionLabel.textContent = `선택 범위에서 이 ${card.sourcePolicy === "compressed-table-cell" ? "약물 묶음" : "특징"}에 해당하는 약물 ${card.answers.length}개를 모두 쓰세요.`;
    renderFeatureWording(card);
    els.koreanPrompt.classList.remove('scientific-question');
    els.answerInput.placeholder = '약물명을 하나씩 입력하거나 쉼표로 구분하세요';
    renderAnswerProgress();
    els.answerInput.lang = 'en';
    els.questionCounter.textContent = `${position + 1} / ${deck.length}번째 문제 · ${orderMode === 'code' ? '코드 순서' : '무작위'}${!['PDF text', 'PDF OCR'].includes(card.orderEvidence) ? ' · 실제 등장·순서 미확인' : ''}`;
    els.answerInput.value = '';
  }

  function renderStats() {
    const completed = correct + wrong + skipped;
    const accuracy = completed ? `${Math.round((correct / completed) * 100)}%` : '—';
    const progress = deck.length ? (completed / deck.length) * 100 : 0;
    els.progressText.textContent = `${completed} / ${deck.length}`;
    els.progressBar.style.width = `${progress}%`;
    els.correctCount.textContent = String(correct);
    els.wrongCount.textContent = String(wrong);
    els.skippedCount.textContent = String(skipped);
    els.accuracyValue.textContent = accuracy;
    els.streakValue.textContent = String(streak);
  }

  function renderRecent() {
    els.emptyState.hidden = recent.length > 0;
    els.recentCount.textContent = `${recent.length}개`;
    els.recentList.innerHTML = recent.map((item) => {
      const card = questions[item.cardIndex];
      const outcome = item.outcome || 'correct';
      const symbol = outcome === 'correct' ? '✓' : outcome === 'wrong' ? '×' : '→';
      const label = outcome === 'correct' ? '정답' : outcome === 'wrong' ? '오답' : '패스';
      const learnerAnswer = item.submittedAnswer || '';
      const correctAnswer = item.correctAnswer || answerForCard(card);
      const comparison = outcome === 'wrong' && card.answers.length === 1
        ? buildCharacterDiff(learnerAnswer, correctAnswer, item.answerKind === 'scientific')
        : null;
      const spellingWarning = comparison && comparison.distance > 0 && comparison.distance <= 3;
      const learnerHtml = spellingWarning ? comparison.learnerHtml : escapeHtml(learnerAnswer || '미입력(패스)');
      const correctHtml = spellingWarning ? comparison.correctHtml : escapeHtml(correctAnswer);
      return `<article class="recent-item ${outcome}">
        <span>${symbol}</span>
        <div class="recent-main">
          <div class="recent-title"><strong>${escapeHtml(card.koreanName)}</strong><em>${escapeHtml(card.scientificName)}</em></div>
          <div class="answer-comparison">
            <p><span>내 답</span><b>${learnerHtml}</b></p>
            <p><span>정답</span><b>${correctHtml}</b></p>
          </div>
        </div>
        <div class="recent-status"><small>${label}</small>${spellingWarning ? '<strong class="spelling-warning">스펠링 주의!</strong>' : ''}</div>
      </article>`;
    }).join('');
  }

  function finishRound() {
    setInputEnabled(false);
    els.questionCard.hidden = true;
    els.answerForm.hidden = true;
    setFeedback('');
    const completed = correct + wrong + skipped;
    const accuracy = completed ? Math.round((correct / completed) * 100) : 100;
    els.completionSummary.textContent = `정답 ${correct}개 · 오답 ${wrong}개 · 패스 ${skipped}개 · 정확도 ${accuracy}%`;
    els.completionCard.hidden = false;
  }

  function sanitizeInput() {
    const original = els.answerInput.value;
    const cleaned = original.replace(/[가-힣]/g, '');
    if (original !== cleaned) {
      els.answerInput.value = cleaned;
      setFeedback('약물명은 영문으로 입력해 주세요.', 'error');
    }
  }

  function renderAnswerProgress() {
    const card = currentCard();
    const target = document.getElementById('answerProgress');
    if (!card) { target.replaceChildren(); return; }
    const status = document.createElement('p');
    status.textContent = `입력 완료 ${enteredAnswers.size} / ${card.answers.length}개`;
    const list = document.createElement('ul');
    for (const answer of card.answers.filter((answer) => enteredAnswers.has(answer.slug))) {
      const item = document.createElement('li');
      item.textContent = answer.name;
      list.append(item);
    }
    target.replaceChildren(status, list);
  }

  function recordQuestion(outcome) {
    const card = currentCard();
    const submitted = card.answers.filter((answer) => enteredAnswers.has(answer.slug)).map((answer) => answer.name).join(', ');
    recent.unshift({ cardIndex: deck[position], outcome, submittedAnswer: submitted,
      correctAnswer: answerForCard(card), answerKind: 'group' });
    recent = recent.slice(0, 8);
    renderRecent();
    renderStats();
  }

  function submitAnswer() {
    if (locked || !currentCard()) return;
    sanitizeInput();
    const card = currentCard();
    const inputs = els.answerInput.value.split(/[,;\n]+/).map((value) => value.trim()).filter(Boolean);
    if (!inputs.length) { setFeedback('약물명을 입력해 주세요.', 'error'); return; }
    const duplicates = [];
    const invalid = [];
    for (const value of inputs) {
      const key = scientificKey(value);
      const answer = card.answers.find((answer) => answerKeys(answer).includes(key));
      if (!answer) { invalid.push(value); questionMistake = true; }
      else if (enteredAnswers.has(answer.slug)) duplicates.push(answer.name);
      else enteredAnswers.add(answer.slug);
    }
    renderAnswerProgress();
    els.answerInput.value = '';
    if (enteredAnswers.size === card.answers.length) {
      if (questionMistake) { wrong += 1; streak = 0; }
      else { correct += 1; streak += 1; }
      els.questionCard.classList.add(questionMistake ? 'wrong' : 'correct');
      recordQuestion(questionMistake ? 'wrong' : 'correct');
      setFeedback(`정답 ${card.answers.length}개를 모두 입력했어요 — ${answerForCard(card)}`, 'success');
      scheduleAdvance(1100);
      return;
    }
    const messages = [];
    if (invalid.length) messages.push(`정답으로 인정되지 않은 입력: ${invalid.join(', ')}`);
    if (duplicates.length) messages.push(`이미 입력한 약물: ${duplicates.join(', ')}`);
    messages.push(`남은 약물 ${card.answers.length - enteredAnswers.size}개를 입력하세요.`);
    setFeedback(messages.join(' · '), invalid.length ? 'error' : 'success');
    els.answerInput.focus();
  }

  function passCard() {
    if (locked || !currentCard()) return;
    const card = currentCard();
    const remaining = card.answers.filter((answer) => !enteredAnswers.has(answer.slug)).map((answer) => answer.name);
    skipped += 1;
    streak = 0;
    recordQuestion('skipped');
    els.questionCard.classList.add('skipped');
    setFeedback(`패스 — 남은 정답: ${remaining.join(', ')}`, 'skip');
    scheduleAdvance(1600);
  }

  function previousTestQuestion() {
    if (!setupComplete || position === 0 || document.querySelector('dialog[open]')) return;
    clearTimeout(advanceTimer);
    advanceTimer = null;
    position -= 1;
    const snapshot = testSnapshots[position];
    correct = snapshot.correct;
    wrong = snapshot.wrong;
    skipped = snapshot.skipped;
    streak = snapshot.streak;
    recent = snapshot.recent.map(item => ({ ...item }));
    testSnapshots.length = position + 1;
    enteredAnswers = new Set();
    questionMistake = false;
    els.completionCard.hidden = true;
    els.questionCard.hidden = false;
    els.answerForm.hidden = false;
    renderQuestion();
    renderRecent();
    renderStats();
    setFeedback('');
    setInputEnabled(true);
    els.answerInput.focus();
  }

  function advanceNow() {
    clearTimeout(advanceTimer);
    advanceTimer = null;
    position += 1;
    enteredAnswers = new Set();
    questionMistake = false;
    if (position >= deck.length) finishRound();
    else {
      renderQuestion();
      setFeedback('');
      setInputEnabled(true);
      els.answerInput.focus();
    }
  }

  function nextTestQuestion() {
    if (!setupComplete || !currentCard() || document.querySelector('dialog[open]')) return;
    // Completed answers have already been recorded; only pending questions count as passes.
    if (!locked) {
      skipped += 1;
      streak = 0;
      recordQuestion('skipped');
    }
    advanceNow();
  }

  function scheduleAdvance(delay) {
    setInputEnabled(false);
    clearTimeout(advanceTimer);
    advanceTimer = setTimeout(advanceNow, delay);
  }

  function lectureGroups() {
    return [0, ...DATA.categories.map((item) => item.id)].map((id) => ({
      macro: id === 0 ? '약리학 기초·실습' : DATA.categories.find((item) => item.id === id).title,
      items: lectures.filter((lecture) => lecture.categoryId === id),
    })).filter((group) => group.items.length);
  }

  function cardIdsForLecture(key) {
    return cards.filter((card) => cardLectureKeys(card).includes(key)).sort((a, b) => a.sequence - b.sequence).map((card) => String(card.id));
  }

  function renderLectureOptions() {
    els.lectureOptions.innerHTML = lectureGroups().map((group) => `<section class="lecture-group">
      <h3><label><input class="category-master" type="checkbox" data-category="${escapeHtml(group.macro)}"> ${escapeHtml(group.macro)}</label></h3>
      <div class="lecture-checks">${group.items.map((lecture) => {
        const lectureCardIds = cardIdsForLecture(lecture.key);
        const selectedCount = lectureCardIds.filter((id) => draftCardIds.has(id)).length;
        return `<div class="lecture-block">
          <div class="lecture-row">
            <label class="lecture-check">
              <input class="lecture-master" type="checkbox" data-lecture="${lecture.key}" ${lectureCardIds.length && selectedCount === lectureCardIds.length ? 'checked' : ''} ${lectureCardIds.length ? '' : 'disabled'}>
              <span><strong>${escapeHtml(lecture.title)}</strong>${lecture.topic ? `<small>${escapeHtml(lecture.topic)}</small>` : ""}</span>
              <em>${selectedCount}/${lectureCardIds.length}개</em>
            </label>
            <button class="lecture-toggle" type="button" data-lecture="${lecture.key}" aria-expanded="false" aria-label="${escapeHtml(lecture.title)} 약물 목록 열기">⌄</button>
          </div>
          <div class="parasite-options" data-panel="${lecture.key}" hidden>${lectureCardIds.map((id) => {
            const card = cards.find((item) => String(item.id) === id);
            return `<label class="parasite-check"><input class="parasite-check-input" type="checkbox" data-card-id="${id}" ${draftCardIds.has(id) ? 'checked' : ''}><span><strong>${escapeHtml(card.code)} · ${escapeHtml(card.scientificName)}</strong><em>${escapeHtml(card.koreanName)}</em></span></label>`;
          }).join('')}</div>
        </div>`;
      }).join('')}</div>
    </section>`).join('');
    syncLectureMasters();
    updateScopeCount();
  }

  function syncLectureMasters() {
    els.lectureOptions.querySelectorAll('.category-master').forEach((input) => {
      const keys = lectures.filter((lecture) => lecture.macro === input.dataset.category).map((lecture) => lecture.key);
      const ids = cards.filter((card) => keys.includes(card.lectureNumbers[0])).map((card) => String(card.id));
      const count = ids.filter((id) => draftCardIds.has(id)).length;
      input.checked = ids.length > 0 && count === ids.length;
      input.indeterminate = count > 0 && count < ids.length;
    });
    els.lectureOptions.querySelectorAll('.lecture-master').forEach((input) => {
      const ids = cardIdsForLecture(input.dataset.lecture);
      const count = ids.filter((id) => draftCardIds.has(id)).length;
      input.checked = ids.length > 0 && count === ids.length;
      input.indeterminate = count > 0 && count < ids.length;
      const countLabel = input.closest('.lecture-check').querySelector('em');
      countLabel.textContent = `${count}/${ids.length}개`;
    });
    els.lectureOptions.querySelectorAll('.parasite-check-input').forEach((input) => {
      input.checked = draftCardIds.has(input.dataset.cardId);
    });
  }

  function updateScopeCount() {
    const fullLectures = lectures.filter((lecture) => cardIdsForLecture(lecture.key).length > 0 && cardIdsForLecture(lecture.key).every((id) => draftCardIds.has(id))).length;
    els.scopeCount.textContent = `${fullLectures}개 강의 전체 · ${draftCardIds.size}개 강의별 카드 선택`;
    els.applyScope.disabled = draftCardIds.size === 0;
  }

  function updateScopeSummary() {
    const count = scopeIndices().length;
    if (!setupComplete) els.scopeSummary.textContent = '선택 전';
    else if (activeCardIds.size === cards.length) els.scopeSummary.textContent = `전체 ${count}개`;
    else els.scopeSummary.textContent = `${count}개 강의별 카드 선택`;
  }

  function openScopeDialog() {
    if (advanceTimer) {
      clearTimeout(advanceTimer);
      advanceTimer = null;
      position += 1;
      if (position >= deck.length) finishRound();
      else {
        renderQuestion();
        setFeedback('');
        setInputEnabled(true);
      }
    }
    draftCardIds = new Set(activeCardIds);
    renderLectureOptions();
    els.scopeCancel.hidden = !setupComplete;
    els.scopeClose.hidden = !setupComplete;
    els.applyScope.textContent = setupComplete ? '범위 적용하고 다시 시작' : '이 범위로 시작';
    els.scopeDialog.showModal();
  }

  els.answerInput.addEventListener('beforeinput', (event) => {
    if (event.data && /[가-힣]/.test(event.data)) {
      event.preventDefault();
      setFeedback('약물명은 영문으로 입력해 주세요.', 'error');
    }
  });
  els.answerInput.addEventListener('input', (event) => { if (!event.isComposing) sanitizeInput(); });
  els.answerInput.addEventListener('compositionend', sanitizeInput);
  els.answerForm.addEventListener('submit', (event) => { event.preventDefault(); submitAnswer(); });
  els.passButton.addEventListener('click', IS_TEST_MODE ? nextTestQuestion : passCard);
  if (IS_TEST_MODE) {
    previousButton.addEventListener('click', previousTestQuestion);
    document.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || document.querySelector('dialog[open]') || !setupComplete) return;
      if (event.key === 'ArrowLeft') {
        if (position === 0) return;
        event.preventDefault();
        previousTestQuestion();
      } else {
        if (!currentCard()) return;
        event.preventDefault();
        nextTestQuestion();
      }
    });
  }
  els.restartDeck.addEventListener('click', () => {
    if (setupComplete && window.confirm('현재 기록을 지우고 선택한 순서로 다시 시작할까요?')) startRound();
  });
  els.repeatRound.addEventListener('click', startRound);
  els.changeScope.addEventListener('click', openScopeDialog);
  els.openScope.addEventListener('click', openScopeDialog);
  [els.featureLanguage, els.scopeFeatureLanguage].forEach((select) => {
    select.addEventListener('change', () => setFeatureLanguage(select.value));
  });
  els.openHelp.addEventListener('click', () => els.helpDialog.showModal());
  els.lectureOptions.addEventListener('click', (event) => {
    const button = event.target.closest('.lecture-toggle');
    if (!button) return;
    const panel = els.lectureOptions.querySelector(`[data-panel="${button.dataset.lecture}"]`);
    const expanded = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!expanded));
    button.textContent = expanded ? '⌄' : '⌃';
    panel.hidden = expanded;
  });
  els.lectureOptions.addEventListener('change', (event) => {
    if (event.target.matches('.category-master')) {
      const keys = lectures.filter((lecture) => lecture.macro === event.target.dataset.category).map((lecture) => lecture.key);
      cards.filter((card) => keys.includes(card.lectureNumbers[0])).forEach((card) => {
        if (event.target.checked) draftCardIds.add(String(card.id)); else draftCardIds.delete(String(card.id));
      });
    } else if (event.target.matches('.lecture-master')) {
      cardIdsForLecture(event.target.dataset.lecture).forEach((id) => {
        if (event.target.checked) draftCardIds.add(id); else draftCardIds.delete(id);
      });
    } else if (event.target.matches('.parasite-check-input')) {
      if (event.target.checked) draftCardIds.add(event.target.dataset.cardId);
      else draftCardIds.delete(event.target.dataset.cardId);
    }
    syncLectureMasters();
    updateScopeCount();
  });
  els.scopeForm.querySelectorAll('[data-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      draftCardIds = button.dataset.preset === 'all' ? new Set(allCardIds) : new Set();
      syncLectureMasters();
      updateScopeCount();
    });
  });
  els.applyScope.addEventListener('click', (event) => {
    event.preventDefault();
    if (!draftCardIds.size) return;
    activeCardIds = new Set(draftCardIds);
    orderMode = document.getElementById('orderMode').value;
    els.repeatRound.textContent = orderMode === 'code' ? '같은 순서로 다시 연습' : '다시 섞어서 연습';
    setupComplete = true;
    updateScopeSummary();
    els.scopeDialog.close();
    try { localStorage.setItem(SCOPE_STORAGE_KEY, JSON.stringify([...activeCardIds])); } catch (_) { /* optional */ }
    startRound();
  });
  els.scopeDialog.addEventListener('cancel', (event) => { if (!setupComplete) event.preventDefault(); });
  els.scopeDialog.addEventListener('click', (event) => { if (event.target === els.scopeDialog && setupComplete) els.scopeDialog.close(); });
  els.helpDialog.addEventListener('click', (event) => { if (event.target === els.helpDialog) els.helpDialog.close(); });

  try {
    const saved = JSON.parse(localStorage.getItem(SCOPE_STORAGE_KEY));
    if (Array.isArray(saved) && saved.length) {
      const currentIdsByDrug = new Map(allCardIds.map(id => [id.split('@')[0], id]));
      const retainedIds = saved.map(id => currentIdsByDrug.get(String(id).split('@')[0])).filter(Boolean);
      if (retainedIds.length) activeCardIds = new Set(retainedIds);
    }
  } catch (_) { /* optional */ }

  try {
    featureLanguage = localStorage.getItem(FEATURE_LANGUAGE_STORAGE_KEY) === 'korean' ? 'korean' : 'mixed';
  } catch (_) { /* optional */ }
  els.featureLanguage.value = featureLanguage;
  els.scopeFeatureLanguage.value = featureLanguage;
  draftCardIds = new Set(activeCardIds);
  renderLectureOptions();
  updateScopeSummary();
  renderRecent();
  renderStats();
  setInputEnabled(false);
  els.scopeCancel.hidden = true;
  els.scopeClose.hidden = true;
  els.scopeDialog.showModal();
})();
