export function matchStudyQuestion(questionFromDB, actualQuestion) {
  if (typeof questionFromDB !== "string" || typeof actualQuestion !== "string") return false;
  const clean = (value) => value.replace(/\s+/g, "").toLowerCase();
  const known = clean(questionFromDB);
  const actual = clean(actualQuestion);
  return Boolean(known && actual && (actual.includes(known) || known.includes(actual)));
}

export function findStudyAnswer(questions, question) {
  if (!Array.isArray(questions)) return null;
  for (const item of questions) {
    if (!item || typeof item.name !== "string" || !Number.isInteger(Number(item.value))) continue;
    if (matchStudyQuestion(item.name, question)) {
      const answer = Number(item.value);
      return answer >= 1 && answer <= 4 ? answer : null;
    }
  }
  return null;
}
