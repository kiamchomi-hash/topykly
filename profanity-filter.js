// Filtro de insultos (es/en). Las variantes tipo "p3ne", "put4", "fvck" o
// "fuuuck" se detectan normalizando cada palabra (leet, acentos, letras
// repetidas), asi la lista solo guarda las formas base. La lista y el texto
// pasan por la misma normalizacion, por eso los mapeos son consistentes.

const SPANISH_WORDS = [
  "puta",
  "puto",
  "putas",
  "putos",
  "putita",
  "putito",
  "putona",
  "putazo",
  "mierda",
  "mierdas",
  "carajo",
  "coño",
  "joder",
  "jodete",
  "verga",
  "vergas",
  "pija",
  "pijas",
  "pene",
  "penes",
  "concha",
  "conchas",
  "conchudo",
  "conchuda",
  "chota",
  "choto",
  "culo",
  "culos",
  "culiao",
  "culiado",
  "culero",
  "culera",
  "ojete",
  "orto",
  "pelotudo",
  "pelotuda",
  "boludo",
  "boluda",
  "boludez",
  "pendejo",
  "pendeja",
  "tarado",
  "tarada",
  "imbecil",
  "idiota",
  "idiotas",
  "estupido",
  "estupida",
  "mogolico",
  "mogolica",
  "retrasado",
  "retrasada",
  "subnormal",
  "gilipollas",
  "capullo",
  "cabron",
  "cabrona",
  "cabrones",
  "hijueputa",
  "hijoeputa",
  "hijodeputa",
  "hijaputa",
  "malparido",
  "malparida",
  "gonorrea",
  "marica",
  "maricon",
  "maricones",
  "trolo",
  "trola",
  "tortillera",
  "zorra",
  "zorras",
  "perra",
  "perras",
  "prostituta",
  "ramera",
  "forro",
  "forra",
  "sorete",
  "garcha",
  "garchar",
  "chupapija",
  "chupavergas",
  "lameculos",
  "cagon",
  "cagona",
  "cagada",
  "mamon",
  "mamona",
  "mamahuevo",
  "huevon",
  "huevona",
  "guevon",
  "pinche",
  "chingar",
  "chingada",
  "chingado",
  "ctm",
  "hdp",
  "lpm"
];

const ENGLISH_WORDS = [
  "fuck",
  "fucks",
  "fucking",
  "fucked",
  "fucker",
  "fuckers",
  "motherfucker",
  "motherfuckers",
  "shit",
  "shits",
  "shitty",
  "bullshit",
  "dumbshit",
  "ass",
  "asses",
  "asshole",
  "assholes",
  "dumbass",
  "jackass",
  "bitch",
  "bitches",
  "bastard",
  "bastards",
  "dick",
  "dicks",
  "dickhead",
  "cock",
  "cocks",
  "cocksucker",
  "pussy",
  "pussies",
  "cunt",
  "cunts",
  "whore",
  "whores",
  "slut",
  "sluts",
  "prick",
  "pricks",
  "wanker",
  "wankers",
  "twat",
  "twats",
  "douche",
  "douchebag",
  "moron",
  "morons",
  "retard",
  "retarded",
  "faggot",
  "faggots",
  "fag",
  "fags",
  "nigger",
  "niggers",
  "nigga",
  "niggas"
];

const LEET_MAP = {
  0: "o",
  1: "i",
  3: "e",
  4: "a",
  5: "s",
  7: "t",
  "@": "a",
  $: "s",
  "€": "e",
  v: "u",
  k: "c"
};

const ENYE_PLACEHOLDER = "\u0001";
const WORD_PATTERN = /[\p{L}\p{N}@$€]+/gu;
const CENSOR_CHARACTERS = ["*", "$", "%", "#", "&", "!"];

function normalizeToken(token) {
  // La enie se protege antes de quitar diacriticos para no confundir "año" con "ano".
  const lowered = String(token || "")
    .toLowerCase()
    .replace(/ñ/g, ENYE_PLACEHOLDER);
  let mapped = "";
  for (const character of lowered) {
    mapped += LEET_MAP[character] ?? character;
  }
  return mapped
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0001/g, "ñ");
}

const PROFANITY_SET = new Set([...SPANISH_WORDS, ...ENGLISH_WORDS].map(normalizeToken));

function tokenCandidates(token) {
  const normalized = normalizeToken(token);
  const candidates = new Set([
    normalized,
    normalized.replace(/(.)\1{2,}/g, "$1$1"),
    normalized.replace(/(.)\1+/g, "$1")
  ]);

  for (const candidate of [...candidates]) {
    if (candidate.endsWith("es") && candidate.length > 4) {
      candidates.add(candidate.slice(0, -2));
    }
    if (candidate.endsWith("s") && candidate.length > 3) {
      candidates.add(candidate.slice(0, -1));
    }
  }

  return candidates;
}

export function isProfaneWord(token) {
  for (const candidate of tokenCandidates(token)) {
    if (PROFANITY_SET.has(candidate)) {
      return true;
    }
  }
  return false;
}

export function censorProfanity(text) {
  const value = String(text ?? "");
  if (!value) {
    return value;
  }

  return value.replace(WORD_PATTERN, (token) => {
    if (!isProfaneWord(token)) {
      return token;
    }

    // La mascara debe conservarse entre renders. Un desplazamiento derivado
    // de la palabra mantiene la variedad visual sin depender de Math.random().
    let hash = 2166136261;
    for (const character of normalizeToken(token)) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }

    const startIndex = (hash >>> 0) % CENSOR_CHARACTERS.length;
    let result = "";
    for (let index = 0; index < token.length; index++) {
      result += CENSOR_CHARACTERS[(startIndex + index) % CENSOR_CHARACTERS.length];
    }
    return result;
  });
}

export function hasProfanity(text) {
  const value = String(text ?? "");
  for (const match of value.matchAll(WORD_PATTERN)) {
    if (isProfaneWord(match[0])) {
      return true;
    }
  }
  return false;
}

// Flag global de render: los renderers llaman a filterDisplayText sin conocer
// el estado; controller-render lo sincroniza con la preferencia del viewer.
let profanityFilterEnabled = false;

export function setProfanityFilterEnabled(enabled) {
  profanityFilterEnabled = Boolean(enabled);
}

export function isProfanityFilterEnabled() {
  return profanityFilterEnabled;
}

export function filterDisplayText(text) {
  return profanityFilterEnabled ? censorProfanity(text) : text;
}
