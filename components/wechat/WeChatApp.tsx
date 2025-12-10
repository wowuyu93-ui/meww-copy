
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
  const NotificationBubble = () => ( notification ? ( <div onClick={handleNotificationClick} className="absolute top-2 left-2 right-2 bg-white/95 backdrop-blur-md shadow-2xl rounded-2xl p-3 z-[100] flex items-center gap-3 animate-slide-up cursor-pointer border border-gray-200 ring-1 ring-black/5"><img src={notification.avatar} className="w-10 h-10 rounded-full object-cover shadow-sm" /><div className="flex-1 min-w-0"><div className="flex justify-between items-center mb-0.5"><span className="font-bold text-sm text-gray-900">{notification.charName}</span><span className="text-[10px] text-gray-400 bg-gray-50 px-1 rounded">刚刚</span></div><p className="text-xs text-gray-600 truncate">{notification.message}</p></div></div> ) : null );

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
        <div className="p-4 overflow-y-auto h-full pb-20 bg-gray-50 no-scrollbar">
           <div className="flex items-center justify-between mb-4"><h2 className="text-xl font-bold">新建联系人</h2><button onClick={() => setIsCreating(false)} className="text-gray-500"><i className="fas fa-times"></i></button></div>
           <div className="space-y-4 bg-white p-4 rounded-xl shadow-sm">
             <div className="flex flex-col items-center mb-4"><div className="relative w-24 h-24 rounded-xl overflow-hidden bg-gray-200 border-2 border-dashed border-gray-400 mb-2 group">{newChar.avatar ? <img src={newChar.avatar} className="w-full h-full object-cover" /> : <div className="flex items-center justify-center h-full text-gray-400"><i className="fas fa-camera text-2xl"></i></div>}<input type="file" accept="image/*" onChange={handleAvatarUpload} className="absolute inset-0 opacity-0 cursor-pointer"/></div><span className="text-xs text-gray-500">点击设置头像</span></div>
             <div><label className="block text-xs font-bold text-gray-700 mb-1">角色真名</label><input className="w-full p-2 border rounded bg-gray-50 focus:bg-white transition" placeholder="例如: 诸葛亮" value={newChar.name || ''} onChange={e => setNewChar({...newChar, name: e.target.value})} /></div>
             <div><label className="block text-xs font-bold text-gray-700 mb-1">备注名</label><input className="w-full p-2 border rounded bg-gray-50 focus:bg-white transition" placeholder="例如: 丞相" value={newChar.remark || ''} onChange={e => setNewChar({...newChar, remark: e.target.value})} /></div>
             <div><label className="block text-xs font-bold text-gray-700 mb-1">性格/人设描述</label><textarea className="w-full p-2 border rounded bg-gray-50 focus:bg-white h-24 text-sm" placeholder="描述角色的性格..." value={newChar.personality || ''} onChange={e => setNewChar({...newChar, personality: e.target.value})} /></div>
             <div><label className="block text-xs font-bold text-gray-700 mb-1">System Prompt</label><textarea className="w-full p-2 border rounded bg-gray-900 text-green-400 h-40 text-[10px] font-mono leading-relaxed" value={newChar.systemPrompt || DEFAULT_SYSTEM_PROMPT} onChange={e => setNewChar({...newChar, systemPrompt: e.target.value})} /></div>
             <div className="flex gap-2 pt-4"><button onClick={() => setIsCreating(false)} className="flex-1 py-3 rounded-lg bg-gray-100 text-gray-600 font-bold">取消</button><button onClick={handleCreateChar} className="flex-1 py-3 rounded-lg bg-[#07c160] text-white font-bold shadow-lg shadow-green-200">完成创建</button></div>
           </div>
        </div>
      )
    }

    if (activeTab === WeChatTab.CHATS) {
      const sortedChars = [...characters].sort((a, b) => { if (a.isPinned === b.isPinned) return 0; return a.isPinned ? -1 : 1; });
      return (
        <div className="h-full overflow-y-auto no-scrollbar divide-y divide-gray-200">
          {sortedChars.map(char => {
             const lastMsg = [...char.messages].filter(m => (!m.mode || m.mode === 'online') && m.mode !== 'offline' && m.mode !== 'theater' && !m.isHidden).pop();
             return (
               <div key={char.id} onClick={() => setActiveChatId(char.id)} onContextMenu={(e) => { e.preventDefault(); setContextMenuCharId(char.id); }} onMouseDown={() => handleTouchStart(char.id)} onMouseUp={handleTouchEnd} onMouseLeave={handleTouchEnd} onTouchStart={() => handleTouchStart(char.id)} onTouchEnd={handleTouchEnd} className={`flex items-center p-3 active:bg-gray-100 cursor-pointer select-none flex-shrink-0 ${char.isPinned ? 'bg-gray-50' : 'bg-white'}`}>
                 <div className="relative pointer-events-none"><img src={char.avatar} className="w-12 h-12 rounded-lg object-cover mr-3 bg-gray-200 flex-shrink-0" />{char.unread ? <div className="absolute -top-1 right-2 w-4 h-4 bg-red-500 rounded-full border-2 border-white"></div> : null}</div>
                 <div className="flex-1 min-w-0 pointer-events-none">
                   <div className="flex justify-between items-baseline mb-1"><h3 className="font-medium text-gray-900 truncate flex items-center gap-1">{char.remark}{char.isPinned && <i className="fas fa-thumbtack text-xs text-gray-400 rotate-45"></i>}</h3><span className="text-xs text-gray-400 flex-shrink-0">{lastMsg ? new Date(lastMsg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}</span></div>
                   <p className="text-sm text-gray-500 truncate">{lastMsg ? (lastMsg.isRecalled ? '对方撤回了一条消息' : lastMsg.content) : '暂无消息'}</p>
                 </div>
               </div>
             )
          })}
          {characters.length === 0 && <div className="p-10 text-center text-gray-400 text-sm mt-10">暂无聊天，请去通讯录添加好友。</div>}
        </div>
      );
    }

    if (activeTab === WeChatTab.CONTACTS) {
       return (
         <div className="h-full overflow-y-auto no-scrollbar p-0">
            <div onClick={() => setIsCreating(true)} className="flex items-center p-3 border-b bg-white active:bg-gray-100 cursor-pointer flex-shrink-0"><div className="w-10 h-10 rounded bg-orange-400 flex items-center justify-center mr-3 text-white flex-shrink-0"><i className="fas fa-user-plus"></i></div><span className="font-medium">新的朋友 / 创建角色</span></div>
            <div className="bg-gray-100 px-3 py-1 text-xs text-gray-500 flex-shrink-0">星标朋友</div>
            {characters.map(char => ( <div key={char.id} className="flex items-center p-3 border-b bg-white active:bg-gray-100 cursor-pointer select-none flex-shrink-0" onClick={() => setActiveChatId(char.id)} onContextMenu={(e) => { e.preventDefault(); setContextMenuCharId(char.id); }} onMouseDown={() => handleTouchStart(char.id)} onMouseUp={handleTouchEnd} onMouseLeave={handleTouchEnd} onTouchStart={() => handleTouchStart(char.id)} onTouchEnd={handleTouchEnd}><img src={char.avatar} className="w-10 h-10 rounded mr-3 object-cover pointer-events-none flex-shrink-0" /><span className="font-medium pointer-events-none">{char.remark}</span></div> ))}
         </div>
       )
    }

    if (activeTab === WeChatTab.MOMENTS) {
        const moments = getAllMoments();
        return (
            <div className="h-full relative bg-white">
                <div className="absolute top-0 left-0 right-0 h-60 bg-gray-700 z-0">
                    <img src="https://picsum.photos/800/400?grayscale" className="w-full h-full object-cover opacity-60" />
                    <div className="absolute bottom-[-20px] right-4 flex items-end gap-3 z-10">
                        <span className="text-white font-bold text-shadow mb-6">{settings.globalPersona.name}</span>
                        <img src={settings.globalPersona.avatar} className="w-20 h-20 rounded-xl border-2 border-white bg-white shadow-md object-cover" />
                    </div>
                </div>
                <div className="pt-64 pb-20 px-4 space-y-8 overflow-y-auto h-full no-scrollbar">
                    <div className="absolute top-4 right-4 z-20 flex gap-4">
                        <button onClick={handleRefreshMoments} className={`w-8 h-8 bg-black/20 backdrop-blur rounded-full text-white flex items-center justify-center hover:bg-black/40 ${isRefreshingMoments ? 'animate-spin' : ''}`}><i className="fas fa-sync-alt"></i></button>
                        <button onClick={() => setIsPostingMoment(true)} className="w-8 h-8 bg-black/20 backdrop-blur rounded-full text-white flex items-center justify-center hover:bg-black/40"><i className="fas fa-camera"></i></button>
                    </div>
                    {moments.length === 0 && <div className="text-center text-gray-400 mt-10">暂无朋友圈，快去发一条吧！</div>}
                    {moments.map(moment => (
                        <div key={moment.id} className="flex gap-3 pb-6 border-b border-gray-100 last:border-0 animate-fade-in">
                            <img src={moment.avatar} className="w-10 h-10 rounded bg-gray-200 object-cover mt-1" />
                            <div className="flex-1">
                                <div className="font-bold text-blue-900 text-sm mb-1">{moment.name}</div>
                                <div className="text-sm text-gray-800 leading-relaxed mb-2 whitespace-pre-wrap">{moment.content}</div>
                                {moment.images && (<div className="grid grid-cols-3 gap-1 mb-2 max-w-[200px]">{moment.images.map((img, i) => <img key={i} src={img} className="w-full h-full aspect-square object-cover bg-gray-100" />)}</div>)}
                                <div className="flex justify-between items-center text-xs text-gray-400 mb-2"><span>{new Date(moment.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span><button onClick={() => handleLikeMoment(moment)} className="bg-gray-100 px-2 py-1 rounded text-blue-900 hover:bg-gray-200"><i className={`far fa-heart ${moment.likes.includes('USER') ? 'font-bold text-red-500' : ''}`}></i></button></div>
                                <div className="bg-gray-50 rounded p-2">
                                    {moment.likes.length > 0 && (<div className="text-xs text-blue-900 font-bold mb-1 border-b border-gray-200 pb-1"><i className="far fa-heart mr-1"></i>{moment.likes.includes('USER') ? '我' : ''}{moment.likes.filter(l => l !== 'USER').length > 0 && (moment.likes.includes('USER') ? ', ' : '') + `${moment.likes.filter(l => l!=='USER').length} 人`}</div>)}
                                    {moment.comments.map(c => (<div key={c.id} className="text-xs mb-1"><span className="text-blue-900 font-bold">{c.authorName}: </span><span className="text-gray-700">{c.content}</span></div>))}
                                    <button onClick={() => handleCommentMoment(moment)} className="text-[10px] text-gray-400 mt-1 hover:text-blue-600">评论...</button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
                {isPostingMoment && (
                    <div className="absolute inset-0 bg-white z-50 animate-slide-up flex flex-col">
                        <div className="p-4 flex justify-between items-center border-b"><button onClick={() => setIsPostingMoment(false)} className="text-gray-600">取消</button><button onClick={handlePostMoment} className={`px-4 py-1 rounded bg-[#07c160] text-white font-bold ${!newMomentContent ? 'opacity-50' : ''}`}>发表</button></div>
                        <div className="p-4 flex-1"><textarea value={newMomentContent} onChange={e => setNewMomentContent(e.target.value)} className="w-full h-40 resize-none outline-none text-base" placeholder="这一刻的想法..."/><div className="border-t py-3 flex items-center justify-between" onClick={() => setShowVisibilitySelector(!showVisibilitySelector)}><div className="flex items-center gap-2 text-gray-700"><i className="fas fa-user-friends"></i> 谁可以看</div><div className="flex items-center gap-1 text-gray-400 text-sm">{momentVisibility.length === 0 ? '公开' : `部分可见(${momentVisibility.length})`} <i className="fas fa-chevron-right"></i></div></div>{showVisibilitySelector && (<div className="bg-gray-50 p-2 rounded max-h-40 overflow-y-auto">{characters.map(c => (<div key={c.id} className="flex items-center gap-2 p-2 border-b last:border-0" onClick={() => { if (momentVisibility.includes(c.id)) setMomentVisibility(momentVisibility.filter(id => id !== c.id)); else setMomentVisibility([...momentVisibility, c.id]); }}><input type="checkbox" checked={momentVisibility.includes(c.id)} onChange={()=>{}} className="pointer-events-none"/><img src={c.avatar} className="w-6 h-6 rounded" /><span className="text-sm">{c.remark}</span></div>))}</div>)}</div>
                    </div>
                )}
            </div>
        );
    }

    if (activeTab === WeChatTab.ME) {
        return (
            <div className="p-4 bg-gray-50 h-full overflow-y-auto no-scrollbar">
                <div className="bg-white p-6 rounded-xl shadow-sm space-y-6">
                    <div className="flex items-center justify-between border-b pb-4"><h2 className="font-bold text-xl text-gray-800">全局用户人设</h2>{isSavingPersona && <span className="text-[#07c160] text-sm font-bold animate-fade-in"><i className="fas fa-check"></i> 已保存</span>}</div>
                    <div className="flex flex-col items-center"><div className="relative w-24 h-24 group"><img src={tempGlobalPersona.avatar} className="w-full h-full rounded-full object-cover shadow-md border-4 border-white" /><div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition cursor-pointer"><i className="fas fa-camera text-white"></i></div><input type="file" accept="image/*" onChange={handleGlobalAvatarUpload} className="absolute inset-0 opacity-0 cursor-pointer" /></div><p className="text-xs text-gray-400 mt-2">点击更换全局头像</p></div>
                    <div><label className="block text-xs font-bold text-gray-500 mb-1 uppercase">我的名字</label><input value={tempGlobalPersona.name} onChange={(e) => setTempGlobalPersona({...tempGlobalPersona, name: e.target.value})} className="w-full p-3 bg-gray-50 rounded-lg border border-gray-200 focus:outline-none focus:border-[#07c160] transition" /></div>
                    <div><label className="block text-xs font-bold text-gray-500 mb-1 uppercase">我的性格/简介</label><textarea value={tempGlobalPersona.description} onChange={(e) => setTempGlobalPersona({...tempGlobalPersona, description: e.target.value})} className="w-full p-3 bg-gray-50 rounded-lg border border-gray-200 focus:outline-none focus:border-[#07c160] transition h-32 resize-none" placeholder="AI 将根据这个描述来认识你..." /></div>
                    <button onClick={saveGlobalPersona} className="w-full py-3 bg-[#07c160] hover:bg-[#06ad56] text-white font-bold rounded-xl shadow-lg shadow-green-200 active:scale-95 transition-all">保存全局设置</button>
                </div>
            </div>
        )
    }

    return null;
  };

  return (
    <div className="h-full bg-gray-100 flex flex-col text-black relative">
      <div className="bg-[#ededed] p-3 border-b border-gray-300 flex justify-between items-end pb-2 sticky top-0 z-10 shadow-sm">
         <div className="flex items-center gap-3">
             <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-200"><i className="fas fa-home text-gray-600"></i></button>
             <h1 className="font-bold text-lg ml-1">微信 {activeTab === WeChatTab.CHATS && (isCreating ? '(创建)' : `(${characters.length})`)}</h1>
         </div>
         <div className="flex gap-4 mr-2"><i className="fas fa-search text-gray-900"></i><i className="fas fa-plus-circle text-gray-900" onClick={() => {setActiveTab(WeChatTab.CONTACTS); setIsCreating(true)}}></i></div>
      </div>
      
      {/* Scrollable content container - now hidden overflow on parent, children handle scrolling */}
      <div className="flex-1 overflow-hidden relative flex flex-col">{renderContent()}</div>
      
      <div className="bg-[#f7f7f7] border-t border-gray-300 flex justify-around py-2 pb-6 sm:pb-2 z-10 relative">
         {[{id: WeChatTab.CHATS, icon: 'comment', label: '微信'}, {id: WeChatTab.CONTACTS, icon: 'address-book', label: '通讯录'}, {id: WeChatTab.MOMENTS, icon: 'compass', label: '发现'}, {id: WeChatTab.ME, icon: 'user', label: '我'}].map(tab => (
           <button key={tab.id} onClick={() => {setActiveTab(tab.id as WeChatTab); setIsCreating(false); if(tab.id === WeChatTab.MOMENTS) setHasNewMoment(false);}} className={`relative flex flex-col items-center gap-0.5 ${activeTab === tab.id ? 'text-[#07c160]' : 'text-gray-900'}`}>
               <i className={`fas fa-${tab.icon} text-xl mb-0.5`}></i>
               {tab.id === WeChatTab.MOMENTS && hasNewMoment && <div className="absolute top-0 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border border-white"></div>}
               <span className="text-[10px]">{tab.label}</span>
           </button>
         ))}
      </div>
      <NotificationBubble />
      {contextMenuCharId && (
        <div className="absolute inset-0 bg-black/20 z-50 flex flex-col justify-end" onClick={() => setContextMenuCharId(null)}>
            <div className="bg-white rounded-t-2xl p-4 animate-slide-up space-y-2 shadow-2xl pb-8" onClick={e => e.stopPropagation()}>
                <div className="text-center text-xs text-gray-400 mb-2">管理联系人</div>
                <button onClick={handleTogglePin} className="w-full py-3 bg-gray-100 rounded-xl font-bold text-gray-800 flex items-center justify-center gap-2"><i className="fas fa-thumbtack"></i>{characters.find(c => c.id === contextMenuCharId)?.isPinned ? '取消置顶' : '置顶聊天'}</button>
                <button onClick={handleDeleteChar} className="w-full py-3 bg-red-50 rounded-xl font-bold text-red-600 flex items-center justify-center gap-2"><i className="fas fa-trash"></i>删除该联系人</button>
                <button onClick={() => setContextMenuCharId(null)} className="w-full py-3 mt-2 bg-white border rounded-xl font-bold text-gray-600">取消</button>
            </div>
        </div>
      )}
    </div>
  );
};

export default WeChatApp;
