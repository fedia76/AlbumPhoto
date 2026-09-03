# Modèles embarqués

Ce dossier reçoit, **hors dépôt git**, les poids des modèles d'IA locale :

- `mobilefacenet.onnx` (optionnel) — modèle d'embedding de visage
  (entrée `1×3×112×112` float32 normalisée `(x − 127.5) / 128`, sortie `1×128`
  ou `1×512`). Sans ce fichier, l'application utilise un embedding de repli
  basé sur les pixels (moins précis). Voir `apps/mobile/README.md`.

Le modèle de langage (légendes) est téléchargé une seule fois par
`react-native-executorch` puis exécuté sur l'appareil.
