/* ════════════════════════════════════════════════════════════════
   AbdoPro — screens/onboarding.js

   Responsabilité unique : écran de bienvenue (première utilisation).
   ─────────────────────────────────────────────────────────────
   Affiché uniquement si aucun profil n'existe en base.
   Présente 3 slides swipables expliquant le concept de l'app,
   puis un bouton "Commencer" qui crée le profil et redirige
   vers le premier test max.

   Contrat d'écran :
     render(container, params) → Génère le HTML et attache les events
     destroy()                 → Nettoie les écouteurs et abonnements

   params.navigateTo(route, data) → Fonction de navigation injectée par app.js
   ════════════════════════════════════════════════════════════════ */

import state from '../state.js';
import notifications from '../utils/notifications.js';


// ── Contenu des slides ──

const SLIDES = [
  {
    icon: '💪',
    title: 'Testez votre maximum',
    text: 'Chaque semaine commence par un test : faites le maximum ' +
          'd\'abdominaux en une série. C\'est votre point de départ.'
  },
  {
    icon: '🧠',
    title: 'Un programme adapté automatiquement',
    text: '5 algorithmes scientifiques analysent vos performances ' +
          'et créent un programme sur mesure, ajusté chaque semaine.'
  },
  {
    icon: '📈',
    title: 'Progressez grâce à la science',
    text: 'Suivez votre progression, recevez des feedbacks ' +
          'personnalisés et atteignez vos objectifs abdominaux.'
  }
];

Object.freeze(SLIDES);


// ── Écran Onboarding ──

const OnboardingScreen = {

  /** @type {Function|null} Fonction de navigation injectée */
  _navigateTo: null,

  /** @type {Function|null} Handler de scroll pour cleanup */
  _scrollHandler: null,

  /** @type {IntersectionObserver|null} Observer pour les slides */
  _observer: null,

  /** @type {AbortController|null} Contrôleur pour les event listeners */
  _abortController: null,


  /* ──────────────────────────────────────────────────────────
     RENDER
     ────────────────────────────────────────────────────────── */

  /**
   * Génère le HTML de l'écran et attache les événements.
   *
   * @param {HTMLElement} container — Conteneur DOM (#screen-container)
   * @param {Object} params — Paramètres injectés par app.js
   * @param {Function} params.navigateTo — Fonction de navigation
   */
  async render(container, params) {
    this._navigateTo = params.navigateTo;
    this._abortController = new AbortController();
    const signal = this._abortController.signal;

    // Générer le HTML
    container.innerHTML = this._buildHTML();

    // Récupérer les éléments DOM
    const slidesContainer = container.querySelector('.slides');
    const dots = container.querySelectorAll('.slide-dot');
    const startButton = container.querySelector('[data-action="start"]');
    const skipButton = container.querySelector('[data-action="skip"]');

    // Observer les slides pour mettre à jour les dots
    this._setupSlideObserver(slidesContainer, dots);

    // Bouton "Commencer mon programme"
    if (startButton) {
      startButton.addEventListener('click', () => this._handleStart(), { signal });
    }

    // Bouton "Passer" (skip)
    if (skipButton) {
      skipButton.addEventListener('click', () => this._handleStart(), { signal });
    }

    // Déverrouiller l'audio au premier geste sur cet écran
    notifications.init();
  },


  /* ──────────────────────────────────────────────────────────
     DESTROY
     ────────────────────────────────────────────────────────── */

  /**
   * Nettoie les écouteurs et observeurs.
   */
  destroy() {
    // Annuler tous les event listeners d'un coup
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }

    // Déconnecter l'IntersectionObserver
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }

    this._navigateTo = null;
    this._scrollHandler = null;
  },


  /* ──────────────────────────────────────────────────────────
     CONSTRUCTION DU HTML
     ────────────────────────────────────────────────────────── */

  /**
   * Construit le HTML complet de l'écran.
   *
   * @returns {string}
   * @private
   */
  _buildHTML() {
    const slidesHTML = SLIDES.map((slide, index) =>
      this._buildSlideHTML(slide, index)
    ).join('');

    const dotsHTML = SLIDES.map((_, index) =>
      `<button class="slide-dot ${index === 0 ? 'slide-dot--active' : ''}"
              data-slide="${index}"
              type="button"
              aria-label="Aller au slide ${index + 1}"
              aria-current="${index === 0 ? 'true' : 'false'}">
      </button>`
    ).join('');

    return `
      <div class="screen fullheight flex-col" role="region" aria-label="Bienvenue dans AbdoPro">

        <!-- Header -->
        <header class="onboarding-header flex-col flex-center gap-2 p-4">
          <h1 class="text-2xl font-bold color-primary">AbdoPro</h1>
          <button class="btn btn-sm btn-ghost"
                  data-action="skip"
                  type="button"
                  aria-label="Passer l'introduction">
            Passer
          </button>
        </header>

        <!-- Slides -->
        <div class="slides flex-1" role="tablist" aria-label="Présentation">
          ${slidesHTML}
        </div>

        <!-- Pagination dots -->
        <nav class="slide-dots" aria-label="Navigation des slides">
          ${dotsHTML}
        </nav>

        <!-- Action -->
        <div class="onboarding-footer p-4">
          <button class="btn btn-primary btn-lg btn-block btn-ripple"
                  data-action="start"
                  type="button">
            Commencer mon programme
          </button>
        </div>
      </div>
    `;
  },

  /**
   * Construit le HTML d'un slide individuel.
   *
   * @param {Object} slide — { icon, title, text }
   * @param {number} index
   * @returns {string}
   * @private
   */
  _buildSlideHTML(slide, index) {
    return `
      <div class="slide"
           role="tabpanel"
           id="slide-${index}"
           aria-label="${slide.title}"
           data-slide-index="${index}">
        <div class="slide__icon" aria-hidden="true">${slide.icon}</div>
        <h2 class="slide__title">${slide.title}</h2>
        <p class="slide__text">${slide.text}</p>
      </div>
    `;
  },


  /* ──────────────────────────────────────────────────────────
     OBSERVATION DES SLIDES
     ────────────────────────────────────────────────────────── */

  /**
   * Configure l'IntersectionObserver pour détecter le slide visible
   * et mettre à jour les dots de pagination.
   *
   * @param {HTMLElement} slidesContainer — Conteneur .slides
   * @param {NodeList} dots — Éléments .slide-dot
   * @private
   */
  _setupSlideObserver(slidesContainer, dots) {
    if (!slidesContainer || !dots || dots.length === 0) return;

    // Utiliser IntersectionObserver (plus performant que scroll event)
    this._observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const index = parseInt(
              entry.target.dataset.slideIndex, 10
            );
            this._updateActiveDot(dots, index);
          }
        });
      },
      {
        root: slidesContainer,
        threshold: 0.6 // Le slide est "actif" quand 60% est visible
      }
    );

    // Observer chaque slide
    const slides = slidesContainer.querySelectorAll('.slide');
    slides.forEach(slide => this._observer.observe(slide));

    // Permettre de cliquer sur les dots pour naviguer
    const signal = this._abortController?.signal;
    dots.forEach(dot => {
      dot.addEventListener('click', () => {
        const targetIndex = parseInt(dot.dataset.slide, 10);
        const targetSlide = slidesContainer.querySelector(
          `[data-slide-index="${targetIndex}"]`
        );
        if (targetSlide) {
          targetSlide.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
            inline: 'center'
          });
        }
      }, { signal });
    });
  },

  /**
   * Met à jour le dot actif dans la pagination.
   *
   * @param {NodeList} dots
   * @param {number} activeIndex
   * @private
   */
  _updateActiveDot(dots, activeIndex) {
    dots.forEach((dot, index) => {
      const isActive = index === activeIndex;
      dot.classList.toggle('slide-dot--active', isActive);
      dot.setAttribute('aria-current', isActive ? 'true' : 'false');
    });
  },


  /* ──────────────────────────────────────────────────────────
     ACTIONS
     ────────────────────────────────────────────────────────── */

  /**
   * Gère le clic sur "Commencer" ou "Passer".
   * Crée le profil utilisateur et navigue vers le test max.
   *
   * @private
   */
  async _handleStart() {
    try {
      // Empêcher les double-clics
      const button = document.querySelector('[data-action="start"]');
      if (button) {
        button.disabled = true;
        button.textContent = 'Chargement...';
      }

      // Créer le profil utilisateur
      await state.createProfile();

      // Sauvegarder le thème dans localStorage pour le chargement rapide
      try {
        localStorage.setItem('abdopro_theme', 'dark');
      } catch {
        // localStorage indisponible — non bloquant
      }

      // Naviguer vers le test max
      if (this._navigateTo) {
        await this._navigateTo('test-max');
      }

    } catch (error) {
      console.error('Erreur lors de la création du profil :', error);

      // Réactiver le bouton
      const button = document.querySelector('[data-action="start"]');
      if (button) {
        button.disabled = false;
        button.textContent = 'Commencer mon programme';
      }

      // Afficher une erreur à l'utilisateur
      this._showError('Impossible de créer votre profil. Vérifiez que votre navigateur autorise le stockage de données.');
    }
  },

  /**
   * Affiche un message d'erreur inline.
   *
   * @param {string} message
   * @private
   */
  _showError(message) {
    const footer = document.querySelector('.onboarding-footer');
    if (!footer) return;

    // Retirer un éventuel message précédent
    const existing = footer.querySelector('.onboarding-error');
    if (existing) existing.remove();

    const errorDiv = document.createElement('div');
    errorDiv.className = 'onboarding-error text-sm color-danger text-center mt-4';
    errorDiv.setAttribute('role', 'alert');
    errorDiv.textContent = message;

    footer.appendChild(errorDiv);
  }
};


// ── Export ──

export default OnboardingScreen;