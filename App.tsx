
import React, { useState, useEffect } from 'react';
import { AppSettings, Character, AppRoute } from './types';
import { DEFAULT_WALLPAPER } from './constants';
import SettingsApp from './components/SettingsApp';
import WeChatApp from './components/wechat/WeChatApp';
import DiaryApp from './components/DiaryApp';

const App: React.FC = () => {
  // --- Global State ---
  const [route, setRoute] = useState<AppRoute>(AppRoute.HOME);
  const [currentTime, setCurrentTime] = useState(new Date());

  // --- Persistence ---
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('small_phone_settings');
    const defaultSettings: AppSettings = {
      apiUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-3.5-turbo',
      wallpaper: DEFAULT_WALLPAPER,
      fullScreenMode: false,
      availableModels: ['gpt-3.5-turbo'],
      globalPersona: {
        name: '我',
        avatar: 'https://ui-avatars.com/api/?name=Me&background=07c160&color=fff',
        description: '一个普通用户',
        diaries: []
      }
    };
    
    if (saved) {
        const parsed = JSON.parse(saved);
        // Merge with defaults
        return { 
            ...defaultSettings, 
            ...parsed, 
            globalPersona: {
                ...defaultSettings.globalPersona,
                ...(parsed.globalPersona || {}),
                diaries: parsed.globalPersona?.diaries || []
            }
        };
    }
    return defaultSettings;
  });

  const [characters, setCharacters] = useState<Character[]>(() => {
    const saved = localStorage.getItem('small_phone_chars');
    return saved ? JSON.parse(saved) : [];
  });

  // --- Effects ---
  useEffect(() => {
    localStorage.setItem('small_phone_settings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem('small_phone_chars', JSON.stringify(characters));
  }, [characters]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // --- Render Helpers ---

  const renderScreen = () => {
    switch (route) {
      case AppRoute.SETTINGS:
        return (
          <SettingsApp 
            settings={settings} 
            updateSettings={setSettings} 
            characters={characters}
            onUpdateCharacters={setCharacters}
            onClose={() => setRoute(AppRoute.HOME)} 
          />
        );
      case AppRoute.WECHAT:
        return (
          <WeChatApp 
            settings={settings}
            onUpdateSettings={setSettings}
            characters={characters}
            onUpdateCharacters={setCharacters}
            onClose={() => setRoute(AppRoute.HOME)}
          />
        );
      case AppRoute.DIARY:
        return (
            <DiaryApp 
                characters={characters}
                settings={settings}
                onUpdateCharacters={setCharacters}
                onUpdateSettings={setSettings}
                onClose={() => setRoute(AppRoute.HOME)}
            />
        );
      case AppRoute.HOME:
      default:
        return (
          <div className="h-full flex flex-col p-6 text-white animate-fade-in relative">
            {/* Status Bar Shim */}
            <div className={`mt-8 mb-10 text-center flex flex-col items-center ${settings.fullScreenMode ? 'mt-12' : ''}`}>
               <div className="text-6xl font-light tracking-tighter drop-shadow-lg">
                 {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
               </div>
               <div className="text-lg opacity-90 mt-2 font-medium drop-shadow-md">
                 {currentTime.toLocaleDateString('zh-CN', { weekday: 'long', month: 'long', day: 'numeric'})}
               </div>
            </div>

            {/* App Grid */}
            <div className="grid grid-cols-4 gap-6 mt-auto mb-12">
               {/* WeChat */}
               <button onClick={() => setRoute(AppRoute.WECHAT)} className="flex flex-col items-center gap-2 group">
                  <div className="w-14 h-14 rounded-2xl bg-[#07c160] flex items-center justify-center shadow-lg group-active:scale-95 transition border border-white/10">
                    <i className="fas fa-comment text-2xl text-white"></i>
                  </div>
                  <span className="text-xs font-medium shadow-black drop-shadow-md">微信</span>
               </button>
               
               {/* Diary */}
               <button onClick={() => setRoute(AppRoute.DIARY)} className="flex flex-col items-center gap-2 group">
                  <div className="w-14 h-14 rounded-2xl bg-[#f5d0a9] flex items-center justify-center shadow-lg group-active:scale-95 transition border border-white/10">
                    <i className="fas fa-book text-2xl text-amber-800"></i>
                  </div>
                  <span className="text-xs font-medium shadow-black drop-shadow-md">日记</span>
               </button>
               
               {/* Settings */}
               <button onClick={() => setRoute(AppRoute.SETTINGS)} className="flex flex-col items-center gap-2 group">
                  <div className="w-14 h-14 rounded-2xl bg-gray-500 flex items-center justify-center shadow-lg group-active:scale-95 transition border border-white/10">
                    <i className="fas fa-cog text-2xl text-white"></i>
                  </div>
                  <span className="text-xs font-medium shadow-black drop-shadow-md">设置</span>
               </button>

               {/* Placeholder App */}
               <button className="flex flex-col items-center gap-2 group opacity-50">
                  <div className="w-14 h-14 rounded-2xl bg-blue-400 flex items-center justify-center shadow-lg">
                    <i className="fas fa-camera text-2xl text-white"></i>
                  </div>
                  <span className="text-xs font-medium shadow-black drop-shadow-md">相机</span>
               </button>
            </div>
            
            {/* Dock Area */}
            <div className="bg-white/20 backdrop-blur-md rounded-[2rem] p-4 flex justify-around items-center mx-2 mb-2 border border-white/10 shadow-2xl">
                <div className="w-12 h-12 bg-[#4cd964] rounded-xl flex items-center justify-center shadow-lg">
                    <i className="fas fa-phone text-white text-xl"></i>
                </div>
                <div className="w-12 h-12 bg-[#5ac8fa] rounded-xl flex items-center justify-center shadow-lg">
                    <i className="fas fa-compass text-white text-xl"></i>
                </div>
                <div className="w-12 h-12 bg-[#ffcc00] rounded-xl flex items-center justify-center shadow-lg">
                     <i className="fas fa-envelope text-white text-xl"></i>
                </div>
                <div className="w-12 h-12 bg-[#ff2d55] rounded-xl flex items-center justify-center shadow-lg">
                     <i className="fas fa-music text-white text-xl"></i>
                </div>
            </div>
          </div>
        );
    }
  };

  // Full Screen Classes
  const containerClasses = settings.fullScreenMode
    ? 'relative w-full h-full bg-black overflow-hidden'
    : 'relative w-[375px] h-[812px] bg-black rounded-[3rem] shadow-2xl border-[8px] border-gray-800 overflow-hidden ring-4 ring-gray-900/50';

  return (
    <div 
      className={containerClasses}
      style={{ 
        fontFamily: settings.customFont || 'inherit',
      }}
    >
      {/* Wallpaper Layer */}
      <div 
        className="absolute inset-0 z-0 bg-cover bg-center transition-all duration-500"
        style={{ backgroundImage: `url(${settings.wallpaper})` }}
      />
      
      {/* Glass Overlay for darkening wallpaper slightly */}
      <div className="absolute inset-0 z-0 bg-black/20 pointer-events-none" />

      {/* Screen Content */}
      <div className="absolute inset-0 z-10 flex flex-col">
        {/* Dynamic Island / Notch Shim (Only if not full screen) */}
        {!settings.fullScreenMode && (
             <div className="h-7 w-full flex justify-center items-start pt-2 z-50 pointer-events-none">
                <div className="w-24 h-7 bg-black rounded-full"></div>
             </div>
        )}

        {/* Main View */}
        <div className="flex-1 overflow-hidden relative">
            {renderScreen()}
        </div>
        
        {/* Home Bar */}
        <div className="h-5 w-full flex justify-center items-center pb-2 z-50 cursor-pointer mb-2" onClick={() => setRoute(AppRoute.HOME)}>
           <div className="w-32 h-1 bg-white/50 rounded-full hover:bg-white transition-colors backdrop-blur"></div>
        </div>
      </div>
    </div>
  );
};

export default App;
