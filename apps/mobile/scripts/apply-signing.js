#!/usr/bin/env node
/**
 * Injecte une configuration de signature « release » dans android/app/build.gradle
 * (généré par `expo prebuild`) à partir des variables d'environnement :
 *   ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD
 * Sans ces variables, le script ne fait rien : la release reste signée avec la
 * clé de debug (installable, mais non publiable sur le Play Store).
 */
const fs = require('fs');
const path = require('path');

const { ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD } = process.env;
if (!ANDROID_KEYSTORE_PATH || !ANDROID_KEYSTORE_PASSWORD || !ANDROID_KEY_ALIAS || !ANDROID_KEY_PASSWORD) {
  console.log('[apply-signing] Pas de keystore fourni : signature de debug conservée.');
  process.exit(0);
}

const gradleFile = path.join(__dirname, '..', 'android', 'app', 'build.gradle');
let src = fs.readFileSync(gradleFile, 'utf8');
if (src.includes('signingConfigs.release')) {
  console.log('[apply-signing] Déjà appliqué.');
  process.exit(0);
}

const releaseConfig = `
        release {
            storeFile file(System.getenv("ANDROID_KEYSTORE_PATH"))
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")
        }`;

src = src.replace(/signingConfigs \{\n/, (m) => m + releaseConfig.trimStart().replace(/^/, '        ') + '\n');
const releaseIdx = src.indexOf('release {', src.indexOf('buildTypes {'));
const target = 'signingConfig signingConfigs.debug';
const sigIdx = src.indexOf(target, releaseIdx);
if (releaseIdx < 0 || sigIdx < 0) {
  console.error('[apply-signing] Structure de build.gradle inattendue.');
  process.exit(1);
}
src = src.slice(0, sigIdx) + 'signingConfig signingConfigs.release' + src.slice(sigIdx + target.length);
fs.writeFileSync(gradleFile, src);
console.log('[apply-signing] Signature release appliquée.');
