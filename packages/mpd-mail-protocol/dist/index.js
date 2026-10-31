// packages/mpd-mail-protocol/src/types.ts
var MAIL_KINDS = ["message", "question", "answer"];
function isMailKind(value) {
  return value === "message" || value === "question" || value === "answer";
}
var INDEX_FIELD_NAMES = [
  "index",
  "indexes",
  "indices",
  "optionIndex",
  "optionIndices",
  "selectedIndex",
  "selectedIndices",
  "optionNumber",
  "optionNumbers"
];
var MAIL_PAYLOADS_CARRY_NO_INDEX = true;
// packages/mpd-mail-protocol/src/validate.ts
function problem(code, message, labels) {
  return labels === undefined ? { code, message } : { code, message, labels: [...labels] };
}
function check(problems) {
  return problems.length === 0 ? { ok: true } : { ok: false, problems: [...problems] };
}
function appendProblems(target, nested) {
  if (!nested.ok)
    target.push(...nested.problems);
}
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function findIndexFields(value) {
  const found = [];
  const seen = new Set;
  const walk = (current, path, depth) => {
    if (depth > 16 || current === null || typeof current !== "object")
      return;
    if (seen.has(current))
      return;
    seen.add(current);
    if (Array.isArray(current)) {
      current.forEach((entry, index) => walk(entry, path + "[" + String(index) + "]", depth + 1));
      return;
    }
    for (const [key, entry] of Object.entries(current)) {
      const childPath = path + "." + key;
      if (INDEX_FIELD_NAMES.includes(key))
        found.push(childPath);
      walk(entry, childPath, depth + 1);
    }
  };
  walk(value, "$", 0);
  return found;
}
function labelsOf(question) {
  const options = question.options;
  if (!Array.isArray(options))
    return [];
  return options.map((option) => String(option?.label ?? "")).filter((label) => label !== "");
}
function validateQuestion(question) {
  if (!isPlainObject(question))
    return check([problem("kind-payload", "a question payload must be an object")]);
  const problems = [];
  for (const path of findIndexFields(question)) {
    problems.push(problem("index-field", "an index-shaped field is forbidden in a mail payload: " + path));
  }
  if (typeof question.questionId !== "string" || question.questionId.trim() === "") {
    problems.push(problem("question-id", "a question must carry a non-empty `questionId`; every answer copies it"));
  }
  const options = question.options;
  if (!Array.isArray(options) || options.length === 0) {
    problems.push(problem("question-empty", "a question must offer at least one option"));
  }
  const labels = [];
  if (Array.isArray(options)) {
    options.forEach((option, index) => {
      const label = option?.label;
      if (typeof label !== "string" || label.trim() === "") {
        problems.push(problem("option-label", "option " + String(index + 1) + " has an empty label"));
        return;
      }
      if (labels.includes(label)) {
        problems.push(problem("option-label", "duplicate option label: " + JSON.stringify(label) + " — labels must be unique within a question"));
        return;
      }
      labels.push(label);
    });
  }
  if (typeof question.question !== "string" || question.question.trim() === "") {
    problems.push(problem("question-empty", "the question text is empty"));
  }
  return check(problems);
}
function validateAnswer(answer, question) {
  if (!isPlainObject(answer))
    return check([problem("kind-payload", "an answer payload must be an object")]);
  const problems = [];
  for (const path of findIndexFields(answer)) {
    problems.push(problem("index-field", "an index-shaped field is forbidden in a mail payload: " + path));
  }
  if (typeof answer.questionId !== "string" || answer.questionId.trim() === "") {
    problems.push(problem("answer-question-id", "an answer must carry the question's non-empty `questionId`"));
  }
  const selected = answer.selected;
  const selectedIsArray = Array.isArray(selected);
  if (!selectedIsArray) {
    problems.push(problem("answer-selection", "`selected` must be an array of offered label strings"));
  }
  const picked = [];
  if (selectedIsArray) {
    selected.forEach((entry, index) => {
      if (typeof entry !== "string" || entry.trim() === "") {
        problems.push(problem("answer-selection", "selected entry " + String(index + 1) + " is not a non-empty label string"));
        return;
      }
      picked.push(entry);
    });
  }
  const custom = answer.custom;
  if (custom !== undefined && (typeof custom !== "string" || custom.trim() === "")) {
    problems.push(problem("answer-selection", "`custom`, when present, must be non-empty text"));
  }
  if (typeof answer.answerTo !== "string" || answer.answerTo.trim() === "") {
    problems.push(problem("reference-unknown", "an answer must name the question message it answers (`answerTo`)"));
  }
  const hasCustom = typeof custom === "string" && custom.trim() !== "";
  if (question === undefined) {
    if (selectedIsArray && picked.length === 0 && !hasCustom) {
      problems.push(problem("answer-selection", "an answer must select at least one offered label or give `custom`"));
    }
    return check(problems);
  }
  const offered = labelsOf(question);
  for (const label of picked) {
    if (!offered.includes(label)) {
      problems.push(problem("answer-unknown-label", "selected label is not offered by the question: " + JSON.stringify(label), offered));
    }
  }
  if (typeof question.questionId !== "string" || question.questionId.trim() === "") {
    problems.push(problem("question-id", "the referenced question has an empty `questionId`, so no answer can be correlated"));
  } else if (typeof answer.questionId === "string" && answer.questionId.trim() !== "" && answer.questionId !== question.questionId) {
    problems.push(problem("answer-question-id", "`questionId` " + JSON.stringify(answer.questionId) + " does not match the referenced question's `questionId` " + JSON.stringify(question.questionId)));
  }
  if (selectedIsArray) {
    if (question.multiSelect === true) {
      if (picked.length < 1) {
        problems.push(problem("answer-selection", "a multi-select answer must select at least one offered label"));
      }
    } else if (picked.length > 1) {
      problems.push(problem("answer-selection", "a single-select answer must select exactly one label; got " + String(picked.length)));
    } else if (picked.length === 1) {
      if (hasCustom) {
        problems.push(problem("answer-selection", "a single-select answer must not combine a selected label with `custom`; give exactly one or the other"));
      }
    } else if (!hasCustom) {
      problems.push(problem("answer-selection", "a single-select answer must select exactly one label or give `custom`"));
    }
  }
  return check(problems);
}
function validateEnvelope(envelope) {
  if (!isPlainObject(envelope))
    return check([problem("envelope", "a mail envelope must be an object")]);
  const problems = [];
  for (const path of findIndexFields(envelope)) {
    problems.push(problem("index-field", "an index-shaped field is forbidden in a mail payload: " + path));
  }
  if (!isMailKind(envelope.kind)) {
    problems.push(problem("kind-payload", "`kind` must be `message`, `question` or `answer`; got " + JSON.stringify(envelope.kind)));
    return check(problems);
  }
  if (envelope.kind === "message") {
    if (envelope.question !== undefined)
      problems.push(problem("kind-payload", "a `message` row must not carry a question payload"));
    if (envelope.answer !== undefined)
      problems.push(problem("kind-payload", "a `message` row must not carry an answer payload"));
  } else if (envelope.kind === "question") {
    if (envelope.question === undefined)
      problems.push(problem("kind-payload", "a `question` row must carry its question payload"));
    else
      appendProblems(problems, validateQuestion(envelope.question));
    if (envelope.answer !== undefined)
      problems.push(problem("kind-payload", "a `question` row must not carry an answer payload"));
  } else {
    if (envelope.answer === undefined)
      problems.push(problem("kind-payload", "an `answer` row must carry its answer payload"));
    else
      appendProblems(problems, validateAnswer(envelope.answer));
    if (envelope.question !== undefined)
      problems.push(problem("kind-payload", "an `answer` row must not carry a question payload"));
  }
  return check(problems);
}
function validateReferences(envelope, messages) {
  const problems = [];
  const byId = new Map(messages.map((message) => [message.id, message]));
  if (envelope.replyTo !== undefined) {
    if (typeof envelope.replyTo !== "string" || !byId.has(envelope.replyTo)) {
      problems.push(problem("reference-unknown", "`replyTo` names no message in this mailbox: " + JSON.stringify(envelope.replyTo)));
    }
  }
  if (envelope.kind === "answer" && envelope.answer !== undefined) {
    const target = byId.get(envelope.answer.answerTo);
    if (target === undefined) {
      problems.push(problem("reference-unknown", "`answerTo` names no message in this mailbox: " + JSON.stringify(envelope.answer.answerTo)));
    } else if (target.kind !== "question") {
      problems.push(problem("reference-not-question", "`answerTo` must name a `question` row; " + target.id + " is a `" + target.kind + "` row"));
    } else if (target.question !== undefined) {
      appendProblems(problems, validateAnswer(envelope.answer, target.question));
    } else {
      problems.push(problem("question-payload-missing", "the referenced `question` row " + target.id + " carries no question payload, so its offered labels cannot be checked"));
      appendProblems(problems, validateAnswer(envelope.answer));
    }
  }
  return check(problems);
}
function inheritedThreadId(envelope, byId) {
  if (typeof envelope.threadId === "string" && envelope.threadId !== "")
    return envelope.threadId;
  if (typeof envelope.replyTo === "string" && envelope.replyTo !== "")
    return byId.get(envelope.replyTo)?.threadId;
  return;
}
function fanOutTargets(senderId, targets) {
  const out = [];
  const seen = new Set;
  for (const target of targets) {
    if (target.id === "" || target.id === senderId || seen.has(target.id))
      continue;
    seen.add(target.id);
    out.push({ id: target.id, name: target.name });
  }
  return out;
}
function ordinalPrefix(index) {
  if (Number.isInteger(index) && index >= 0 && index < 26)
    return String.fromCharCode(65 + index) + ".";
  return String(Number.isFinite(index) ? index + 1 : 1) + ")";
}
function withOrdinal(index, text) {
  return ordinalPrefix(index) + " " + text;
}
// packages/mpd-mail-protocol/src/fold.ts
function isPlainObject2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function textOf(value) {
  if (typeof value === "string")
    return value;
  return value === undefined || value === null ? "" : String(value);
}
function objectOf(value) {
  return isPlainObject2(value) ? value : undefined;
}
function foldSend(state, record, line) {
  const id = record.id;
  if (typeof id !== "string" || id === "") {
    state.problems.push("line " + String(line) + ": a `send` row has no id, skipped");
    return;
  }
  if (state.byId.has(id)) {
    state.problems.push("line " + String(line) + ": duplicate `send` id " + JSON.stringify(id) + "; the FIRST write wins and this row is ignored");
    return;
  }
  const kindValue = record.kind;
  const kind = isMailKind(kindValue) ? kindValue : "message";
  if (kindValue !== undefined && !isMailKind(kindValue)) {
    state.problems.push("line " + String(line) + ": unknown kind " + JSON.stringify(kindValue) + ", folded as `message`");
  }
  const replyTo = typeof record.replyTo === "string" && record.replyTo !== "" ? record.replyTo : undefined;
  const statedThread = typeof record.threadId === "string" && record.threadId !== "" ? record.threadId : undefined;
  let question = objectOf(record.question);
  let answer = objectOf(record.answer);
  if (kind === "question" && question === undefined) {
    state.problems.push("line " + String(line) + ": a `question` row has no question payload");
  }
  if (kind === "answer" && answer === undefined) {
    state.problems.push("line " + String(line) + ": an `answer` row has no answer payload");
  }
  if (kind !== "question" && question !== undefined) {
    state.problems.push("line " + String(line) + ": a `" + kind + "` row carries a question payload, dropped");
    question = undefined;
  }
  if (kind !== "answer" && answer !== undefined) {
    state.problems.push("line " + String(line) + ": a `" + kind + "` row carries an answer payload, dropped");
    answer = undefined;
  }
  if (replyTo !== undefined && !state.byId.has(replyTo)) {
    state.problems.push("line " + String(line) + ": `replyTo` " + JSON.stringify(replyTo) + " names no folded message; the reply re-roots on its own id");
  }
  if (statedThread !== undefined && statedThread !== id && !state.byId.has(statedThread)) {
    state.problems.push("line " + String(line) + ": explicit `threadId` " + JSON.stringify(statedThread) + " names no folded message; kept as declared");
  }
  const inherited = inheritedThreadId({
    kind,
    ...replyTo === undefined ? {} : { replyTo },
    ...statedThread === undefined ? {} : { threadId: statedThread }
  }, state.byId);
  const message = {
    id,
    kind,
    fromId: textOf(record.fromId),
    fromName: textOf(record.fromName),
    toId: textOf(record.toId),
    toName: textOf(record.toName),
    subject: textOf(record.subject),
    body: textOf(record.body),
    sentAt: textOf(record.at),
    threadId: inherited ?? id,
    ...typeof record.teamId === "string" && record.teamId !== "" ? { teamId: record.teamId } : {},
    ...replyTo === undefined ? {} : { replyTo },
    ...question === undefined ? {} : { question },
    ...answer === undefined ? {} : { answer }
  };
  state.byId.set(id, message);
}
function foldStateRecord(state, record, line) {
  const id = record.id;
  if (typeof id !== "string" || id === "") {
    state.problems.push("line " + String(line) + ": a `" + String(record.t) + "` row has no id, skipped");
    return;
  }
  const message = state.byId.get(id);
  if (message === undefined) {
    state.problems.push("line " + String(line) + ": a `" + String(record.t) + "` row references unfolded message " + JSON.stringify(id));
    return;
  }
  if (record.t === "delivered") {
    message.deliveredAt = textOf(record.at);
    return;
  }
  message.readAt = textOf(record.at);
  const by = record.by;
  if (typeof by === "string" && by !== "")
    message.readBy = by;
}
function foldMail(records) {
  const state = { byId: new Map, problems: [] };
  records.forEach((raw, index) => {
    if (!isPlainObject2(raw)) {
      state.problems.push("line " + String(index + 1) + ": not a JSON object, skipped");
      return;
    }
    if (raw.t === "send") {
      foldSend(state, raw, index + 1);
      return;
    }
    if (raw.t === "delivered" || raw.t === "read") {
      foldStateRecord(state, raw, index + 1);
      return;
    }
  });
  return { messages: [...state.byId.values()], problems: state.problems };
}
export {
  INDEX_FIELD_NAMES,
  MAIL_KINDS,
  MAIL_PAYLOADS_CARRY_NO_INDEX,
  fanOutTargets,
  findIndexFields,
  foldMail,
  inheritedThreadId,
  isMailKind,
  labelsOf,
  ordinalPrefix,
  validateAnswer,
  validateEnvelope,
  validateQuestion,
  validateReferences,
  withOrdinal
};
