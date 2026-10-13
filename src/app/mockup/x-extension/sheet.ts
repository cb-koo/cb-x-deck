// Text-preserving sheet helpers adapted from the approved cb_x_extension mockup.
import type { Person } from './model';

export const reservationForm = [
  'ご予約のため、以下の内容をご記入ください。',
  '',
  '1. ご希望日時（韓国時間）：',
  '2. 初診／再診：',
  '3. お名前（ハングル／ローマ字）：',
  '4. 性別：',
  '5. 生年月日（YYYY-MM-DD）：',
  '6. 韓国語での会話：可能／難しい',
  '7. ご希望の施術内容：',
  '',
  '※こちらは予約リクエストです。クリニックとの調整後に予約が確定します。',
].join('\n');

type ClientSheetFields = {
  preferred?: string;
  visitType?: string;
  name?: string;
  gender?: string;
  birthDate?: string;
  koreanAbility?: string;
  treatment?: string;
  preferred2?: string;
  note?: string;
};

export function createClientSheet(person: Pick<Person, 'handle'>, fields: ClientSheetFields = {}): string {
  const handle = person.handle.trim().replace(/^@+/, '');
  const value = (text?: string) => text?.trim() || '-';
  const date = (text?: string) => value(text).replace('T', ' ');
  const lines = [
    `@${handle}`,
    `https://x.com/${encodeURIComponent(handle)}?s=20`,
    '',
    `1. 희망 일시: ${date(fields.preferred)}`,
    `2. 초진/재진: ${value(fields.visitType)}`,
    `3. 이름(한글/로마자): ${value(fields.name)}`,
    `4. 성별: ${value(fields.gender)}`,
    `5. 생년월일: ${value(fields.birthDate)}`,
    `6. 한국어 가능 여부: ${value(fields.koreanAbility)}`,
    `7. 희망 시술 내용: ${value(fields.treatment)}`,
  ];
  let nextNumber = 8;
  if (fields.preferred2?.trim()) lines.push(`${nextNumber++}. 제2희망 일시: ${date(fields.preferred2)}`);
  if (fields.note?.trim()) lines.push(`${nextNumber}. 메모: ${fields.note}`);
  return lines.join('\n');
}

function validDateTime(text: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(text);
  if (!match) return '';
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const [year, month, day, hour, minute] = [yearText, monthText, dayText, hourText, minuteText].map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > monthDays[month - 1] ||
    hour > 23 ||
    minute > 59
  )
    return '';
  return `${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}`;
}

export function readClientSheet(text: string): {
  name: string;
  treatment: string;
  preferred: string;
  preferred2: string;
} {
  const values = new Map<string, string>();
  for (const line of text.split(/\r\n|\r|\n/)) {
    const match = /^\s*(?:\d+\s*[.)]\s*|[-•·]\s*)?([^:：]+)[:：]\s*(.*)$/.exec(line);
    if (!match) continue;
    const label = match[1].replace(/\s+/g, '');
    const value = match[2].trim();
    values.set(label, /^(?:-|미입력|미등록)?$/.test(value) ? '' : value);
  }
  const find = (...labels: string[]) => {
    for (const label of labels) if (values.has(label)) return values.get(label)!;
    return '';
  };
  return {
    name: find('이름(한글/로마자)', '이름', '예약자'),
    treatment: find('희망시술내용', '희망시술', '시술'),
    preferred: validDateTime(find('희망일시', '제1희망일시', '제1희망', '1순위')),
    preferred2: validDateTime(find('제2희망일시', '제2희망', '2순위')),
  };
}

export type ClientSheetEditFields = {
  handle: string;
  profileUrl: string;
  preferred: string;
  visitType: string;
  name: string;
  gender: string;
  birthDate: string;
  koreanAbility: string;
  treatment: string;
  preferred2: string;
  uploadDeadline: string;
};

export type ReservationNameParts = { korean: string; roman: string };
export function splitReservationName(value: string): ReservationNameParts {
  const text = value.trim();
  const pair = /^(.*?)\s*[（(]([^()（）]*)[)）]$/.exec(text);
  const hasKorean = (name: string) => /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(name);
  if (pair) {
    const outside = pair[1].trim(),
      inside = pair[2].trim();
    return !hasKorean(outside) && hasKorean(inside)
      ? { korean: inside, roman: outside }
      : { korean: outside, roman: inside };
  }
  return !hasKorean(text) && /[A-Za-z]/.test(text)
    ? { korean: '', roman: text }
    : { korean: text, roman: '' };
}
export function formatReservationName({ korean, roman }: ReservationNameParts): string {
  const ko = korean.trim(),
    latin = roman.trim();
  return ko && latin ? `${ko}(${latin})` : ko || latin;
}

const inputDefinitions = {
  handle: { prefix: '', aliases: ['계정', '계정명', 'X계정', '핸들'] },
  profileUrl: { prefix: '', aliases: ['프로필URL', '프로필링크', 'X프로필', 'URL'] },
  preferred: { prefix: '1. 희망 일시: ', aliases: ['희망일시', '제1희망일시', '제1희망', '1순위'] },
  visitType: { prefix: '2. 초진/재진: ', aliases: ['초진/재진', '초진／재진', '초진여부'] },
  name: { prefix: '3. 이름(한글/로마자): ', aliases: ['이름(한글/로마자)', '이름', '예약자'] },
  gender: { prefix: '4. 성별: ', aliases: ['성별'] },
  birthDate: { prefix: '5. 생년월일: ', aliases: ['생년월일', '생년월일(YYYY-MM-DD)'] },
  koreanAbility: { prefix: '6. 한국어 가능 여부: ', aliases: ['한국어가능여부', '한국어회화', '한국어'] },
  treatment: { prefix: '7. 희망 시술 내용: ', aliases: ['희망시술내용', '희망시술', '시술'] },
  preferred2: { prefix: '8. 제2희망 일시: ', aliases: ['제2희망일시', '제2희망', '2순위'] },
  uploadDeadline: {
    prefix: '업로드 기한: ',
    aliases: ['업로드기한', '게시예정일', '게시예정일(업로드기한)'],
  },
} satisfies Record<keyof ClientSheetEditFields, { prefix: string; aliases: string[] }>;

type InputLine = { index: number; prefix: string; value: string; suffix: string };

function findInputLine(parts: string[], key: keyof ClientSheetEditFields): InputLine | undefined {
  // Keep every separator outside the editable value, including full-width colons.
  for (const alias of inputDefinitions[key].aliases) {
    for (let index = parts.length - 1; index >= 0; index -= 2) {
      const match = /^([ \t]*(?:\d+[ \t]*[.)][ \t]*|[-•·][ \t]*)?([^:：]+)[:：][ \t]*)(.*?)([ \t]*)$/.exec(
        parts[index],
      );
      if (match && match[2].replace(/\s+/g, '') === alias) {
        return { index, prefix: match[1], value: match[3], suffix: match[4] };
      }
    }
  }
  if (key !== 'handle' && key !== 'profileUrl') return undefined;

  let handleLine: InputLine | undefined;
  for (let index = 0; index < parts.length; index += 2) {
    const handle = /^([ \t]*)(@\S*)([ \t]*)$/.exec(parts[index]);
    if (handle) {
      handleLine = { index, prefix: handle[1], value: handle[2], suffix: handle[3] };
      break;
    }
  }
  if (key === 'handle') return handleLine;
  for (let index = 0; index < parts.length; index += 2) {
    // URLs in a later memo are not the account's profile URL.
    if (/^[ \t]*\d+[ \t]*[.)]/.test(parts[index])) break;
    const url = /^([ \t]*)(https?:\/\/\S+)([ \t]*)$/i.exec(parts[index]);
    if (url) return { index, prefix: url[1], value: url[2], suffix: url[3] };
  }
  // A URL can be temporarily empty or invalid while being typed. Keep its
  // existing header slot addressable instead of appending duplicate URL lines.
  const index = handleLine ? handleLine.index + 2 : -1;
  if (index >= 0 && index < parts.length && !/^[ \t]*\d+[ \t]*[.)]/.test(parts[index])) {
    const match = /^([ \t]*)(.*?)([ \t]*)$/.exec(parts[index])!;
    return { index, prefix: match[1], value: match[2], suffix: match[3] };
  }
  return undefined;
}

function inputValue(value: string, key: keyof ClientSheetEditFields): string {
  const text = value.trim();
  if (/^(?:-|미입력|미등록)?$/.test(text)) return '';
  if (key === 'preferred' || key === 'preferred2') return validDateTime(text) || text;
  if (key === 'handle') return text.replace(/^@+/, '') ? `@${text.replace(/^@+/, '')}` : '';
  return text;
}

export function readClientSheetInputs(text: string): ClientSheetEditFields {
  const parts = text.split(/(\r\n|\n|\r)/);
  const fields: ClientSheetEditFields = {
    handle: '',
    profileUrl: '',
    preferred: '',
    visitType: '',
    name: '',
    gender: '',
    birthDate: '',
    koreanAbility: '',
    treatment: '',
    preferred2: '',
    uploadDeadline: '',
  };
  for (const key of Object.keys(fields) as (keyof ClientSheetEditFields)[]) {
    fields[key] = inputValue(findInputLine(parts, key)?.value ?? '', key);
  }
  return fields;
}

export function updateClientSheetInput(
  text: string,
  key: keyof ClientSheetEditFields,
  value: string,
): string {
  const parts = text.split(/(\r\n|\n|\r)/);
  const line = findInputLine(parts, key);
  // Input date normalization and placeholder display must not rewrite the sheet.
  if (inputValue(line?.value ?? '', key) === inputValue(value, key)) return text;
  let nextValue = value;
  if (key === 'handle') nextValue = `@${value.trim().replace(/^@+/, '')}`;
  if (key === 'preferred' || key === 'preferred2') {
    nextValue = value.replace(/^(\d{4}-\d{2}-\d{2})T(?=\d{2}:\d{2})/, '$1 ');
  }
  if (line) {
    parts[line.index] = `${line.prefix}${nextValue}${line.suffix}`;
    return parts.join('');
  }
  const newline = parts.find((_, index) => index % 2 === 1) ?? '\n';
  const newLine = `${inputDefinitions[key].prefix}${nextValue}`;
  if (!text) return newLine;
  if (key === 'handle') return `${newLine}${newline}${text}`;
  if (key === 'profileUrl') {
    const handle = findInputLine(parts, 'handle');
    if (!handle) return `${newLine}${newline}${text}`;
    const before = parts.slice(0, handle.index + 1).join('');
    const after = parts.slice(handle.index + 2).join('');
    const separator = parts[handle.index + 1] ?? newline;
    return `${before}${separator}${newLine}${parts[handle.index + 1] !== undefined ? separator : ''}${after}`;
  }
  return `${text}${/[\r\n]$/.test(text) ? '' : newline}${newLine}`;
}
