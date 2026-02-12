/* ════════════════════════════════════════════════════════════════
   AbdoPro — app.js

   Responsabilité unique : point d'entrée et routeur SPA.
   ─────────────────────────────────────────────────────────────
   Ce fichier orchestre le cycle de vie de l'application :
     1. Initialisation (DB, état, thème)
     2. Enregistrement du Service Worker
     3. Routage hash-based
     4. Gestion de la navigation (bottom nav)
     5. Transitions entre écrans
     6. Masquage de l'écran de chargement

   Aucune logique métier, aucun rendu d'écran ici.
   Chaque écran est délégué à son module dans js/screens/*.
   ─────────────────────────────────────────────────────────────
   Routes :
     #/onboarding  → Première utilisation
     #/dashboard   → Tableau de bord principal
     #/test-max    → Test maximum (J1)
     #/session     → Séance active
     #/feedback    → Feedback post-séance
     #/history     → Historique & statistiques
     #/settings    → Paramètres
   ════════════════════════════════════════════════════════════════ */

import { state, TOPICS } from './state.js';

// ── Imports dynamiques des écrans ──
// Chaque écran est importé à la demande (lazy loading)
// pour réduire le temps de chargement initial.
// Les modules sont mis en cache par le navigateur après le premier import.

const screenModules = {
  onboarding: () => import('./screens/onboarding.js'),
  dashboard:  () => import('./screens/dashboard.js'),
  'test-max': () => import('./screens/test-max.js'),
  session:    () => import('./screens/session.js'),
  feedback:   () => import('./screens/feedback.js'),
  history:    () => import('./screens/history.js'),
  settings:   () => import('./screens/settings.js')
};


// ── Configuration des routes ──

const ROUTE_CONFIG = {
  onboarding: {
    showNav: false,
    title: 'Bienvenue'
  },
  dashboard: {
    showNav: true,
    navItem: 'dashboard',
    title: 'Tableau de bord'
  },
  'test-max': {
    showNav: false,
    title: 'Test Maximum'
  },
  session: {
    showNav: false,
    title: 'Séance'
  },
  feedback: {
    showNav: false,
    title: 'Feedback'
  },
  history: {
    showNav: true,
    navItem: 'history',
    title: 'Statistiques'
  },
  settings: {
    showNav: true,
    navItem: 'settings',
    title: 'Paramètres'
  }
};

Object.freeze(ROUTE_CONFIG);


// ── Constantes DOM ──

const DOM_IDS = {
  APP_LOADING:      'app-loading',
  SCREEN_CONTAINER: 'screen-container',
  BOTTOM_NAV:       'bottom-nav',
  BEEP_SOUND:       'beep-sound'
};

Object.freeze(DOM_IDS);


// ── Classe App ──

class App {

  constructor() {
    /** @type {string|null} Route actuellement affichée */
    this._currentRoute = null;

    /** @type {Object|null} Instance de l'écran actif */
    this._currentScreen = null;

    /** @type {Map<string, Object>} Cache des modules d'écran chargés */
    this._screenCache = new Map();

    /** @type {boolean} Flag pour empêcher les navigations simultanées */
    this._navigating = false;

    /** @type {Object} Références DOM mises en cache */
    this._dom = {};
  }


  /* ──────────────────────────────────────────────────────────
     1. INITIALISATION
     ────────────────────────────────────────────────────────── */

  /**
   * Point d'entrée principal.
   * Appelé une seule fois au chargement de la page.
   */
  async start() {
    try {
      // Mettre en cache les éléments DOM fixes
      this._cacheDomElements();

      // Appliquer le thème sauvegardé (avant l'init pour éviter le flash)
      this._applyInitialTheme();

      // Initialiser la couche données
      await state.init();

      // Enregistrer le Service Worker
      this._registerServiceWorker();

      // Configurer la navigation
      this._setupNavigation();

      // Déterminer la route initiale
      const initialRoute = this._resolveInitialRoute();

      // Naviguer vers la route initiale
      await this.navigateTo(initialRoute);

      // Masquer l'écran de chargement
      this._hideLoadingScreen();

    } catch (error) {
      console.error('Erreur fatale au démarrage :', error);
      this._showFatalError(error);
    }
  }

  /**
   * Met en cache les éléments DOM fixes (jamais recréés).
   * @private
   */
  _cacheDomElements() {
    this._dom.loading   = document.getElementById(DOM_IDS.APP_LOADING);
    this._dom.container = document.getElementById(DOM_IDS.SCREEN_CONTAINER);
    this._dom.nav       = document.getElementById(DOM_IDS.BOTTOM_NAV);
    this._dom.beep      = document.getElementById(DOM_IDS.BEEP_SOUND);

    if (!this._dom.container) {
      throw new Error('Élément #screen-container introuvable dans le DOM.');
    }
  }

  /**
   * Applique le thème CSS avant l'initialisation de l'état
   * pour éviter un flash de couleur incorrecte.
   *
   * Lit directement depuis localStorage (plus rapide que IndexedDB)
   * pour le thème uniquement.
   * @private
   */
  _applyInitialTheme() {
    try {
      const saved = localStorage.getItem('abdopro_theme');
      if (saved && ['dark', 'light', 'auto'].includes(saved)) {
        document.documentElement.setAttribute('data-theme', saved);
      }
    } catch {
      // localStorage indisponible (mode privé sur certains navigateurs)
      // Le thème sombre par défaut s'applique via :root dans main.css
    }
  }


  /* ──────────────────────────────────────────────────────────
     2. SERVICE WORKER
     ────────────────────────────────────────────────────────── */

  /**
   * Enregistre le Service Worker pour le mode offline.
   * @private
   */
  _registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      console.warn('Service Worker non supporté par ce navigateur.');
      return;
    }

    navigator.serviceWorker
      .register('./sw.js')
      .then(registration => {
        console.log('Service Worker enregistré :', registration.scope);

        // Vérifier les mises à jour en arrière-plan
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'activated') {
                console.log('Nouvelle version du cache activée.');
              }
            });
          }
        });
      })
      .catch(error => {
        // Non bloquant — l'app fonctionne sans SW (pas d'offline)
        console.warn('Échec d\'enregistrement du Service Worker :', error);
      });
  }


  /* ──────────────────────────────────────────────────────────
     3. ROUTAGE
     ────────────────────────────────────────────────────────── */

  /**
   * Détermine la route initiale selon l'état de l'application.
   *
   * Priorité :
   * 1. Premier lancement → onboarding
   * 2. Hash déjà présent dans l'URL → cette route
   * 3. Jour 1 (test max) → test-max
   * 4. Sinon → dashboard
   *
   * @returns {string} Nom de la route
   * @private
   */
  _resolveInitialRoute() {
    // Premier lancement — pas de profil
    if (state.isFirstLaunch()) {
      return 'onboarding';
    }

    // Hash déjà dans l'URL (ex: partage de lien, refresh)
    const hashRoute = this._parseHash(window.location.hash);
    if (hashRoute && ROUTE_CONFIG[hashRoute]) {
      // Sécurité : ne pas aller sur onboarding si le profil existe
      if (hashRoute === 'onboarding') {
        return 'dashboard';
      }
      return hashRoute;
    }

    // Jour de test max
    if (state.isTestMaxDay()) {
      return 'test-max';
    }

    // Route par défaut
    return 'dashboard';
  }

  /**
   * Parse le hash de l'URL pour extraire le nom de la route.
   *
   * @param {string} hash — Ex: '#/dashboard', '#/test-max'
   * @returns {string|null} Nom de la route ou null
   * @private
   */
  _parseHash(hash) {
    if (!hash || hash.length < 3) return null;

    // Supprimer le '#/' initial
    const route = hash.replace(/^#\/?/, '');
    return route || null;
  }

  /**
   * Construit le hash pour une route.
   *
   * @param {string} routeName
   * @returns {string} Ex: '#/dashboard'
   * @private
   */
  _buildHash(routeName) {
    return `#/${routeName}`;
  }

  /**
   * Configure les écouteurs de navigation.
   * @private
   */
  _setupNavigation() {
    // Écouter les changements de hash (bouton retour, navigation manuelle)
    window.addEventListener('hashchange', () => {
      const route = this._parseHash(window.location.hash);
      if (route && route !== this._currentRoute) {
        this.navigateTo(route);
      }
    });

    // Écouter les clics sur la barre de navigation
    if (this._dom.nav) {
      this._dom.nav.addEventListener('click', (event) => {
        const navItem = event.target.closest('[data-route]');
        if (!navItem) return;

        const route = navItem.dataset.route;
        if (route && route !== this._currentRoute) {
          this.navigateTo(route);
        }
      });
    }
  }

  /**
   * Navigue vers une route.
   *
   * @param {string} routeName   — Nom de la route
   * @param {Object} [params={}] — Paramètres optionnels passés à l'écran
   * @returns {Promise<void>}
   */
  async navigateTo(routeName, params = {}) {
    // Vérifier que la route existe
    if (!ROUTE_CONFIG[routeName]) {
      console.error(`Route inconnue : "${routeName}". Redirection vers dashboard.`);
      routeName = 'dashboard';
    }

    // Empêcher les navigations simultanées
    if (this._navigating) return;
    this._navigating = true;

    try {
      const config = ROUTE_CONFIG[routeName];

      // Détruire l'écran courant
      await this._destroyCurrentScreen();

      // Mettre à jour le hash sans déclencher hashchange
      const newHash = this._buildHash(routeName);
      if (window.location.hash !== newHash) {
        // replaceState évite de polluer l'historique pour certaines transitions
        // pushState est utilisé pour la navigation normale
        if (this._shouldReplaceState(routeName)) {
          history.replaceState(null, '', newHash);
        } else {
          history.pushState(null, '', newHash);
        }
      }

      // Mettre à jour la barre de navigation
      this._updateNav(config);

      // Mettre à jour le conteneur (padding-bottom selon nav visible ou non)
      this._updateContainer(config);

      // Charger et afficher le nouvel écran
      await this._mountScreen(routeName, params);

      // Mettre à jour la route courante
      this._currentRoute = routeName;

      // Notifier le state du changement de navigation
      state.notify(TOPICS.NAVIGATION, { route: routeName, params });

    } catch (error) {
      console.error(`Erreur de navigation vers "${routeName}" :`, error);
    } finally {
      this._navigating = false;
    }
  }

  /**
   * Détermine si on doit remplacer l'entrée d'historique
   * plutôt qu'en ajouter une nouvelle.
   *
   * On remplace pour les transitions internes d'un flow :
   * test-max → dashboard (pas de retour arrière vers test-max)
   * feedback → dashboard (pas de retour arrière vers feedback)
   *
   * @param {string} routeName
   * @returns {boolean}
   * @private
   */
  _shouldReplaceState(routeName) {
    const replaceFrom = {
      'onboarding': true,  // Pas de retour à l'onboarding
      'feedback':   true,  // Pas de retour au feedback
    };
    return !!replaceFrom[this._currentRoute];
  }


  /* ──────────────────────────────────────────────────────────
     4. GESTION DES ÉCRANS
     ────────────────────────────────────────────────────────── */

  /**
   * Charge un module d'écran (avec cache).
   *
   * @param {string} routeName
   * @returns {Promise<Object>} Le module exporté
   * @private
   */
  async _loadScreenModule(routeName) {
    // Retourner depuis le cache si déjà chargé
    if (this._screenCache.has(routeName)) {
      return this._screenCache.get(routeName);
    }

    // Charger dynamiquement
    const loader = screenModules[routeName];
    if (!loader) {
      throw new Error(`Aucun module d'écran pour la route "${routeName}".`);
    }

    const module = await loader();
    this._screenCache.set(routeName, module);
    return module;
  }

  /**
   * Monte un écran dans le conteneur.
   *
   * @param {string} routeName
   * @param {Object} params
   * @private
   */
  async _mountScreen(routeName, params) {
    const module = await this._loadScreenModule(routeName);

    // Chaque module d'écran exporte un objet avec :
    //   render(container, params)  → Génère le HTML et attache les événements
    //   destroy()                  → Nettoie les écouteurs et abonnements
    if (!module.default || typeof module.default.render !== 'function') {
      throw new Error(
        `Le module "${routeName}" doit exporter un objet avec une méthode render().`
      );
    }

    this._currentScreen = module.default;

    // Rendre l'écran dans le conteneur
    await this._currentScreen.render(this._dom.container, {
      ...params,
      navigateTo: (route, p) => this.navigateTo(route, p)
    });

    // Scroll en haut du conteneur
    this._dom.container.scrollTop = 0;
  }

  /**
   * Détruit l'écran courant proprement.
   * @private
   */
  async _destroyCurrentScreen() {
    if (!this._currentScreen) return;

    if (typeof this._currentScreen.destroy === 'function') {
      try {
        await this._currentScreen.destroy();
      } catch (error) {
        console.warn('Erreur lors de la destruction de l\'écran :', error);
      }
    }

    this._currentScreen = null;

    // Vider le conteneur
    if (this._dom.container) {
      this._dom.container.innerHTML = '';
    }
  }


  /* ──────────────────────────────────────────────────────────
     5. NAVIGATION UI
     ────────────────────────────────────────────────────────── */

  /**
   * Met à jour la visibilité et l'état actif de la barre de nav.
   *
   * @param {Object} config — Configuration de la route
   * @private
   */
  _updateNav(config) {
    if (!this._dom.nav) return;

    // Afficher/masquer la nav
    if (config.showNav) {
      this._dom.nav.removeAttribute('hidden');
    } else {
      this._dom.nav.setAttribute('hidden', '');
    }

    // Mettre à jour l'item actif
    if (config.navItem) {
      const items = this._dom.nav.querySelectorAll('[data-route]');
      items.forEach(item => {
        const isActive = item.dataset.route === config.navItem;
        item.classList.toggle('active', isActive);
        item.setAttribute('aria-current', isActive ? 'page' : 'false');
      });
    }
  }

  /**
   * Met à jour le padding du conteneur selon la nav.
   *
   * @param {Object} config
   * @private
   */
  _updateContainer(config) {
    if (!this._dom.container) return;

    if (config.showNav) {
      this._dom.container.classList.remove('no-nav');
    } else {
      this._dom.container.classList.add('no-nav');
    }
  }


  /* ──────────────────────────────────────────────────────────
     6. ÉCRAN DE CHARGEMENT
     ────────────────────────────────────────────────────────── */

  /**
   * Masque l'écran de chargement avec une transition.
   * @private
   */
  _hideLoadingScreen() {
    if (!this._dom.loading) return;

    // Déclencher la transition CSS (opacity → 0)
    this._dom.loading.setAttribute('hidden', '');

    // Retirer du DOM après la transition
    setTimeout(() => {
      if (this._dom.loading && this._dom.loading.parentNode) {
        this._dom.loading.parentNode.removeChild(this._dom.loading);
        this._dom.loading = null;
      }
    }, 400);
  }

  /**
   * Affiche une erreur fatale si l'init échoue.
   *
   * @param {Error} error
   * @private
   */
  _showFatalError(error) {
    // Remplacer l'écran de chargement par un message d'erreur
    const target = this._dom.loading || this._dom.container;
    if (!target) return;

    target.innerHTML = `
      <div class="screen centered" style="padding: 2rem; text-align: center;">
        <div style="font-size: 3rem; margin-bottom: 1rem;">⚠️</div>
        <h1 style="margin-bottom: 1rem; color: var(--accent-danger, #ef4444);">
          Erreur de démarrage
        </h1>
        <p style="margin-bottom: 1.5rem; color: var(--text-secondary, #a0a0b0);">
          L'application n'a pas pu démarrer correctement.
        </p>
        <p style="font-family: monospace; font-size: 0.875rem; 
                  padding: 1rem; border-radius: 8px;
                  background: var(--bg-card, #16213e);
                  color: var(--text-secondary, #a0a0b0);
                  word-break: break-word;">
          ${this._escapeHtml(error.message)}
        </p>
        <button onclick="location.reload()" 
                style="margin-top: 1.5rem; padding: 0.75rem 2rem;
                       background: var(--accent-primary, #6366f1);
                       color: white; border: none; border-radius: 12px;
                       font-size: 1rem; cursor: pointer;">
          Réessayer
        </button>
      </div>
    `;

    // Retirer l'attribut hidden si c'est l'écran de chargement
    target.removeAttribute('hidden');
  }

  /**
   * Échappe le HTML pour éviter les injections XSS.
   *
   * @param {string} text
   * @returns {string}
   * @private
   */
  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}


// ── Instanciation et démarrage ──

const app = new App();

// Démarrer quand le DOM est prêt
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => app.start());
} else {
  // DOM déjà prêt (script type="module" → defer implicite)
  app.start();
}

// ── Export pour accès global (navigation depuis les écrans) ──

export { app, ROUTE_CONFIG };
export default app;