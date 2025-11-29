import { GoogleGenAI, Modality, LiveServerMessage, GenerateContentResponse } from "@google/genai";
import { VideoAnalysisResult, SpeakerAnalysis, DubbingSegment } from "../types";

// Helper to safely access environment variable without crashing if process is undefined
const getEnvApiKey = (): string | undefined => {
    try {
        if (typeof process !== 'undefined' && process.env?.API_KEY) {
            return process.env.API_KEY;
        }
    } catch (e) {
        // process is not defined, ignore
    }
    return undefined;
};

const getClient = () => {
  const apiKey = getEnvApiKey();
  if (!apiKey) {
      console.warn("API Key missing from environment. Functionality may be limited.");
      // We don't throw immediately to allow the UI to render, but calls will fail.
      // In a real env, this would be a hard stop.
  }
  return new GoogleGenAI({ apiKey: apiKey || 'DUMMY_KEY_FOR_BUILD' });
};

const cleanJson = (text: string) => {
  if (!text) return "";
  
  // Find the first '{' or '['
  const startObject = text.indexOf('{');
  const startArray = text.indexOf('[');
  
  let start = -1;
  let end = -1;
  
  // Determine if it's likely an object or an array based on which comes first
  if (startObject !== -1 && (startArray === -1 || startObject < startArray)) {
      start = startObject;
      end = text.lastIndexOf('}');
  } else if (startArray !== -1) {
      start = startArray;
      end = text.lastIndexOf(']');
  }

  if (start !== -1 && end !== -1 && end > start) {
      return text.substring(start, end + 1);
  }
  
  // Fallback: aggressive markdown stripping
  return text.replace(/```json/gi, '').replace(/```/g, '').trim();
};

const writeString = (view: DataView, offset: number, string: string) => {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
};

const parseTime = (time: any): number => {
    if (typeof time === 'number') return time;
    if (typeof time === 'string') {
        // Handle "01:23" or "00:01:23"
        if (time.includes(':')) {
            const parts = time.split(':').map(Number);
            if (parts.length === 2) return parts[0] * 60 + parts[1];
            if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        }
        return parseFloat(time);
    }
    return 0;
};

// --- Voice Library & Matching Logic ---

const VOICE_DEFINITIONS = [
    { name: 'Charon', gender: 'Male', tags: ['deep', 'authoritative', 'older', 'villain', 'serious'] },
    { name: 'Fenrir', gender: 'Male', tags: ['gravelly', 'intense', 'angry', 'strong'] },
    { name: 'Puck', gender: 'Male', tags: ['soft', 'playful', 'young', 'mid-range', 'casual'] },
    { name: 'Orpheus', gender: 'Male', tags: ['confident', 'energetic', 'narrator', 'clear'] },
    { name: 'Kore', gender: 'Female', tags: ['soothing', 'mid-range', 'motherly', 'calm'] },
    { name: 'Zephyr', gender: 'Female', tags: ['soft', 'whispery', 'gentle', 'shy'] },
    { name: 'Aoede', gender: 'Female', tags: ['energetic', 'high-pitched', 'young', 'confident'] },
    { name: 'Leda', gender: 'Female', tags: ['sophisticated', 'older', 'elegant', 'deep'] }
];

const matchVoiceToPersona = (speaker: SpeakerAnalysis): string => {
    if (speaker.assignedVoice) return speaker.assignedVoice;

    let bestMatch = 'Kore'; // Default
    let maxScore = -1;

    // Normalize input traits
    const traits = [
        speaker.voiceQuality, 
        speaker.mood, 
        speaker.ageRange
    ].join(' ').toLowerCase();

    VOICE_DEFINITIONS.filter(v => v.gender === speaker.gender).forEach(voice => {
        let score = 0;
        voice.tags.forEach(tag => {
            if (traits.includes(tag)) score += 2;
        });
        
        // Age heuristics
        if (speaker.ageRange === 'Elderly' && (voice.name === 'Charon' || voice.name === 'Leda')) score += 3;
        if (speaker.ageRange === 'Child' && (voice.name === 'Puck' || voice.name === 'Aoede')) score += 3;

        if (score > maxScore) {
            maxScore = score;
            bestMatch = voice.name;
        }
    });

    return bestMatch;
};

export const checkApiConnection = async (): Promise<boolean> => {
  try {
    const ai = getClient();
    await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: "ping",
    });
    return true;
  } catch (e) {
    console.error("API Connection Check Failed:", e);
    return false;
  }
};

const pcmToWav = (pcmData: Uint8Array, sampleRate: number): Blob => {
    // Ensure even byte length for 16-bit PCM
    if (pcmData.length % 2 !== 0) {
        const padded = new Uint8Array(pcmData.length + 1);
        padded.set(pcmData);
        pcmData = padded;
    }

    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const subChunk2Size = pcmData.length;
    const chunkSize = 36 + subChunk2Size;

    const buffer = new ArrayBuffer(44 + subChunk2Size);
    const view = new DataView(buffer);
    
    // RIFF Chunk
    writeString(view, 0, 'RIFF'); 
    view.setUint32(4, chunkSize, true); 
    writeString(view, 8, 'WAVE');
    
    // fmt Chunk
    writeString(view, 12, 'fmt '); 
    view.setUint32(16, 16, true); // Subchunk1Size
    view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
    view.setUint16(22, numChannels, true); // NumChannels
    view.setUint32(24, sampleRate, true); // SampleRate
    view.setUint32(28, byteRate, true); // ByteRate
    view.setUint16(32, blockAlign, true); // BlockAlign
    view.setUint16(34, bitsPerSample, true); // BitsPerSample
    
    // data Chunk
    writeString(view, 36, 'data'); 
    view.setUint32(40, subChunk2Size, true);
    new Uint8Array(buffer, 44).set(pcmData);
    
    return new Blob([buffer], { type: 'audio/wav' });
};

const createSilentWav = (durationSeconds: number): Blob => {
    const sampleRate = 24000;
    const numSamples = Math.floor(sampleRate * durationSeconds);
    const numChannels = 1;
    // 2 bytes per sample (16-bit)
    const byteLength = numSamples * 2; 
    const buffer = new Uint8Array(byteLength).fill(0); // Silence is 0
    return pcmToWav(buffer, sampleRate);
};

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
        promise.then(res => { clearTimeout(timer); resolve(res); }, err => { clearTimeout(timer); reject(err); });
    });
};

const retryWithBackoff = async <T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> => {
  try { return await fn(); } 
  catch (error: any) {
    if (retries === 0) throw error;
    console.warn(`Retry attempt left: ${retries}. Error: ${error.message}`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    return retryWithBackoff(fn, retries - 1, delay * 2); // Exponential backoff
  }
};

// --- Core Features ---

export const analyzeVoiceSample = async (audioBase64: string, mimeType: string): Promise<SpeakerAnalysis> => {
    const ai = getClient();
    const response = await ai.models.generateContent({
        model: "gemini-3-pro-preview",
        contents: {
            parts: [{ inlineData: { mimeType, data: audioBase64 } }, { text: `Analyze gender (Male/Female) and voice quality. Return JSON: {"id":"cloned","gender":"Male","voiceQuality":"string"}` }]
        },
        config: { responseMimeType: "application/json" }
    });
    try { return JSON.parse(cleanJson(response.text || "{}")); } 
    catch { return { id: "cloned_fallback", gender: "Male", voiceQuality: "Mid-range" }; }
};

export const analyzeVideoForDubbing = async (videoBase64: string, mimeType: string): Promise<VideoAnalysisResult> => {
  return retryWithBackoff(async () => {
    const ai = getClient();
    return withTimeout((async () => {
      const prompt = `
        You are a Professional Dubbing Director using Gemini 3 Vision.
        Task: Analyze the video to create a precise dubbing script and detailed character profiles.

        CRITICAL INSTRUCTIONS FOR PERSON DETECTION:
        1. **Deep Character Analysis**: For every unique speaker, deduce:
           - 'gender': Male/Female
           - 'ageRange': Child, Young Adult, Adult, Elderly
           - 'voiceQuality': Describe their likely voice based on appearance/expression (e.g., "Deep, raspy, authoritative" or "High, energetic, nervous").
           - 'mood': Current emotional state (e.g., "Angry", "Calm", "Joyful").
        2. **VISUAL MOUTH TRACKING**: Set 'startTime' and 'endTime' strictly based on when lips move.
        3. **SEGMENTATION**: Combine fluid sentences. Max segment 7s.
        
        Return valid JSON:
        {
          "detectedLanguage": "string",
          "summary": "string",
          "speakers": [{ "id": "spk_1", "gender": "Male", "ageRange": "Adult", "voiceQuality": "Deep authoritative", "mood": "Serious" }],
          "segments": [
            { "startTime": 0.0, "endTime": 0.0, "speakerId": "spk_1", "originalText": "Full sentence." }
          ]
        }
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-pro-preview",
        contents: { parts: [{ inlineData: { mimeType, data: videoBase64 } }, { text: prompt }] },
        config: { responseMimeType: "application/json" },
      });

      const result = JSON.parse(cleanJson(response.text || "{}")) as VideoAnalysisResult;
      if (!result.segments) result.segments = [];
      
      // Post-process segments
      result.segments = result.segments.map((s, i) => ({ 
          ...s, 
          id: s.id || `s_${i}`,
          startTime: parseTime(s.startTime),
          endTime: parseTime(s.endTime)
      }));
      result.segments.sort((a, b) => a.startTime - b.startTime);

      // Post-process speakers with Voice Matching
      if (result.speakers) {
          result.speakers = result.speakers.map(spk => ({
              ...spk,
              assignedVoice: matchVoiceToPersona(spk)
          }));
      }
      
      return result;
    })(), 300000); // Increased timeout for deep analysis (5 mins)
  });
};

export const translateAndRefineScript = async (segments: DubbingSegment[], targetLanguage: string, contextSummary: string = ""): Promise<DubbingSegment[]> => {
    if (!segments.length) return [];
    const ai = getClient();
    
    // Create a payload that includes duration constraints for the model to reason about
    const payload = segments.map(s => ({
        id: s.id,
        text: s.originalText,
        duration: (s.endTime - s.startTime).toFixed(2),
        speaker: s.speakerId
    }));

    // Gemini 3 Context-Aware Dubbing Prompt
    const prompt = `
        You are a World-Class Dubbing Adaptor using Gemini 3.
        Task: Translate the following subtitle segments into **Natural, Expressive, Lip-Syncable ${targetLanguage}**.
        
        VIDEO CONTEXT: "${contextSummary}"

        CRITICAL DUBBING RULES:
        1. **Completeness & Expression**: Include *everything* the speaker implies. If they laugh, sigh, or exclaim, include those nuances in the text representation.
        2. **Rhythmic Matching**: The translated text MUST approximate the **syllable count** and **duration** of the original text. This is crucial for seamless lip-sync.
        3. **EXTREME COMPRESSION**: ${targetLanguage} text can be longer. You MUST use **concise synonyms** to fit the time slot. Avoid translating word-for-word if it makes the sentence too long.
        4. **Timing**: If the original slot is short (e.g., < 2s), use short interjections or very brief phrases.
        
        Input Segments:
        ${JSON.stringify(payload)}

        Return strict JSON Array: [{ "id": "string", "translatedText": "string" }]
    `;

    try {
        const response = await ai.models.generateContent({
            model: "gemini-3-pro-preview",
            contents: prompt,
            config: { responseMimeType: "application/json" }
        });
        
        const translatedMap = new Map();
        const rawResponse = JSON.parse(cleanJson(response.text || "[]"));
        
        if (Array.isArray(rawResponse)) {
            rawResponse.forEach((item: any) => {
                if (item.id && item.translatedText) {
                    translatedMap.set(item.id, item.translatedText);
                }
            });
            
            return segments.map(s => ({
                ...s,
                translatedText: translatedMap.get(s.id) || s.originalText // Fallback to original if translation missing
            }));
        }
    } catch (e) { console.error("Translation Refinement Failed:", e); }
    
    // Fallback: Return original segments if AI fails
    return segments.map(s => ({ ...s, translatedText: s.originalText }));
};

export const generateSpeechTTS = async (text: string, voiceName: string): Promise<Blob | null> => {
  const ai = getClient();

  // Clean text but allow punctuation for prosody and expressions
  let cleanText = text.replace(/[\(\[].*?[\)\]]/g, '') 
                      .replace(/\s+/g, ' ')
                      .trim();

  // If text is empty or lacks substantial content, skip generation
  if (!cleanText || !/[\p{L}\p{N}]/u.test(cleanText)) {
      return null;
  }

  // Cap length
  if (cleanText.length > 500) cleanText = cleanText.substring(0, 500);

  const runGen = async (input: string) => {
      // Use 'gemini-2.5-flash-preview-tts' specifically for TTS
      const response = await withTimeout(ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: input }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
        },
      }), 20000) as GenerateContentResponse;

      const candidate = response.candidates?.[0];
      if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
          if (candidate.finishReason === 'SAFETY') throw new Error("Blocked by Safety Filters");
          console.warn(`TTS Finish Reason: ${candidate.finishReason}`);
      }

      let base64Audio = '';
      for (const part of candidate?.content?.parts || []) {
          if (part.inlineData?.data) { base64Audio = part.inlineData.data; break; }
      }
      
      if (!base64Audio) throw new Error("No audio returned from API");

      const binary = atob(base64Audio);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);

      // Verify length is even (16-bit PCM)
      let pcm = bytes;
      
      // Wrap raw PCM in WAV container (24kHz Mono)
      return pcmToWav(pcm, 24000);
  };

  try {
      return await retryWithBackoff(() => runGen(cleanText), 3, 2000);
  } catch (error: any) {
      console.warn("TTS Failed:", error.message);
      // Generate silent fallback to prevent workflow blocking
      try {
           return createSilentWav(2.0); // 2 seconds silence fallback
      } catch (e) {
           console.error("Critical: Silent fallback creation failed");
      }
      return null;
  }
};

export const createLiveSession = async (
    onAudioData: (data: ArrayBuffer) => void,
    onTranscription: (text: string, isUser: boolean) => void,
    onClose: () => void
) => {
    const ai = getClient();
    const inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 16000});
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
            onopen: () => {
                const source = inputAudioContext.createMediaStreamSource(stream);
                const scriptProcessor = inputAudioContext.createScriptProcessor(4096, 1, 1);
                scriptProcessor.onaudioprocess = (e) => {
                    const inputData = e.inputBuffer.getChannelData(0);
                    // Conversion to 16-bit PCM for API
                    const l = inputData.length;
                    const int16 = new Int16Array(l);
                    for (let i = 0; i < l; i++) int16[i] = inputData[i] * 32768;
                    
                    let binary = '';
                    const bytes = new Uint8Array(int16.buffer);
                    const len = bytes.byteLength;
                    for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
                    const base64 = btoa(binary);

                    sessionPromise.then(session => session.sendRealtimeInput({ media: { mimeType: 'audio/pcm;rate=16000', data: base64 } }));
                };
                source.connect(scriptProcessor);
                scriptProcessor.connect(inputAudioContext.destination);
            },
            onmessage: async (message: LiveServerMessage) => {
                const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                if (base64Audio) {
                    const binaryString = atob(base64Audio);
                    const len = binaryString.length;
                    const bytes = new Uint8Array(len);
                    for (let i = 0; i < len; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    onAudioData(bytes.buffer);
                }
                
                if (message.serverContent?.outputTranscription) {
                    onTranscription(message.serverContent.outputTranscription.text, false);
                } else if (message.serverContent?.inputTranscription) {
                    onTranscription(message.serverContent.inputTranscription.text, true);
                }
            },
            onclose: () => onClose(),
            onerror: (e) => { console.error(e); onClose(); }
        },
        config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
            systemInstruction: 'You are a helpful assistant.',
            inputAudioTranscription: {},
            outputAudioTranscription: {},
        }
    });

    const session = await sessionPromise;
    return {
        close: () => {
            session.close();
            stream.getTracks().forEach(t => t.stop());
            inputAudioContext.close();
        }
    };
};