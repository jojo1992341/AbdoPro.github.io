/* ════════════════════════════════════════════════════════════════
   AbdoPro — screens/session.js
   
   Responsabilité unique : séance d'entraînement active.
   ─────────────────────────────────────────────────────────────
   CORRECTION : Ajout d'espaces et de gap sur l'écran de résumé.
   ════════════════════════════════════════════════════════════════ */

import state from '../state.js';
import { RestTimer, updateTimerUI, getCircleCircumference } from '../utils/timer.js';
import notifications from '../utils/notifications.js';

const SESSION_STATE = {
  READY:      'ready',
  EXERCISING: 'exercising',
  RESTING:    'resting',
  COMPLETED:  'completed',
  FAILED:     'failed',
  SAVING:     'saving'
};

const SessionScreen = {
  _container: null,
  _navigateTo: null,
  _abortController: null,
  _timer: null,
  _state: SESSION_STATE.READY,
  _plan: null,
  _currentSeries: 1,
  _seriesDetail: [],
  _sessionStart: 0,
  _seriesStart: 0,
  _timerElements: null,

  async render(container, params) {
    this._container = container;
    this._navigateTo = params.navigateTo;
    this._abortController = new AbortController();

    this._plan = state.getCurrentDayPlan();
    if (!this._plan) {
      this._showNoPlanError();
      return;
    }

    this._state = SESSION_STATE.READY;
    this._currentSeries = 1;
    this._seriesDetail = [];
    this._sessionStart = 0;

    notifications.init();
    this._attachEvents();
    this._render();
  },

  destroy() {
    if (this._timer) this._timer.destroy();
    if (this._abortController) this._abortController.abort();
    this._timer = null;
    this._container = null;
    this._seriesDetail = [];
  },

  _render() {
    if (!this._container) return;
    switch (this._state) {
      case SESSION_STATE.READY:      this._container.innerHTML = this._buildReadyHTML(); break;
      case SESSION_STATE.EXERCISING: this._container.innerHTML = this._buildExercisingHTML(); break;
      case SESSION_STATE.RESTING:    this._container.innerHTML = this._buildRestingHTML(); 
                                     this._cacheTimerElements(); 
                                     this._startRestTimer(); break;
      case SESSION_STATE.COMPLETED:  this._container.innerHTML = this._buildCompletedHTML(); break;
      case SESSION_STATE.FAILED:     this._container.innerHTML = this._buildFailedHTML(); break;
      case SESSION_STATE.SAVING:     this._container.innerHTML = this._buildSavingHTML(); break;
    }
  },

  _attachEvents() {
    const signal = this._abortController.signal;
    this._container.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      this._handleAction(target.dataset.action, target);
    }, { signal });
  },

  _handleAction(action, target) {
    switch (action) {
      case 'start-session':     this._onStartSession(); break;
      case 'series-done':       this._onSeriesDone(); break;
      case 'impossible':        this._onImpossible(); break;
      case 'skip-rest':         this._onSkipRest(); break;
      case 'go-feedback':       this._onGoFeedback(); break;
    }
  },

  _onStartSession() {
    this._sessionStart = Date.now();
    this._seriesStart = Date.now();
    this._state = SESSION_STATE.EXERCISING;
    this._render();
  },

  _onSeriesDone() {
    if (this._state !== SESSION_STATE.EXERCISING) return;
    this._seriesDetail.push({
      seriesNumber: this._currentSeries,
      repsCompleted: this._plan.reps,
      completed: true,
      duration: Math.round((Date.now() - this._seriesStart) / 1000)
    });

    if (this._currentSeries >= this._plan.series) {
      this._state = SESSION_STATE.COMPLETED;
      notifications.notifySessionEnd();
    } else {
      this._state = SESSION_STATE.RESTING;
    }
    this._render();
  },

  _onRestComplete() {
    if (this._timer) this._timer.destroy();
    this._timer = null;
    this._currentSeries++;
    this._seriesStart = Date.now();
    this._state = SESSION_STATE.EXERCISING;
    this._render();
  },

  _buildReadyHTML() {
    return `
      <div class="screen centered">
        <header class="screen-header text-center">
          <h1 class="screen-header__title">Prêt ?</h1>
          <span class="text-secondary">Séance J${state.getCurrentDayNumber()}</span>
        </header>
        <div class="card mb-6 w-full">
          <div class="card__body text-center">
            <div class="text-4xl font-bold color-primary mb-2">${this._plan.series} × ${this._plan.reps}</div>
            <div class="text-sm text-secondary">Objectif du jour</div>
          </div>
        </div>
        <button class="btn btn-primary btn-lg btn-block" data-action="start-session">Commencer</button>
      </div>`;
  },

  _buildExercisingHTML() {
    const progress = Math.round(((this._currentSeries - 1) / this._plan.series) * 100);
    return `
      <div class="screen centered">
        <header class="screen-header text-center">
          <h1 class="screen-header__title">Série ${this._currentSeries} / ${this._plan.series}</h1>
        </header>
        <div class="text-4xl font-bold mono color-primary mb-8">${this._plan.reps}</div>
        <button class="btn btn-success btn-lg btn-block mb-4" data-action="series-done">✅ Série terminée</button>
        <button class="btn btn-ghost btn-block" data-action="impossible">❌ Impossible</button>
        <div class="progress mt-8"><div class="progress__fill" style="width: ${progress}%"></div></div>
      </div>`;
  },

  _buildRestingHTML() {
    return `
      <div class="screen centered">
        <h1 class="screen-header__title mb-6">Repos</h1>
        <div class="timer" id="rest-timer-container">
          <svg class="timer__svg" viewBox="0 0 120 120">
            <circle class="timer__track" cx="60" cy="60" r="54" />
            <circle class="timer__progress" id="timer-progress" cx="60" cy="60" r="54" />
          </svg>
          <div class="timer__display"><span class="timer__time" id="timer-time">0:00</span></div>
        </div>
        <button class="btn btn-ghost btn-block mt-8" data-action="skip-rest">⏭️ Passer</button>
      </div>`;
  },

  _buildCompletedHTML() {
    const total = this._seriesDetail.reduce((sum, s) => sum + s.repsCompleted, 0);
    const goal = this._plan.series * this._plan.reps;
    return `
      <div class="screen centered">
        <div class="text-3xl mb-4">🎉</div>
        <h1 class="text-2xl font-bold mb-6">Séance terminée !</h1>
        <div class="card w-full mb-8">
          <div class="card__body">
            <div class="flex-between gap-2 mb-3">
              <span class="text-secondary">Objectif&nbsp;:</span>
              <span class="mono font-semibold">${goal}&nbsp;reps</span>
            </div>
            <div class="flex-between gap-2">
              <span class="text-secondary">Réalisé&nbsp;:</span>
              <span class="mono color-success font-bold">${total}&nbsp;reps</span>
            </div>
          </div>
        </div>
        <button class="btn btn-primary btn-lg btn-block" data-action="go-feedback">Continuer</button>
      </div>`;
  },

  _startRestTimer() {
    this._timer = new RestTimer({
      duration: this._plan.rest,
      onTick: (data) => updateTimerUI(this._timerElements, data),
      onComplete: () => this._onRestComplete()
    });
    this._timer.start();
  },

  _cacheTimerElements() {
    this._timerElements = {
      container: this._container.querySelector('#rest-timer-container'),
      circle: this._container.querySelector('#timer-progress'),
      timeText: this._container.querySelector('#timer-time')
    };
  },

  _onSkipRest() { if (this._timer) this._timer.skip(); },

  async _onGoFeedback() {
    const total = this._seriesDetail.reduce((sum, s) => sum + s.repsCompleted, 0);
    await state.saveSession({
      weekNumber: state.getCurrentWeekNumber(),
      dayNumber: state.getCurrentDayNumber(),
      date: new Date().toISOString(),
      type: 'training',
      duration: Math.round((Date.now() - this._sessionStart) / 1000),
      actual: { totalRepsCompleted: total, seriesDetail: this._seriesDetail },
      status: 'completed'
    });
    this._navigateTo('feedback');
  },

  _showNoPlanError() {
    this._container.innerHTML = `<div class="screen centered"><p>Aucune séance prévue.</p></div>`;
  }
};

export default SessionScreen;