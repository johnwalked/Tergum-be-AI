export interface SpeakerProfile {
  id: string;
  name: string;
  voiceName: string; // Gemini voice name
  color: string;
}

export interface DubbingSegment {
  id: string;
  startTime: number;
  endTime: number;
  speakerId: string;
  originalText: string;
  translatedText: string;
  status?: 'pending' | 'generating' | 'complete' | 'error';
}

export enum ProcessingStatus {
  IDLE = 'IDLE',
  UPLOADING = 'UPLOADING',
  ANALYZING = 'ANALYZING',
  GENERATING = 'GENERATING',
  COMPLETE = 'COMPLETE',
  ERROR = 'ERROR'
}

export interface SpeakerAnalysis {
  id: string; // Matches speakerId in segments
  gender: 'Male' | 'Female';
  ageRange?: 'Child' | 'Young Adult' | 'Adult' | 'Elderly';
  voiceQuality: string; // Free text description: e.g., "Deep, raspy, authoritative"
  mood?: string;
  assignedVoice?: string; // The Gemini voice name selected
}

export interface VideoAnalysisResult {
  segments: DubbingSegment[];
  detectedLanguage: string;
  summary: string;
  speakers: SpeakerAnalysis[];
}

export interface ClonedVoice {
    id: string;
    name: string;
    baseVoice: string; // The Gemini voice it maps to
    gender: 'Male' | 'Female';
    characteristics: string;
}