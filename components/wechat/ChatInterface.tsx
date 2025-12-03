
import React, { useState, useEffect, useRef } from 'react';
import { Character, Message, AppSettings, MemoryCard, Scenario } from '../../types';
import { generateChatCompletion, interpolatePrompt } from '../../services/aiService';
import { ARCHIVIST_PROMPT, FUSE_PROMPT, DEFAULT_OS_PROMPT, OFFLINE_LOADING_COLORS } from '../../constants';

interface ChatInterfaceProps {
  character: Character;
  settings: AppSettings;
  onBack: () => void;
  onUpdateCharacter: (c: Character) => void;
  onAddMessage: (charId: string, message: Message) => void;
  isGlobalGenerating: boolean;
  setGlobalGenerating: (isGenerating: boolean) => void;
}

type ViewMode = 'chat' | 'offline' | 'theater_list' | 'theater_room';

// --- Helper Components ---
const LoadingBubbles = ({ color }: { color?: string }) => (
  <div className="flex space-x-1 items-center bg-stone-800/80 px-4 py-2 rounded-full w-fit animate-fade-in border border-stone-600">
    <div className="w-2 h-2 rounded-full animate-bounce [animation-delay:-0.3s]" style={{ backgroundColor: color || '#f59e0b' }}></div>
    <div className="w-2 h-2 rounded-full animate-bounce [animation-delay:-0.15s]" style={{ backgroundColor: color || '#f59e0b' }}></div>
    <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: color || '#f59e0b' }}></div>
    <span className="text-xs text-stone-400 ml-2 font-serif">对方正在行动中...</span>
  </div>
);

const ChatInterface: React.FC<ChatInterfaceProps> = ({ character, settings, onBack, onUpdateCharacter, onAddMessage, isGlobalGenerating, setGlobalGenerating }) => {
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [showMemoryFurnace, setShowMemoryFurnace] = useState(false);
  const [showCharSettings, setShowCharSettings] = useState(false);
  const [showOfflineSettings, setShowOfflineSettings] = useState(false);
  const [showClearHistoryModal, setShowClearHistoryModal] = useState(false);
  const [showOSModal, setShowOSModal] = useState(false);
  
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  
  // Theater State
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [isCreatingScenario, setIsCreatingScenario] = useState(false);
  const [newScenario, setNewScenario] = useState<Partial<Scenario>>({});
  const [showScenarioSettings, setShowScenarioSettings] = useState(false);

  // Temp State
  const [tempCharConfig, setTempCharConfig] = useState<Character>(character);

  // Message Action State
  const [contextMenuMsgId, setContextMenuMsgId] = useState<string | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [quotingMsg, setQuotingMsg] = useState<Message | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const activeScenario = character.scenarios?.find(s => s.id === activeScenarioId);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [character.messages, isTyping, viewMode, quotingMsg, activeScenario]);

  useEffect(() => {
    setTempCharConfig(character);
  }, [character]);

  const currentUserAvatar = character.useLocalPersona ? (character.userMaskAvatar || 'https://ui-avatars.com/api/?name=U') : settings.globalPersona.avatar;

  // --- Theater Logic ---

  const handleCreateScenario = () => {
      if (!newScenario.title) return;
      const scenario: Scenario = {
          id: Date.now().toString(),
          title: newScenario.title,
          description: newScenario.description || '',
          systemPrompt: newScenario.systemPrompt || '这是一个全新的剧场世界。',
          isConnected: newScenario.isConnected ?? true,
          wallpaper: '',
          contextMemory: '',
          messages: [] 
      };
      onUpdateCharacter({
          ...character,
          scenarios: [scenario, ...(character.scenarios || [])]
      });
      setIsCreatingScenario(false);
      setNewScenario({});
  };

  const handleDeleteScenario = (id: string) => {
      if (!window.confirm("确定删除该剧场吗？")) return;
      const updatedScenarios = (character.scenarios || []).filter(s => s.id !== id);
      onUpdateCharacter({ ...character, scenarios: updatedScenarios });
      if (activeScenarioId === id) setViewMode('theater_list');
  };

  const updateActiveScenario = (updates: Partial<Scenario>) => {
      if (!activeScenarioId) return;
      const updatedScenarios = (character.scenarios || []).map(s => 
          s.id === activeScenarioId ? { ...s, ...updates } : s
      );
      onUpdateCharacter({ ...character, scenarios: updatedScenarios });
  };

  const exitTheater = () => {
      if (activeScenario && activeScenario.isConnected) {
           const exitMsg: Message = {
              id: Date.now().toString(),
              role: 'system',
              content: `[系统：用户已离开剧场模式: ${activeScenario.title}。请恢复正常微信聊天模式。]`,
              timestamp: Date.now(),
              mode: 'online',
              isHidden: true 
           };
           onAddMessage(character.id, exitMsg);
      }
      setActiveScenarioId(null);
      setViewMode('theater_list');
  };

  // --- Message Handling ---

  const handleSend = async (getReply: boolean, customContent?: string) => {
    if (isGlobalGenerating) return;
    if (getReply && !settings.apiKey) { alert("请先配置 API Key"); return; }

    const contentToSend = customContent || inputValue.trim();
    if (!contentToSend && !getReply) return;
    
    let newMessage: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: contentToSend,
        timestamp: Date.now(),
        mode: viewMode === 'offline' ? 'offline' : (viewMode === 'theater_room' ? 'theater' : 'online'),
        scenarioId: activeScenarioId || undefined,
        quote: quotingMsg ? {
            id: quotingMsg.id,
            content: quotingMsg.content,
            name: quotingMsg.role === 'model' ? character.remark : '我'
        } : undefined
    };
    
    // Optimistic Update for AI Context
    let updatedCharForAI = { ...character };

    if (viewMode === 'theater_room' && activeScenario && !activeScenario.isConnected) {
        const updatedScenarios = character.scenarios?.map(s => 
            s.id === activeScenarioId ? { ...s, messages: [...(s.messages || []), newMessage] } : s
        ) || [];
        onUpdateCharacter({ ...character, scenarios: updatedScenarios });
        updatedCharForAI = { ...character, scenarios: updatedScenarios };
    } else {
        onAddMessage(character.id, newMessage);
        updatedCharForAI = { ...character, messages: [...character.messages, newMessage] };
    }

    setInputValue('');
    setQuotingMsg(null);
    setShowDrawer(false); 

    if (getReply) {
      setIsTyping(true);
      setGlobalGenerating(true); 
      try {
        await fetchAIReply(updatedCharForAI); 
      } catch (e) {
        console.error(e);
        setIsTyping(false);
        setGlobalGenerating(false);
      }
    }
  };

  const handlePat = () => {
      const patMsg: Message = {
          id: Date.now().toString(),
          role: 'system',
          content: `你拍了拍 "${character.remark}"`,
          timestamp: Date.now(),
          mode: viewMode === 'theater_room' ? 'theater' : 'online',
          scenarioId: activeScenarioId || undefined
      };
      
      if (viewMode === 'theater_room' && activeScenario && !activeScenario.isConnected) {
         const updatedScenarios = character.scenarios?.map(s => 
            s.id === activeScenarioId ? { ...s, messages: [...(s.messages || []), patMsg] } : s
         ) || [];
         onUpdateCharacter({ ...character, scenarios: updatedScenarios });
      } else {
         onAddMessage(character.id, patMsg);
      }
  };
  
  const handleGame = (type: 'DICE') => {
      const val = Math.floor(Math.random() * 6) + 1;
      const result = `[骰子] 掷出了 ${val} 点`;
      handleSend(true, result);
  };

  const fetchAIReply = async (currentChar: Character) => {
    const isOffline = viewMode === 'offline';
    const isTheater = viewMode === 'theater_room';
    
    let currentScenario = null;
    if (isTheater && activeScenarioId) {
        currentScenario = currentChar.scenarios?.find(s => s.id === activeScenarioId);
    }

    const memoryInjection = currentChar.memories.map(m => `[长期记忆: ${m.content}]`).join('\n');
    const mainContext = currentChar.contextMemory ? `[主线重要上下文]: ${currentChar.contextMemory}` : '';
    
    const scenarioContext = (isTheater && currentScenario && !currentScenario.isConnected) 
        ? `[剧场上下文]: ${currentScenario.contextMemory || ''}` 
        : '';

    const userName = currentChar.useLocalPersona ? currentChar.userMaskName : settings.globalPersona.name;
    const userDesc = currentChar.useLocalPersona ? currentChar.userMaskDescription : settings.globalPersona.description;
    const personaInjection = userDesc ? `\n[用户(${userName})设定: ${userDesc}]` : '';
    const timeInjection = currentChar.realTimeMode ? `\n[现实世界时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}]` : '';

    let fullSystemPrompt = '';

    if (isTheater && currentScenario) {
        fullSystemPrompt = `[THEATER MODE: ${currentScenario.title}]\n${currentScenario.systemPrompt}\n\n${personaInjection}`;
        if (currentScenario.isConnected) {
            fullSystemPrompt += `\n\n[注意：本剧场与主线记忆互通]\n${memoryInjection}\n${mainContext}`;
        } else {
             fullSystemPrompt += `\n\n[注意：本剧场为独立平行宇宙]\n${scenarioContext}`;
        }
    } else if (isOffline) {
        fullSystemPrompt = interpolatePrompt(currentChar.offlineConfig.systemPrompt, {
            ai_name: currentChar.name,
            user_mask_name: userName,
            style: currentChar.offlineConfig.style,
            word_count: currentChar.offlineConfig.wordCount.toString()
        });
        fullSystemPrompt += `\n\n${memoryInjection}\n${mainContext}`;
    } else {
        let promptTemplate = currentChar.systemPrompt;
        if (currentChar.showOS && currentChar.osSystemPrompt) {
            promptTemplate += `\n\n${currentChar.osSystemPrompt}`;
        }
        let basePrompt = interpolatePrompt(promptTemplate, {
            ai_name: currentChar.name,
            user_mask_name: userName,
            personality: currentChar.personality,
        });
        fullSystemPrompt = `${basePrompt}${personaInjection}${timeInjection}\n\n${memoryInjection}\n${mainContext}`;
    }

    const historyCount = currentChar.historyCount || 20;
    let history: any[] = [];

    if (isTheater && currentScenario && !currentScenario.isConnected) {
        history = (currentScenario.messages || []).slice(-historyCount);
    } else {
        history = currentChar.messages.slice(-historyCount);
    }

    const processedHistory = history
      .filter(m => !m.isRecalled)
      .map(m => {
        let finalContent = m.content;
        if (m.quote) finalContent = `> 引用回复 "${m.quote.name}": ${m.quote.content}\n\n${m.content}`;
        return {
            role: m.role,
            content: m.role === 'model' 
              ? (m.osContent ? `<os>${m.osContent}</os><reply>${finalContent.split('|||').join(' ')}</reply>` : finalContent) 
              : finalContent
        };
      });

    let tailInjection = null;
    if (isOffline) {
        tailInjection = { role: 'system', content: `[System Instruction: You are in OFFLINE/REALITY mode. Maintain immersive description. Ignore WeChat format.]` };
    } else if (isTheater) {
        tailInjection = { role: 'system', content: `[系统指令：当前处于剧场模式。请严格扮演设定角色。]` };
    } else {
        tailInjection = { role: 'system', content: `[系统强制指令]\n用户已回到手机微信界面 (Online Mode)。\n1. **立即停止**任何动作、环境、神态描写。\n2. 必须严格遵守**短句**风格，不使用标点。\n3. 必须使用 **|||** 来分隔多条气泡消息。` };
    }

    const apiMessages = [
      { role: 'system', content: fullSystemPrompt },
      ...processedHistory,
      ...(tailInjection ? [tailInjection] : [])
    ];

    const rawResponse = await generateChatCompletion(apiMessages, settings);

    const osMatch = rawResponse.match(/<os>([\s\S]*?)<\/os>/);
    const osContent = osMatch ? osMatch[1].trim() : undefined;
    let replyContent = rawResponse.replace(/<os>[\s\S]*?<\/os>/, '').replace(/<reply>/, '').replace(/<\/reply>/, '').trim();
    
    const rawBubbles = replyContent.split('|||');
    const processedBubbles: {type: 'text'|'nudge', content: string}[] = [];
    rawBubbles.forEach(rb => {
        if (rb.includes('{{NUDGE}}')) {
            const parts = rb.split('{{NUDGE}}');
            parts.forEach((p, idx) => {
                if (p.trim()) processedBubbles.push({ type: 'text', content: p.trim() });
                if (idx < parts.length - 1) processedBubbles.push({ type: 'nudge', content: `${character.remark} 拍了拍我` });
            });
        } else {
            if (rb.trim()) processedBubbles.push({ type: 'text', content: rb.trim() });
        }
    });

    setIsTyping(false);

    for (let i = 0; i < processedBubbles.length; i++) {
        await new Promise(resolve => setTimeout(resolve, i === 0 ? 300 : 800));
        const item = processedBubbles[i];
        
        const newMsg: Message = {
            id: Date.now().toString() + i,
            role: item.type === 'nudge' ? 'system' : 'model',
            content: item.content,
            osContent: (i === 0 && item.type === 'text') ? osContent : undefined,
            timestamp: Date.now() + i,
            mode: isOffline ? 'offline' : (isTheater ? 'theater' : 'online'),
            scenarioId: activeScenarioId || undefined
        };

        if (isTheater && currentScenario && !currentScenario.isConnected) {
             const updatedScenarios = currentChar.scenarios?.map(s => 
                s.id === activeScenarioId ? { ...s, messages: [...(s.messages || []), newMsg] } : s
            ) || [];
            onUpdateCharacter({ ...currentChar, scenarios: updatedScenarios });
        } else {
            onAddMessage(currentChar.id, newMsg);
        }
    }
    
    setGlobalGenerating(false);
  };

  // --- Handlers ---

  const bindLongPress = (msgId: string) => ({
      onContextMenu: (e: any) => { e.preventDefault(); setContextMenuMsgId(msgId); }
  });

  const handleDeleteMsg = () => {
    if (!contextMenuMsgId) return;
    if (viewMode === 'theater_room' && activeScenario && !activeScenario.isConnected) {
        const updatedScenarios = (character.scenarios || []).map(s => 
            s.id === activeScenarioId 
            ? { ...s, messages: s.messages?.filter(m => m.id !== contextMenuMsgId) }
            : s
        );
        onUpdateCharacter({ ...character, scenarios: updatedScenarios });
    } else {
        onUpdateCharacter({ ...character, messages: character.messages.filter(m => m.id !== contextMenuMsgId) });
    }
    setContextMenuMsgId(null);
  };

  const handleRecallMsg = () => {
    if (!contextMenuMsgId) return;
    const logic = (msgs: Message[]) => msgs.map(m => {
        if (m.id === contextMenuMsgId) return { ...m, isRecalled: true, originalContent: m.content, content: '对方撤回了一条消息', osContent: undefined };
        return m;
    });

    if (viewMode === 'theater_room' && activeScenario && !activeScenario.isConnected) {
        const updatedScenarios = (character.scenarios || []).map(s => 
            s.id === activeScenarioId ? { ...s, messages: logic(s.messages || []) } : s
        );
        onUpdateCharacter({ ...character, scenarios: updatedScenarios });
    } else {
        onUpdateCharacter({ ...character, messages: logic(character.messages) });
    }
    setContextMenuMsgId(null);
  };

  const handleRegenerate = () => {
    if (!contextMenuMsgId) return;
    
    let targetList: Message[] = [];
    let isIsolated = false;

    if (viewMode === 'theater_room' && activeScenario && !activeScenario.isConnected) {
        targetList = activeScenario.messages || [];
        isIsolated = true;
    } else {
        targetList = character.messages;
    }

    const targetIndex = targetList.findIndex(m => m.id === contextMenuMsgId);
    if (targetIndex === -1) return;
    
    let rewindIndex = targetIndex;
    while (rewindIndex >= 0 && targetList[rewindIndex].role === 'model') {
        rewindIndex--;
    }
    if (rewindIndex < 0) { setContextMenuMsgId(null); return; }
    
    const prevMessages = targetList.slice(0, rewindIndex + 1);
    let tempCharState = { ...character };
    
    if (isIsolated) {
        const updatedScenarios = (character.scenarios || []).map(s => 
            s.id === activeScenarioId ? { ...s, messages: prevMessages } : s
        );
        onUpdateCharacter({ ...character, scenarios: updatedScenarios });
        tempCharState = { ...character, scenarios: updatedScenarios };
    } else {
        onUpdateCharacter({ ...character, messages: prevMessages });
        tempCharState = { ...character, messages: prevMessages };
    }

    setContextMenuMsgId(null);
    setIsTyping(true);
    setGlobalGenerating(true);
    fetchAIReply(tempCharState).catch(e => {
        console.error(e);
        setIsTyping(false);
        setGlobalGenerating(false);
    });
  };

  const startEdit = () => {
      let targetList = (viewMode === 'theater_room' && activeScenario && !activeScenario.isConnected) 
         ? activeScenario.messages 
         : character.messages;
      const msg = targetList?.find(m => m.id === contextMenuMsgId);
      if (msg) {
          setEditContent(msg.content);
          setEditingMsgId(contextMenuMsgId);
      }
      setContextMenuMsgId(null);
  };

  const confirmEdit = () => {
      if (!editingMsgId) return;
      const logic = (msgs: Message[]) => msgs.map(m => {
          if (m.id === editingMsgId) return { ...m, content: editContent };
          return m;
      });

      if (viewMode === 'theater_room' && activeScenario && !activeScenario.isConnected) {
          const updatedScenarios = (character.scenarios || []).map(s => 
              s.id === activeScenarioId ? { ...s, messages: logic(s.messages || []) } : s
          );
          onUpdateCharacter({ ...character, scenarios: updatedScenarios });
      } else {
          onUpdateCharacter({ ...character, messages: logic(character.messages) });
      }
      setEditingMsgId(null);
  };

  const handleQuoteMsg = () => {
      if (!contextMenuMsgId) return;
      const listToSearch = (viewMode === 'theater_room' && activeScenario && !activeScenario.isConnected) ? activeScenario.messages : character.messages;
      const msg = listToSearch?.find(m => m.id === contextMenuMsgId);
      if (msg && !msg.isRecalled) {
          setQuotingMsg(msg);
          if (inputRef.current) inputRef.current.focus();
      }
      setContextMenuMsgId(null);
  };

  // --- Common Logic ---
  const saveCharSettings = () => { onUpdateCharacter(tempCharConfig); setShowCharSettings(false); setShowOfflineSettings(false); };
  const handleOfflineBackgroundUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { const reader = new FileReader(); reader.onload = (ev) => { if (ev.target?.result) setTempCharConfig(prev => ({ ...prev, offlineConfig: { ...prev.offlineConfig, bgUrl: ev.target!.result as string } })); }; reader.readAsDataURL(file); }
  };
  const handleCharAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (file) { const reader = new FileReader(); reader.onload = (ev) => { if (ev.target?.result) setTempCharConfig(prev => ({...prev, avatar: ev.target!.result as string})); }; reader.readAsDataURL(file); }
  };
  const handleUserMaskAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (file) { const reader = new FileReader(); reader.onload = (ev) => { if (ev.target?.result) setTempCharConfig(prev => ({...prev, userMaskAvatar: ev.target!.result as string})); }; reader.readAsDataURL(file); }
  };
  const handleBackgroundUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (file) { const reader = new FileReader(); reader.onload = (ev) => { if (ev.target?.result) setTempCharConfig(prev => ({...prev, chatBackground: ev.target!.result as string})); }; reader.readAsDataURL(file); }
  };
  const toggleMemorySelection = (id: string) => {
    const updatedMemories = character.memories.map(m => m.id === id ? { ...m, selected: !m.selected } : m);
    onUpdateCharacter({ ...character, memories: updatedMemories });
  };
  const handleSummarize = async (scopeCount: number = 30, isAuto: boolean = false) => {
    if (!settings.apiKey) return;
    if (!isAuto) { setIsTyping(true); setGlobalGenerating(true); }
    const recentMsgs = character.messages.slice(-scopeCount).map(m => `[${m.mode === 'offline' ? '线下' : '线上'}] ${m.role}: ${m.content}`).join('\n');
    const prompt = `${ARCHIVIST_PROMPT}\n\n聊天记录 (最近${scopeCount}条):\n${recentMsgs}`;
    try {
      const result = await generateChatCompletion([{ role: 'user', content: prompt }], settings);
      let jsonStr = result.trim().replace(/^```json/, '').replace(/```$/, '');
      let parsed; try { parsed = JSON.parse(jsonStr); } catch { parsed = { summary: result, event: '总结' }; }
      const newMemory: MemoryCard = { id: Date.now().toString(), timestamp: Date.now(), location: parsed.location || '未知地点', event: parsed.event || '总结', content: parsed.summary || result, status: parsed.status, };
      onUpdateCharacter({ ...character, memories: [newMemory, ...character.memories] });
    } catch (e) { console.error("Summary failed", e); if (!isAuto) alert("总结失败"); }
    if (!isAuto) { setIsTyping(false); setGlobalGenerating(false); }
  };
  const handleFuse = async () => {
    if (!settings.apiKey) { alert("请配置 API Key"); return; }
    const selected = character.memories.filter(m => m.selected); if (selected.length < 2) return;
    setIsTyping(true); setGlobalGenerating(true);
    const contentToFuse = selected.map(m => m.content).join('\n---\n');
    try {
      const fusedContent = await generateChatCompletion([{ role: 'user', content: `${FUSE_PROMPT}\n\n待合并记忆:\n${contentToFuse}` }], settings);
      const newMemory: MemoryCard = { id: Date.now().toString(), timestamp: Date.now(), event: "融合记忆", content: fusedContent, location: "思维殿堂" };
      onUpdateCharacter({ ...character, memories: [newMemory, ...character.memories.filter(m => !m.selected)] });
    } catch (e) { console.error(e); }
    setIsTyping(false); setGlobalGenerating(false);
  };
  const confirmClearHistory = (clearAll: boolean) => {
      let updatedChar = { ...tempCharConfig, messages: [] };
      if (clearAll) { updatedChar.contextMemory = ''; updatedChar.memories = []; }
      setTempCharConfig(updatedChar);
      onUpdateCharacter({ ...character, ...updatedChar });
      setShowClearHistoryModal(false);
  };

  // --- RENDER HELPERS ---

  // Common Modal Render Logic
  const renderCommonModals = () => (
      <>
        {showOSModal && (
            <div className="absolute top-14 right-4 z-50 w-72 bg-white rounded-xl shadow-2xl border border-gray-200 p-4 animate-fade-in origin-top-right">
                <div className="flex justify-between items-center mb-3"><h3 className="font-bold text-gray-800 flex items-center gap-2"><i className="fas fa-eye text-indigo-600"></i> 内心 OS 模式</h3><button onClick={() => setShowOSModal(false)} className="text-gray-400 hover:text-gray-600"><i className="fas fa-times"></i></button></div>
                <div className="flex items-center justify-between mb-4 bg-gray-50 p-2 rounded"><span className="text-sm font-medium">OS 可见性开关</span><div className={`w-10 h-5 rounded-full cursor-pointer relative transition-colors ${character.showOS ? 'bg-green-500' : 'bg-gray-300'}`} onClick={() => onUpdateCharacter({ ...character, showOS: !character.showOS })}><div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow ${character.showOS ? 'left-5.5' : 'left-0.5'}`}></div></div></div>
                <div className="mb-2"><label className="text-xs font-bold text-gray-500 uppercase">OS 生成指令</label><textarea value={tempCharConfig.osSystemPrompt || DEFAULT_OS_PROMPT} onChange={(e) => setTempCharConfig({...tempCharConfig, osSystemPrompt: e.target.value})} onBlur={saveCharSettings} className="w-full h-32 mt-1 p-2 text-[10px] border border-gray-200 rounded bg-gray-50 focus:bg-white focus:outline-none focus:border-indigo-400 resize-none font-mono text-gray-600" /></div>
            </div>
        )}
        {contextMenuMsgId && (
            <div className="absolute inset-0 z-50 bg-black/20 flex flex-col justify-end" onClick={() => setContextMenuMsgId(null)}>
                <div className="bg-white rounded-t-2xl p-4 animate-slide-up space-y-2 shadow-2xl" onClick={e => e.stopPropagation()}>
                    <div className="text-center text-xs text-gray-400 mb-2">对消息进行操作</div>
                    <div className="grid grid-cols-5 gap-2">
                        <button onClick={handleRecallMsg} className="flex flex-col items-center gap-1 p-2 rounded-lg active:bg-gray-100"><div className="w-10 h-10 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center"><i className="fas fa-undo"></i></div><span className="text-xs">撤回</span></button>
                        <button onClick={handleRegenerate} className="flex flex-col items-center gap-1 p-2 rounded-lg active:bg-gray-100"><div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center"><i className="fas fa-sync-alt"></i></div><span className="text-xs">重回</span></button>
                        <button onClick={startEdit} className="flex flex-col items-center gap-1 p-2 rounded-lg active:bg-gray-100"><div className="w-10 h-10 bg-green-100 text-green-600 rounded-full flex items-center justify-center"><i className="fas fa-pen"></i></div><span className="text-xs">编辑</span></button>
                        <button onClick={handleQuoteMsg} className="flex flex-col items-center gap-1 p-2 rounded-lg active:bg-gray-100"><div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center"><i className="fas fa-quote-right"></i></div><span className="text-xs">引用</span></button>
                        <button onClick={handleDeleteMsg} className="flex flex-col items-center gap-1 p-2 rounded-lg active:bg-gray-100"><div className="w-10 h-10 bg-red-100 text-red-600 rounded-full flex items-center justify-center"><i className="fas fa-trash"></i></div><span className="text-xs">删除</span></button>
                    </div>
                    <button onClick={() => setContextMenuMsgId(null)} className="w-full py-3 mt-2 bg-gray-100 rounded-xl font-bold text-gray-600">取消</button>
                </div>
            </div>
        )}
        {editingMsgId && (
            <div className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center p-6"><div className="bg-white w-full rounded-xl p-4 shadow-xl"><h3 className="font-bold mb-2">编辑消息</h3><textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} className="w-full h-32 p-2 border rounded bg-gray-50 focus:outline-none focus:border-green-500 mb-4" /><div className="flex gap-2"><button onClick={() => setEditingMsgId(null)} className="flex-1 py-2 bg-gray-200 rounded">取消</button><button onClick={confirmEdit} className="flex-1 py-2 bg-[#07c160] text-white rounded font-bold">确定</button></div></div></div>
        )}
        {showClearHistoryModal && (
            <div className="absolute inset-0 z-[60] bg-black/50 flex items-center justify-center p-6"><div className="bg-white w-full rounded-xl p-6 shadow-xl animate-slide-up"><h3 className="font-bold text-lg text-red-600 mb-4 flex items-center gap-2"><i className="fas fa-exclamation-triangle"></i> 确认清空</h3><div className="space-y-3"><button onClick={() => confirmClearHistory(false)} className="w-full py-3 bg-gray-100 text-gray-800 rounded-xl font-bold hover:bg-gray-200">仅清空消息</button><button onClick={() => confirmClearHistory(true)} className="w-full py-3 bg-red-100 text-red-600 rounded-xl font-bold hover:bg-red-200">彻底清空 (含记忆)</button><button onClick={() => setShowClearHistoryModal(false)} className="w-full py-3 border border-gray-200 text-gray-500 rounded-xl font-medium mt-2">取消</button></div></div></div>
        )}
      </>
  );

  const renderImmersiveList = (messages: Message[], bgColor?: string) => (
      <div className="flex-1 overflow-y-auto p-6 space-y-8 no-scrollbar relative z-10" ref={messagesEndRef}>
           {messages.filter(m => !m.isHidden).map((msg) => (
               <div key={msg.id} {...bindLongPress(msg.id)} className={`animate-fade-in ${msg.role === 'user' ? 'pl-8 border-l-2 border-stone-600' : ''}`}>
                    <div className="text-xs text-stone-500 mb-1 font-sans uppercase tracking-wider flex justify-between">
                        <span>{msg.role === 'user' ? (character.useLocalPersona ? character.userMaskName : settings.globalPersona.name) : character.name}</span>
                        {msg.isRecalled && <span className="text-stone-600 italic">已撤回</span>}
                    </div>
                    {msg.quote && !msg.isRecalled && <div className="mb-2 pl-2 border-l-2 border-amber-600 bg-stone-800/50 p-1 text-xs text-stone-400 font-sans rounded"><span className="font-bold">{msg.quote.name}:</span> {msg.quote.content}</div>}
                    {msg.isRecalled ? <div className="text-stone-600 italic cursor-pointer text-sm" onClick={() => alert(`原内容:\n${msg.originalContent}`)}>(对方撤回了动作 - 点击偷看)</div> : <div className={`leading-loose text-lg whitespace-pre-wrap ${msg.role === 'user' ? 'text-stone-300 italic' : 'text-amber-100/90'}`}>{msg.content}</div>}
               </div>
           ))}
           {isTyping && <div className="mt-4 animate-slide-up"><LoadingBubbles color={bgColor} /></div>}
      </div>
  );

  const renderChatList = (messages: Message[]) => (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar">
        {messages.filter(m => !m.isHidden).map((msg, idx) => (
            <div key={msg.id} {...bindLongPress(msg.id)} className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}>
                {msg.role === 'model' && <img src={character.avatar} alt="avatar" onDoubleClick={handlePat} className="w-9 h-9 rounded bg-gray-300 mr-2 mt-0 object-cover cursor-pointer hover:opacity-90 active:scale-95 transition" />}
                {msg.role === 'system' && <div className="w-full flex justify-center my-2"><span className="bg-gray-200/50 text-gray-500 text-xs px-2 py-1 rounded">{msg.content}</span></div>}
                {msg.role !== 'system' && (
                    <div className={`max-w-[75%] flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} ${msg.quote ? 'min-w-[40%]' : 'w-fit'}`}>
                         {msg.mode === 'offline' && viewMode !== 'offline' && <span className="text-[10px] text-purple-600 bg-purple-100 px-1 rounded mb-1 inline-block">线下记忆</span>}
                         {msg.mode === 'theater' && viewMode !== 'theater_room' && <span className="text-[10px] text-pink-600 bg-pink-100 px-1 rounded mb-1 inline-block">剧场记忆</span>}
                        {character.showOS && msg.osContent && !msg.isRecalled && <div className="text-xs text-gray-500 italic mb-1 pl-1 border-l-2 border-indigo-300 animate-fade-in bg-white/50 p-1 rounded-r"><i className="fas fa-thought-bubble mr-1"></i>{msg.osContent}</div>}
                        {msg.isRecalled ? <div className="bg-gray-200 text-gray-500 text-xs px-2 py-1 rounded cursor-pointer select-none" onClick={() => alert(`原内容：\n${msg.originalContent}`)}>{msg.content} <span className="text-[8px]">(点击偷看)</span></div> : (
                            <div className={`p-2.5 rounded text-[15px] leading-relaxed break-words shadow-sm relative text-left max-w-full flex flex-col w-fit ${msg.role === 'user' ? 'bg-[#95ec69] text-black' : 'bg-white text-black'} ${msg.mode === 'offline' ? 'opacity-80 border border-purple-200' : ''}`}>
                                {msg.quote && <div className={`mb-1 p-1 rounded text-xs border-l-2 mb-2 w-full ${msg.role === 'user' ? 'bg-[#89d961] border-[#6dbf44] text-emerald-900' : 'bg-gray-100 border-gray-300 text-gray-500'}`}><span className="font-bold mr-1">{msg.quote.name}:</span><span className="line-clamp-2">{msg.quote.content}</span></div>}
                                <div className={`absolute top-3 w-2 h-2 rotate-45 ${msg.role === 'user' ? '-right-1 bg-[#95ec69]' : '-left-1 bg-white'}`}></div>
                                <span className="relative z-10 whitespace-pre-wrap">{msg.content}</span>
                            </div>
                        )}
                    </div>
                )}
                {msg.role === 'user' && <img src={currentUserAvatar} className="w-9 h-9 rounded bg-gray-300 ml-2 mt-0 object-cover"/>}
            </div>
        ))}
        <div ref={messagesEndRef} />
    </div>
  );

  // --- VIEW RENDERERS ---

  if (viewMode === 'theater_list') {
      return (
          <div className="flex flex-col h-full bg-stone-900 text-white relative animate-fade-in font-serif">
              <div className="p-4 flex items-center justify-between bg-stone-800 border-b border-stone-700">
                  <button onClick={() => setViewMode('chat')} className="text-stone-400 hover:text-white"><i className="fas fa-arrow-left"></i> 返回微信</button>
                  <h2 className="text-xl font-bold text-amber-500">剧场模式</h2>
                  <button onClick={() => setIsCreatingScenario(true)} className="text-amber-500 hover:text-amber-300"><i className="fas fa-plus"></i></button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {(character.scenarios || []).map(scenario => (
                      <div key={scenario.id} className="bg-stone-800 rounded-xl overflow-hidden shadow-lg border border-stone-700 relative group">
                          <div className="h-24 bg-gradient-to-r from-purple-900 to-indigo-900 p-4 flex flex-col justify-end relative">
                              {scenario.wallpaper && <img src={scenario.wallpaper} className="absolute inset-0 w-full h-full object-cover opacity-50" />}
                              <div className="relative z-10">
                                  <h3 className="font-bold text-lg">{scenario.title}</h3>
                                  <p className="text-xs text-stone-300 line-clamp-1">{scenario.description || '无简介'}</p>
                              </div>
                              <button onClick={(e) => { e.stopPropagation(); handleDeleteScenario(scenario.id); }} className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center bg-black/30 rounded-full text-stone-400 hover:text-red-500 z-20"><i className="fas fa-trash"></i></button>
                          </div>
                          <div className="p-4 flex justify-between items-center">
                              <span className={`text-xs px-2 py-1 rounded border ${scenario.isConnected ? 'border-green-800 text-green-400 bg-green-900/20' : 'border-indigo-800 text-indigo-400 bg-indigo-900/20'}`}>{scenario.isConnected ? '🔗 关联记忆' : '🌌 独立宇宙'}</span>
                              <button onClick={() => { setActiveScenarioId(scenario.id); setViewMode('theater_room'); }} className="px-4 py-2 bg-amber-700 text-white rounded font-bold text-sm hover:bg-amber-600">进入剧场</button>
                          </div>
                      </div>
                  ))}
                  {(character.scenarios || []).length === 0 && <div className="text-center text-stone-600 mt-10">暂无剧场，点击右上角创建。</div>}
              </div>
              {isCreatingScenario && (
                  <div className="absolute inset-0 bg-black/80 z-50 flex items-center justify-center p-6">
                      <div className="bg-stone-800 w-full max-w-sm rounded-xl p-6 shadow-2xl border border-stone-600">
                          <h3 className="text-amber-500 font-bold text-lg mb-4">创建新剧场</h3>
                          <input className="w-full bg-stone-900 border border-stone-700 p-2 rounded text-white mb-3 focus:border-amber-500 focus:outline-none" placeholder="剧场标题" value={newScenario.title || ''} onChange={e => setNewScenario({...newScenario, title: e.target.value})} />
                          <input className="w-full bg-stone-900 border border-stone-700 p-2 rounded text-white mb-3 text-sm focus:border-amber-500 focus:outline-none" placeholder="简介" value={newScenario.description || ''} onChange={e => setNewScenario({...newScenario, description: e.target.value})} />
                          <textarea className="w-full bg-stone-900 border border-stone-700 p-2 rounded text-white mb-3 text-xs h-24 focus:border-amber-500 focus:outline-none" placeholder="剧场世界观/System Prompt..." value={newScenario.systemPrompt || ''} onChange={e => setNewScenario({...newScenario, systemPrompt: e.target.value})} />
                          <div className="flex items-center justify-between mb-6 bg-stone-900 p-2 rounded border border-stone-700"><div><div className="text-sm font-bold text-stone-300">关联主线记忆</div><div className="text-[10px] text-stone-500">开启后AI记得主线发生的事</div></div><input type="checkbox" className="accent-amber-600 w-5 h-5" checked={newScenario.isConnected ?? true} onChange={e => setNewScenario({...newScenario, isConnected: e.target.checked})} /></div>
                          <div className="flex gap-3"><button onClick={() => setIsCreatingScenario(false)} className="flex-1 py-2 bg-stone-700 rounded text-stone-300">取消</button><button onClick={handleCreateScenario} className="flex-1 py-2 bg-amber-700 rounded text-white font-bold">创建</button></div>
                      </div>
                  </div>
              )}
          </div>
      );
  }

  if (viewMode === 'theater_room' && activeScenario) {
      const messagesToShow = activeScenario.isConnected ? character.messages.filter(m => m.scenarioId === activeScenario.id) : (activeScenario.messages || []);
      return (
          <div className="flex flex-col h-full relative text-black" style={{ backgroundImage: activeScenario.wallpaper ? `url(${activeScenario.wallpaper})` : undefined, backgroundColor: activeScenario.wallpaper ? undefined : '#292524', backgroundSize: 'cover', backgroundPosition: 'center' }}>
              <div className="absolute inset-0 bg-stone-900/30 pointer-events-none z-0"></div>
              <div className="p-3 bg-stone-900/80 backdrop-blur text-white flex justify-between items-center sticky top-0 z-20 border-b border-stone-700">
                   <div className="flex items-center gap-2"><button onClick={exitTheater} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20"><i className="fas fa-chevron-left"></i></button><div><div className="font-bold text-amber-500 text-sm flex items-center gap-2">{activeScenario.title}<span className="text-[10px] bg-stone-700 px-1 rounded text-stone-300">{activeScenario.isConnected ? '关联' : '独立'}</span></div><div className="text-[10px] text-stone-400">{character.remark}</div></div></div>
                   <button onClick={() => setShowScenarioSettings(true)} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20"><i className="fas fa-cog"></i></button>
              </div>
              {renderImmersiveList(messagesToShow, '#f59e0b')}
              {quotingMsg && <div className="bg-stone-800 px-3 py-2 flex justify-between items-center text-xs text-stone-300 border-t border-stone-600 relative z-20"><div className="truncate max-w-[85%]">引用: {quotingMsg.content}</div><button onClick={() => setQuotingMsg(null)}><i className="fas fa-times"></i></button></div>}
              <div className="bg-stone-900 p-3 border-t border-stone-700 relative z-20 flex gap-2"><input value={inputValue} onChange={e => setInputValue(e.target.value)} onKeyDown={e => { if(e.key === 'Enter') handleSend(true); }} className="flex-1 bg-stone-800 border border-stone-600 rounded-full px-4 text-white focus:outline-none focus:border-amber-600" placeholder="发送剧场消息..." /><button onClick={() => handleSend(true)} className="w-10 h-10 rounded-full bg-amber-600 text-white flex items-center justify-center font-bold"><i className="fas fa-paper-plane"></i></button></div>
              {showScenarioSettings && (
                  <div className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center p-6">
                      <div className="bg-stone-800 w-full max-w-sm rounded-xl p-6 shadow-2xl border border-stone-600 animate-slide-up">
                          <h3 className="text-amber-500 font-bold mb-4">剧场设置</h3>
                          <div className="space-y-4">
                              <div><label className="text-xs text-stone-400 font-bold uppercase">System Prompt</label><textarea className="w-full h-24 bg-stone-900 border border-stone-700 rounded p-2 text-xs text-stone-300 focus:border-amber-500 focus:outline-none" value={activeScenario.systemPrompt} onChange={e => updateActiveScenario({ systemPrompt: e.target.value })} /></div>
                              {!activeScenario.isConnected && <div><label className="text-xs text-stone-400 font-bold uppercase">独立上下文 (Context)</label><textarea className="w-full h-16 bg-stone-900 border border-stone-700 rounded p-2 text-xs text-stone-300 focus:border-amber-500 focus:outline-none" value={activeScenario.contextMemory || ''} onChange={e => updateActiveScenario({ contextMemory: e.target.value })} /></div>}
                              <div><label className="text-xs text-stone-400 font-bold uppercase">剧场壁纸</label><input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) { const reader = new FileReader(); reader.onload = (ev) => { if (ev.target?.result) updateActiveScenario({ wallpaper: ev.target!.result as string }); }; reader.readAsDataURL(file); } }} className="text-xs text-stone-500 w-full mt-1" /></div>
                          </div>
                          <button onClick={() => setShowScenarioSettings(false)} className="w-full mt-6 py-2 bg-stone-700 text-stone-200 rounded font-bold">关闭</button>
                      </div>
                  </div>
              )}
              {/* RENDER MODALS IN THEATER VIEW */}
              {renderCommonModals()}
          </div>
      );
  }

  if (viewMode === 'offline') {
      const bgStyle = character.offlineConfig.bgUrl ? { backgroundImage: `url(${character.offlineConfig.bgUrl})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' } : { backgroundColor: '#1c1917' };
      return (
          <div className="flex flex-col h-full relative text-stone-200 font-serif" style={bgStyle}>
               <div className="absolute inset-0 bg-black/40 pointer-events-none z-0"></div>
               <div className="p-4 flex justify-between items-center sticky top-0 z-20"><button onClick={() => setViewMode('chat')} className="bg-black/20 backdrop-blur rounded-full w-10 h-10 flex items-center justify-center text-white/80 hover:bg-black/40 transition"><i className="fas fa-sign-out-alt"></i></button><button onClick={() => setShowOfflineSettings(true)} className="bg-black/20 backdrop-blur rounded-full w-10 h-10 flex items-center justify-center text-white/80 hover:bg-black/40 transition"><i className="fas fa-sliders-h"></i></button></div>
               {renderImmersiveList(character.messages.filter(m => m.mode === 'offline'), character.offlineConfig.indicatorColor)}
               <div className="p-4 bg-stone-950 border-t border-stone-800 relative z-20"><div className="relative"><textarea value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={(e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(true); } }} className="w-full bg-stone-900 text-stone-300 border border-stone-700 rounded-lg p-3 pr-12 focus:outline-none focus:border-amber-700 resize-none h-24 font-sans" placeholder="描述你的动作、语言..." disabled={isGlobalGenerating} /><button onClick={() => handleSend(true)} disabled={isGlobalGenerating} className={`absolute bottom-3 right-3 transition ${isGlobalGenerating ? 'text-gray-600' : 'text-amber-600 hover:text-amber-400'}`}><i className="fas fa-feather-alt text-xl"></i></button></div></div>
               {showOfflineSettings && (
                   <div className="absolute inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
                       <div className="bg-stone-900 border border-stone-700 w-full max-w-md rounded-lg p-6 shadow-2xl animate-slide-up text-stone-300 max-h-full overflow-y-auto">
                           <h3 className="font-bold text-xl text-amber-500 mb-6 border-b border-stone-800 pb-2">线下模式配置</h3>
                           <div className="space-y-4 font-sans">
                               <div><label className="text-xs uppercase font-bold text-stone-500">指示器颜色</label><div className="flex gap-2 mt-1 flex-wrap">{OFFLINE_LOADING_COLORS.map(c => (<button key={c.name} onClick={() => setTempCharConfig({...tempCharConfig, offlineConfig: {...tempCharConfig.offlineConfig, indicatorColor: c.value}})} className={`w-6 h-6 rounded-full border border-stone-600 ${tempCharConfig.offlineConfig.indicatorColor === c.value ? 'ring-2 ring-white scale-110' : ''}`} style={{ backgroundColor: c.value }} />))}</div></div>
                               <div><label className="text-xs uppercase font-bold text-stone-500">文风设定</label><input value={tempCharConfig.offlineConfig.style} onChange={e => setTempCharConfig({...tempCharConfig, offlineConfig: {...tempCharConfig.offlineConfig, style: e.target.value}})} className="w-full bg-stone-800 border-stone-700 rounded p-2 mt-1 focus:outline-none focus:border-amber-600" /></div>
                               <div><label className="text-xs uppercase font-bold text-stone-500">回复字数限制</label><input type="number" value={tempCharConfig.offlineConfig.wordCount} onChange={e => setTempCharConfig({...tempCharConfig, offlineConfig: {...tempCharConfig.offlineConfig, wordCount: parseInt(e.target.value) || 150}})} className="w-full bg-stone-800 border-stone-700 rounded p-2 mt-1 focus:outline-none focus:border-amber-600" placeholder="150" /></div>
                               <div><label className="text-xs uppercase font-bold text-stone-500">场景壁纸</label><div className="flex items-center gap-2 mt-1"><div className="w-12 h-12 bg-stone-800 border border-stone-700 rounded overflow-hidden">{tempCharConfig.offlineConfig.bgUrl ? <img src={tempCharConfig.offlineConfig.bgUrl} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-xs text-stone-600">无</div>}</div><input type="file" accept="image/*" onChange={handleOfflineBackgroundUpload} className="flex-1 text-xs text-stone-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-stone-700 file:text-stone-300" /></div></div>
                               <div><label className="text-xs uppercase font-bold text-stone-500">System Prompt</label><textarea value={tempCharConfig.offlineConfig.systemPrompt} onChange={e => setTempCharConfig({...tempCharConfig, offlineConfig: {...tempCharConfig.offlineConfig, systemPrompt: e.target.value}})} className="w-full bg-stone-800 border-stone-700 rounded p-2 mt-1 h-32 text-xs font-mono focus:outline-none focus:border-amber-600" /></div>
                           </div>
                           <div className="mt-6 flex gap-3"><button onClick={() => setShowOfflineSettings(false)} className="flex-1 py-2 bg-stone-800 rounded hover:bg-stone-700">取消</button><button onClick={saveCharSettings} className="flex-1 py-2 bg-amber-700 text-black font-bold rounded hover:bg-amber-600">保存生效</button></div>
                       </div>
                   </div>
               )}
               {/* RENDER MODALS IN OFFLINE VIEW */}
               {renderCommonModals()}
          </div>
      );
  }

  // ONLINE MODE
  const mainChatMessages = character.messages.filter(m => m.mode !== 'theater' && m.mode !== 'offline'); 

  return (
    <div className="flex flex-col h-full relative text-black" style={{ backgroundImage: character.chatBackground ? `url(${character.chatBackground})` : undefined, backgroundColor: character.chatBackground ? undefined : '#ededed', backgroundSize: 'cover', backgroundPosition: 'center' }}>
      <div className="bg-[#ededed]/95 backdrop-blur border-b border-gray-300 p-3 flex items-center justify-between sticky top-0 z-20 h-[60px]">
        <div className="flex items-center"><button onClick={onBack} className="mr-3 text-gray-800 active:text-gray-500"><i className="fas fa-chevron-left text-lg"></i></button><div className="flex flex-col cursor-pointer select-none" onDoubleClick={handlePat}><span className="font-bold text-gray-900 text-base">{character.remark}</span>{isTyping && <span className="text-[10px] text-gray-500">对方正在输入...</span>}</div></div>
        <div className="flex gap-4"><button onClick={() => setShowOSModal(true)} className={`w-8 h-8 rounded-full flex items-center justify-center transition ${character.showOS ? 'text-indigo-600 bg-indigo-100' : 'text-gray-600 hover:bg-gray-200'}`}><i className="fas fa-eye"></i></button><button onClick={() => setShowMemoryFurnace(true)} className="w-8 h-8 rounded-full hover:bg-gray-200 text-gray-600 flex items-center justify-center transition"><i className="fas fa-brain"></i></button></div>
      </div>
      {renderChatList(mainChatMessages)} 
      {quotingMsg && <div className="bg-gray-100 px-3 py-2 flex justify-between items-center text-xs text-gray-500 border-t border-gray-200"><div className="truncate max-w-[85%]">回复 <span className="font-bold text-gray-700">{quotingMsg.role === 'model' ? character.remark : '我'}</span>: {quotingMsg.content}</div><button onClick={() => setQuotingMsg(null)}><i className="fas fa-times"></i></button></div>}
      <div className="bg-[#f7f7f7] p-2 border-t border-gray-300 flex flex-col gap-2 relative z-20">
        <div className="flex items-end gap-2"><button onClick={() => setShowDrawer(!showDrawer)} className={`w-8 h-8 mb-1 rounded-full border text-xl flex items-center justify-center transition-all ${showDrawer ? 'rotate-45 border-gray-600 text-gray-800' : 'border-gray-400 text-gray-500'}`} disabled={isGlobalGenerating}><i className="fas fa-plus-circle"></i></button><div className="flex-1 bg-white rounded p-2 min-h-[40px]"><textarea ref={inputRef} value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(false); }}} disabled={isGlobalGenerating} className="w-full bg-transparent resize-none focus:outline-none text-base max-h-24 disabled:text-gray-400" rows={1} /></div><div className="flex flex-col gap-1"><button onClick={() => handleSend(false)} disabled={isGlobalGenerating} className="bg-gray-200 text-gray-600 px-2 py-1 rounded text-[10px] font-bold whitespace-nowrap active:bg-gray-300 disabled:opacity-50">上屏</button><button onClick={() => handleSend(true)} disabled={isGlobalGenerating} className={`px-3 py-1 rounded text-sm font-bold shadow-sm whitespace-nowrap transition-colors ${isGlobalGenerating ? 'bg-gray-300 text-gray-100 cursor-not-allowed' : 'bg-[#07c160] text-white active:bg-[#06ad56]'}`}>发送</button></div></div>
        {showDrawer && (
            <div className="grid grid-cols-4 gap-6 p-6 bg-[#f7f7f7] border-t border-gray-200 animate-slide-up h-[220px]">
                 <button onClick={() => setShowCharSettings(true)} className="flex flex-col items-center gap-2 group"><div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center text-gray-600 shadow-sm group-active:bg-gray-200"><i className="fas fa-user-cog text-2xl"></i></div><span className="text-xs text-gray-500">聊天设置</span></button>
                 <button onClick={() => setViewMode('offline')} className="flex flex-col items-center gap-2 group"><div className="w-14 h-14 bg-stone-800 rounded-2xl flex items-center justify-center text-amber-500 shadow-sm group-active:bg-stone-700"><i className="fas fa-street-view text-2xl"></i></div><span className="text-xs text-gray-500">线下模式</span></button>
                 <button onClick={() => setViewMode('theater_list')} className="flex flex-col items-center gap-2 group"><div className="w-14 h-14 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-sm group-active:scale-95"><i className="fas fa-theater-masks text-2xl"></i></div><span className="text-xs text-gray-500">小剧场</span></button>
                 <button onClick={() => handleGame('DICE')} className="flex flex-col items-center gap-2 group"><div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center text-pink-500 shadow-sm group-active:bg-gray-200"><i className="fas fa-dice text-2xl"></i></div><span className="text-xs text-gray-500">掷骰子</span></button>
            </div>
        )}
      </div>
      {/* RENDER MODALS IN ONLINE VIEW */}
      {renderCommonModals()}
      {showCharSettings && (
          <div className="absolute inset-0 bg-gray-100 z-50 flex flex-col animate-slide-up">
              <div className="bg-white p-4 shadow-sm flex items-center justify-between sticky top-0"><button onClick={() => setShowCharSettings(false)} className="text-gray-600 font-medium">取消</button><h3 className="font-bold text-lg">聊天信息</h3><button onClick={saveCharSettings} className="bg-[#07c160] text-white px-3 py-1 rounded font-bold text-sm">完成</button></div>
              <div className="flex-1 overflow-y-auto p-4 space-y-6">
                  <div className="bg-white p-4 rounded-xl shadow-sm"><div className="flex items-center justify-between"><div><h4 className="font-bold text-gray-700">本聊天室人设</h4><p className="text-xs text-gray-400">是否为此角色单独设置你的身份？</p></div><label className="relative inline-flex items-center cursor-pointer"><input type="checkbox" className="sr-only peer" checked={tempCharConfig.useLocalPersona} onChange={(e) => setTempCharConfig({...tempCharConfig, useLocalPersona: e.target.checked})} /><div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#07c160]"></div></label></div>{tempCharConfig.useLocalPersona && <div className="mt-4 pt-4 border-t border-gray-100 space-y-3 animate-fade-in"><div className="flex items-center gap-4"><div className="relative w-14 h-14"><img src={tempCharConfig.userMaskAvatar || 'https://ui-avatars.com/api/?name=U'} className="w-full h-full rounded-lg object-cover bg-gray-100" /><input type="file" accept="image/*" onChange={handleUserMaskAvatarUpload} className="absolute inset-0 opacity-0 cursor-pointer" /></div><div className="flex-1"><input value={tempCharConfig.userMaskName} onChange={e => setTempCharConfig({...tempCharConfig, userMaskName: e.target.value})} className="text-sm font-bold border-b w-full p-1 mb-2 focus:border-green-500 focus:outline-none" placeholder="你的名字" /><input value={tempCharConfig.userMaskDescription || ''} onChange={e => setTempCharConfig({...tempCharConfig, userMaskDescription: e.target.value})} className="text-xs text-gray-500 border-b w-full p-1 focus:border-green-500 focus:outline-none" placeholder="你的人设描述..." /></div></div></div>}</div>
                  <div className="bg-white p-4 rounded-xl shadow-sm flex items-center justify-between"><div><h4 className="font-bold text-gray-700">真实时间模式</h4></div><label className="relative inline-flex items-center cursor-pointer"><input type="checkbox" className="sr-only peer" checked={!!tempCharConfig.realTimeMode} onChange={(e) => setTempCharConfig({...tempCharConfig, realTimeMode: e.target.checked})} /><div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-blue-500"></div></label></div>
                  <div className="bg-white p-4 rounded-xl flex items-center gap-4 shadow-sm"><div className="relative w-16 h-16"><img src={tempCharConfig.avatar} className="w-full h-full rounded-lg object-cover bg-gray-200" /><input type="file" accept="image/*" onChange={handleCharAvatarUpload} className="absolute inset-0 opacity-0 cursor-pointer" /><div className="absolute bottom-0 right-0 bg-black/50 text-white text-[10px] px-1 rounded">更换</div></div><div className="flex-1 space-y-2"><input value={tempCharConfig.remark} onChange={e => setTempCharConfig({...tempCharConfig, remark: e.target.value})} className="text-lg font-bold border-b border-gray-200 w-full focus:outline-none focus:border-green-500" placeholder="备注名" /><input value={tempCharConfig.name} onChange={e => setTempCharConfig({...tempCharConfig, name: e.target.value})} className="text-sm text-gray-500 border-b border-gray-200 w-full focus:outline-none focus:border-green-500" placeholder="AI真名" /></div></div>
                  <div className="bg-white p-4 rounded-xl shadow-sm"><h4 className="font-bold text-gray-700 mb-2">聊天背景</h4><div className="flex items-center gap-4"><div className="w-16 h-24 bg-gray-100 border rounded overflow-hidden">{tempCharConfig.chatBackground ? <img src={tempCharConfig.chatBackground} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-gray-300"><i className="fas fa-image"></i></div>}</div><div className="flex-1"><input type="file" accept="image/*" onChange={handleBackgroundUpload} className="text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-green-50 file:text-green-700 hover:file:bg-green-100"/><button onClick={() => setTempCharConfig({...tempCharConfig, chatBackground: undefined})} className="text-xs text-red-500 mt-2 ml-4">清除背景</button></div></div></div>
                  <div className="bg-white p-4 rounded-xl shadow-sm"><h4 className="font-bold text-gray-700 mb-2">上下文记忆</h4><textarea value={tempCharConfig.contextMemory} onChange={e => setTempCharConfig({...tempCharConfig, contextMemory: e.target.value})} className="w-full h-24 p-2 text-sm bg-yellow-50 border border-yellow-200 rounded focus:outline-none focus:ring-1 focus:ring-yellow-400" /></div>
                  <div className="bg-white p-4 rounded-xl shadow-sm"><h4 className="font-bold text-gray-700 mb-2">角色人设 (Personality)</h4><textarea value={tempCharConfig.personality} onChange={e => setTempCharConfig({...tempCharConfig, personality: e.target.value})} className="w-full h-24 p-2 text-xs border border-gray-200 rounded focus:outline-none focus:border-green-500 resize-none bg-gray-50" /></div>
                  <div className="bg-white p-4 rounded-xl shadow-sm"><h4 className="font-bold text-gray-700 mb-2">System Prompt</h4><textarea value={tempCharConfig.systemPrompt} onChange={e => setTempCharConfig({...tempCharConfig, systemPrompt: e.target.value})} className="w-full h-40 p-2 text-[10px] font-mono bg-gray-900 text-green-400 rounded leading-relaxed focus:outline-none" /></div>
                  <div className="bg-red-50 p-4 rounded-xl shadow-sm border border-red-100 mt-4"><button onClick={() => setShowClearHistoryModal(true)} className="w-full py-2 bg-white border border-red-200 text-red-600 rounded font-bold text-sm shadow-sm hover:bg-red-50"><i className="fas fa-trash-alt mr-2"></i> 清空该角色聊天记录</button></div>
              </div>
          </div>
      )}
      {showMemoryFurnace && (
        <div className="absolute inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"><div className="bg-[#f2f2f2] w-full h-[90%] sm:h-[650px] sm:rounded-2xl rounded-t-2xl flex flex-col shadow-2xl animate-slide-up"><div className="p-4 border-b flex justify-between items-center bg-white rounded-t-2xl sticky top-0 z-10"><h3 className="font-bold text-gray-900 flex items-center gap-2"><span className="w-8 h-8 rounded bg-indigo-100 text-indigo-600 flex items-center justify-center"><i className="fas fa-brain"></i></span>记忆熔炉</h3><button onClick={() => setShowMemoryFurnace(false)} className="bg-gray-200 w-8 h-8 rounded-full text-gray-600"><i className="fas fa-times"></i></button></div><div className="bg-indigo-50 p-4 border-b border-indigo-100"><div className="flex items-center justify-between mb-2"><span className="text-sm font-bold text-indigo-900">自动总结设置</span><label className="relative inline-flex items-center cursor-pointer"><input type="checkbox" className="sr-only peer" checked={tempCharConfig.furnaceConfig?.autoEnabled} onChange={(e) => { const newConfig = { ...tempCharConfig.furnaceConfig, autoEnabled: e.target.checked }; setTempCharConfig({...tempCharConfig, furnaceConfig: newConfig}); onUpdateCharacter({...character, furnaceConfig: newConfig}); }} /><div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-indigo-600"></div></label></div></div><div className="flex-1 overflow-y-auto p-4 space-y-3">{character.memories.map(mem => (<div key={mem.id} className={`bg-white p-4 rounded-xl shadow-sm relative transition-all border ${mem.selected ? 'border-indigo-500 ring-2 ring-indigo-100' : 'border-gray-200'}`}><div onClick={() => toggleMemorySelection(mem.id)} className="cursor-pointer"><div className="flex justify-between items-start mb-2"><div className="flex gap-2 items-center"><span className="bg-blue-100 text-blue-700 text-[10px] px-2 py-0.5 rounded font-bold">{mem.location || '记忆'}</span><span className="text-xs text-gray-400">{new Date(mem.timestamp).toLocaleDateString()}</span></div><input type="checkbox" checked={!!mem.selected} onChange={() => toggleMemorySelection(mem.id)} className="w-5 h-5 accent-indigo-600 pointer-events-none" /></div><div className="font-bold text-gray-900 mb-2">{mem.event}</div><div className="text-sm text-gray-600 leading-relaxed text-justify">{mem.content}</div></div></div>))}</div><div className="p-4 bg-white border-t flex flex-col gap-3 pb-8 sm:pb-4 rounded-b-2xl"><div className="flex gap-3"><button onClick={() => handleSummarize(tempCharConfig.furnaceConfig?.manualScope || 30, false)} disabled={isTyping} className="flex-1 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition shadow-sm">{isTyping ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-compress-alt"></i>} 立即总结</button><button onClick={handleFuse} disabled={character.memories.filter(m => m.selected).length < 2 || isTyping} className="flex-1 bg-gradient-to-r from-indigo-500 to-purple-600 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg hover:shadow-indigo-500/30 transition"><i className="fas fa-fire-alt"></i> 熔炼选中</button></div></div></div></div>
      )}
    </div>
  );
};

export default ChatInterface;
