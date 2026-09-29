/**
 * Canonical book table. `abbr` is the normalized reference form used in data files (e.g. "1 Cor 15:44").
 * Per-publisher identifiers: USCCB slug, churchofjesuschrist.org path, wol.jw.org book number (1-66), ESV name.
 */
export interface Book {
  abbr: string;
  name: string;
  usccb: string;
  lds?: string;
  wol?: number;
  esv?: string;
}

const OT: [string, string, string, string][] = [
  ["Gen", "Genesis", "genesis", "gen"], ["Ex", "Exodus", "exodus", "ex"], ["Lev", "Leviticus", "leviticus", "lev"],
  ["Num", "Numbers", "numbers", "num"], ["Deut", "Deuteronomy", "deuteronomy", "deut"], ["Josh", "Joshua", "joshua", "josh"],
  ["Judg", "Judges", "judges", "judg"], ["Ruth", "Ruth", "ruth", "ruth"], ["1 Sam", "1 Samuel", "1samuel", "1-sam"],
  ["2 Sam", "2 Samuel", "2samuel", "2-sam"], ["1 Kgs", "1 Kings", "1kings", "1-kgs"], ["2 Kgs", "2 Kings", "2kings", "2-kgs"],
  ["1 Chr", "1 Chronicles", "1chronicles", "1-chr"], ["2 Chr", "2 Chronicles", "2chronicles", "2-chr"], ["Ezra", "Ezra", "ezra", "ezra"],
  ["Neh", "Nehemiah", "nehemiah", "neh"], ["Esth", "Esther", "esther", "esth"], ["Job", "Job", "job", "job"],
  ["Ps", "Psalms", "psalms", "ps"], ["Prov", "Proverbs", "proverbs", "prov"], ["Eccl", "Ecclesiastes", "ecclesiastes", "eccl"],
  ["Song", "Song of Songs", "songofsongs", "song"], ["Isa", "Isaiah", "isaiah", "isa"], ["Jer", "Jeremiah", "jeremiah", "jer"],
  ["Lam", "Lamentations", "lamentations", "lam"], ["Ezek", "Ezekiel", "ezekiel", "ezek"], ["Dan", "Daniel", "daniel", "dan"],
  ["Hos", "Hosea", "hosea", "hosea"], ["Joel", "Joel", "joel", "joel"], ["Amos", "Amos", "amos", "amos"],
  ["Obad", "Obadiah", "obadiah", "obad"], ["Jonah", "Jonah", "jonah", "jonah"], ["Mic", "Micah", "micah", "micah"],
  ["Nah", "Nahum", "nahum", "nahum"], ["Hab", "Habakkuk", "habakkuk", "hab"], ["Zeph", "Zephaniah", "zephaniah", "zeph"],
  ["Hag", "Haggai", "haggai", "hag"], ["Zech", "Zechariah", "zechariah", "zech"], ["Mal", "Malachi", "malachi", "mal"],
];
const NT: [string, string, string, string][] = [
  ["Matt", "Matthew", "matthew", "matt"], ["Mark", "Mark", "mark", "mark"], ["Luke", "Luke", "luke", "luke"],
  ["John", "John", "john", "john"], ["Acts", "Acts", "acts", "acts"], ["Rom", "Romans", "romans", "rom"],
  ["1 Cor", "1 Corinthians", "1corinthians", "1-cor"], ["2 Cor", "2 Corinthians", "2corinthians", "2-cor"],
  ["Gal", "Galatians", "galatians", "gal"], ["Eph", "Ephesians", "ephesians", "eph"], ["Phil", "Philippians", "philippians", "philip"],
  ["Col", "Colossians", "colossians", "col"], ["1 Thess", "1 Thessalonians", "1thessalonians", "1-thes"],
  ["2 Thess", "2 Thessalonians", "2thessalonians", "2-thes"], ["1 Tim", "1 Timothy", "1timothy", "1-tim"],
  ["2 Tim", "2 Timothy", "2timothy", "2-tim"], ["Titus", "Titus", "titus", "titus"], ["Phlm", "Philemon", "philemon", "philem"],
  ["Heb", "Hebrews", "hebrews", "heb"], ["Jas", "James", "james", "james"], ["1 Pet", "1 Peter", "1peter", "1-pet"],
  ["2 Pet", "2 Peter", "2peter", "2-pet"], ["1 John", "1 John", "1john", "1-jn"], ["2 John", "2 John", "2john", "2-jn"],
  ["3 John", "3 John", "3john", "3-jn"], ["Jude", "Jude", "jude", "jude"], ["Rev", "Revelation", "revelation", "rev"],
];
const DEUTERO: [string, string, string][] = [
  ["Tob", "Tobit", "tobit"], ["Jdt", "Judith", "judith"], ["1 Macc", "1 Maccabees", "1maccabees"], ["2 Macc", "2 Maccabees", "2maccabees"],
  ["Wis", "Wisdom", "wisdom"], ["Sir", "Sirach", "sirach"], ["Bar", "Baruch", "baruch"],
];

export const BOOKS: Book[] = [
  ...OT.map(([abbr, name, usccb, lds], i) => ({ abbr, name, usccb, lds: `ot/${lds}`, wol: i + 1, esv: name })),
  ...NT.map(([abbr, name, usccb, lds], i) => ({ abbr, name, usccb, lds: `nt/${lds}`, wol: i + 40, esv: name })),
  ...DEUTERO.map(([abbr, name, usccb]) => ({ abbr, name, usccb })),
];

export const RESTORATION: Record<string, string> = {
  "1 Ne": "bofm/1-ne", "2 Ne": "bofm/2-ne", Jacob: "bofm/jacob", Mosiah: "bofm/mosiah", Alma: "bofm/alma",
  Hel: "bofm/hel", "3 Ne": "bofm/3-ne", Ether: "bofm/ether", Moro: "bofm/moro", "D&C": "dc-testament/dc",
  Moses: "pgp/moses", Abr: "pgp/abr", "JS-H": "pgp/js-h", "A of F": "pgp/a-of-f",
};

export const bookByAbbr = new Map(BOOKS.map((b) => [b.abbr, b]));
