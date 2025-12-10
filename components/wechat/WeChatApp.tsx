
import React, { useState, useEffect, useRef, Dispatch, SetStateAction } from 'react';
import { Character, AppSettings, WeChatTab, Message, Moment, Comment } from '../../types';
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_OFFLINE_PROMPT, DEFAULT_OS_PROMPT, MOMENT_REPLY_PROMPT } from '../../constants';
import { generateChatCompletion, interpolatePrompt } from '../../services/aiService';
import ChatInterface from './ChatInterface';

interface WeChatAppProps {
  settings: AppSettings;
  onUpdateSettings: Dispatch<SetStateAction<AppSettings>>;
  characters: Character[];
  onUpdateCharacters: Dispatch<SetStateAction<Character[]>>;
  onClose: () => void;
}

interface NotificationState {
  show: boolean;
  charId: string;
  charName: string;
  avatar: string;
  message: string;
}

const WeChatApp: React.FC<WeChatAppProps> = ({ settings, onUpdateSettings, characters, onUpdateCharacters, onClose }) => {
  const [activeTab, setActiveTab] = useState<WeChatTab>(WeChatTab.CHATS);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const activeChatIdRef = useRef<string | null>(null);
  const charactersRef = useRef(characters);
  const settingsRef = useRef(settings);
  
  const [notification, setNotification] = useState<NotificationState | null>(null);
  const [globalIsGenerating, setGlobalIsGenerating] = useState(false);
  const [contextMenuCharId, setContextMenuCharId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newChar, setNewChar] = useState<Partial<Character>>({});
  const [tempGlobalPersona, setTempGlobalPersona] = useState(settings.globalPersona);
  const [isSavingPersona, setIsSavingPersona] = useState(false);
  
  // Moments
  const [isPostingMoment, setIsPostingMoment] = useState(false);
  const [newMomentContent, setNewMomentContent] = useState('');
  const [momentVisibility, setMomentVisibility] = useState<string[]>([]); 
  const [showVisibilitySelector, setShowVisibilitySelector] = useState(false);
  const [isRefreshingMoments, setIsRefreshingMoments] = useState(false);
  
  // Red Dot
  const [hasNewMoment, setHasNewMoment] = useState(false);
  const prevMomentsCountRef = useRef(0);

  const longPressTimerRef = useRef<any>(null);

  useEffect(() => { setTempGlobalPersona(settings.globalPersona); }, [settings.globalPersona]);
  useEffect(() => { activeChatIdRef.current = activeChatId; }, [activeChatId]);
  useEffect(() => { charactersRef.current = characters; }, [characters]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  useEffect(() => {
      const totalMoments = characters.reduce((acc, c) => acc + (c.moments ? c.moments.length : 0), 0) 
                         + (settings.globalPersona.moments ? settings.globalPersona.moments.length : 0);
      if (prevMomentsCountRef.current === 0 && totalMoments > 0) {
          prevMomentsCountRef.current = totalMoments;
      }
      if (totalMoments > prevMomentsCountRef.current) {
          setHasNewMoment(true);
      }
      prevMomentsCountRef.current = totalMoments;
  }, [characters, settings.globalPersona.moments]);

  const handleAddMessage = (charId: string, message: Message) => {
      onUpdateCharacters((prevChars: Character[]) => {
          return prevChars.map(c => {
              if (c.id === charId) {
                  return { ...c, messages: [...c.messages, message] };
              }
              return c;
          });
      });

      if (activeChatIdRef.current !== charId && message.role === 'model' && !message.isHidden) {
          const char = characters.find(c => c.id === charId);
          if (char) {
              setNotification({ show: true, charId: char.id, charName: char.remark, avatar: char.avatar, message: message.content });
              setTimeout(() => { setNotification(prev => prev?.charId === charId ? null : prev); }, 3000);
          }
      }
  };

  const handleShowNotification = (text: string) => {
      setNotification({
          show: true,
          charId: 'system',
          charName: '朋友圈',
          avatar: 'https://ui-avatars.com/api/?name=M&background=random',
          message: text
      });
      setTimeout(() => setNotification(null), 3000);
  };

  const handleNotificationClick = () => {
      if (notification && notification.charId !== 'system') { 
          setActiveChatId(notification.charId); 
      } else if (notification && notification.charId === 'system') {
          setActiveTab(WeChatTab.MOMENTS);
      }
      setNotification(null);
  };

  const handleCreateChar = () => {
    if (!newChar.name || !newChar.remark) { alert("请至少填写【名字】和【备注】"); return; }
    const char: Character = {
      id: Date.now().toString(),
      name: newChar.name,
      remark: newChar.remark,
      avatar: newChar.avatar || 'https://ui-avatars.com/api/?name=' + newChar.remark + '&background=random',
      description: newChar.description || '',
      personality: newChar.personality || '友好的助手',
      systemPrompt: newChar.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      osSystemPrompt: DEFAULT_OS_PROMPT,
      showOS: false,
      useLocalPersona: false,
      userMaskName: '用户', 
      chatFontSize: 15,
      contextMemory: '',
      historyCount: 20,
      renderMessageLimit: 50, // Default to 50
      furnaceConfig: { autoEnabled: false, autoThreshold: 20, autoScope: 30, manualScope: 30 },
      offlineConfig: { systemPrompt: DEFAULT_OFFLINE_PROMPT, style: '细腻、沉浸、小说感', wordCount: 150, bgUrl: '', indicatorColor: '#f59e0b' },
      scenarios: [], memories: [], messages: [], diaries: [], moments: [], autoPostMoments: true, unread: 0,
      realTimeMode: false
    };
    onUpdateCharacters((prev) => [...prev, char]);
    setIsCreating(false);
    setNewChar({});
    setActiveTab(WeChatTab.CHATS);
  };

  const getAllMoments = () => {
      const userMoments = (settings.globalPersona.moments || []).map(m => ({ ...m, isUser: true, avatar: settings.globalPersona.avatar, name: settings.globalPersona.name }));
      const charMoments = characters.flatMap(c => (c.moments || []).map(m => ({ ...m, isUser: false, avatar: c.avatar, name: c.remark })));
      return [...userMoments, ...charMoments].sort((a, b) => b.timestamp - a.timestamp);
  };

  const simulateAiInteractions = async (userMomentId: string, content: string) => {
      const currentSettings = settingsRef.current;
      if (!currentSettings.apiKey) { console.warn("No API Key"); return; }
      const currentChars = charactersRef.current;
      const reactors = currentChars.filter(c => Math.random() > 0.1); 
      console.log(`Simulating interactions for ${userMomentId}, reactors: ${reactors.length}`);

      for (const char of reactors) {
          if (Math.random() > 0.1) {
              handleLikeMoment({ id: userMomentId, isUser: true } as any, char.id);
          }
          if (Math.random() > 0.3) {
              try {
                  const prompt = interpolatePrompt(MOMENT_REPLY_PROMPT, { ai_name: char.name, user_name: currentSettings.globalPersona.name, moment_content: content, user_comment: "（这是用户发的一条朋友圈，请以好友身份回复评论）" });
                  const reply = await generateChatCompletion([{ role: 'user', content: prompt }], currentSettings);
                  const newComment: Comment = { id: Date.now().toString() + char.id, authorId: char.id, authorName: char.remark, content: reply.replace(/^["']|["']$/g, ''), timestamp: Date.now(), isAi: true };
                  onUpdateSettings(prev => ({ ...prev, globalPersona: { ...prev.globalPersona, moments: prev.globalPersona.moments.map(m => m.id === userMomentId ? { ...m, comments: [...m.comments, newComment] } : m) } }));
                  setHasNewMoment(true);
              } catch (e) { console.error("AI Comment Failed", e); }
          }
      }
  };

  const handlePostMoment = () => {
      if (!newMomentContent) return;
      const newMomentId = Date.now().toString();
      const newMoment: Moment = { id: newMomentId, authorId: 'USER', content: newMomentContent, timestamp: Date.now(), likes: [], comments: [], visibleTo: momentVisibility.length > 0 ? momentVisibility : undefined };
      onUpdateSettings(prev => ({ ...prev, globalPersona: { ...prev.globalPersona, moments: [newMoment, ...(prev.globalPersona.moments || [])] } }));
      setIsPostingMoment(false);
      handleShowNotification("发布成功！好友可能会互动哦...");
      setTimeout(() => simulateAiInteractions(newMomentId, newMomentContent), 3000);
      setNewMomentContent('');
      setMomentVisibility([]);
  };

  // Allow AI to trigger a moment post for itself
  const handleAIForceMoment = (content: string, images?: string[]) => {
      if (!activeChatId) return;
      const charId = activeChatId;
      const newMoment: Moment = {
          id: Date.now().toString(),
          authorId: charId,
          content: content,
          timestamp: Date.now(),
          images: images,
          likes: [],
          comments: []
      };
      onUpdateCharacters(prev => prev.map(c => c.id === charId ? { ...c, moments: [newMoment, ...(c.moments || [])] } : c));
      handleShowNotification(`${characters.find(c=>c.id === charId)?.remark} 发布了朋友圈`);
  };

  const handleLikeMoment = (moment: Moment & { isUser: boolean }, likerId: string = 'USER') => {
      if (moment.isUser) {
          onUpdateSettings(curr => {
             const m = curr.globalPersona.moments.find(x => x.id === moment.id);
             if (!m) return curr;
             const isLiked = m.likes.includes(likerId);
             const newLikes = isLiked ? m.likes.filter(id => id !== likerId) : [...m.likes, likerId];
             return { ...curr, globalPersona: { ...curr.globalPersona, moments: curr.globalPersona.moments.map(xm => xm.id === moment.id ? { ...xm, likes: newLikes } : xm) } };
          });
      } else {
          const char = characters.find(c => c.moments && c.moments.some(m => m.id === moment.id));
          if (char) {
              onUpdateCharacters(prev => prev.map(c => {
                  if (c.id === char.id) {
                      return { ...c, moments: c.moments.map(m => m.id === moment.id ? { ...m, likes: m.likes.includes(likerId) ? m.likes.filter(id => id !== likerId) : [...m.likes, likerId] } : m) };
                  }
                  return c;
              }));
          }
      }
  };

  const handleCommentMoment = async (moment: Moment & { isUser: boolean }) => {
      const text = prompt("评论:");
      if (!text) return;
      const newComment: Comment = { id: Date.now().toString(), authorId: 'USER', authorName: settings.globalPersona.name, content: text, timestamp: Date.now() };

      if (moment.isUser) {
          onUpdateSettings(prev => ({ ...prev, globalPersona: { ...prev.globalPersona, moments: prev.globalPersona.moments.map(m => m.id === moment.id ? { ...m, comments: [...m.comments, newComment] } : m) } }));
      } else {
          const char = characters.find(c => c.moments && c.moments.some(m => m.id === moment.id));
          if (char) {
              onUpdateCharacters(prev => prev.map(c => c.id === char.id ? { ...c, moments: c.moments.map(m => m.id === moment.id ? { ...m, comments: [...m.comments, newComment] } : m) } : c));
              if (settings.apiKey) {
                  const prompt = interpolatePrompt(MOMENT_REPLY_PROMPT, { ai_name: char.name, user_name: settings.globalPersona.name, moment_content: moment.content, user_comment: text });
                  try {
                      const reply = await generateChatCompletion([{ role: 'user', content: prompt }], settings);
                      const aiComment: Comment = { id: (Date.now() + 1).toString(), authorId: char.id, authorName: char.remark, content: reply.replace(/^["']|["']$/g, ''), timestamp: Date.now() + 1000, isAi: true };
                      onUpdateCharacters(prev => prev.map(c => c.id === char.id ? { ...c, moments: c.moments.map(m => m.id === moment.id ? { ...m, comments: [...m.comments, aiComment] } : m) } : c));
                  } catch (e) { console.error("AI Comment Reply Failed", e); }
              }
          }
      }
  };

  const handleRefreshMoments = () => { setIsRefreshingMoments(true); setTimeout(() => setIsRefreshingMoments(false), 1000); };
  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (file) { const reader = new FileReader(); reader.onloadend = () => { if (reader.result) setNewChar(prev => ({ ...prev, avatar: reader.result as string })); }; reader.readAsDataURL(file); } };
  const handleGlobalAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (file) { const reader = new FileReader(); reader.onloadend = () => { if (reader.result) setTempGlobalPersona(prev => ({ ...prev, avatar: reader.result as string })); }; reader.readAsDataURL(file); } };
  const saveGlobalPersona = () => { onUpdateSettings(prev => ({ ...prev, globalPersona: tempGlobalPersona })); setIsSavingPersona(true); setTimeout(() => setIsSavingPersona(false), 1500); };
  
  const updateActiveCharacter = (updatedOrFn: Character | ((prev: Character) => Character)) => {
    onUpdateCharacters((prevChars) => prevChars.map(c => {
        if (c.id === activeChatId) {
            return typeof updatedOrFn === 'function' ? updatedOrFn(c) : updatedOrFn;
        }
        return c;
    }));
  };

  const handleTogglePin = () => { if (!contextMenuCharId) return; onUpdateCharacters((prev) => prev.map(c => { if (c.id === contextMenuCharId) return { ...c, isPinned: !c.isPinned }; return c; })); setContextMenuCharId(null); }
  const handleDeleteChar = () => { if (!contextMenuCharId) return; if (window.confirm('确定要删除该联系人及其所有数据吗？')) { if (activeChatId === contextMenuCharId) setActiveChatId(null); onUpdateCharacters((prev) => prev.filter(c => c.id !== contextMenuCharId)); } setContextMenuCharId(null); }
  const handleTouchStart = (charId: string) => { longPressTimerRef.current = setTimeout(() => { setContextMenuCharId(charId); }, 600); };
  const handleTouchEnd = () => { if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; } };

  const activeCharacter = characters.find(c => c.id === activeChatId);
  const NotificationBubble = () => ( notification ? ( <div onClick={handleNotificationClick} className="absolute top-2 left-2 right-2 bg-white/95 backdrop-blur-md shadow-2xl rounded-2xl p-3 z-[100] flex items-center gap-3 animate-slide-up cursor-pointer border border-stone-200 ring-1 ring-black/5"><img src={notification.avatar} className="w-10 h-10 rounded-full object-cover shadow-sm" /><div className="flex-1 min-w-0"><div className="flex justify-between items-center mb-0.5"><span className="font-bold text-sm text-stone-900">{notification.charName}</span><span className="text-[10px] text-stone-400 bg-stone-50 px-1 rounded">刚刚</span></div><p className="text-xs text-stone-600 truncate">{notification.message}</p></div></div> ) : null );

  if (activeChatId && activeCharacter) {
    return (
      <div className="h-full relative">
        <ChatInterface 
            character={activeCharacter} settings={settings} onBack={() => setActiveChatId(null)} 
            onUpdateCharacter={updateActiveCharacter} 
            onAddMessage={handleAddMessage} isGlobalGenerating={globalIsGenerating} setGlobalGenerating={setGlobalIsGenerating}
            onShowNotification={handleShowNotification}
            onPostMoment={handleAIForceMoment}
        />
        <NotificationBubble />
      </div>
    );
  }

  const renderContent = () => {
    if (isCreating) {
      return (
        <div className="p-4 overflow-y-auto h-full pb-20 bg-gray-50/50 no-scrollbar">
           <div className="flex items-center justify-between mb-4"><h2 className="text-xl font-bold text-stone-800">新建联系人</h2><button onClick={() => setIsCreating(false)} className="text-stone-500 hover:bg-stone-200 rounded-full w-8 h-8 flex items-center justify-center"><i className="fas fa-times"></i></button></div>
           <div className="space-y-4 bg-white/80 backdrop-blur-md p-6 rounded-2xl shadow-sm border border-white">
             <div className="flex flex-col items-center mb-4"><div className="relative w-24 h-24 rounded-2xl overflow-hidden bg-stone-100 border-2 border-dashed border-stone-300 mb-2 group shadow-inner hover:border-red-900 transition">{newChar.avatar ? <img src={newChar.avatar} className="w-full h-full object-cover" /> : <div className="flex items-center justify-center h-full text-stone-300"><i className="fas fa-camera text-3xl"></i></div>}<input type="file" accept="image/*" onChange={handleAvatarUpload} className="absolute inset-0 opacity-0 cursor-pointer"/></div><span className="text-xs text-stone-400 font-bold">点击设置头像</span></div>
             <div><label className="block text-xs font-bold text-stone-500 mb-1 uppercase tracking-wider">角色真名</label><input className="w-full p-3 border border-stone-200 rounded-xl bg-stone-50 focus:bg-white focus:border-red-900 focus:ring-2 focus:ring-red-100 transition outline-none" placeholder="例如: 诸葛亮" value={newChar.name || ''} onChange={e => setNewChar({...newChar, name: e.target.value})} /></div>
             <div><label className="block text-xs font-bold text-stone-500 mb-1 uppercase tracking-wider">备注名</label><input className="w-full p-3 border border-stone-200 rounded-xl bg-stone-50 focus:bg-white focus:border-red-900 focus:ring-2 focus:ring-red-100 transition outline-none" placeholder="例如: 丞相" value={newChar.remark || ''} onChange={e => setNewChar({...newChar, remark: e.target.value})} /></div>
             <div><label className="block text-xs font-bold text-stone-500 mb-1 uppercase tracking-wider">性格/人设描述</label><textarea className="w-full p-3 border border-stone-200 rounded-xl bg-stone-50 focus:bg-white focus:border-red-900 focus:ring-2 focus:ring-red-100 transition outline-none h-24 text-sm" placeholder="描述角色的性格..." value={newChar.personality || ''} onChange={e => setNewChar({...newChar, personality: e.target.value})} /></div>
             <div><label className="block text-xs font-bold text-stone-500 mb-1 uppercase tracking-wider">System Prompt</label><textarea className="w-full p-3 border border-stone-900 rounded-xl bg-stone-900 text-stone-200 h-40 text-[10px] font-mono leading-relaxed focus:ring-2 focus:ring-green-900 outline-none" value={newChar.systemPrompt || DEFAULT_SYSTEM_PROMPT} onChange={e => setNewChar({...newChar, systemPrompt: e.target.value})} /></div>
             <div className="flex gap-3 pt-4"><button onClick={() => setIsCreating(false)} className="flex-1 py-3 rounded-xl bg-stone-100 text-stone-600 font-bold hover:bg-stone-200 transition">取消</button><button onClick={handleCreateChar} className="flex-1 py-3 rounded-xl bg-stone-900 text-white font-bold shadow-lg shadow-stone-200 hover:shadow-xl hover:scale-[1.02] transition">完成创建</button></div>
           </div>
        </div>
      )
    }

    if (activeTab === WeChatTab.CHATS) {
      const sortedChars = [...characters].sort((a, b) => { if (a.isPinned === b.isPinned) return 0; return a.isPinned ? -1 : 1; });
      return (
        <div className="h-full overflow-y-auto no-scrollbar pt-2 pb-20">
          {sortedChars.map(char => {
             const lastMsg = [...char.messages].filter(m => (!m.mode || m.mode === 'online') && m.mode !== 'offline' && m.mode !== 'theater' && !m.isHidden).pop();
             return (
               <div key={char.id} onClick={() => setActiveChatId(char.id)} onContextMenu={(e) => { e.preventDefault(); setContextMenuCharId(char.id); }} onMouseDown={() => handleTouchStart(char.id)} onMouseUp={handleTouchEnd} onMouseLeave={handleTouchEnd} onTouchStart={() => handleTouchStart(char.id)} onTouchEnd={handleTouchEnd} 
                className={`
                    relative flex items-center p-4 mx-3 mb-3 rounded-2xl cursor-pointer select-none transition-all duration-200 group
                    ${char.isPinned ? 'bg-stone-100 border border-stone-200' : 'bg-white/80 border border-white'}
                    hover:bg-white hover:shadow-md hover:-translate-y-0.5 backdrop-blur-sm shadow-sm
                `}>
                 <div className="relative pointer-events-none mr-4">
                    <img src={char.avatar} className={`w-14 h-14 rounded-full object-cover bg-stone-200 shadow-sm ${char.isPinned ? 'ring-2 ring-stone-300' : ''}`} />
                    {char.unread ? <div className="absolute -top-1 right-0 w-4 h-4 bg-red-600 rounded-full border-2 border-white shadow-sm"></div> : null}
                 </div>
                 <div className="flex-1 min-w-0 pointer-events-none">
                   <div className="flex justify-between items-baseline mb-1">
                       <h3 className={`font-bold text-base truncate flex items-center gap-1 ${char.isPinned ? 'text-stone-900' : 'text-stone-800'}`}>
                           {char.remark}
                           {char.isPinned && <i className="fas fa-thumbtack text-[10px] text-stone-400 rotate-45 ml-1"></i>}
                       </h3>
                       <span className="text-[10px] text-stone-400 flex-shrink-0 font-medium bg-stone-50 px-1.5 py-0.5 rounded-full">
                           {lastMsg ? new Date(lastMsg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}
                       </span>
                   </div>
                   <p className="text-sm text-stone-500 truncate font-medium opacity-80">
                       {lastMsg ? (lastMsg.isRecalled ? '对方撤回了一条消息' : lastMsg.content) : '暂无消息'}
                   </p>
                 </div>
                 {/* Hover Arrow */}
                 <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-stone-300">
                     <i className="fas fa-chevron-right"></i>
                 </div>
               </div>
             )
          })}
          {characters.length === 0 && (
              <div className="flex flex-col items-center justify-center mt-20 text-stone-400 gap-4 opacity-50">
                  <i className="fas fa-comments text-6xl"></i>
                  <span className="text-sm font-bold">暂无聊天，请去通讯录添加好友</span>
              </div>
          )}
        </div>
      );
    }

    if (activeTab === WeChatTab.CONTACTS) {
       return (
         <div className="h-full overflow-y-auto no-scrollbar p-0 pb-20">
            <div onClick={() => setIsCreating(true)} className="flex items-center p-4 mx-3 mt-3 bg-white/80 backdrop-blur rounded-2xl border border-white shadow-sm active:scale-95 transition-all cursor-pointer mb-6 group">
                <div className="w-12 h-12 rounded-full bg-stone-800 flex items-center justify-center mr-4 text-white shadow-lg shadow-stone-300 group-hover:shadow-stone-400 transition-all">
                    <i className="fas fa-user-plus text-lg"></i>
                </div>
                <span className="font-bold text-stone-800">新的朋友 / 创建角色</span>
                <i className="fas fa-chevron-right ml-auto text-stone-300"></i>
            </div>
            
            <div className="px-6 mb-2 text-xs font-bold text-stone-400 uppercase tracking-widest">我的联系人</div>
            
            <div className="space-y-2 px-3">
                {characters.map(char => ( 
                    <div key={char.id} className="flex items-center p-3 bg-white/60 backdrop-blur-sm border border-transparent hover:border-white hover:bg-white rounded-xl cursor-pointer select-none transition-all" 
                        onClick={() => setActiveChatId(char.id)} 
                        onContextMenu={(e) => { e.preventDefault(); setContextMenuCharId(char.id); }} 
                        onMouseDown={() => handleTouchStart(char.id)} onMouseUp={handleTouchEnd} onMouseLeave={handleTouchEnd} onTouchStart={() => handleTouchStart(char.id)} onTouchEnd={handleTouchEnd}
                    >
                        <img src={char.avatar} className="w-10 h-10 rounded-full mr-4 object-cover pointer-events-none shadow-sm" />
                        <span className="font-bold text-stone-700 pointer-events-none">{char.remark}</span>
                    </div> 
                ))}
            </div>
         </div>
       )
    }

    if (activeTab === WeChatTab.MOMENTS) {
        const moments = getAllMoments();
        return (
            <div className="h-full relative bg-white">
                <div className="absolute top-0 left-0 right-0 h-72 z-0">
                    <div className="w-full h-full relative overflow-hidden bg-stone-900">
                        <img src="https://picsum.photos/800/400?grayscale" className="w-full h-full object-cover opacity-60 scale-110 blur-[2px]" />
                        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/20 to-black/60"></div>
                    </div>
                    <div className="absolute bottom-[-30px] right-6 flex items-end gap-4 z-10">
                        <span className="text-white font-bold text-xl text-shadow-lg mb-8 tracking-wide">{settings.globalPersona.name}</span>
                        <img src={settings.globalPersona.avatar} className="w-24 h-24 rounded-2xl border-[3px] border-white bg-white shadow-xl object-cover" />
                    </div>
                </div>
                
                <div className="pt-80 pb-20 px-4 space-y-10 overflow-y-auto h-full no-scrollbar relative z-1">
                    <div className="absolute top-4 right-4 z-20 flex gap-4">
                        <button onClick={handleRefreshMoments} className={`w-10 h-10 bg-black/30 backdrop-blur-md rounded-full text-white flex items-center justify-center hover:bg-black/50 transition border border-white/20 shadow-lg ${isRefreshingMoments ? 'animate-spin' : ''}`}><i className="fas fa-sync-alt"></i></button>
                        <button onClick={() => setIsPostingMoment(true)} className="w-10 h-10 bg-black/30 backdrop-blur-md rounded-full text-white flex items-center justify-center hover:bg-black/50 transition border border-white/20 shadow-lg"><i className="fas fa-camera"></i></button>
                    </div>
                    
                    {moments.length === 0 && <div className="text-center text-stone-400 mt-20 font-bold opacity-60">暂无朋友圈，快去发一条吧！</div>}
                    
                    {moments.map(moment => (
                        <div key={moment.id} className="flex gap-4 animate-fade-in group">
                            <img src={moment.avatar} className="w-12 h-12 rounded-xl bg-stone-200 object-cover mt-1 shadow-sm flex-shrink-0" />
                            <div className="flex-1 pb-6 border-b border-stone-100 group-last:border-0">
                                <div className="font-bold text-stone-900 text-[15px] mb-1">{moment.name}</div>
                                <div className="text-[15px] text-stone-800 leading-relaxed mb-3 whitespace-pre-wrap">{moment.content}</div>
                                {moment.images && (<div className="grid grid-cols-3 gap-1 mb-3 max-w-[280px] rounded-lg overflow-hidden">{moment.images.map((img, i) => <img key={i} src={img} className="w-full h-full aspect-square object-cover bg-stone-100 hover:opacity-90 cursor-pointer" />)}</div>)}
                                <div className="flex justify-between items-center text-xs text-stone-400 mb-3">
                                    <span>{new Date(moment.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                    <button onClick={() => handleLikeMoment(moment)} className="bg-stone-50 px-3 py-1.5 rounded text-stone-900 hover:bg-stone-100 transition active:scale-95"><i className={`far fa-heart mr-1 ${moment.likes.includes('USER') ? 'font-bold text-red-600' : ''}`}></i> {moment.likes.length || '赞'}</button>
                                </div>
                                <div className="bg-stone-50/80 rounded-[4px] p-3 text-[14px]">
                                    {moment.likes.length > 0 && (
                                        <div className="text-stone-900 font-bold mb-1.5 border-b border-stone-200/50 pb-1.5 flex items-center gap-1">
                                            <i className="far fa-heart text-xs"></i>
                                            {moment.likes.includes('USER') ? '我' : ''}{moment.likes.filter(l => l !== 'USER').length > 0 && (moment.likes.includes('USER') ? ', ' : '') + `${moment.likes.filter(l => l!=='USER').length} 人`}
                                        </div>
                                    )}
                                    <div className="space-y-1">
                                        {moment.comments.map(c => (<div key={c.id} className=""><span className="text-stone-900 font-bold cursor-pointer hover:underline">{c.authorName}: </span><span className="text-stone-700">{c.content}</span></div>))}
                                    </div>
                                    <button onClick={() => handleCommentMoment(moment)} className="text-xs text-stone-400 mt-2 hover:text-red-900 transition">写评论...</button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
                {isPostingMoment && (
                    <div className="absolute inset-0 bg-white z-50 animate-slide-up flex flex-col">
                        <div className="p-4 flex justify-between items-center border-b bg-gray-50/50 backdrop-blur"><button onClick={() => setIsPostingMoment(false)} className="text-stone-600 font-bold">取消</button><button onClick={handlePostMoment} className={`px-4 py-1.5 rounded-lg bg-stone-900 text-white font-bold shadow-md shadow-stone-200 ${!newMomentContent ? 'opacity-50' : ''}`}>发表</button></div>
                        <div className="p-6 flex-1"><textarea value={newMomentContent} onChange={e => setNewMomentContent(e.target.value)} className="w-full h-40 resize-none outline-none text-lg placeholder-stone-300" placeholder="这一刻的想法..."/><div className="border-t py-4 flex items-center justify-between cursor-pointer active:bg-gray-50 -mx-4 px-4" onClick={() => setShowVisibilitySelector(!showVisibilitySelector)}><div className="flex items-center gap-3 text-stone-800 font-bold"><i className="fas fa-user-friends text-stone-500"></i> 谁可以看</div><div className="flex items-center gap-2 text-stone-400 text-sm font-bold">{momentVisibility.length === 0 ? '公开' : `部分可见(${momentVisibility.length})`} <i className="fas fa-chevron-right"></i></div></div>{showVisibilitySelector && (<div className="bg-stone-50 p-2 rounded-xl mt-2 max-h-40 overflow-y-auto border border-stone-100 shadow-inner">{characters.map(c => (<div key={c.id} className="flex items-center gap-3 p-3 border-b border-stone-100 last:border-0 hover:bg-white rounded-lg transition cursor-pointer" onClick={() => { if (momentVisibility.includes(c.id)) setMomentVisibility(momentVisibility.filter(id => id !== c.id)); else setMomentVisibility([...momentVisibility, c.id]); }}><input type="checkbox" checked={momentVisibility.includes(c.id)} onChange={()=>{}} className="w-5 h-5 accent-green-500 pointer-events-none"/><img src={c.avatar} className="w-8 h-8 rounded-full object-cover" /><span className="text-sm font-bold text-stone-700">{c.remark}</span></div>))}</div>)}</div>
                    </div>
                )}
            </div>
        );
    }

    if (activeTab === WeChatTab.ME) {
        return (
            <div className="p-6 bg-gray-50/50 h-full overflow-y-auto no-scrollbar">
                <div className="bg-white p-8 rounded-3xl shadow-sm space-y-8 border border-white/50 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-stone-800 to-black"></div>
                    <div className="flex items-center justify-between border-b border-stone-100 pb-4">
                        <h2 className="font-bold text-2xl text-stone-800 tracking-tight">全局人设</h2>
                        {isSavingPersona && <span className="text-[#07c160] text-sm font-bold animate-fade-in flex items-center gap-1 bg-green-50 px-2 py-1 rounded-full"><i className="fas fa-check-circle"></i> 已保存</span>}
                    </div>
                    
                    <div className="flex flex-col items-center">
                        <div className="relative w-28 h-28 group">
                            <img src={tempGlobalPersona.avatar} className="w-full h-full rounded-full object-cover shadow-xl border-[6px] border-stone-50 group-hover:border-white transition-all" />
                            <div className="absolute inset-0 bg-black/30 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition cursor-pointer backdrop-blur-[2px]">
                                <i className="fas fa-camera text-white text-2xl"></i>
                            </div>
                            <input type="file" accept="image/*" onChange={handleGlobalAvatarUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                        </div>
                        <p className="text-xs font-bold text-stone-400 mt-3 uppercase tracking-wider">点击更换头像</p>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-stone-400 mb-2 uppercase tracking-widest ml-1">我的名字</label>
                            <input value={tempGlobalPersona.name} onChange={(e) => setTempGlobalPersona({...tempGlobalPersona, name: e.target.value})} className="w-full p-4 bg-stone-50 rounded-xl border border-stone-200 focus:outline-none focus:border-stone-400 focus:bg-white focus:ring-4 focus:ring-stone-100 transition font-bold text-stone-800" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-stone-400 mb-2 uppercase tracking-widest ml-1">人设/简介</label>
                            <textarea value={tempGlobalPersona.description} onChange={(e) => setTempGlobalPersona({...tempGlobalPersona, description: e.target.value})} className="w-full p-4 bg-stone-50 rounded-xl border border-stone-200 focus:outline-none focus:border-stone-400 focus:bg-white focus:ring-4 focus:ring-stone-100 transition h-32 resize-none text-sm leading-relaxed text-stone-600" placeholder="AI 将根据这个描述来认识你..." />
                        </div>
                    </div>
                    
                    <button onClick={saveGlobalPersona} className="w-full py-4 bg-stone-900 hover:shadow-lg text-white font-bold rounded-2xl active:scale-[0.98] transition-all flex items-center justify-center gap-2 text-lg">
                        <i className="fas fa-save"></i> 保存设置
                    </button>
                </div>
            </div>
        )
    }

    return null;
  };

  return (
    <div className="h-full bg-gradient-to-b from-gray-50 to-gray-100 flex flex-col text-black relative">
      {/* HEADER */}
      <div className="bg-white/70 backdrop-blur-md px-4 py-3 flex justify-between items-end pb-3 sticky top-0 z-10 border-b border-gray-200/50 shadow-sm transition-all">
         <div className="flex items-center gap-3">
             <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-200/80 transition active:scale-90"><i className="fas fa-arrow-left text-gray-700"></i></button>
             <h1 className="font-bold text-xl ml-1 text-gray-800 tracking-tight">
                 {activeTab === WeChatTab.CHATS && (isCreating ? '创建角色' : '消息')}
                 {activeTab === WeChatTab.CONTACTS && '通讯录'}
                 {activeTab === WeChatTab.MOMENTS && '朋友圈'}
                 {activeTab === WeChatTab.ME && '我'}
             </h1>
             {activeTab === WeChatTab.CHATS && !isCreating && <span className="bg-gray-200 text-gray-500 text-[10px] px-2 py-0.5 rounded-full font-bold">{characters.length}</span>}
         </div>
         <div className="flex gap-4 mr-1">
             <button className="w-8 h-8 rounded-full hover:bg-gray-200/50 flex items-center justify-center transition"><i className="fas fa-search text-gray-700"></i></button>
             <button onClick={() => {setActiveTab(WeChatTab.CONTACTS); setIsCreating(true)}} className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center shadow-md hover:scale-110 transition active:scale-95"><i className="fas fa-plus"></i></button>
         </div>
      </div>
      
      {/* CONTENT */}
      <div className="flex-1 overflow-hidden relative flex flex-col">{renderContent()}</div>
      
      {/* BOTTOM TAB BAR */}
      <div className="bg-white/90 backdrop-blur-xl border-t border-gray-200 flex justify-around py-2 pb-6 sm:pb-3 z-10 relative shadow-[0_-4px_20px_rgba(0,0,0,0.02)]">
         {[{id: WeChatTab.CHATS, icon: 'comment', label: '微信'}, {id: WeChatTab.CONTACTS, icon: 'address-book', label: '通讯录'}, {id: WeChatTab.MOMENTS, icon: 'compass', label: '发现'}, {id: WeChatTab.ME, icon: 'user', label: '我'}].map(tab => (
           <button key={tab.id} onClick={() => {setActiveTab(tab.id as WeChatTab); setIsCreating(false); if(tab.id === WeChatTab.MOMENTS) setHasNewMoment(false);}} className={`relative flex flex-col items-center gap-1 transition-all duration-300 w-16 group ${activeTab === tab.id ? 'text-red-900' : 'text-gray-400 hover:text-gray-600'}`}>
               <div className={`text-xl transition-transform duration-300 ${activeTab === tab.id ? '-translate-y-1 scale-110 drop-shadow-sm' : 'group-hover:-translate-y-0.5'}`}>
                   <i className={`fas fa-${tab.icon}`}></i>
               </div>
               {tab.id === WeChatTab.MOMENTS && hasNewMoment && <div className="absolute top-0 right-3 w-2.5 h-2.5 bg-red-600 rounded-full border border-white animate-pulse"></div>}
               <span className={`text-[10px] font-bold ${activeTab === tab.id ? 'opacity-100' : 'opacity-0 scale-0'} transition-all duration-300 absolute -bottom-1`}>{tab.label}</span>
           </button>
         ))}
      </div>
      
      <NotificationBubble />
      
      {/* CONTEXT MENU */}
      {contextMenuCharId && (
        <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px] z-50 flex flex-col justify-end" onClick={() => setContextMenuCharId(null)}>
            <div className="bg-white rounded-t-3xl p-6 animate-slide-up space-y-3 shadow-2xl pb-10" onClick={e => e.stopPropagation()}>
                <div className="w-12 h-1 bg-gray-200 rounded-full mx-auto mb-4"></div>
                <div className="text-center text-sm font-bold text-gray-500 mb-4">管理 {characters.find(c => c.id === contextMenuCharId)?.remark}</div>
                <button onClick={handleTogglePin} className="w-full py-4 bg-stone-100 rounded-2xl font-bold text-stone-900 flex items-center justify-center gap-3 active:scale-[0.98] transition"><i className="fas fa-thumbtack"></i>{characters.find(c => c.id === contextMenuCharId)?.isPinned ? '取消置顶' : '置顶聊天'}</button>
                <button onClick={handleDeleteChar} className="w-full py-4 bg-red-50 rounded-2xl font-bold text-red-900 flex items-center justify-center gap-3 active:scale-[0.98] transition"><i className="fas fa-trash"></i>删除该联系人</button>
                <button onClick={() => setContextMenuCharId(null)} className="w-full py-4 mt-2 bg-white border border-gray-200 rounded-2xl font-bold text-gray-500 active:bg-gray-50 transition">取消</button>
            </div>
        </div>
      )}
    </div>
  );
};

export default WeChatApp;
