# @albumphoto/mobile

Application Expo (SDK 57, React Native) : éditeur d'album et assistant IA locale.

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

## Architecture

```
App.tsx                       providers + routeur minimal (pile)
src/navigation.tsx            navigation sans dépendance
src/storage/albumStore.ts     bundles <documents>/albums/<id>.album/ (album.json, photos/, thumbs/)
src/hooks/useAlbumEditor.ts   état immuable + sauvegarde automatique
src/components/PageView.tsx   rendu d'une page conforme au format (+ gestes de recadrage/zoom)
src/components/…              gabarits, sélecteur de photos, carte personne, UI
src/screens/HomeScreen.tsx    liste des albums
src/screens/EditorScreen.tsx  éditeur : gabarits, placement, zoom, textes, pages
src/screens/WizardScreen.tsx  assistant IA : parcours → personnes → style → génération
src/services/                 adaptateurs natifs des « ports » définis dans @albumphoto/core
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
- **Identité (regroupement par personne)** : par défaut, embedding de repli calculé sur les
  pixels du visage (rapide mais approximatif). Pour une reconnaissance fiable, fournissez un
  modèle ONNX type MobileFaceNet / ArcFace (entrée `1×3×112×112`, normalisation
  `(x − 127.5) / 128`) : renseignez `FACE_MODEL_URL` dans `src/config.ts`, il sera téléchargé
  une fois dans le dossier documents. Le seuil de regroupement s'adapte à l'embedder.
- **Légendes** : au choix dans l'assistant, gabarits (instantané, hors ligne) ou LLM local
  (Qwen 3 0.6B quantisé, ~600 Mo téléchargés une fois par `react-native-executorch`, puis
  inférence sur l'appareil). Le prompt est construit par `buildCaptionPrompt` dans le cœur.

### Confidentialité

Les photos, visages et légendes ne quittent jamais l'appareil. Les albums ne stockent aucun
vecteur biométrique, seulement les associations photo ↔ personne nommée.
