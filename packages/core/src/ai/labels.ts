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
};

export function translateLabel(label: string, locale = 'fr-FR'): string {
  const key = label.trim().toLowerCase();
  if (!locale.startsWith('fr')) return key;
  return FR[key] ?? key;
}

/** Étiquettes trop génériques pour nourrir une légende. */
const GENERIC = new Set(['person', 'people', 'face', 'human', 'photograph', 'photo', 'image', 'picture', 'event', 'fun', 'font', 'text', 'pattern', 'room', 'product']);

export function usefulLabels(labels: { text: string; confidence?: number }[], locale = 'fr-FR', max = 4): string[] {
  return labels
    .filter((l) => (l.confidence ?? 1) >= 0.6 && !GENERIC.has(l.text.trim().toLowerCase()))
    .slice(0, max)
    .map((l) => translateLabel(l.text, locale));
}
