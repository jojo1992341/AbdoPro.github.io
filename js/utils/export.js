/* ════════════════════════════════════════════════════════════════
   AbdoPro — utils/export.js

   Responsabilité unique : export et import des données utilisateur.
   ─────────────────────────────────────────────────────────────
   Gère la sérialisation complète de la base IndexedDB en JSON
   et la restauration depuis un fichier JSON importé.

   Mécanismes :
   - Export : db.exportAll() → JSON string → Blob → URL.createObjectURL
              → <a download> → clic programmatique → cleanup
   - Import : <input type="file"> → FileReader → JSON.parse
              → validation → state.importData()

   ─────────────────────────────────────────────────────────────
   API publique :

     exportData()              → Télécharge un fichier JSON
     importData()              → Ouvre le sélecteur de fichier, importe
     importFromJson(jsonStr)   → Importe depuis une chaîne JSON brute
     generateFileName()        → Nom de fichier horodaté
     validateImportData(data)  → Valide la structure avant import
   ════════════════════════════════════════════════════════════════ */

import state from '../utils/state.js';


// ── Constantes ──

/** Préfixe du nom de fichier exporté */
const FILE_PREFIX = 'abdopro-backup';

/** Extension du fichier */
const FILE_EXTENSION = '.json';

/** Type MIME pour le JSON */
const JSON_MIME_TYPE = 'application/json';

/** Version courante de l'app (pour compatibilité d'import) */
const APP_VERSION = '1.0.0';

/** Clés obligatoires dans un fichier d'import */
const REQUIRED_IMPORT_KEYS = ['appVersion', 'exportDate'];

/** Taille maximale d'un fichier d'import (5 Mo) */
const MAX_IMPORT_SIZE_BYTES = 5 * 1024 * 1024;


/* ──────────────────────────────────────────────────────────────
   EXPORT
   ────────────────────────────────────────────────────────────── */

/**
 * Exporte toutes les données de l'application dans un fichier JSON
 * et déclenche son téléchargement.
 *
 * Flux :
 * 1. Récupère toutes les données via state.exportData()
 * 2. Sérialise en JSON indenté (lisible humainement)
 * 3. Crée un Blob + Object URL
 * 4. Crée un <a download> invisible et le clique
 * 5. Nettoie le Blob URL et le lien
 *
 * @returns {Promise<{success: boolean, fileName: string, size: number}>}
 * @throws {Error} Si l'export échoue
 */
export async function exportData() {
  // 1. Récupérer les données
  const data = await state.exportData();

  // 2. Sérialiser
  const jsonString = JSON.stringify(data, null, 2);
  const fileName = generateFileName();

  // 3. Créer le Blob
  const blob = new Blob([jsonString], { type: JSON_MIME_TYPE });
  const url = URL.createObjectURL(blob);

  // 4. Créer un lien de téléchargement et cliquer
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;

  // Ajouter au DOM (nécessaire sur certains navigateurs)
  link.style.display = 'none';
  document.body.appendChild(link);

  link.click();

  // 5. Cleanup (après un délai pour laisser le téléchargement démarrer)
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 1000);

  return {
    success: true,
    fileName,
    size: blob.size
  };
}


/* ──────────────────────────────────────────────────────────────
   IMPORT
   ────────────────────────────────────────────────────────────── */

/**
 * Ouvre le sélecteur de fichier natif et importe le fichier JSON
 * sélectionné par l'utilisateur.
 *
 * Flux :
 * 1. Crée un <input type="file" accept=".json">
 * 2. L'utilisateur sélectionne un fichier
 * 3. FileReader lit le contenu
 * 4. JSON.parse + validation
 * 5. state.importData() écrase les données
 *
 * @returns {Promise<{success: boolean, weekCount: number, sessionCount: number}>}
 * @throws {ImportError} Si le fichier est invalide
 */
export async function importData() {
  // 1. Lire le fichier sélectionné par l'utilisateur
  const jsonString = await selectAndReadFile();

  // 2. Importer depuis la chaîne JSON
  return importFromJson(jsonString);
}

/**
 * Importe des données depuis une chaîne JSON brute.
 * Utile pour les tests et l'import programmatique.
 *
 * @param {string} jsonString — Contenu JSON à importer
 * @returns {Promise<{success: boolean, weekCount: number, sessionCount: number}>}
 * @throws {ImportError}
 */
export async function importFromJson(jsonString) {
  // 1. Parser le JSON
  let data;
  try {
    data = JSON.parse(jsonString);
  } catch (error) {
    throw new ImportError(
      'Le fichier sélectionné n\'est pas un fichier JSON valide.',
      'INVALID_JSON',
      error
    );
  }

  // 2. Valider la structure
  const validation = validateImportData(data);
  if (!validation.valid) {
    throw new ImportError(
      validation.message,
      validation.code
    );
  }

  // 3. Importer dans la base
  await state.importData(data);

  // 4. Retourner un résumé
  return {
    success: true,
    weekCount: Array.isArray(data.weeks) ? data.weeks.length : 0,
    sessionCount: Array.isArray(data.sessions) ? data.sessions.length : 0
  };
}


/* ──────────────────────────────────────────────────────────────
   SÉLECTION DE FICHIER
   ────────────────────────────────────────────────────────────── */

/**
 * Ouvre le sélecteur de fichier natif et lit le contenu du fichier sélectionné.
 *
 * @returns {Promise<string>} Contenu textuel du fichier
 * @throws {ImportError} Si l'utilisateur annule ou si la lecture échoue
 */
function selectAndReadFile() {
  return new Promise((resolve, reject) => {
    // Créer l'input file invisible
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = FILE_EXTENSION + ',' + JSON_MIME_TYPE;
    input.style.display = 'none';

    // Flag pour détecter l'annulation
    let fileSelected = false;

    // Écouter la sélection de fichier
    input.addEventListener('change', (event) => {
      fileSelected = true;
      const file = event.target.files[0];

      if (!file) {
        cleanup();
        reject(new ImportError(
          'Aucun fichier sélectionné.',
          'NO_FILE'
        ));
        return;
      }

      // Vérifier la taille
      if (file.size > MAX_IMPORT_SIZE_BYTES) {
        cleanup();
        reject(new ImportError(
          `Le fichier est trop volumineux (${formatFileSize(file.size)}). ` +
          `Taille maximale : ${formatFileSize(MAX_IMPORT_SIZE_BYTES)}.`,
          'FILE_TOO_LARGE'
        ));
        return;
      }

      // Vérifier le type (indication, pas fiable)
      if (file.type && file.type !== JSON_MIME_TYPE && !file.name.endsWith(FILE_EXTENSION)) {
        cleanup();
        reject(new ImportError(
          'Le fichier sélectionné ne semble pas être un fichier JSON.',
          'WRONG_TYPE'
        ));
        return;
      }

      // Lire le contenu
      const reader = new FileReader();

      reader.onload = () => {
        cleanup();
        resolve(reader.result);
      };

      reader.onerror = () => {
        cleanup();
        reject(new ImportError(
          'Impossible de lire le fichier sélectionné.',
          'READ_ERROR',
          reader.error
        ));
      };

      reader.readAsText(file, 'UTF-8');
    });

    // Détecter l'annulation (focus revient sans sélection)
    // Utilisation d'un timer car il n'y a pas d'événement natif "cancel"
    // sur <input type="file"> dans tous les navigateurs
    const cancelDetector = () => {
      setTimeout(() => {
        if (!fileSelected) {
          cleanup();
          reject(new ImportError(
            'Import annulé par l\'utilisateur.',
            'CANCELLED'
          ));
        }
      }, 500);
    };

    window.addEventListener('focus', cancelDetector, { once: true });

    // Cleanup
    function cleanup() {
      if (input.parentNode) {
        document.body.removeChild(input);
      }
      window.removeEventListener('focus', cancelDetector);
    }

    // Ajouter au DOM et déclencher le sélecteur
    document.body.appendChild(input);
    input.click();
  });
}


/* ──────────────────────────────────────────────────────────────
   VALIDATION
   ────────────────────────────────────────────────────────────── */

/**
 * Valide la structure d'un objet de données importé.
 *
 * Vérifie :
 * - Présence des clés obligatoires
 * - Types des champs principaux
 * - Cohérence des données (weekNumber, dayNumber)
 * - Compatibilité de version
 *
 * @param {Object} data — Données parsées depuis le JSON
 * @returns {{valid: boolean, message: string, code: string}}
 */
export function validateImportData(data) {
  // 1. Vérifier que c'est un objet
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {
      valid: false,
      message: 'Le fichier ne contient pas un objet JSON valide.',
      code: 'NOT_OBJECT'
    };
  }

  // 2. Vérifier les clés obligatoires
  for (const key of REQUIRED_IMPORT_KEYS) {
    if (!(key in data)) {
      return {
        valid: false,
        message: `Clé obligatoire manquante : "${key}". ` +
                 `Ce fichier ne semble pas être un export AbdoPro.`,
        code: 'MISSING_KEY'
      };
    }
  }

  // 3. Vérifier la version
  const importVersion = data.appVersion;
  if (typeof importVersion !== 'string') {
    return {
      valid: false,
      message: 'Version de l\'application manquante ou invalide.',
      code: 'INVALID_VERSION'
    };
  }

  // Comparaison de version majeure (1.x.x compatible avec 1.y.z)
  const importMajor = parseInt(importVersion.split('.')[0], 10);
  const currentMajor = parseInt(APP_VERSION.split('.')[0], 10);
  if (isNaN(importMajor) || importMajor > currentMajor) {
    return {
      valid: false,
      message: `Ce fichier provient d'une version plus récente (${importVersion}). ` +
               `Mettez à jour AbdoPro avant d'importer.`,
      code: 'VERSION_TOO_NEW'
    };
  }

  // 4. Valider les semaines
  if (data.weeks !== undefined && data.weeks !== null) {
    if (!Array.isArray(data.weeks)) {
      return {
        valid: false,
        message: 'Le champ "weeks" doit être un tableau.',
        code: 'WEEKS_NOT_ARRAY'
      };
    }

    for (let i = 0; i < data.weeks.length; i++) {
      const week = data.weeks[i];
      if (!week || typeof week !== 'object') {
        return {
          valid: false,
          message: `Semaine ${i + 1} invalide : doit être un objet.`,
          code: 'INVALID_WEEK'
        };
      }
      if (typeof week.weekNumber !== 'number' || week.weekNumber < 1) {
        return {
          valid: false,
          message: `Semaine ${i + 1} : weekNumber manquant ou invalide.`,
          code: 'INVALID_WEEK_NUMBER'
        };
      }
    }

    // Vérifier l'unicité des weekNumber
    const weekNumbers = data.weeks.map(w => w.weekNumber);
    const uniqueWeeks = new Set(weekNumbers);
    if (uniqueWeeks.size !== weekNumbers.length) {
      return {
        valid: false,
        message: 'Plusieurs semaines ont le même numéro.',
        code: 'DUPLICATE_WEEKS'
      };
    }
  }

  // 5. Valider les séances
  if (data.sessions !== undefined && data.sessions !== null) {
    if (!Array.isArray(data.sessions)) {
      return {
        valid: false,
        message: 'Le champ "sessions" doit être un tableau.',
        code: 'SESSIONS_NOT_ARRAY'
      };
    }

    for (let i = 0; i < data.sessions.length; i++) {
      const session = data.sessions[i];
      if (!session || typeof session !== 'object') {
        return {
          valid: false,
          message: `Séance ${i + 1} invalide : doit être un objet.`,
          code: 'INVALID_SESSION'
        };
      }
      if (typeof session.weekNumber !== 'number' || session.weekNumber < 1) {
        return {
          valid: false,
          message: `Séance ${i + 1} : weekNumber manquant ou invalide.`,
          code: 'INVALID_SESSION_WEEK'
        };
      }
      if (typeof session.dayNumber !== 'number' ||
          session.dayNumber < 1 || session.dayNumber > 7) {
        return {
          valid: false,
          message: `Séance ${i + 1} : dayNumber doit être entre 1 et 7.`,
          code: 'INVALID_SESSION_DAY'
        };
      }
    }

    // Vérifier l'unicité des combinaisons week+day
    const sessionKeys = data.sessions.map(s => `${s.weekNumber}_${s.dayNumber}`);
    const uniqueSessions = new Set(sessionKeys);
    if (uniqueSessions.size !== sessionKeys.length) {
      return {
        valid: false,
        message: 'Plusieurs séances existent pour le même jour.',
        code: 'DUPLICATE_SESSIONS'
      };
    }
  }

  // 6. Valider l'historique algorithmique
  if (data.algorithmHistory !== undefined && data.algorithmHistory !== null) {
    if (!Array.isArray(data.algorithmHistory)) {
      return {
        valid: false,
        message: 'Le champ "algorithmHistory" doit être un tableau.',
        code: 'ALGO_HISTORY_NOT_ARRAY'
      };
    }

    for (let i = 0; i < data.algorithmHistory.length; i++) {
      const entry = data.algorithmHistory[i];
      if (!entry || typeof entry !== 'object') {
        return {
          valid: false,
          message: `Entrée scoring ${i + 1} invalide.`,
          code: 'INVALID_SCORING'
        };
      }
      if (typeof entry.weekNumber !== 'number' || entry.weekNumber < 1) {
        return {
          valid: false,
          message: `Entrée scoring ${i + 1} : weekNumber invalide.`,
          code: 'INVALID_SCORING_WEEK'
        };
      }
    }
  }

  // 7. Valider le profil utilisateur (optionnel)
  if (data.user !== undefined && data.user !== null) {
    if (typeof data.user !== 'object' || Array.isArray(data.user)) {
      return {
        valid: false,
        message: 'Le champ "user" doit être un objet.',
        code: 'INVALID_USER'
      };
    }
  }

  // Tout est valide
  return {
    valid: true,
    message: 'Données valides.',
    code: 'OK'
  };
}


/* ──────────────────────────────────────────────────────────────
   UTILITAIRES
   ────────────────────────────────────────────────────────────── */

/**
 * Génère un nom de fichier horodaté pour l'export.
 *
 * Format : abdopro-backup-2025-07-15-18h30.json
 *
 * @returns {string}
 */
export function generateFileName() {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');

  return `${FILE_PREFIX}-${year}-${month}-${day}-${hours}h${minutes}${FILE_EXTENSION}`;
}

/**
 * Formate une taille de fichier en unité lisible.
 *
 * @param {number} bytes — Taille en octets
 * @returns {string} Ex: "1.2 Mo", "256 Ko"
 */
function formatFileSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} octets`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} Ko`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}


/* ──────────────────────────────────────────────────────────────
   CLASSE D'ERREUR SPÉCIALISÉE
   ────────────────────────────────────────────────────────────── */

/**
 * Erreur spécialisée pour les problèmes d'import.
 * Porte un code d'erreur en plus du message.
 */
export class ImportError extends Error {
  /**
   * @param {string} message — Message lisible par l'utilisateur
   * @param {string} code    — Code d'erreur machine (INVALID_JSON, NO_FILE, etc.)
   * @param {Error}  [cause] — Erreur originale (si applicable)
   */
  constructor(message, code, cause = null) {
    super(message);
    this.name = 'ImportError';
    this.code = code;
    this.cause = cause;
  }

  /**
   * Vérifie si l'erreur est une annulation volontaire.
   * @returns {boolean}
   */
  isCancellation() {
    return this.code === 'CANCELLED';
  }

  /**
   * Vérifie si l'erreur est un problème de format.
   * @returns {boolean}
   */
  isFormatError() {
    return [
      'INVALID_JSON',
      'NOT_OBJECT',
      'MISSING_KEY',
      'INVALID_VERSION',
      'WEEKS_NOT_ARRAY',
      'SESSIONS_NOT_ARRAY',
      'ALGO_HISTORY_NOT_ARRAY',
      'INVALID_WEEK',
      'INVALID_SESSION',
      'INVALID_SCORING',
      'INVALID_USER',
      'INVALID_WEEK_NUMBER',
      'INVALID_SESSION_WEEK',
      'INVALID_SESSION_DAY',
      'INVALID_SCORING_WEEK',
      'DUPLICATE_WEEKS',
      'DUPLICATE_SESSIONS'
    ].includes(this.code);
  }

}
