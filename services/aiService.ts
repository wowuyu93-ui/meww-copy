

import { GoogleGenAI } from "@google/genai";
import { AppSettings } from '../types';

// Helper to replace template variables
export const interpolatePrompt = (
  template: string, 
  variables: Record<string, string>
): string => {
  let result = template;
  Object.entries(variables).forEach(([key, value]) => {
    result = result.replace(new RegExp(`{${key}}`, 'g'), value || '');
  });
  return result;
};

// --- OpenAI Compatible Fallback ---
const fetchOpenAICompatible = async (
    messages: { role: string; content: string }[],
    settings: AppSettings,
    systemPrompt?: string
) => {
    const apiKey = settings.apiKey || process.env.API_KEY;
    if (!apiKey) throw new Error("API Key missing");

    let baseUrl = settings.apiUrl || "https://api.openai.com";
    // Normalize URL: Remove trailing slash
    baseUrl = baseUrl.replace(/\/+$/, '');

    let endpoint = baseUrl;
    // Automatic path correction logic requested by user
    if (!baseUrl.includes('/v1')) {
        endpoint = `${baseUrl}/v1/chat/completions`;
    } else if (baseUrl.endsWith('/v1')) {
        endpoint = `${baseUrl}/chat/completions`;
    } 
    // If user provided a specific path inside /v1 (rare), we trust them, 
    // but the above covers the 99% case of "https://api.example.com" -> "https://api.example.com/v1/chat/completions"

    console.log("⚠️ SDK failed. Falling back to OpenAI Protocol:", endpoint);

    // Transform messages to OpenAI format
    // 1. If system prompt exists, add it as the first message
    const openAIMessages = [];
    if (systemPrompt) {
        openAIMessages.push({ role: 'system', content: systemPrompt });
    }
    // 2. Add rest of messages
    messages.forEach(m => {
        if (m.role === 'system') return; // Skip embedded system messages if any, we handled it above
        openAIMessages.push({
            role: m.role === 'model' ? 'assistant' : 'user',
            content: m.content
        });
    });

    const body = {
        model: settings.model || 'gpt-3.5-turbo', // Fallback model name if generic, but usually users put 'gemini-1.5-flash' here too
        messages: openAIMessages,
        stream: false,
        temperature: 0.7
    };

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Protocol Error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
};

export const generateChatCompletion = async (
  messages: { role: string; content: string }[],
  settings: AppSettings
) => {
    // Extract system prompt first
    const systemMessage = messages.find(m => m.role === 'system');
    const systemContent = systemMessage ? systemMessage.content : undefined;
    const conversationMessages = messages.filter(m => m.role !== 'system');

    // 1. Try Google GenAI SDK First
    try {
        const apiKey = settings.apiKey || process.env.API_KEY;
        if (!apiKey) throw new Error("API Key not found.");

        const baseUrl = settings.apiUrl || undefined;
        
        // If baseUrl is clearly an OpenAI proxy (contains v1 but not googleapis), skip SDK and go straight to fallback
        if (baseUrl && baseUrl.includes('/v1') && !baseUrl.includes('googleapis')) {
             throw new Error("Detected OpenAI-compatible URL, skipping SDK.");
        }

        const ai = new GoogleGenAI({ apiKey, baseUrl });
        
        const contents = conversationMessages.map(msg => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }]
        }));

        const modelName = settings.model || 'gemini-1.5-flash';

        const response = await ai.models.generateContent({
            model: modelName,
            contents: contents,
            config: {
                systemInstruction: systemContent,
            }
        });

        return response.text;

    } catch (googleError: any) {
        // 2. Fallback to OpenAI Compatible Fetch
        // Only try if we have an API URL configured (implies custom proxy) or if we just want to try standard OpenAI endpoints
        if (settings.apiUrl) {
            try {
                return await fetchOpenAICompatible(messages, settings, systemContent);
            } catch (fallbackError: any) {
                // If fallback also fails, throw a combined error or the original
                console.error("Fallback also failed:", fallbackError);
                throw new Error(`Connection Failed. Check network.`);
            }
        }
        
        throw new Error("Connection Failed.");
    }
};

export const fetchModels = async (settings: AppSettings): Promise<string[]> => {
  const apiKey = settings.apiKey || process.env.API_KEY;
  if (!apiKey) throw new Error("请先填写 API Key");

  // Strategy 1: Google SDK / Official Endpoint
  try {
      let baseUrl = settings.apiUrl || "https://generativelanguage.googleapis.com";
      baseUrl = baseUrl.replace(/\/+$/, '');
      const url = `${baseUrl}/v1beta/models?key=${apiKey}`;
      
      // Skip if it looks like an OpenAI proxy
      if (baseUrl.includes('/v1') && !baseUrl.includes('googleapis')) {
          throw new Error("Skipping Google fetch for OpenAI proxy");
      }

      console.log("Fetching models (Google Protocol):", url);
      const response = await fetch(url);
      if (response.ok) {
          const data = await response.json();
          if (data.models && Array.isArray(data.models)) {
              return data.models
                  .map((m: any) => m.name.replace(/^models\//, ''))
                  .filter((name: string) => name.toLowerCase().includes('gemini'));
          }
      }
  } catch (e) {
      console.warn("Google Model Fetch failed:", e);
  }

  // Strategy 2: OpenAI Compatible Endpoint
  try {
      let baseUrl = settings.apiUrl || "https://api.openai.com";
      baseUrl = baseUrl.replace(/\/+$/, '');
      let endpoint = baseUrl;
      if (!baseUrl.includes('/v1')) endpoint = `${baseUrl}/v1/models`;
      else if (baseUrl.endsWith('/v1')) endpoint = `${baseUrl}/models`;
      else endpoint = `${baseUrl}/models`; // Assume path is correct

      console.log("Fetching models (OpenAI Protocol):", endpoint);
      const response = await fetch(endpoint, {
          headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      
      if (response.ok) {
          const data = await response.json();
          if (data.data && Array.isArray(data.data)) {
              return data.data.map((m: any) => m.id);
          }
      }
  } catch (e) {
      console.warn("OpenAI Model Fetch failed:", e);
  }

  // Fallback List if all network requests fail
  return [
    'gemini-2.5-flash',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
    'gemini-2.0-flash-exp',
    'gpt-3.5-turbo',
    'gpt-4o'
  ];
}