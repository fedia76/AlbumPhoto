/**
 * Traduction des étiquettes courantes renvoyées par les modèles d'étiquetage
 * d'images (ML Kit, en anglais) vers le français, pour les légendes.
 * Les étiquettes inconnues sont renvoyées en minuscules telles quelles.
 */
const FR: Record<string, string> = {
  beach: 'plage',
  sea: 'mer',
  ocean: 'océan',
  mountain: 'montagne',
  snow: 'neige',
  sky: 'ciel',
  sunset: 'coucher de soleil',
  sunrise: 'lever de soleil',
  cake: 'gâteau',
  birthday: 'anniversaire',
  food: 'repas',
  dog: 'chien',
  cat: 'chat',
  car: 'voiture',
  bicycle: 'vélo',
  boat: 'bateau',
  flower: 'fleur',
  tree: 'arbre',
  forest: 'forêt',
  garden: 'jardin',
  park: 'parc',
  city: 'ville',
  building: 'bâtiment',
  street: 'rue',
  water: 'eau',
  pool: 'piscine',
  swimming: 'baignade',
  sport: 'sport',
  football: 'football',
  concert: 'concert',
  music: 'musique',
  wedding: 'mariage',
  christmas: 'Noël',
  baby: 'bébé',
  child: 'enfant',
  smile: 'sourire',
  selfie: 'selfie',
  fun: 'fête',
  party: 'fête',
  picnic: 'pique-nique',
  camping: 'camping',
  hiking: 'randonnée',
  travel: 'voyage',
  vacation: 'vacances',
  night: 'nuit',
  fireworks: 'feu d\'artifice',
  rain: 'pluie',
  lake: 'lac',
  river: 'rivière',
  bridge: 'pont',
  museum: 'musée',
  restaurant: 'restaurant',
  drink: 'boisson',
  coffee: 'café',
  bread: 'pain',
  dessert: 'dessert',
  fruit: 'fruit',
  // Scènes d'intérieur et d'enfance : les plus fréquentes sur des photos de
  // famille, et les plus voyantes quand elles restent en anglais.
  toy: 'jouet',
  plush: 'peluche',
  'teddy bear': 'nounours',
  doll: 'poupée',
  bed: 'lit',
  play: 'jeu',
  playground: 'aire de jeux',
  slide: 'toboggan',
  swing: 'balançoire',
  book: 'livre',
  ball: 'ballon',
  balloon: 'ballon',
  gift: 'cadeau',
  costume: 'déguisement',
  hat: 'chapeau',
  stroller: 'poussette',
  sand: 'sable',
  grass: 'herbe',
  tent: 'tente',
  church: 'église',
  castle: 'château',
  market: 'marché',
  kitchen: 'cuisine',
  farm: 'ferme',
  zoo: 'zoo',
  horse: 'cheval',
  bird: 'oiseau',
};

export function translateLabel(label: string, locale = 'fr-FR'): string {
  const key = label.trim().toLowerCase();
  if (!locale.startsWith('fr')) return key;
  return FR[key] ?? key;
}

/** Étiquettes trop génériques pour nourrir une légende. */
const GENERIC = new Set([
  'person', 'people', 'face', 'human', 'photograph', 'photo', 'image', 'picture', 'event', 'fun', 'font', 'text',
  'pattern', 'room', 'product',
  // Étiquettes que ML Kit produit en masse et qui ne disent rien d'une photo.
  'leisure', 'comfort', 'textile', 'linens', 'furniture', 'material property', 'gesture', 'skin', 'sleeve', 'thigh',
  'eyewear', 'flash photography', 'happy', 'smile', 'fashion', 'interior design', 'wood', 'plastic',
]);

export function usefulLabels(labels: { text: string; confidence?: number }[], locale = 'fr-FR', max = 4): string[] {
  return labels
    .filter((l) => (l.confidence ?? 1) >= 0.6 && !GENERIC.has(l.text.trim().toLowerCase()))
    .slice(0, max)
    .map((l) => translateLabel(l.text, locale));
}
