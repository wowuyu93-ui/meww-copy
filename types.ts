
export interface Message {
  id: string;
  role: 'user' | 'model' | 'system';
  content: string;
  osContent?: string;
  timestamp: number;
  mode?: 'online' | 'offline' | 'theater';
  scenarioId?: string;
  isRecalled?: boolean;
  originalContent?: string;
  quote?: { id: string; content: string; name: string; };
  isHidden?: boolean;
}

export interface MemoryCard {
  id: string;
  location?: string;
  event: string;
  status?: string;
  content: string;
  timestamp: number;
  selected?: boolean;
}

export interface DiaryEntry {
  id: string;
  timestamp: number;
  title: string;
  weather: string;
  mood: string;
  content: string;
  isExpanded?: boolean;
}

export interface PeekReaction {
  charId: string;
  charName: string;
  charAvatar: string;
  comment: string;
  timestamp: number;
}

export interface UserDiaryEntry {
  id: string;
  timestamp: number;
  title: string;
  content: string;
  weather: string;
  mood: string;
  peeks: PeekReaction[];
  isExpanded?: boolean;
}

export interface FurnaceConfig {
  autoEnabled: boolean;
  autoThreshold: number;
  autoScope: number;
  manualScope: number;
}

export interface OfflineConfig {
  systemPrompt: string;
  style: string;
  wordCount: number;
  bgUrl?: string;
  indicatorColor?: string;
}

export interface Scenario {
  id: string;
  title: string;
  description: string;
  systemPrompt: string;
  isConnected: boolean;
  wallpaper?: string;
  contextMemory?: string;
  messages?: Message[];
}

export interface GlobalPersona {
  name: string;
  avatar: string;
  description: string;
  diaries: UserDiaryEntry[];
}

export interface Character {
  id: string;
  name: string;
  remark: string;
  avatar: string;
  description: string;
  personality: string;
  systemPrompt: string;
  osSystemPrompt?: string;
  showOS?: boolean;
  useLocalPersona: boolean;
  userMaskName: string;
  userMaskAvatar?: string;
  userMaskDescription?: string;
  realTimeMode: boolean;
  chatBackground?: string;
  contextMemory: string;
  historyCount: number;
  furnaceConfig: FurnaceConfig;
  offlineConfig: OfflineConfig;
  scenarios?: Scenario[];
  memories: MemoryCard[];
  messages: Message[];
  diaries: DiaryEntry[];
  isPinned?: boolean;
  unread?: number;
}

export interface AppSettings {
  apiUrl: string;
  apiKey: string;
  model: string;
  wallpaper: string;
  fullScreenMode: boolean;
  customFont?: string;
  availableModels: string[];
  globalPersona: GlobalPersona;
}

export interface BackupData {
  version: number;
  type?: 'small_phone_backup';
  timestamp: number;
  settings: AppSettings;
  characters: Character[];
}

export enum AppRoute {
  HOME = 'HOME',
  WECHAT = 'WECHAT',
  SETTINGS = 'SETTINGS',
  DIARY = 'DIARY',
}

export enum WeChatTab {
  CHATS = 'CHATS',
  CONTACTS = 'CONTACTS',
  MOMENTS = 'MOMENTS',
  ME = 'ME',
}
