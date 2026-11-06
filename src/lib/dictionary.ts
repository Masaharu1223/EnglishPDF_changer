// 英単語のトークンから辞書検索用の語形を取り出し、Oxford Learner's Dictionaries を開く。

const OXFORD_DICTIONARY_BASE_URL =
  "https://www.oxfordlearnersdictionaries.com/definition/english/";

// 引数: 空白区切りのトークン / 返り値: 前後の句読点・記号を取り除いた語(内部のアポストロフィは残す)
export function extractDictionaryWord(token: string): string {
  return token.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, "");
}

// 引数: 空白区切りのトークン / 返り値: なし(辞書ページを新しいタブで開く。語が空なら何もしない)
export function openInOxfordDictionary(token: string) {
  const word = extractDictionaryWord(token);
  if (!word) return;
  const url = `${OXFORD_DICTIONARY_BASE_URL}${encodeURIComponent(word.toLowerCase())}`;
  window.open(url, "_blank");
}
