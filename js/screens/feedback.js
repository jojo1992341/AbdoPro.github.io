// js/screens/feedback.js
// ─────────────────────────────────────────────────────────
// Écran de feedback post-séance.
//
// Affiché UNIQUEMENT après une séance complétée sans interruption.
// Collecte le ressenti utilisateur (Facile / Parfait),
// en déduit le RIR estimé, persiste, et avance au jour suivant.
//
// Dépendance : State (js/state.js)
// Route :      #/feedback
// ─────────────────────────────────────────────────────────

import { State } from '../state.js';

// ── Configuration ──────────────────────────────────────────

const FEEDBACK_OPTIONS = Object.freeze({
  facile: {
    id: 'facile',
    emoji: '😊',
    label: 'FACILE',
    description: "J'aurais pu faire plus",
    rir: 4,
    cssModifier: 'easy',
  },
  parfait: {
    id: 'parfait',
    emoji: '👌',
    label: 'PARFAIT',
    description: 'Juste ce qu\'il faut',
    rir: 2,
    cssModifier: 'perfect',
  },
});

const REDIRECT_DELAY_MS = 400;
const STAGGER_DELAY_MS = 100;

// ── Classe Principale ──────────────────────────────────────

export class FeedbackScreen {

  constructor() {
    this._container = null;
    this._sessionData = null;
    this._isProcessing = false;
    this._boundHandlers = new Map();
  }

  // ── Lifecycle ──────────────────────────────────────────

  /**
   * Point d'entrée du rendu. Appelé par le routeur SPA.
   * @param {HTMLElement} container — Élément DOM parent dans lequel rendre l'écran.
   */
  async render(container) {
    this._container = container;
    this._sessionData = await this._loadCurrentSession();

    if (!this._sessionData) {
      this._navigateTo('dashboard');
      return;
    }

    this._container.innerHTML = this._buildHTML();
    this._attachEvents();
    this._animateEntry();
  }

  /**
   * Nettoyage complet. Appelé par le routeur avant de quitter l'écran.
   */
  destroy() {
    this._detachEvents();
    this._container = null;
    this._sessionData = null;
    this._isProcessing = false;
  }

  // ── Chargement des Données ─────────────────────────────

  /**
   * Charge la séance courante depuis State.
   * Retourne null si aucune séance éligible au feedback
   * (pas de séance, ou feedback déjà donné).
   */
  async _loadCurrentSession() {
    const user = await State.getUser();
    if (!user) return null;

    const session = await State.getSession(user.currentWeek, user.currentDay);

    // Garde : pas de séance, ou feedback déjà enregistré
    if (!session || session.feedback) return null;

    return session;
  }

  // ── Construction du HTML ───────────────────────────────

  _buildHTML() {
    const stats = this._computeStats();

    return `
      <div class="screen screen--feedback" role="main" aria-labelledby="feedback-title">

        <header class="screen__header">
          <h1 id="feedback-title" class="screen__title">
            <span class="screen__title-icon" aria-hidden="true">✅</span>
            Séance Terminée
          </h1>
        </header>

        <section class="card card--recap feedback__recap" aria-label="Récapitulatif de la séance">
          <h2 class="card__subtitle">Récapitulatif</h2>
          <p class="recap__formula">
            ${stats.series} séries × ${stats.reps} reps
            = <strong>${stats.totalReps} reps</strong>
          </p>
          <p class="recap__duration">
            Durée : <strong>${stats.formattedDuration}</strong>
          </p>
        </section>

        <section class="feedback__prompt" aria-label="Donnez votre ressenti">
          <h2 class="feedback__question">Comment c'était ?</h2>
          <div class="feedback__options" role="group" aria-label="Choix du ressenti">
            ${this._buildButtons()}
          </div>
        </section>

      </div>
    `;
  }

  _buildButtons() {
    return Object.values(FEEDBACK_OPTIONS)
      .map(option => `
        <button
          class="btn btn--feedback btn--feedback-${option.cssModifier}"
          data-feedback="${option.id}"
          type="button"
          aria-label="${option.label} — ${option.description}"
        >
          <span class="btn__emoji" aria-hidden="true">${option.emoji}</span>
          <span class="btn__label">${option.label}</span>
          <span class="btn__description">${option.description}</span>
        </button>
      `)
      .join('');
  }

  // ── Calcul des Statistiques de Séance ──────────────────

  _computeStats() {
    const planned = this._sessionData.planned || {};
    const actual = this._sessionData.actual || {};

    const series = actual.completedSeries || planned.series || 0;
    const reps = planned.reps || 0;
    const totalReps = actual.totalRepsCompleted || (series * reps);

    return {
      series,
      reps,
      totalReps,
      formattedDuration: this._formatDuration(this._sessionData.duration || 0),
    };
  }

  /**
   * Convertit une durée en secondes vers le format "M min SSs".
   * @param {number} totalSeconds
   * @returns {string}
   */
  _formatDuration(totalSeconds) {
    if (!totalSeconds || totalSeconds <= 0) return '0 min 00s';

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return `${minutes} min ${String(seconds).padStart(2, '0')}s`;
  }

  // ── Gestion des Événements ─────────────────────────────

  _attachEvents() {
    const buttons = this._container.querySelectorAll('[data-feedback]');

    buttons.forEach(button => {
      const handler = (e) => this._onFeedbackSelected(e);
      this._boundHandlers.set(button, handler);
      button.addEventListener('click', handler);
    });
  }

  _detachEvents() {
    this._boundHandlers.forEach((handler, button) => {
      button.removeEventListener('click', handler);
    });
    this._boundHandlers.clear();
  }

  /**
   * Handler principal. Déclenché au clic sur un bouton de feedback.
   * Verrouille l'UI, persiste, et redirige vers le dashboard.
   */
  async _onFeedbackSelected(event) {
    if (this._isProcessing) return;

    const feedbackId = event.currentTarget.dataset.feedback;
    const option = FEEDBACK_OPTIONS[feedbackId];
    if (!option) return;

    this._isProcessing = true;
    this._freezeButtons(event.currentTarget);
    this._animateSelection(event.currentTarget);

    await this._persistFeedback(feedbackId, option.rir);
    await State.advanceToNextDay();

    setTimeout(() => this._navigateTo('dashboard'), REDIRECT_DELAY_MS);
  }

  // ── Persistance ────────────────────────────────────────

  /**
   * Enregistre le feedback à deux niveaux :
   * 1. Sur la session individuelle (feedback + RIR + status)
   * 2. Sur le résumé hebdomadaire (agrégation des feedbacks)
   */
  async _persistFeedback(feedbackId, rir) {
    const user = await State.getUser();
    const { currentWeek, currentDay } = user;

    await State.updateSession(currentWeek, currentDay, {
      feedback: feedbackId,
      rirEstimated: rir,
      status: 'completed',
    });

    await State.addWeekFeedback(currentWeek, feedbackId, rir);
  }

  // ── Contrôle de l'UI ──────────────────────────────────

  /**
   * Désactive tous les boutons et estompe les non-sélectionnés.
   * Empêche le double-tap et donne un retour visuel immédiat.
   */
  _freezeButtons(selectedButton) {
    this._container.querySelectorAll('[data-feedback]').forEach(btn => {
      btn.disabled = true;
      if (btn !== selectedButton) {
        btn.classList.add('btn--faded');
      }
    });
  }

  // ── Animations ─────────────────────────────────────────

  /**
   * Animation d'entrée : fade-in + slide-up échelonné
   * sur les éléments principaux de l'écran.
   * Respecte prefers-reduced-motion via CSS.
   */
  _animateEntry() {
    const targets = this._container.querySelectorAll(
      '.card, .feedback__question, .btn--feedback'
    );

    targets.forEach((el, index) => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(20px)';

      requestAnimationFrame(() => {
        setTimeout(() => {
          el.style.transition = 'opacity 0.3s ease-out, transform 0.3s ease-out';
          el.style.opacity = '1';
          el.style.transform = 'translateY(0)';
        }, index * STAGGER_DELAY_MS);
      });
    });
  }

  /**
   * Animation de sélection : classe CSS déclenchant
   * un effet bounce + checkmark (défini dans components.css).
   */
  _animateSelection(button) {
    button.classList.add('btn--selected');
  }

  // ── Navigation ─────────────────────────────────────────

  _navigateTo(screen) {
    window.location.hash = `#/${screen}`;
  }
}