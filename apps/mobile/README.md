# @albumphoto/mobile

Application Expo (SDK 57, React Native) : éditeur d'album et assistant IA locale.

## Obtenir l'APK sans ordinateur

Le workflow `.github/workflows/android-apk.yml` compile un APK release (arm64) à chaque push et
le publie dans la pre-release `apk-latest` du dépôt, téléchargeable depuis le téléphone.
Le script `scripts/apply-signing.js` permet de signer avec votre propre keystore si les secrets
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` et
`ANDROID_KEY_PASSWORD` sont définis dans le dépôt.

## Lancer

```bash
# depuis la racine du dépôt
npm install
cd apps/mobile
npx expo prebuild          # modules natifs : ML Kit, ONNX Runtime, ExecuTorch, Reanimated
npx expo run:android       # ou run:ios (macOS)
```

Expo Go ne convient pas (modules natifs). Le web n'est pas ciblé par cette app :
la version web réutilisera `@albumphoto/core` avec ses propres adaptateurs.

## Diagnostic sans ordinateur

Il n'y a pas d'accès à `logcat` depuis un téléphone non connecté. L'application
journalise donc elle-même : erreurs JavaScript non rattrapées, erreurs de rendu,
modules natifs indisponibles, dans `<documents>/diagnostics/app.log`.

- Bouton **Diagnostic** en haut de l'écran d'accueil : état de chaque module natif,
  journal, et trois actions épinglées sous l'en-tête — **Partager**, **Actualiser**,
  **Vider** — accessibles quelle que soit la longueur du journal.
- Le journal est borné à 40 Ko, les piles d'appel sont tronquées à douze niveaux et les
  erreurs identiques qui se suivent sont comptées (`×12`) au lieu d'être recopiées.
  L'écran n'affiche que la fin du journal ; le partage contient le tout.
- Si l'application s'est fermée avant d'afficher quoi que ce soit, un bandeau rouge
  le signale au lancement suivant et renvoie vers le journal.
- Si le chargement échoue complètement, `index.ts` affiche un écran de secours avec
  la pile d'appel plutôt que de fermer l'application.

Les modules natifs d'IA (ML Kit, ONNX Runtime, ExecuTorch) sont chargés
**paresseusement**, au moment de l'analyse : un module absent dégrade la
fonctionnalité concernée au lieu d'empêcher l'application de démarrer.

Un `try/catch` autour d'un `require` ne suffit pas : quand un module lève une
exception pendant son évaluation, Metro ne la propage pas à l'appelant mais la
signale comme erreur fatale (`guardedLoadModule` appelle
`ErrorUtils.reportFatalError`). C'est pourquoi `src/services/nativeAvailability.ts`
vérifie la présence du module natif (`NativeModules` / `TurboModuleRegistry`)
**avant** tout import de `onnxruntime-react-native` et `react-native-executorch`,
qui touchent tous deux leur partie native dès le chargement.

`onnxruntime-react-native` embarque par ailleurs un `unimodule.json` hérité qui le
fait passer pour un module Expo : l'autolinking renonce alors à le lier des deux
côtés, si bien qu'il compile mais que `OnnxruntimePackage` n'atteint jamais
`PackageList`. Le script `scripts/patch-native-deps.js` (postinstall) retire ce
fichier pour rétablir l'autolinking React Native standard.

## Architecture

```
App.tsx                       providers + routeur minimal (pile)
src/navigation.tsx            navigation sans dépendance
src/storage/albumStore.ts     bundles <documents>/albums/<id>.album/ (album.json, photos/, thumbs/)
src/hooks/useAlbumEditor.ts   état immuable + sauvegarde automatique
src/components/PageView.tsx   rendu d'une page conforme au format (+ gestes de recadrage/zoom)
src/services/faceThumbnails.ts vignettes de visage recadrées pour l'assistant
src/components/…              gabarits, sélecteur de photos, carte personne, UI
src/screens/HomeScreen.tsx    liste des albums
src/screens/EditorScreen.tsx  éditeur : carrousel de pages, gabarits, placement, zoom, textes
src/screens/WizardScreen.tsx  assistant IA : parcours → personnes (fusion possible) → revue → style → génération
src/components/SelectionReview.tsx  revue détaillée : photos retenues, écartées, et motifs
src/services/photoThumbnails.ts     vignettes des photos de l'appareil, mises en cache
src/services/captionJob.ts          écriture des légendes en tâche de fond (avancement, reprise, arrêt)
src/services/remoteWriter.ts        rédaction des légendes par Claude Haiku 4.5 (description seule, jamais la photo)
src/services/apiKey.ts              clé d'API conservée sur l'appareil (magasin sécurisé, repli fichier)
src/components/CaptionChooser.tsx   description du modèle et propositions de légendes, dans l'éditeur
src/components/CaptionProgress.tsx  bandeau d'avancement des légendes (éditeur et accueil)
src/screens/DiagnosticsScreen.tsx  état des modules natifs et journal partageable
src/diagnostics/              journal disque, détection de plantage au démarrage, écran de secours
src/services/                 adaptateurs natifs des « ports » définis dans @albumphoto/core
metro.config.js               redirige le fichier Node du SDK Anthropic vers son jumeau navigateur
```

### Adaptateurs IA (tous sur l'appareil)

| Port (`@albumphoto/core`) | Implémentation | Bibliothèque |
|---|---|---|
| `PhotoSource` | `DevicePhotoSource` | `expo-media-library` |
| `PixelReader` | `ManipulatorPixelReader` | `expo-image-manipulator` + `jpeg-js` |
| `FaceDetector` | `MlKitFaceDetector` | `@react-native-ml-kit/face-detection` |
| `FaceEmbedder` | `OnnxFaceEmbedder` (si modèle) sinon `PixelFaceEmbedder` | `onnxruntime-react-native` |
| `ImageLabeler` | `MlKitImageLabeler` | `@react-native-ml-kit/image-labeling` |
| `CaptionGenerator` | `LocalLlmCaptionGenerator` (repli `TemplateCaptionGenerator`) | `react-native-executorch` |
| `PhotoImporter` | `BundlePhotoImporter` | `expo-file-system` |

### Modèles

- **Visages / expressions** : ML Kit embarque ses modèles, rien à télécharger.
- **Identité (regroupement par personne)** : MobileFaceNet `w600k_mbf.onnx` (pack insightface
  buffalo_sc, 13,6 Mo, entrée `1×3×112×112` RGB, normalisation `(x − 127.5) / 127.5`, sortie 512).
  Le workflow `publish-model.yml` le publie comme asset de la release `models-v1` de ce dépôt ;
  l'application le télécharge au premier lancement de l'assistant dans le dossier documents et
  vérifie son MD5. Sans réseau, repli sur un embedding par pixels (approximatif) avec un seuil
  de regroupement adapté. Licence insightface : usage non commercial. Pour changer de modèle,
  éditez `src/config.ts`.
- **Légendes** : trois moteurs au choix dans l'assistant (`src/services/captioner.ts`,
  table `CAPTION_MODELS`).
  - *Gabarits* : instantané, hors ligne, tournures écrites à l'avance.
  - *Modèle texte* : Qwen 3 0.6B quantisé (~600 Mo téléchargés une fois par
    `react-native-executorch`). Il ne voit pas la photo et n'écrit qu'à partir des faits
    relevés — prénoms, étiquettes ML Kit, date. C'est la limite du procédé : les étiquettes
    (« personne », « plage ») sont une matière trop mince pour une belle légende.
  - *Modèle vision* : LFM2.5-VL 1.6B quantisé (XNNPACK, CPU ; environ 1 Go — l'ordre de
    grandeur découle de la quantisation 8da4w, le chiffre exact s'affiche pendant le
    téléchargement). La photo est réduite à 512 px de côté long puis passée au modèle via
    `mediaPath` ; le prompt (`buildVisionCaptionPrompt`) ne lui répète donc pas ce qu'il a
    sous les yeux et ne lui donne que ce qu'aucune image ne porte : les prénoms, la date,
    l'événement. Comptez jusqu'à une minute par photo, la lecture de l'image comprise.

  - *Vision + rédaction en ligne* : le modèle local **décrit** la photo (ce qu'un petit
    modèle sait faire de mieux), **Claude Haiku 4.5** écrit la légende (ce qu'il fait
    infiniment mieux qu'un modèle de 1,6 milliard de paramètres, en français surtout).
    Ce qui sort de l'appareil : la description, les prénoms saisis, la date, l'événement
    et le titre de l'album. **Jamais la photo.** Rien n'est envoyé tant que ce moteur
    n'est pas explicitement choisi. Une clé d'API Anthropic est demandée dans l'assistant
    et conservée sur l'appareil (magasin sécurisé du système, à défaut un fichier privé) ;
    comptez moins d'un centime par album. Sans clé, sans réseau ou en cas de quota
    épuisé, la légende du modèle local prend le relais, puis le gabarit.

  La description est demandée **en anglais** : ces petits modèles y décrivent nettement
  mieux. Elle est conservée dans l'album et consultable dans l'éditeur.

#### Description et propositions

La qualité d'une légende est plafonnée par celle de la description : le rédacteur ne voit
que ce texte. Quatre choix la soignent (`buildDescriptionPrompt`) :

- **une consigne structurée** — qui, quoi, où, puis ce qui rend le moment particulier —
  plutôt qu'un « décris bien » : un petit modèle suit une liste, pas un adjectif ;
- **l'ancrage sur ce que l'appareil sait déjà** : le nombre de visages détectés par ML Kit
  (« fais-y confiance plutôt qu'à ton propre compte » — ces modèles comptent mal), le
  moment de la journée, les étiquettes de contenu ;
- **768 px de côté long** au lieu de 512 : au-delà de la tuile du modèle, c'est un visage
  lisible là où la vignette ne montrait qu'une tache ;
- **deux ou trois phrases** plutôt qu'une : le rédacteur sait résumer, pas deviner.

Le rédacteur en ligne renvoie ensuite **quatre légendes pour chacun des cinq styles en un
seul appel** — grouper les styles coûte moins cher que cinq requêtes et évite qu'il se
répète d'un style à l'autre. La légende du style choisi habille la page ; les vingt
propositions et la description sont enregistrées dans l'album (`Photo.description`,
`Photo.captionOptions`) et s'affichent en touchant une légende dans l'éditeur, où il
suffit d'en toucher une autre pour changer d'avis. Rien n'est régénéré à ce moment-là.

  Les réglages d'échantillonnage (température, `topP`) sont laissés aux presets : chacun
  porte les valeurs recommandées par ses auteurs, les écraser dégradait les légendes.
  Le prompt textuel est construit par `buildCaptionPrompt` dans le cœur.
  Depuis la version 0.9, `react-native-executorch` exige un « resource fetcher » explicite :
  `initExecutorch({ resourceFetcher: ExpoResourceFetcher })` est appelé au premier chargement
  du modèle (`src/services/captioner.ts`). Sans lui, tout téléchargement échoue et
  l'application se rabat silencieusement sur les gabarits.

#### Les légendes s'écrivent en tâche de fond

L'assistant n'attend plus le modèle pour rendre l'album. Il assemble les pages avec des
légendes de **gabarit** — instantanées, et surtout indispensables : le choix du gabarit de
page dépend de la présence d'une légende, une page assemblée sans légende n'aurait aucune
zone où l'écrire ensuite. L'album s'ouvre, puis `captionJob` (`src/services/captionJob.ts`)
fait repasser le modèle photo par photo et remplace chaque légende au fil de l'eau
(`onCaption` côté cœur, `applyPhotoCaptions` pour reposer le texte dans la bonne zone).

- **La préparation du modèle est une étape à part** (`CaptionGenerator.prepare`). Télécharger
  un gigaoctet puis le charger prend des minutes au premier lancement : compter cette attente
  dans le délai d'une légende revenait à abandonner le modèle pendant qu'il se chargeait
  encore — le moteur vision ne démarrait jamais. Le chargement est retenté trois fois : sur
  réseau mobile, la coupure en cours de téléchargement (« Software caused connection abort »)
  est la règle, pas l'exception.
- L'avancement est visible partout : bandeau `CaptionProgress` dans l'éditeur et sur
  l'écran d'accueil (préparation et pourcentage de téléchargement, puis compteur de légendes,
  signe de vie du modèle, bouton « Arrêter »).
- **Qui écrit le fichier.** Tant que l'éditeur est ouvert sur cet album, c'est lui qui
  applique les légendes et les sauvegarde (`captionJob.claim`) ; sinon la tâche écrit le
  fichier elle-même. Sans cette règle, l'éditeur travaillerait sur une copie périmée et
  écraserait les légendes à sa prochaine sauvegarde automatique.
- Une légende retouchée à la main n'est pas remplacée par celle du modèle.
- « Arrière-plan » s'entend l'application au premier plan : c'est du JavaScript, il
  s'interrompt si le système suspend l'application et reprend à son retour.
- Le modèle est libéré à la fin de la tâche (plusieurs centaines de mégaoctets).

#### Pourquoi une génération peut sembler figée

Rien, côté natif, ne borne la longueur d'une réponse : un petit modèle qui part en boucle
écrit jusqu'à saturer sa fenêtre de contexte, soit plusieurs minutes pour une seule légende.
`LocalLlmCaptionGenerator` surveille donc chaque génération et l'interrompt (`interrupt()`)
dès que la première ligne est complète, après un silence prolongé, ou au bout du délai total.
Les bornes dépendent du moteur (`GenerationLimits`) : un modèle vision reste muet le temps de
lire l'image — jusqu'à deux minutes — et l'interrompre pendant cette phase gâcherait tout le
travail, alors qu'un modèle textuel qui ne dit rien après 25 s est bloqué.

Cas particulier des modèles « thinking » (Qwen 3) : un bloc `<think>` jamais refermé ne laisse
aucun texte exploitable, quelle que soit sa longueur. `isStuckThinking` le repère au bout de
600 caractères et coupe aussitôt, au lieu d'attendre le délai complet pour ne rien récolter —
c'est ce qui brûlait quarante secondes par photo sur la moitié d'un album.
Si le moteur natif ne rend toujours pas la main, la légende part au gabarit et le reste de
l'album aussi — plutôt que d'attendre indéfiniment. Le cœur ajoute un garde-fou indépendant
(`generateCaptions({ timeoutMs })`, 75 s) pour tout générateur qui se bloquerait.

Ce qui aide à diagnostiquer, dans « Diagnostic » :

- une ligne de journal par légende : durée, jetons d'entrée et générés, caractères reçus,
  et le motif d'une coupure éventuelle ;
- le bilan de l'album (légendes par le modèle, par gabarits, moyenne par légende) ;
- pendant l'écriture, l'assistant affiche la photo **en cours** (et non la dernière terminée),
  avec les caractères produits et les secondes écoulées : un compteur qui avance signifie que
  le modèle travaille, un compteur figé qu'il est bloqué.

### Confidentialité

Les photos et les visages ne quittent **jamais** l'appareil, quel que soit le moteur.
Les trois moteurs locaux (gabarits, texte, vision) n'émettent aucune requête réseau
hors le téléchargement initial du modèle. Le quatrième, « Vision + rédaction en ligne »,
doit être choisi explicitement et n'envoie que du texte : la description produite sur
l'appareil, les prénoms que vous avez saisis, la date, l'événement et le titre de l'album.

Les photos, visages et légendes ne quittent jamais l'appareil. Les albums ne stockent aucun
vecteur biométrique, seulement les associations photo ↔ personne nommée.
