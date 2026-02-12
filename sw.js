// sw.js
// ─────────────────────────────────────────────────────────
// Service Worker — AbdoPro
//
// Stratégie : Cache-First avec pré-cache exhaustif.
//
// Install  → Télécharge et met en cache TOUS les assets.
// Fetch    → Sert depuis le cache. Fallback réseau si absent.
// Activate → Supprime les caches obsolètes (versions précédentes).
//
// Ce fichier tourne dans un contexte Worker isolé.
// Aucun import ES6, aucun accès au DOM, aucune dépendance.
// ─────────────────────────────────────────────────────────

// ── Versioning ─────────────────────────────────────────────
//
// Incrémenter CACHE_VERSION à chaque déploiement pour forcer
// l'invalidation du cache. Le nom du cache inclut la version
// pour permettre la coexistence temporaire ancien/nouveau
// pendant la phase d'activation.

const CACHE_VERSION = 'v1';
const CACHE_NAME = `abdopro-${CACHE_VERSION}`;

// ── Assets à Pré-cacher ────────────────────────────────────
//
// Liste EXHAUSTIVE de tous les fichiers statiques de l'app.
// Chaque fichier ajouté au projet DOIT être ajouté ici.
// Un oubli = un fichier inaccessible en mode offline.
//
// Organisé par catégorie pour faciliter la maintenance.

const STATIC_ASSETS = [

  // ── Point d'entrée ──
  './',
  './index.html',

  // ── Styles ──
  './css/main.css',
  './css/components.css',
  './css/themes.css',

  // ── Infrastructure JS ──
  './js/app.js',
  './js/db.js',
  './js/state.js',

  // ── Algorithmes ──
  './js/algorithms/engine.js',
  './js/algorithms/linear.js',
  './js/algorithms/banister.js',
  './js/algorithms/dup.js',
  './js/algorithms/rir.js',
  './js/algorithms/regression.js',
  './js/algorithms/scoring.js',

  // ── Écrans ──
  './js/screens/onboarding.js',
  './js/screens/dashboard.js',
  './js/screens/test-max.js',
  './js/screens/session.js',
  './js/screens/feedback.js',
  './js/screens/history.js',
  './js/screens/settings.js',

  // ── Utilitaires ──
  './js/utils/timer.js',
  './js/utils/notifications.js',
  './js/utils/export.js',
  './js/utils/math.js',

  // ── Assets Média ──
  './assets/sounds/beep.mp3',

  // ── Icônes PWA ──
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',

  // ── PWA ──
  './manifest.json',
];

// ── Install ────────────────────────────────────────────────
//
// Déclenché quand le navigateur détecte un SW nouveau ou modifié.
// On pré-cache TOUS les assets d'un coup. Si un seul échoue,
// l'installation entière échoue (comportement voulu : on ne veut
// pas d'un cache partiel qui casserait l'app offline).
//
// skipWaiting() force l'activation immédiate sans attendre
// que l'utilisateur ferme tous les onglets.

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate ───────────────────────────────────────────────
//
// Déclenché quand le nouveau SW prend le contrôle.
// On supprime TOUS les caches qui ne correspondent pas à
// CACHE_NAME (= les versions précédentes).
//
// clients.claim() permet au nouveau SW de contrôler
// immédiatement les pages déjà ouvertes, sans rechargement.

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name.startsWith('abdopro-') && name !== CACHE_NAME)
            .map((obsolete) => caches.delete(obsolete))
        );
      })
      .then(() => self.clients.claim())
  );
});

// ── Fetch — Cache-First ────────────────────────────────────
//
// Stratégie :
// 1. Chercher dans le cache.
// 2. Si trouvé → servir depuis le cache (instantané, offline OK).
// 3. Si absent → tenter le réseau (asset oublié ou nouveau).
// 4. Si réseau échoue → page de fallback offline.
//
// On ne cache PAS dynamiquement les réponses réseau.
// Tous les assets doivent être dans STATIC_ASSETS.
// Ceci est un choix délibéré : le cache est un snapshot cohérent
// d'une version donnée, pas un fourre-tout incrémental.

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Ignorer les requêtes non-GET (POST, etc.)
  if (request.method !== 'GET') return;

  // Ignorer les requêtes vers des origines externes
  if (!request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(request)
          .then((networkResponse) => {
            // Réponse réseau valide mais non cachée dynamiquement.
            // Si un fichier n'est pas dans STATIC_ASSETS, il sera
            // servi depuis le réseau à chaque fois — c'est intentionnel.
            return networkResponse;
          })
          .catch(() => {
            // Réseau indisponible ET pas dans le cache.
            // Pour les requêtes de navigation (HTML), on sert index.html
            // depuis le cache (SPA — le routeur JS gèrera la route).
            if (request.mode === 'navigate') {
              return caches.match('./index.html');
            }

            // Pour les autres ressources (JS, CSS, images) :
            // aucun fallback possible → réponse d'erreur explicite.
            return new Response('', {
              status: 503,
              statusText: 'Offline — Resource not cached',
            });
          });
      })
  );
});