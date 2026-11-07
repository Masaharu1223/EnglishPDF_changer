// ElevenLabs の音声合成APIを呼び、英文を音声(data URL)に変換する。
// APIキーと声は環境変数で指定する。

const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1/text-to-speech";

// 引数: 読み上げるテキスト / 返り値: base64 の音声データ URL(audio/mpeg)
export async function generateSpeech(text: string): Promise<string> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";

  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY is not set");
  }

  const response = await fetch(`${ELEVENLABS_API_URL}/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
  }

  const audioBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(audioBuffer).toString("base64");
  return `data:audio/mpeg;base64,${base64}`;
}
