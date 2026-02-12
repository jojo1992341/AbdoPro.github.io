/* ════════════════════════════════════════════════════════════════
   AbdoPro — screens/feedback.js
   
   Responsabilité unique : collecte du ressenti post-séance.
   ─────────────────────────────────────────────────────────────
   Cet écran s'affiche après une séance réussie.
   Il permet d'ajuster l'algorithme RIR (Repetitions In Reserve).
   
   Actions :
   1. Affiche le résumé de la séance terminée.
   2. Enregistre le feedback (facile / parfait).
   3. Avance l'état global au jour suivant.
   4. Redirige vers le tableau de bord.
   ════════════════════════════════════════════════════════════════ */

import state from '../state.js';

const FeedbackScreen = {
  _container: null,
  _navigateTo: null,
  _abortController: null,
  _session: null,
  _isProcessing: false,

  /* ──────────────────────────────────────────────────────────
     RENDER
     ────────────────────────────────────────────────────────── */

  async render(container, params) {
    this._container = container;
    this._navigateTo = params.navigateTo;
    this._abortController = new AbortController();
    this._isProcessing = false;

    // Récupérer la séance qui vient d'être effectuée
    const dayNumber = state.getCurrentDayNumber();
    const sessions = state.getCurrentSessions();
    this._session = sessions.find(s => s.dayNumber === dayNumber);

    // Sécurité : si aucune séance trouvée ou déjà commentée, retour dashboard
    if (!this._session || this._session.feedback) {
      this._navigateTo('dashboard');
      return;
    }

    this._renderUI();
  },

  /* ──────────────────────────────────────────────────────────
     DESTROY
     ────────────────────────────────────────────────────────── */

  destroy() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
    this._container = null;
    this._navigateTo = null;
    this._session = null;
  },

  /* ──────────────────────────────────────────────────────────
     LOGIQUE INTERNE
     ────────────────────────────────────────────────────────── */

  _renderUI() {
    this._container.innerHTML = `
      <div class="screen fullheight centered">
        <header class="screen-header text-center">
          <span class="screen-header__subtitle">Séance terminée</span>
          <h1 class="screen-header__title">Bien joué ! 🎉</h1>
        </header>

        <!-- Carte Récapitulative -->
        <div class="card mb-8 w-full">
          <div class="card__header">
            <h2 class="card__title text-sm">Résumé de l'effort</h2>
          </div>
          <div class="card__body">
            <div class="flex-between">
              <span class="text-secondary text-sm">Volume total</span>
              <span class="mono font-bold">${this._session.actual.totalRepsCompleted} reps</span>
            </div>
            <div class="flex-between">
              <span class="text-secondary text-sm">Durée</span>
              <span class="mono">${this._formatDuration(this._session.duration)}</span>
            </div>
          </div>
        </div>

        <p class="text-center mb-6 font-semibold">Comment avez-vous trouvé cette séance ?</p>

        <!-- Boutons de Feedback (Composants Section 9) -->
        <div class="feedback-buttons">
          <button class="feedback-btn feedback-btn--facile" data-feedback="facile" type="button">
            <span class="feedback-btn__icon">😊</span>
            <span class="feedback-btn__title">Facile</span>
            <span class="feedback-btn__desc">J'en avais encore sous le coude</span>
          </button>

          <button class="feedback-btn feedback-btn--parfait" data-feedback="parfait" type="button">
            <span class="feedback-btn__icon">👌</span>
            <span class="feedback-btn__title">Parfait</span>
            <span class="feedback-btn__desc">C'était le bon niveau d'effort</span>
          </button>
        </div>
      </div>
    `;

    this._attachEvents();
  },

  _attachEvents() {
    const signal = this._abortController.signal;

    this._container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-feedback]');
      if (btn && !this._isProcessing) {
        this._handleFeedback(btn.dataset.feedback);
      }
    }, { signal });
  },

  /**
   * Traite le choix de l'utilisateur
   * @param {string} type 'facile' | 'parfait'
   */
  async _handleFeedback(type) {
    this._isProcessing = true;

    // Animation visuelle de sélection
    const btn = this._container.querySelector(`[data-feedback="${type}"]`);
    btn.classList.add('feedback-btn--selected');
    
    // Désactiver l'autre bouton
    this._container.querySelectorAll('.feedback-btn').forEach(b => {
      if (b !== btn) b.style.opacity = '0.5';
    });

    try {
      // Calcul du RIR (Repetitions In Reserve)
      // facile = 4 reps en réserve, parfait = 2 reps en réserve
      const rir = type === 'facile' ? 4 : 2;

      // Mise à jour de la séance avec le feedback
      const updatedSession = {
        ...this._session,
        feedback: type,
        rirEstimated: rir
      };

      await state.saveSession(updatedSession);
      
      // Passage au jour suivant
      await state.advanceDay();

      // Redirection après un léger délai pour laisser l'animation respirer
      setTimeout(() => {
        this._navigateTo('dashboard');
      }, 300);

    } catch (error) {
      console.error('Erreur lors de l\'enregistrement du feedback:', error);
      this._isProcessing = false;
    }
  },

  _formatDuration(seconds) {
    if (!seconds) return '0s';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }
};

export default FeedbackScreen;