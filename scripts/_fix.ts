import { readFileSync, writeFileSync } from "node:fs";
const TG = (slug: string, title: string) => `        - source: 'Topical Guide, "${title}"'\n          tier: church-published\n          url: https://www.churchofjesuschrist.org/study/scriptures/tg/${slug}?lang=eng`;
type Fix = { find: string; bible: string; tg?: [string, string]; extra?: string };
function apply(file: string, fixes: Fix[]) {
  let s = readFileSync(file, "utf8");
  for (const f of fixes) {
    const i = s.indexOf(f.find);
    if (i < 0) throw new Error(`${file}: anchor not found: ${f.find}`);
    const sIdx = s.indexOf("scripture:", i);
    const lineEnd = s.indexOf("\n", sIdx);
    const line = s.slice(sIdx, lineEnd);
    if (!line.includes("bible: none-cited")) throw new Error(`${file}: expected none-cited after ${f.find}: ${line}`);
    s = s.slice(0, sIdx) + line.replace("bible: none-cited", `bible: ${f.bible}`) + s.slice(lineEnd);
    if (f.tg) {
      const authIdx = s.indexOf("authority:\n", sIdx);
      const at = authIdx + "authority:\n".length;
      const indent = s.slice(at).match(/^(\s*)- /)![1];
      const entry = TG(...f.tg).replace(/^        /gm, indent);
      s = s.slice(0, at) + entry + "\n" + s.slice(at);
    }
    if (f.extra) {
      const authIdx = s.indexOf("authority:\n", sIdx);
      const at = authIdx + "authority:\n".length;
      s = s.slice(0, at) + f.extra + "\n" + s.slice(at);
    }
  }
  writeFileSync(file, s);
}
const LM = "data/traditions/lds/metamodel.yaml", L = "data/traditions/lds/model.yaml";
apply(LM, [
  { find: "- id: Being\n", bible: `[{ together: [Matt 3:17, Luke 3:22], note: 'Both listed under Topical Guide "Godhead": at the baptism the Father speaks from heaven and the Holy Ghost descends "in a bodily shape like a dove" upon the Son.' }]`, tg: ["godhead", "Godhead"] },
  { find: "- id: GodheadMember\n", bible: "[Matt 28:19]", tg: ["godhead", "Godhead"] },
  { find: "- id: ChildOfGod\n", bible: "[Acts 17:29, Heb 12:9, Rom 8:16]", tg: ["man-a-spirit-child-of-heavenly-father", "Man, a Spirit Child of Heavenly Father"] },
  { find: "- id: Godhead\n", bible: "[Matt 28:19]", tg: ["godhead", "Godhead"] },
  { find: "- id: begets\n", bible: "[Heb 12:9, Num 16:22, Acts 17:29]", tg: ["man-a-spirit-child-of-heavenly-father", "Man, a Spirit Child of Heavenly Father"] },
  { find: "- id: comprises\n", bible: "[Matt 28:19]", tg: ["godhead", "Godhead"] },
]);
apply(L, [
  { find: "- id: lds.father\n", bible: "[Matt 6:9, Matt 3:17]", tg: ["god-the-father-elohim", "God the Father, Elohim"] },
  { find: "- name: Existence before birth", bible: "[John 17:5, John 8:58, John 1:1]", tg: ["jesus-christ-antemortal-existence-of", "Jesus Christ, Antemortal Existence of"] },
  { find: "- id: lds.holy-ghost\n    label", bible: "[Matt 28:19, John 14:26]", tg: ["holy-ghost", "Holy Ghost"] },
  { find: "- id: lds.godhead\n", bible: "[Matt 28:19, John 10:30]", tg: ["godhead", "Godhead"] },
  { find: "- id: lds.e.godhead-father\n", bible: "[Matt 28:19]", tg: ["godhead", "Godhead"] },
  { find: "- id: lds.e.father-begets-jesus-flesh\n", bible: `[Luke 1:32, { ref: Luke 1:35, highlight: "shall be called the Son of God" }]`, tg: ["jesus-christ-divine-sonship", "Jesus Christ, Divine Sonship"] },
]);
const CM = "data/traditions/catholic/metamodel.yaml", C = "data/traditions/catholic/model.yaml";
const ccc200 = `        - source: Catechism of the Catholic Church\n          ref: CCC 200-202, 228\n          tier: ordinary-magisterium\n          url: https://www.vatican.va/archive/ENG0015/__P16.HTM\n          quote: '"The Christian faith confesses that God is one in nature, substance and essence."'`;
apply(CM, [
  { find: "- id: DivineNature\n", bible: "[Deut 6:4, Mark 12:29]", extra: ccc200 },
  { find: "- id: ax.soul-reunites-body\n", bible: "[John 5:29, Luke 24:39]", extra: `        - source: Catechism of the Catholic Church\n          ref: CCC 997-999\n          tier: ordinary-magisterium\n          url: https://www.vatican.va/archive/ENG0015/__P2H.HTM\n          quote: God, in his almighty power, will definitively grant incorruptible life to our bodies by reuniting them with our souls` },
]);
apply(C, [{ find: "- id: cath.godhead\n", bible: "[Deut 6:4, Mark 12:29]", extra: ccc200 }]);
