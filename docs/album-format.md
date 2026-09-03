# Format d'album AlbumPhoto — version 1

Ce document spécifie le format de fichier des albums. Il est la **référence
commune** aux versions mobile, web et desktop : tout moteur de rendu qui
respecte ce document affiche une page à l'identique.

Principes :

- **JSON pur, lisible**, sans dépendance à une bibliothèque particulière.
- **Autonome** : un album embarque les gabarits qu'il utilise et ses photos.
- **Normalisé** : les positions sont des fractions `0..1` de la page, les
  transformations de photos sont bornées et indépendantes de la résolution.
- **Extensible** : les champs inconnus sont ignorés ; `formatVersion` permet
  des migrations explicites.

L'implémentation de référence (types, validation, géométrie) est le paquet
[`@albumphoto/core`](../packages/core). Un schéma JSON est fourni dans
[`packages/core/schema/album.schema.json`](../packages/core/schema/album.schema.json).

## 1. Le bundle

Un album est un **dossier** dont le nom se termine par `.album` :

```
Été 2026.album/
├── album.json        # manifeste (ce document)
├── photos/           # fichiers image référencés par album.json (chemins relatifs)
│   ├── 3f2a9c….jpg
│   └── …
└── thumbs/           # vignettes optionnelles, régénérables
```

- Les chemins (`photos[].src`, `photos[].thumb`) sont **relatifs au bundle**,
  jamais absolus, jamais avec `..`.
- Pour le partage, le dossier peut être compressé en zip (extension
  recommandée : `.album.zip`). Le manifeste doit rester à la racine de l'archive.

## 2. Le manifeste `album.json`

```jsonc
{
  "format": "albumphoto",
  "formatVersion": 1,
  "id": "0b6b0f1c-…",             // UUID stable
  "title": "Été 2026",
  "locale": "fr-FR",
  "createdAt": "2026-08-30T10:00:00.000Z",
  "updatedAt": "2026-08-30T10:12:41.000Z",
  "generator": "albumphoto-mobile/0.1.0",
  "page":  { "width": 210, "height": 210, "unit": "mm", "bleed": 3 },
  "theme": { "background": "#ffffff", "textColor": "#222222", "fontFamily": "System" },
  "templates": [ /* gabarits embarqués, voir §3 */ ],
  "photos":    [ /* bibliothèque de l'album, voir §4 */ ],
  "people":    [ /* personnes reconnues, voir §5 */ ],
  "pages":     [ /* pages dans l'ordre, voir §6 */ ],
  "ai":        { "captionStyle": "funny", "captionModel": "template:fr" }
}
```

| Champ | Obligatoire | Description |
|---|---|---|
| `format` | oui | Toujours `"albumphoto"`. |
| `formatVersion` | oui | Entier. Un lecteur refuse une version supérieure à celle qu'il connaît. |
| `id`, `title` | oui | Identité de l'album. |
| `locale` | non | BCP 47, défaut `fr-FR`. Sert aux dates et à l'IA. |
| `page` | oui | Taille physique **hors fond perdu** ; `bleed` est ajouté sur chaque bord à l'impression. |
| `theme` | non | Fond, couleur de texte et police par défaut. |
| `templates` | oui | Gabarits utilisés par les pages (copie intégrale). |
| `photos` | oui | Toutes les photos disponibles dans l'album, placées ou non. |
| `people` | non | Personnes nommées par l'utilisateur. |
| `pages` | oui | Pages ordonnées. |
| `ai` | non | Métadonnées informatives sur l'assistance IA. |

## 3. Gabarits (`templates`)

Un gabarit décrit des **zones** (`slots`) en coordonnées normalisées :

```json
{
  "id": "two-caption",
  "name": "Deux photos + légende",
  "photoCount": 2,
  "slots": [
    { "id": "p1", "kind": "photo", "rect": { "x": 0.04, "y": 0.04, "w": 0.445, "h": 0.8 } },
    { "id": "p2", "kind": "photo", "rect": { "x": 0.515, "y": 0.04, "w": 0.445, "h": 0.8 } },
    { "id": "c1", "kind": "text",  "rect": { "x": 0.04, "y": 0.86, "w": 0.92, "h": 0.1 }, "align": "center" }
  ]
}
```

- `rect` : fractions de la page (`x + w ≤ 1`, `y + h ≤ 1`).
- `kind` : `photo` ou `text`. Un texte a un `align` optionnel.
- Les ids de gabarits intégrés (`cover`, `single`, `single-caption`,
  `two-columns`, `two-rows`, `two-caption`, `one-plus-two`, `grid-2x2`,
  `three-caption`, `full-bleed`, `chapter`) sont réservés mais **toujours
  embarqués** dans l'album : un lecteur n'a pas besoin de les connaître.
- Un album peut définir ses propres gabarits avec d'autres ids.

## 4. Photos (`photos`)

```json
{
  "id": "3f2a9c…",
  "src": "photos/3f2a9c….jpg",
  "thumb": "thumbs/3f2a9c….jpg",
  "width": 4032, "height": 3024,
  "mimeType": "image/jpeg",
  "takenAt": "2026-07-14T18:30:00+02:00",
  "location": { "latitude": 48.85, "longitude": 2.35 },
  "sourceUri": "ph://…",
  "hash": "9f8e7d6c5b4a3921",
  "people": ["person-a"],
  "score": 0.83,
  "labels": ["plage", "coucher de soleil"]
}
```

`width`/`height` sont les dimensions en pixels de `src` **telles que rendues**
(orientation EXIF déjà appliquée). `sourceUri`, `hash`, `score`, `labels` et
`people` sont informatifs (IA) et peuvent être omis.

## 5. Personnes (`people`)

```json
{ "id": "person-a", "name": "Léa", "referencePhotoId": "3f2a9c…",
  "referenceFaceRect": { "x": 0.41, "y": 0.22, "w": 0.12, "h": 0.16 } }
```

Aucune donnée biométrique (vecteur d'identité) n'est stockée dans l'album :
seules les associations photo ↔ personne nommée sont conservées.

## 6. Pages (`pages`)

```json
{
  "id": "page-1",
  "templateId": "two-caption",
  "photos": {
    "p1": { "photoId": "3f2a9c…", "transform": { "scale": 1.4, "offsetX": 0.2, "offsetY": 0, "rotation": 0 } },
    "p2": { "photoId": "77ab…",  "transform": { "scale": 1, "offsetX": 0, "offsetY": 0, "rotation": 0 } }
  },
  "texts": {
    "c1": { "text": "Léa et Tom : 100 % naturel, 0 % posé. Ou presque.", "role": "caption" }
  }
}
```

Les clés de `photos` et `texts` sont des ids de zones du gabarit. Une zone
absente est vide.

### 6.1 Transformation d'une photo dans une zone (règle de rendu)

C'est le cœur de l'interopérabilité. Pour une zone d'aspect `As` (largeur /
hauteur **en unités physiques**, donc en tenant compte des proportions de la
page) et une photo d'aspect `Ap` :

1. **Cover** : la photo est agrandie au minimum pour remplir la zone.
   Fraction visible de la photo :
   - si `Ap ≥ As` : `vw = As / Ap`, `vh = 1`
   - sinon : `vw = 1`, `vh = Ap / As`
2. **Zoom** : `vw /= scale`, `vh /= scale` avec `1 ≤ scale ≤ 6`.
3. **Déplacement** : le centre de la fenêtre visible est
   `cx = 0.5 + offsetX · (1 − vw) / 2`, `cy = 0.5 + offsetY · (1 − vh) / 2`
   avec `offsetX, offsetY ∈ [−1, 1]` (−1 = bord gauche/haut, +1 = bord droit/bas).
4. Le rectangle source, en coordonnées normalisées de la photo, est
   `{ x: cx − vw/2, y: cy − vh/2, w: vw, h: vh }`. Le renderer dessine cette
   portion de la photo, étirée sur le rectangle de la zone.

Cette construction garantit qu'aucune zone vide n'apparaît, quel que soit le
zoom, et que les offsets restent valides si l'on change de zoom.
`rotation` (degrés, sens horaire) est réservé ; la valeur `0` est la seule
produite aujourd'hui, un lecteur peut ignorer les autres valeurs.

Implémentation de référence : `computeCropRect()` dans
`packages/core/src/album/geometry.ts`.

### 6.2 Textes

Le texte est rendu dans le rectangle de la zone, dans la police et la couleur
du thème, avec l'alignement du gabarit. La taille de police est libre (le
renderer réduit la taille pour tenir dans la zone). `role` aide au style
(`title` plus grand que `caption`).

## 7. Compatibilité et évolution

- Les lecteurs **ignorent** les champs inconnus et les conservent si possible
  lors d'une réécriture.
- Toute modification incompatible incrémente `formatVersion` et s'accompagne
  d'une migration dans `@albumphoto/core`.
- Les ids sont des chaînes opaques ; les UUID sont recommandés.
