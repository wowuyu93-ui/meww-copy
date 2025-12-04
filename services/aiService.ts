
import { Message, AppSettings } from '../types';

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

// Generic fetch handler since user wants custom URL support
export const generateChatCompletion = async (
  messages: { role: string; content: string }[],
  settings: AppSettings
) => {
  try {
    const response = await fetch(`${settings.apiUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages: messages,
        temperature: 0.7,
        stream: false, // Simplifying to non-stream for this MVP structure
      }),
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error("AI Generation Failed:", error);
    throw error;
  }
};

export const fetchModels = async (settings: AppSettings): Promise<string[]> => {
  try {
    // Attempt standard OpenAI format model list
    const response = await fetch(`${settings.apiUrl.replace(/\/$/, '')}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${settings.apiKey}`,
        },
    });
    if (response.ok) {
        const data = await response.json();
        return data.data.map((m: any) => m.id);
    }
    return ['gemini-2.0-flash', 'gpt-4o', 'claude-3-opus']; // Fallback
  } catch (e) {
    return ['gemini-2.0-flash', 'gpt-4o'];
  }
}
