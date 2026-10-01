(function () {
  'use strict';

  const DATA = window.DRUG_DATA;
  if (!DATA || !Array.isArray(DATA.cards) || !Array.isArray(DATA.matrix)) {
    document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif">게임 데이터를 불러오지 못했습니다. data.js가 index.html과 같은 폴더에 있는지 확인해 주세요.</p>';
    return;
  }

  const cards = DATA.cards;
  const matrix = DATA.matrix;
  const lectures = DATA.lectures.map((item) => ({
    key: item.id, number: item.id, title: `${item.courseLectureNumber}강. ${item.title}`, topic: "", macro: item.category,
  }));
  const exactScientificNames = new Map();
  cards.forEach((card, index) => {
    [card.name, ...(card.aliases || [])].forEach((name) => exactScientificNames.set(scientificKey(name), index));
  });

  const els = {
    guessForm: document.getElementById('guessForm'),
    guessInput: document.getElementById('guessInput'),
    suggestions: document.getElementById('suggestions'),
    notice: document.getElementById('notice'),
    hintStrip: document.getElementById('hintStrip'),
    attemptList: document.getElementById('attemptList'),
    emptyState: document.getElementById('emptyState'),
    answerResult: document.getElementById('answerResult'),
    guessCount: document.getElementById('guessCount'),
    bestScore: document.getElementById('bestScore'),
    bestRank: document.getElementById('bestRank'),
    proximityBar: document.getElementById('proximityBar'),
    proximityLabel: document.getElementById('proximityLabel'),
    newGame: document.getElementById('newGame'),
    hintButton: document.getElementById('hintButton'),
    shareButton: document.getElementById('shareButton'),
    giveUpButton: document.getElementById('giveUpButton'),
    openScope: document.getElementById('openScope'),
    scopeDialog: document.getElementById('scopeDialog'),
    scopeForm: document.getElementById('scopeForm'),
    lectureOptions: document.getElementById('lectureOptions'),
    scopeCount: document.getElementById('scopeCount'),
    scopeSummary: document.getElementById('scopeSummary'),
    scopeCancel: document.getElementById('scopeCancel'),
    scopeClose: document.getElementById('scopeClose'),
    applyScope: document.getElementById('applyScope'),
    openHelp: document.getElementById('openHelp'),
    helpDialog: document.getElementById('helpDialog'),
    catalogToggle: document.getElementById('catalogToggle'),
    catalogPanel: document.getElementById('catalogPanel'),
    catalogBody: document.getElementById('catalogBody'),
    toast: document.getElementById('toast'),
  };

  const allCardIds = cards.filter((card) => card.occurrences.length).map((card) => String(card.id));
  const validCardIds = new Set(allCardIds);
  let activeCardIds = new Set(allCardIds);
  let draftCardIds = new Set(allCardIds);
  let difficulty = 'easy';
  const DIFFICULTY_STORAGE_KEY = 'drug-semantle-difficulty-v2';
  let setupComplete = false;
  let answerIndex = null;
  let previousAnswerIndex = null;
  let history = [];
  let rankings = new Map();
  let hintLevel = 0;
  let hintMessages = [];
  let gameOver = false;
  let toastTimer = null;
  let sharedAnswerIndex = answerFromUrl();
  let visibleSuggestions = [];
  let activeSuggestion = -1;

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function scientificKey(value) {
    return String(value).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add('show');
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
  }

  function setNotice(message) {
    els.notice.textContent = message || '';
  }

  function cardLectureKeys(card) {
    return card.lectureIds;
  }

  function cardInScope(card) {
    return activeCardIds.has(String(card.id));
  }

  function eligibleIndices() {
    return cards.map((_, index) => index).filter((index) => cardInScope(cards[index]));
  }

  function searchScientificNames(query) {
    const q = scientificKey(query);
    if (!q) return [];
    const guessed = new Set(history.map((item) => item.index));
    return eligibleIndices()
      .filter((index) => !guessed.has(index))
      .map((index) => {
        const names = [cards[index].name, ...(cards[index].aliases || [])].map(scientificKey);
        const relevance = names.includes(q) ? 0 : names.some((name) => name.startsWith(q)) ? 1 : names.some((name) => name.includes(q)) ? 2 : 9;
        return { index, relevance };
      })
      .filter((item) => item.relevance < 9)
      .sort((a, b) => a.relevance - b.relevance || cards[a.index].id - cards[b.index].id)
      .slice(0, 9)
      .map((item) => item.index);
  }

  function hideSuggestions() {
    visibleSuggestions = [];
    activeSuggestion = -1;
    els.suggestions.hidden = true;
    els.suggestions.innerHTML = '';
    els.guessInput.setAttribute('aria-expanded', 'false');
  }

  function renderSuggestions() {
    if (difficulty !== 'easy' || gameOver || !setupComplete) {
      hideSuggestions();
      return;
    }
    visibleSuggestions = searchScientificNames(els.guessInput.value);
    activeSuggestion = visibleSuggestions.length ? 0 : -1;
    if (!visibleSuggestions.length) {
      hideSuggestions();
      return;
    }
    els.suggestions.innerHTML = visibleSuggestions.map((index, position) => {
      const card = cards[index];
      return `<button type="button" class="suggestion${position === activeSuggestion ? ' active' : ''}" role="option" aria-selected="${position === activeSuggestion}" data-index="${index}">
        <strong>${escapeHtml(card.scientificName)}</strong><small>${escapeHtml(card.macro)}</small>
      </button>`;
    }).join('');
    els.suggestions.hidden = false;
    els.guessInput.setAttribute('aria-expanded', 'true');
  }

  function updateActiveSuggestion() {
    [...els.suggestions.querySelectorAll('.suggestion')].forEach((node, position) => {
      const active = position === activeSuggestion;
      node.classList.toggle('active', active);
      node.setAttribute('aria-selected', String(active));
      if (active) node.scrollIntoView({ block: 'nearest' });
    });
  }

  function buildRankings() {
    rankings = new Map();
    if (answerIndex === null) return;
    const values = eligibleIndices()
      .filter((index) => index !== answerIndex)
      .map((index) => ({ index, score: matrix[answerIndex][index] }))
      .sort((a, b) => b.score - a.score || a.index - b.index);
    values.forEach((item) => {
      const rank = 1 + values.filter((other) => other.score > item.score + Number.EPSILON).length;
      rankings.set(item.index, { rank, poolSize: values.length });
    });
  }

  function answerFromUrl() {
    try {
      const key = new URL(window.location.href).searchParams.get('answer');
      if (!key) return null;
      const index = cards.findIndex((card) => card.slug === key || String(card.id) === key);
      return index >= 0 ? index : null;
    } catch (_) {
      return null;
    }
  }

  function pickRandomAnswer() {
    const pool = eligibleIndices();
    if (!pool.length) return null;
    const withoutPrevious = pool.length > 1 ? pool.filter((index) => index !== previousAnswerIndex) : pool;
    return withoutPrevious[Math.floor(Math.random() * withoutPrevious.length)];
  }

  function resetUrl() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('answer');
      window.history.replaceState({}, '', url.href);
    } catch (_) { /* file URLs can restrict history changes */ }
  }

  function setGameControls(enabled) {
    els.guessInput.disabled = !enabled;
    els.newGame.disabled = !enabled;
    els.hintButton.disabled = !enabled;
    els.shareButton.disabled = !enabled;
    els.giveUpButton.disabled = !enabled;
  }

  function startGame(preferredIndex, keepSharedUrl) {
    previousAnswerIndex = answerIndex;
    const preferredIsValid = Number.isInteger(preferredIndex) && cardInScope(cards[preferredIndex]);
    const chosen = preferredIsValid ? preferredIndex : pickRandomAnswer();
    if (chosen === null) {
      setNotice('출제할 수 있는 카드가 없습니다. 대분류를 한 개 이상 선택해 주세요.');
      return;
    }
    answerIndex = chosen;
    history = [];
    hintLevel = 0;
    hintMessages = [];
    gameOver = false;
    buildRankings();
    els.guessInput.value = '';
    hideSuggestions();
    els.answerResult.hidden = true;
    els.answerResult.innerHTML = '';
    els.hintStrip.hidden = true;
    els.hintStrip.innerHTML = '';
    setGameControls(true);
    setNotice('');
    refreshAttempts();
    updateStatus();
    if (!keepSharedUrl) resetUrl();
    els.guessInput.focus();
  }

  function proximity(score) {
    if (score >= 100) return '정답';
    if (score >= 75) return '매우 가까움';
    if (score >= 50) return '가까움';
    if (score >= 25) return '연결됨';
    return '먼 편';
  }

  function scoreColor(score) {
    if (score >= 99.999) return '#237653';
    if (score >= 75) return '#ed6a50';
    if (score >= 50) return '#e7a838';
    if (score >= 25) return '#8eaa72';
    return '#9aa9a3';
  }

  function matchLabel(index) {
    if (index === answerIndex) return '정답';
    const answer = cards[answerIndex].similarityProfile;
    const card = cards[index].similarityProfile;
    if (card.minor === answer.minor) return '같은 약리 소분류';
    if (card.mid === answer.mid) return '같은 약리 중분류';
    if (card.major === answer.major) return '같은 약리 대분류';
    return '';
  }

  function formatScore(score) {
    return score > 0 && score < 0.1 ? '<0.1' : score.toFixed(1);
  }

  function hierarchyLabel(value) {
    return value.replace(/^\d+_(?:\d+_)?/, '').replace(/_/g, ' · ');
  }

  function submitGuess(index, source) {
    if (gameOver || index === null || index === undefined) return;
    if (!cardInScope(cards[index])) {
      setNotice('선택한 범위에 등록되지 않은 약물입니다');
      return;
    }
    if (history.some((item) => item.index === index)) {
      setNotice('이미 입력한 약물입니다');
      return;
    }
    const score = index === answerIndex ? 100 : matrix[answerIndex][index] * 100;
    const rankInfo = rankings.get(index) || { rank: 0, poolSize: eligibleIndices().length - 1 };
    history.push({ index, score, rank: rankInfo.rank, poolSize: rankInfo.poolSize, source: source || 'guess' });
    els.guessInput.value = '';
    hideSuggestions();
    setNotice('');
    refreshAttempts();
    updateStatus();
    if (index === answerIndex) finishGame(true);
    else els.guessInput.focus();
  }

  function refreshAttempts() {
    els.emptyState.hidden = history.length > 0;
    if (!history.length) {
      els.attemptList.innerHTML = '';
      return;
    }
    const latestIndex = history[history.length - 1].index;
    const sorted = [...history].sort((a, b) => b.score - a.score || a.rank - b.rank || a.index - b.index);
    els.attemptList.innerHTML = sorted.map((item) => {
      const card = cards[item.index];
      const label = matchLabel(item.index);
      const winner = item.index === answerIndex;
      const rank = winner ? 'TARGET' : `${item.rank} / ${item.poolSize}`;
      return `<article class="attempt-row${item.index === latestIndex ? ' latest' : ''}${winner ? ' winner' : ''}">
        <div class="attempt-name">
          <strong>${escapeHtml(card.scientificName)}${label ? `<span class="match-label">${escapeHtml(label)}</span>` : ''}</strong>
          <em>${escapeHtml(card.lecture)}</em>
        </div>
        <div class="score-cell">
          <span class="score-track"><i style="width:${Math.max(1, item.score)}%;background:${scoreColor(item.score)}"></i></span>
          <strong class="score-value" style="color:${scoreColor(item.score)}">${escapeHtml(formatScore(item.score))}</strong>
        </div>
        <span class="rank-value">${rank}</span>
      </article>`;
    }).join('');
  }

  function updateStatus() {
    const nonAnswer = history.filter((item) => item.index !== answerIndex);
    const best = nonAnswer.length ? [...nonAnswer].sort((a, b) => b.score - a.score)[0] : null;
    els.guessCount.textContent = String(history.length);
    els.bestScore.textContent = best ? formatScore(best.score) : '—';
    els.bestRank.textContent = best ? `#${best.rank}` : '—';
    els.proximityBar.style.width = best ? `${best.score}%` : '0%';
    els.proximityLabel.textContent = best ? proximity(best.score) : '탐색 전';
  }

  function renderAnswerCard(won) {
    const card = cards[answerIndex];
    const sectionOrder = ['약리학적 계열', '핵심 특징', '강의별 코드', '판정', '출처'];
    const details = sectionOrder
      .filter((section) => Array.isArray(card.sections[section]) && card.sections[section].length)
      .map((section, index) => `<details${index < 2 ? ' open' : ''}>
        <summary>${escapeHtml(section)}</summary>
        <ul>${card.sections[section].map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
      </details>`).join('');
    els.answerResult.innerHTML = `
      <span class="result-badge">${won ? '정답입니다' : '이번 정답'}</span>
      <h2 class="result-title">${escapeHtml(card.scientificName)}</h2>
      <p class="result-scientific">${escapeHtml(card.koreanName)}</p>
      <div class="result-meta"><span>${escapeHtml(card.macro)}</span><span>${escapeHtml(card.lecture)}</span><span>${escapeHtml(card.code || "코드 없음")}</span></div>
      <div class="study-details">${details}</div>`;
    els.answerResult.hidden = false;
    els.answerResult.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function finishGame(won) {
    gameOver = true;
    hideSuggestions();
    setGameControls(false);
    els.newGame.disabled = false;
    els.shareButton.disabled = false;
    renderAnswerCard(won);
    setNotice(won ? `${history.length}번 만에 정답을 찾았습니다.` : '정답 카드를 펼쳐 복습해 보세요.');
  }

  function useHint() {
    if (gameOver) return;
    const answer = cards[answerIndex];
    hintLevel += 1;
    if (hintLevel === 1) {
      hintMessages.push(`약리 대분류: <strong>${escapeHtml(hierarchyLabel(answer.similarityProfile.major))}</strong>`);
    } else if (hintLevel === 2) {
      hintMessages.push(`약리 중분류: <strong>${escapeHtml(hierarchyLabel(answer.similarityProfile.mid))}</strong> · 약리 계열: <strong>${escapeHtml(answer.koreanName)}</strong>`);
    } else {
      const guessed = new Set(history.map((item) => item.index));
      const closest = [...rankings.entries()]
        .filter(([index]) => !guessed.has(index))
        .sort((a, b) => a[1].rank - b[1].rank || a[0] - b[0])[0];
      if (!closest) {
        hintMessages.push('더 이상 추천할 후보가 없습니다.');
        els.hintButton.disabled = true;
      } else {
        hintMessages.push(`가장 가까운 미입력 약물 <strong>${escapeHtml(cards[closest[0]].scientificName)}</strong>을 기록에 추가했습니다.`);
        submitGuess(closest[0], 'hint');
      }
    }
    els.hintStrip.innerHTML = hintMessages.join('<span aria-hidden="true"> · </span>');
    els.hintStrip.hidden = false;
  }

  async function shareGame() {
    if (answerIndex === null) return;
    const card = cards[answerIndex];
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('answer', card.slug);
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(url.href);
      else {
        const area = document.createElement('textarea');
        area.value = url.href;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
      }
      showToast('같은 정답으로 시작하는 주소를 복사했습니다.');
    } catch (_) {
      showToast('주소 복사가 제한되었습니다. 브라우저 주소창에서 복사해 주세요.');
    }
  }

  function lectureGroups() {
    return [...new Set(lectures.map((item) => item.macro))].map((macro) => ({ macro, items: lectures.filter((item) => item.macro === macro) }));
  }

  function renderLectureOptions() {
    els.lectureOptions.innerHTML = lectureGroups().map((group) => `<section class="lecture-group">
      <h3>${escapeHtml(group.macro)}</h3>
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
            return `<label class="parasite-check"><input class="parasite-check-input" type="checkbox" data-card-id="${id}" ${draftCardIds.has(id) ? 'checked' : ''}><span><strong>${escapeHtml(card.occurrences.find((o) => o.lectureId === lecture.key).code)} · ${escapeHtml(card.scientificName)}</strong><em>${escapeHtml(card.koreanName)}</em></span></label>`;
          }).join('')}</div>
        </div>`;
      }).join('')}</div>
    </section>`).join('');
    syncLectureMasters();
    updateScopeCount();
  }

  function cardIdsForLecture(key) {
    return cards.filter((card) => cardLectureKeys(card).includes(key)).sort((a, b) => a.occurrences.find((o) => o.lectureId === key).sequence - b.occurrences.find((o) => o.lectureId === key).sequence).map((card) => String(card.id));
  }

  function syncLectureMasters() {
    els.lectureOptions.querySelectorAll('.lecture-master').forEach((input) => {
      const ids = cardIdsForLecture(input.dataset.lecture);
      const count = ids.filter((id) => draftCardIds.has(id)).length;
      input.checked = ids.length > 0 && count === ids.length;
      input.indeterminate = count > 0 && count < ids.length;
      input.closest('.lecture-check').querySelector('em').textContent = `${count}/${ids.length}개`;
    });
    els.lectureOptions.querySelectorAll('.parasite-check-input').forEach((input) => {
      input.checked = draftCardIds.has(input.dataset.cardId);
    });
  }

  function updateScopeCount() {
    const fullLectures = lectures.filter((lecture) => cardIdsForLecture(lecture.key).length > 0 && cardIdsForLecture(lecture.key).every((id) => draftCardIds.has(id))).length;
    els.scopeCount.textContent = `${fullLectures}개 분류 전체 · ${draftCardIds.size}개 선택`;
    els.applyScope.disabled = draftCardIds.size === 0;
  }

  function updateScopeSummary() {
    const exampleCard = cards.find(card => card.name === 'Metformin' && cardInScope(card)) || cards.find(cardInScope);
    els.guessInput.placeholder = exampleCard ? `예: ${exampleCard.name}` : '약물명을 입력하세요';
    const count = eligibleIndices().length;
    const mode = difficulty === 'easy' ? 'Easy' : 'Hard';
    if (!setupComplete) els.scopeSummary.textContent = '선택 전';
    else if (activeCardIds.size === allCardIds.length) els.scopeSummary.textContent = `${mode} · 전체 ${count}개`;
    else els.scopeSummary.textContent = `${mode} · ${count}개 선택`;
  }

  function renderCatalog() {
    els.catalogBody.innerHTML = cards.filter((card) => card.learningEligible).map((card) => {
      return `<tr><td>${escapeHtml(card.code || "코드 없음")}</td><td><i>${escapeHtml(card.scientificName)}</i></td><td>${escapeHtml(card.lecture)}</td></tr>`;
    }).join('');
  }

  function sanitizeScientificInput() {
    const original = els.guessInput.value;
    const cleaned = original.replace(/[가-힣]/g, '');
    if (original !== cleaned) {
      els.guessInput.value = cleaned;
      setNotice('약물명은 영문으로 입력해 주세요');
    } else if (els.notice.textContent === '약물명은 영문으로 입력해 주세요') {
      setNotice('');
    }
  }

  els.guessInput.addEventListener('beforeinput', (event) => {
    if (event.data && /[가-힣]/.test(event.data)) {
      event.preventDefault();
      setNotice('약물명은 영문으로 입력해 주세요');
    }
  });
  els.guessInput.addEventListener('input', (event) => {
    if (!event.isComposing) {
      sanitizeScientificInput();
      renderSuggestions();
    }
  });
  els.guessInput.addEventListener('compositionend', () => {
    sanitizeScientificInput();
    renderSuggestions();
  });
  els.guessInput.addEventListener('keydown', (event) => {
    if (difficulty !== 'easy' || els.suggestions.hidden) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeSuggestion = Math.min(activeSuggestion + 1, visibleSuggestions.length - 1);
      updateActiveSuggestion();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeSuggestion = Math.max(activeSuggestion - 1, 0);
      updateActiveSuggestion();
    } else if (event.key === 'Escape') {
      hideSuggestions();
    }
  });
  els.guessInput.addEventListener('blur', () => setTimeout(hideSuggestions, 130));
  els.suggestions.addEventListener('mousedown', (event) => event.preventDefault());
  els.suggestions.addEventListener('click', (event) => {
    const button = event.target.closest('[data-index]');
    if (button) submitGuess(Number(button.dataset.index));
  });
  els.guessForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!setupComplete || gameOver) return;
    sanitizeScientificInput();
    const value = scientificKey(els.guessInput.value);
    if (!value) {
      setNotice('약물명을 입력해 주세요');
      return;
    }
    let index = exactScientificNames.get(value);
    if (index === undefined && difficulty === 'easy' && activeSuggestion >= 0) index = visibleSuggestions[activeSuggestion];
    if (index === undefined) {
      setNotice('등록되지 않은 약물명입니다');
      return;
    }
    if (!cardInScope(cards[index])) {
      setNotice('선택한 범위에 등록되지 않은 약물입니다');
      return;
    }
    submitGuess(index);
  });

  els.newGame.addEventListener('click', () => startGame());
  els.hintButton.addEventListener('click', useHint);
  els.giveUpButton.addEventListener('click', () => {
    if (!gameOver && window.confirm('정답을 확인하고 이번 문제를 끝낼까요?')) finishGame(false);
  });
  els.shareButton.addEventListener('click', shareGame);
  els.openHelp.addEventListener('click', () => els.helpDialog.showModal());
  els.openScope.addEventListener('click', () => {
    hideSuggestions();
    draftCardIds = new Set(activeCardIds);
    renderLectureOptions();
    const difficultyInput = els.scopeForm.querySelector(`input[name="difficulty"][value="${difficulty}"]`);
    if (difficultyInput) difficultyInput.checked = true;
    els.scopeCancel.hidden = !setupComplete;
    els.scopeClose.hidden = !setupComplete;
    els.applyScope.textContent = setupComplete ? '범위 적용하고 새 문제' : '이 범위로 시작';
    els.scopeDialog.showModal();
  });
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
    if (event.target.matches('.lecture-master')) {
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
    difficulty = els.scopeForm.querySelector('input[name="difficulty"]:checked')?.value || 'easy';
    setupComplete = true;
    updateScopeSummary();
    els.scopeDialog.close();
    try { localStorage.setItem('drug-semantle-cards-v9', JSON.stringify([...activeCardIds])); } catch (_) { /* optional preference */ }
    try { localStorage.setItem(DIFFICULTY_STORAGE_KEY, difficulty); } catch (_) { /* optional preference */ }
    const preferred = sharedAnswerIndex !== null && cardInScope(cards[sharedAnswerIndex]) ? sharedAnswerIndex : null;
    startGame(preferred, preferred !== null);
    sharedAnswerIndex = null;
  });
  els.scopeDialog.addEventListener('cancel', (event) => {
    if (!setupComplete) event.preventDefault();
  });
  els.scopeDialog.addEventListener('click', (event) => {
    if (event.target === els.scopeDialog && setupComplete) els.scopeDialog.close();
  });
  els.helpDialog.addEventListener('click', (event) => {
    if (event.target === els.helpDialog) els.helpDialog.close();
  });
  els.catalogToggle.addEventListener('click', () => {
    const expanded = els.catalogToggle.getAttribute('aria-expanded') === 'true';
    els.catalogToggle.setAttribute('aria-expanded', String(!expanded));
    els.catalogPanel.hidden = expanded;
    els.catalogToggle.querySelector('i').textContent = expanded ? '＋' : '−';
  });

  try {
    const saved = JSON.parse(localStorage.getItem('drug-semantle-cards-v9'));
    if (Array.isArray(saved) && saved.length) {
      const retainedIds = saved.map(String).filter(id => validCardIds.has(id));
      if (retainedIds.length) activeCardIds = new Set(retainedIds);
    }
  } catch (_) { /* local storage is optional */ }
  try {
    const savedDifficulty = localStorage.getItem(DIFFICULTY_STORAGE_KEY);
    if (savedDifficulty === 'easy' || savedDifficulty === 'hard') difficulty = savedDifficulty;
  } catch (_) { /* local storage is optional */ }

  draftCardIds = new Set(activeCardIds);
  renderLectureOptions();
  renderCatalog();
  updateScopeSummary();
  setGameControls(false);
  refreshAttempts();
  updateStatus();
  els.scopeCancel.hidden = true;
  els.scopeClose.hidden = true;
  const initialDifficulty = els.scopeForm.querySelector(`input[name="difficulty"][value="${difficulty}"]`);
  if (initialDifficulty) initialDifficulty.checked = true;
  els.scopeDialog.showModal();
})();
