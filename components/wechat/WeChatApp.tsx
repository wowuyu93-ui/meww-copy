
import React, { useState, useEffect, useRef } from 'react';
import { Character, AppSettings, WeChatTab, Message } from '../../types';
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_OFFLINE_PROMPT, DEFAULT_OS_PROMPT } from '../../constants';
import ChatInterface from './ChatInterface';

interface WeChatAppProps {
  settings: AppSettings;
  onUpdateSettings: (s: AppSettings) => void;
  characters: Character[];
  onUpdateCharacters: (chars: Character[] | ((prev: Character[]) => Character[])) => void;
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
  
  const [notification, setNotification] = useState<NotificationState | null>(null);
  const [globalIsGenerating, setGlobalIsGenerating] = useState(false);
  const [contextMenuCharId, setContextMenuCharId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newChar, setNewChar] = useState<Partial<Character>>({});
  const [tempGlobalPersona, setTempGlobalPersona] = useState(settings.globalPersona);
  const [isSavingPersona, setIsSavingPersona] = useState(false);
  const longPressTimerRef = useRef<any>(null);

  useEffect(() => {
    setTempGlobalPersona(settings.globalPersona);
  }, [settings.globalPersona]);

  useEffect(() => {
      activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  const handleAddMessage = (charId: string, message: Message) => {
      onUpdateCharacters((prevChars: Character[]) => {
          return prevChars.map(c => {
              if (c.id === charId) {
                  return {
                      ...c,
                      messages: [...c.messages, message]
                  };
              }
              return c;
          });
      });

      if (activeChatIdRef.current !== charId && message.role === 'model' && !message.isHidden) {
          const char = characters.find(c => c.id === charId);
          if (char) {
              setNotification({
                  show: true,
                  charId: char.id,
                  charName: char.remark,
                  avatar: char.avatar,
                  message: message.content
              });
              setTimeout(() => {
                  setNotification(prev => prev?.charId === charId ? null : prev);
              }, 3000);
          }
      }
  };

  const handleNotificationClick = () => {
      if (notification) {
          setActiveChatId(notification.charId);
          setNotification(null);
      }
  };

  const handleCreateChar = () => {
    if (!newChar.name || !newChar.remark) {
        alert("请至少填写【名字】和【备注】");
        return;
    }
    
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
      userMaskDescription: '',
      realTimeMode: false,
      contextMemory: '',
      historyCount: 20,
      furnaceConfig: {
        autoEnabled: false,
        autoThreshold: 20,
        autoScope: 30,
        manualScope: 30
      },
      offlineConfig: {
        systemPrompt: DEFAULT_OFFLINE_PROMPT,
        style: '细腻、沉浸、小说感',
        wordCount: 150,
        bgUrl: '',
        indicatorColor: '#f59e0b'
      },
      scenarios: [],
      memories: [],
      messages: [],
      diaries: [],
      unread: 0,
    };
    onUpdateCharacters([...characters, char]);
    setIsCreating(false);
    setNewChar({});
    setActiveTab(WeChatTab.CHATS);
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
          if (reader.result) setNewChar(prev => ({ ...prev, avatar: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleGlobalAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
          if (reader.result) setTempGlobalPersona(prev => ({ ...prev, avatar: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const saveGlobalPersona = () => {
      onUpdateSettings({ ...settings, globalPersona: tempGlobalPersona });
      setIsSavingPersona(true);
      setTimeout(() => setIsSavingPersona(false), 1500);
  };

  const updateActiveCharacter = (updated: Character) => {
    onUpdateCharacters((prev) => prev.map(c => c.id === updated.id ? updated : c));
  };
  
  const handleTogglePin = () => {
      if (!contextMenuCharId) return;
      onUpdateCharacters((prev) => prev.map(c => {
          if (c.id === contextMenuCharId) return { ...c, isPinned: !c.isPinned };
          return c;
      }));
      setContextMenuCharId(null);
  }

  const handleDeleteChar = () => {
      if (!contextMenuCharId) return;
      if (window.confirm('确定要删除该联系人及其所有数据吗？')) {
          if (activeChatId === contextMenuCharId) setActiveChatId(null);
          onUpdateCharacters((prev) => prev.filter(c => c.id !== contextMenuCharId));
      }
      setContextMenuCharId(null);
  }

  const handleTouchStart = (charId: string) => {
      longPressTimerRef.current = setTimeout(() => {
          setContextMenuCharId(charId);
      }, 600);
  };

  const handleTouchEnd = () => {
      if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
      }
  };

  const activeCharacter = characters.find(c => c.id === activeChatId);

  const NotificationBubble = () => (
     notification ? (
         <div 
             onClick={handleNotificationClick}
             className="absolute top-2 left-2 right-2 bg-white/95 backdrop-blur-md shadow-2xl rounded-2xl p-3 z-[100] flex items-center gap-3 animate-slide-up cursor-pointer border border-gray-200 ring-1 ring-black/5"
         >
             <img src={notification.avatar} className="w-10 h-10 rounded-full object-cover shadow-sm" />
             <div className="flex-1 min-w-0">
                 <div className="flex justify-between items-center mb-0.5">
                     <span className="font-bold text-sm text-gray-900">{notification.charName}</span>
                     <span className="text-[10px] text-gray-400 bg-gray-50 px-1 rounded">刚刚</span>
                 </div>
                 <p className="text-xs text-gray-600 truncate">{notification.message}</p>
             </div>
         </div>
     ) : null
  );

  if (activeChatId && activeCharacter) {
    return (
      <div className="h-full relative">
        <ChatInterface 
            character={activeCharacter}
            settings={settings}
            onBack={() => setActiveChatId(null)}
            onUpdateCharacter={updateActiveCharacter}
            onAddMessage={handleAddMessage}
            isGlobalGenerating={globalIsGenerating}
            setGlobalGenerating={setGlobalIsGenerating}
        />
        <NotificationBubble />
      </div>
    );
  }

  const renderContent = () => {
    if (isCreating) {
      return (
        <div className="p-4 overflow-y-auto h-full pb-20 bg-gray-50">
           <div className="flex items-center justify-between mb-4">
             <h2 className="text-xl font-bold">新建联系人</h2>
             <button onClick={() => setIsCreating(false)} className="text-gray-500"><i className="fas fa-times"></i></button>
           </div>
           <div className="space-y-4 bg-white p-4 rounded-xl shadow-sm">
             <div className="flex flex-col items-center mb-4">
                <div className="relative w-24 h-24 rounded-xl overflow-hidden bg-gray-200 border-2 border-dashed border-gray-400 mb-2 group">
                    {newChar.avatar ? <img src={newChar.avatar} className="w-full h-full object-cover" /> : <div className="flex items-center justify-center h-full text-gray-400"><i className="fas fa-camera text-2xl"></i></div>}
                    <input type="file" accept="image/*" onChange={handleAvatarUpload} className="absolute inset-0 opacity-0 cursor-pointer"/>
                </div>
                <span className="text-xs text-gray-500">点击设置头像</span>
             </div>
             <div><label className="block text-xs font-bold text-gray-700 mb-1">角色真名</label><input className="w-full p-2 border rounded bg-gray-50 focus:bg-white transition" placeholder="例如: 诸葛亮" value={newChar.name || ''} onChange={e => setNewChar({...newChar, name: e.target.value})} /></div>
             <div><label className="block text-xs font-bold text-gray-700 mb-1">备注名</label><input className="w-full p-2 border rounded bg-gray-50 focus:bg-white transition" placeholder="例如: 丞相" value={newChar.remark || ''} onChange={e => setNewChar({...newChar, remark: e.target.value})} /></div>
             <div><label className="block text-xs font-bold text-gray-700 mb-1">性格/人设描述</label><textarea className="w-full p-2 border rounded bg-gray-50 focus:bg-white h-24 text-sm" placeholder="描述角色的性格..." value={newChar.personality || ''} onChange={e => setNewChar({...newChar, personality: e.target.value})} /></div>
             <div><label className="block text-xs font-bold text-gray-700 mb-1">System Prompt</label><textarea className="w-full p-2 border rounded bg-gray-900 text-green-400 h-40 text-[10px] font-mono leading-relaxed" value={newChar.systemPrompt || DEFAULT_SYSTEM_PROMPT} onChange={e => setNewChar({...newChar, systemPrompt: e.target.value})} /></div>
             <div className="flex gap-2 pt-4">
                <button onClick={() => setIsCreating(false)} className="flex-1 py-3 rounded-lg bg-gray-100 text-gray-600 font-bold">取消</button>
                <button onClick={handleCreateChar} className="flex-1 py-3 rounded-lg bg-[#07c160] text-white font-bold shadow-lg shadow-green-200">完成创建</button>
             </div>
           </div>
        </div>
      )
    }

    if (activeTab === WeChatTab.CHATS) {
      const sortedChars = [...characters].sort((a, b) => {
          if (a.isPinned === b.isPinned) return 0;
          return a.isPinned ? -1 : 1;
      });
      return (
        <div className="divide-y divide-gray-200">
          {sortedChars.map(char => {
             const lastMsg = [...char.messages].filter(m => m.mode !== 'theater' && m.mode !== 'offline' && !m.isHidden).pop();
             return (
               <div 
                key={char.id} 
                onClick={() => setActiveChatId(char.id)}
                onContextMenu={(e) => { e.preventDefault(); setContextMenuCharId(char.id); }}
                onMouseDown={() => handleTouchStart(char.id)}
                onMouseUp={handleTouchEnd}
                onMouseLeave={handleTouchEnd}
                onTouchStart={() => handleTouchStart(char.id)}
                onTouchEnd={handleTouchEnd}
                className={`flex items-center p-3 active:bg-gray-100 cursor-pointer select-none ${char.isPinned ? 'bg-gray-50' : 'bg-white'}`}
               >
                 <div className="relative pointer-events-none">
                    <img src={char.avatar} className="w-12 h-12 rounded-lg object-cover mr-3 bg-gray-200" />
                    {char.unread ? <div className="absolute -top-1 right-2 w-4 h-4 bg-red-500 rounded-full border-2 border-white"></div> : null}
                 </div>
                 <div className="flex-1 min-w-0 pointer-events-none">
                   <div className="flex justify-between items-baseline mb-1">
                     <h3 className="font-medium text-gray-900 truncate flex items-center gap-1">{char.remark}{char.isPinned && <i className="fas fa-thumbtack text-xs text-gray-400 rotate-45"></i>}</h3>
                     <span className="text-xs text-gray-400">{lastMsg ? new Date(lastMsg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}</span>
                   </div>
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
         <div className="p-0">
            <div onClick={() => setIsCreating(true)} className="flex items-center p-3 border-b bg-white active:bg-gray-100 cursor-pointer">
                <div className="w-10 h-10 rounded bg-orange-400 flex items-center justify-center mr-3 text-white"><i className="fas fa-user-plus"></i></div>
                <span className="font-medium">新的朋友 / 创建角色</span>
            </div>
            <div className="bg-gray-100 px-3 py-1 text-xs text-gray-500">星标朋友</div>
            {characters.map(char => (
               <div 
                    key={char.id} 
                    className="flex items-center p-3 border-b bg-white active:bg-gray-100 cursor-pointer select-none"
                    onClick={() => setActiveChatId(char.id)}
                    onContextMenu={(e) => { e.preventDefault(); setContextMenuCharId(char.id); }}
                    onMouseDown={() => handleTouchStart(char.id)}
                    onMouseUp={handleTouchEnd}
                    onMouseLeave={handleTouchEnd}
                    onTouchStart={() => handleTouchStart(char.id)}
                    onTouchEnd={handleTouchEnd}
               >
                 <img src={char.avatar} className="w-10 h-10 rounded mr-3 object-cover pointer-events-none" />
                 <span className="font-medium pointer-events-none">{char.remark}</span>
               </div>
            ))}
         </div>
       )
    }

    if (activeTab === WeChatTab.ME) {
        return (
            <div className="p-4 bg-gray-50 h-full overflow-y-auto">
                <div className="bg-white p-6 rounded-xl shadow-sm space-y-6">
                    <div className="flex items-center justify-between border-b pb-4">
                        <h2 className="font-bold text-xl text-gray-800">全局用户人设</h2>
                        {isSavingPersona && <span className="text-[#07c160] text-sm font-bold animate-fade-in"><i className="fas fa-check"></i> 已保存</span>}
                    </div>
                    <div className="flex flex-col items-center">
                        <div className="relative w-24 h-24 group">
                            <img src={tempGlobalPersona.avatar} className="w-full h-full rounded-full object-cover shadow-md border-4 border-white" />
                            <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition cursor-pointer"><i className="fas fa-camera text-white"></i></div>
                            <input type="file" accept="image/*" onChange={handleGlobalAvatarUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                        </div>
                        <p className="text-xs text-gray-400 mt-2">点击更换全局头像</p>
                    </div>
                    <div><label className="block text-xs font-bold text-gray-500 mb-1 uppercase">我的名字</label><input value={tempGlobalPersona.name} onChange={(e) => setTempGlobalPersona({...tempGlobalPersona, name: e.target.value})} className="w-full p-3 bg-gray-50 rounded-lg border border-gray-200 focus:outline-none focus:border-[#07c160] transition" /></div>
                    <div><label className="block text-xs font-bold text-gray-500 mb-1 uppercase">我的性格/简介</label><textarea value={tempGlobalPersona.description} onChange={(e) => setTempGlobalPersona({...tempGlobalPersona, description: e.target.value})} className="w-full p-3 bg-gray-50 rounded-lg border border-gray-200 focus:outline-none focus:border-[#07c160] transition h-32 resize-none" placeholder="AI 将根据这个描述来认识你..." /></div>
                    <button onClick={saveGlobalPersona} className="w-full py-3 bg-[#07c160] hover:bg-[#06ad56] text-white font-bold rounded-xl shadow-lg shadow-green-200 active:scale-95 transition-all">保存全局设置</button>
                </div>
            </div>
        )
    }

    return (
        <div className="p-10 text-center text-gray-400 flex flex-col items-center justify-center h-full">
            <i className="fas fa-compass text-2xl mb-2"></i>
            <p>朋友圈功能开发中...</p>
        </div>
    );
  };

  return (
    <div className="h-full bg-gray-100 flex flex-col text-black relative">
      <div className="bg-[#ededed] p-3 border-b border-gray-300 flex justify-between items-end pb-2 sticky top-0 z-10">
         <h1 className="font-bold text-lg ml-1">微信 {isCreating ? '(创建)' : `(${characters.length})`}</h1>
         <div className="flex gap-4 mr-2"><i className="fas fa-search text-gray-900"></i><i className="fas fa-plus-circle text-gray-900" onClick={() => {setActiveTab(WeChatTab.CONTACTS); setIsCreating(true)}}></i></div>
      </div>
      <div className="flex-1 overflow-y-auto no-scrollbar relative">{renderContent()}</div>
      <div className="bg-[#f7f7f7] border-t border-gray-300 flex justify-around py-2 pb-6 sm:pb-2">
         {[{id: WeChatTab.CHATS, icon: 'comment', label: '微信'}, {id: WeChatTab.CONTACTS, icon: 'address-book', label: '通讯录'}, {id: WeChatTab.MOMENTS, icon: 'compass', label: '发现'}, {id: WeChatTab.ME, icon: 'user', label: '我'}].map(tab => (
           <button key={tab.id} onClick={() => {setActiveTab(tab.id as WeChatTab); setIsCreating(false)}} className={`flex flex-col items-center gap-0.5 ${activeTab === tab.id ? 'text-[#07c160]' : 'text-gray-900'}`}><i className={`fas fa-${tab.icon} text-xl mb-0.5`}></i><span className="text-[10px]">{tab.label}</span></button>
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
