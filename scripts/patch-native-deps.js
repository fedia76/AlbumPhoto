#!/usr/bin/env node
/**
 * Correctifs appliqués aux dépendances natives après `npm install` (postinstall).
 * Idempotent : chaque correctif vérifie sa cible et ne s'applique qu'une fois.
 *
 * 1. onnxruntime-react-native : son build.gradle utilise `VersionNumber`
 *    (org.gradle.util), supprimé dans Gradle 9 (React Native 0.86+), et
 *    `$buildDir`, déprécié. Le bloc concerné ne sert qu'aux RN < 0.71.
 * 2. onnxruntime-react-native : son `unimodule.json` hérité (Expo SDK < 40) le
 *    fait passer pour un module Expo. L'autolinking refuse alors de le lier des
 *    deux côtés — il compile mais `OnnxruntimePackage` n'atteint jamais
 *    `PackageList`, et `NativeModules.Onnxruntime` vaut `null` à l'exécution.
 *    Le retirer rétablit l'autolinking React Native standard.
 */
const fs = require('fs');
const path = require('path');

function patch(file, edits) {
  const abs = path.join(__dirname, '..', 'node_modules', file);
  if (!fs.existsSync(abs)) {
    console.log(`[patch-native-deps] ${file} absent, ignoré.`);
    return;
  }
  let src = fs.readFileSync(abs, 'utf8');
  let changed = 0;
  for (const { find, replace, label } of edits) {
    if (src.includes(replace)) continue; // déjà appliqué
    if (!src.includes(find)) {
      console.warn(`[patch-native-deps] ${file} : motif introuvable (${label}). Le correctif est peut-être devenu inutile.`);
      continue;
    }
    src = src.replace(find, replace);
    changed++;
  }
  if (changed) {
    fs.writeFileSync(abs, src);
    console.log(`[patch-native-deps] ${file} : ${changed} correctif(s) appliqué(s).`);
  }
}

/** Supprime un fichier d'une dépendance, s'il existe. */
function removeFile(file, why) {
  const abs = path.join(__dirname, '..', 'node_modules', file);
  if (!fs.existsSync(abs)) return; // déjà retiré, ou dépendance absente
  fs.rmSync(abs);
  console.log(`[patch-native-deps] ${file} supprimé (${why}).`);
}

removeFile(
  'onnxruntime-react-native/unimodule.json',
  "sinon l'autolinking le prend pour un module Expo et n'enregistre pas OnnxruntimePackage",
);

patch('onnxruntime-react-native/android/build.gradle', [
  {
    label: 'VersionNumber (Gradle 9)',
    find: `  if (VersionNumber.parse(REACT_NATIVE_VERSION) < VersionNumber.parse("0.71")) {
    extractLibs "com.facebook.fbjni:fbjni:+:headers"
    extractLibs "com.facebook.fbjni:fbjni:+"
  }
`,
    replace: `  // [albumphoto] bloc RN < 0.71 retiré : VersionNumber n'existe plus dans Gradle 9.
`,
  },
  {
    label: 'buildDir déprécié',
    find: 'into "$buildDir/$file.name"',
    replace: 'into "${layout.buildDirectory.get().asFile}/$file.name"',
  },
]);
