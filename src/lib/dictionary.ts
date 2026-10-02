const OXFORD_DICTIONARY_BASE_URL =
  "https://www.oxfordlearnersdictionaries.com/definition/english/";

/**
 * 空白区切りのトークンから、辞書検索に使う語形だけを取り出す。
 * 前後に付いた句読点・記号(., 、"()! など)を取り除き、
 * 単語内部のアポストロフィ(don't 等)やハイフンはそのまま残す。
 * 例: "Hello," -> "Hello" / "(world)" -> "world" / "don't." -> "don't"
 */
export function extractDictionaryWord(token: string): string {
  return token.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, "");
}

export function openInOxfordDictionary(token: string) {
  const word = extractDictionaryWord(token);
  if (!word) return;
  const url = `${OXFORD_DICTIONARY_BASE_URL}${encodeURIComponent(word.toLowerCase())}`;
  window.open(url, "_blank");
}
