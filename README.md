# AlbumPhoto

Application de création d'album photo assistée par une **IA 100 % locale**.
Version mobile aujourd'hui (Expo / React Native) ; les versions web et desktop
viendront s'appuyer sur le **même format d'album** et le **même cœur TypeScript**.

```
albumphoto/
├── packages/core/     @albumphoto/core — format d'album + logique IA, TypeScript pur, testé
│   ├── src/album/     types, validation, sérialisation, géométrie (règle de rendu), gabarits
│   ├── src/ai/        qualité d'image, hash perceptuel, regroupement de visages, scoring,
│   │                  sélection, légendes (prompt LLM + gabarits), assemblage, pipeline
│   ├── schema/        album.schema.json (JSON Schema 2020-12)
│   └── test/          suite vitest (pipeline de bout en bout inclus)
├── apps/mobile/       application Expo (éditeur + assistant IA) — adaptateurs natifs
└── docs/album-format.md   spécification du format, référence pour web et desktop
```

## Fonctionnalités

**Création (volontairement basique)**
- Choix d'un gabarit de page parmi 11 mises en page (couverture, 1 à 4 photos, avec ou sans légende, chapitre).
- Placement de photos depuis la galerie de l'appareil, textes (titre, légendes).
- Recadrage par glisser, zoom par pincement, changement de gabarit sans perdre les photos.
- Sauvegarde automatique dans un bundle `<id>.album/` (voir le format).

**Assistant IA locale** (aucune donnée ne quitte l'appareil)
1. **Parcours** des photos de l'appareil (les N plus récentes).
2. **Détection des visages** (Google ML Kit, sur l'appareil) puis **regroupement par personne**
   (embeddings MobileFaceNet via ONNX Runtime, téléchargé une fois depuis la release
   `models-v1` du dépôt ; repli sans modèle si hors ligne).
3. **Choix des personnes** par l'utilisateur, avec prénoms.
4. **Scoring** des photos : netteté (variance du laplacien), exposition, contraste, couleurs,
   présence des personnes choisies, yeux ouverts, sourires, composition ; déduplication des
   rafales (dHash) et limitation par « moment ».
5. **Revue de la sélection** : écran détaillé listant les photos retenues avec leur note et le
   détail des quatre critères, et les photos écartées avec le motif (floue, quasi-doublon,
   trop de photos du même moment, album complet).
6. **Légendes** dans le style choisi — drôle, formel, poétique, minimaliste, famille — par un
   **modèle local**, écrites en tâche de fond pendant que l'album est déjà consultable :
   soit un modèle vision-langage qui regarde la photo (LFM2.5-VL 1.6B),
   soit un modèle textuel qui écrit à partir des faits relevés (Qwen 3 0.6B), avec repli sur un générateur
   par gabarits dont les tournures dépendent du contexte (personnes, date, saison, moment de la
   journée, contenu) et tournent d'une photo à l'autre.
7. **Assemblage** de l'album : couverture, chapitres par événement (écart temporel), rythme de
   pages 1 / 2 / 3 / 4 photos selon l'orientation, légendes dans les zones texte.

## Installer l'APK Android sans ordinateur

À chaque push, le workflow [`Android APK`](.github/workflows/android-apk.yml) compile
l'application et publie l'APK dans la pre-release **`apk-latest`** du dépôt :

1. Sur le téléphone, ouvrez `https://github.com/fedia76/AlbumPhoto/releases/tag/apk-latest`.
2. Téléchargez le fichier `AlbumPhoto-<commit>.apk`.
3. Autorisez l'installation d'applications inconnues pour le navigateur, puis ouvrez l'APK.

L'APK est signé avec la clé de debug d'Expo (mises à jour possibles d'un build à l'autre,
mais pas de publication sur le Play Store sans vos propres secrets de signature, voir le
workflow). Le suivi des builds se fait dans l'onglet *Actions* du dépôt.

## Démarrer (avec un ordinateur)

Prérequis : Node 20+, et pour l'app mobile un environnement Expo (Android Studio / Xcode).
Les modules natifs (ML Kit, ONNX Runtime, ExecuTorch) imposent un **development build**
(pas Expo Go).

```bash
npm install
npm test                 # tests du cœur
npm run typecheck        # types du cœur et de l'app

cd apps/mobile
npx expo prebuild        # génère android/ et ios/
npx expo run:android     # ou npx expo run:ios
```

Voir [`apps/mobile/README.md`](apps/mobile/README.md) pour les modèles d'IA et les réglages.

## Le format d'album

Spécifié dans [`docs/album-format.md`](docs/album-format.md) : un dossier `*.album/` avec un
manifeste `album.json` (JSON), des gabarits **embarqués**, des coordonnées **normalisées** et une
règle de rendu unique (`computeCropRect`) pour que mobile, web et desktop affichent exactement
la même page. La validation et la géométrie de référence sont dans `@albumphoto/core`, qui ne
dépend d'aucune API native et pourra être publié pour les autres clients.

## Feuille de route

- Web / desktop : réutiliser `@albumphoto/core` avec un renderer Canvas/SVG et un export PDF.
- Éditeur : rotation, fonds et polices, réordonnancement des pages par glisser-déposer.
- IA : modèle d'embedding de visage packagé, géocodage inverse hors ligne pour les lieux,
  comparaison des moteurs de légendes sur un même album.
