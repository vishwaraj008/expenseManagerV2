// lib/gemini.js
import fetch from 'node-fetch';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_TIMEOUT = 8000; // 8 seconds timeout to leave buffer for other operations

// Fallback regex parser for simple patterns
function fallbackParser(text) {
  const patterns = [
    /(?:(\d+)\s+)?(\w+)/g,
    /(?:(\d+)\s*x\s*)?(\w+)/g,
    /(?:(\d+)\s*of\s*)?(\w+)/g
  ];
  
  const items = [];
  for (const pattern of patterns) {
    const matches = [...text.matchAll(pattern)];
    if (matches.length > 0) {
      for (const match of matches) {
        const quantity = parseInt(match[1]) || 1;
        const item = match[2].toLowerCase();
        if (item && quantity > 0) {
          items.push({ item, quantity });
        }
      }
      break;
    }
  }
  
  return { items };
}

export async function parseInput(text) {
  // First try fallback parser for simple cases
  const fallbackResult = fallbackParser(text);
  if (fallbackResult.items.length > 0) {
    console.log('Using fallback parser');
    return fallbackResult;
  }
  
  const prompt = `
You are a smart assistant that extracts item names and quantities from user inputs for expense tracking.

Known items: chai, chips, choti, connect, samosa

Rules:
1. Extract item names and quantities only
2. Only recognize the 5 known items above
3. Default quantity is 0 if not specified
4. Ignore extra words like "please", "give me", etc.
5. If an item is not in the known list, ignore it

Examples:
Input: "2 chai" → { "items": [{ "item": "chai", "quantity": 2 }] }
Input: "1 samosa and 1 chai" → { "items": [{ "item": "samosa", "quantity": 1 }, { "item": "chai", "quantity": 1 }] }
Input: "give me 3 chips" → { "items": [{ "item": "chips", "quantity": 3 }] }

Respond ONLY with valid JSON:
{
  "items": [
    { "item": "chai", "quantity": 2 }
  ]
}

User input: "${text}"
`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT);
    
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          topK: 1,
          topP: 1,
          maxOutputTokens: 150,
          stopSequences: []
        }
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }
    
    const data = await response.json();
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!content) {
      throw new Error('No content in Gemini response');
    }
    
    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Gemini output');
    }
    
    const parsed = JSON.parse(jsonMatch[0]);
    
    // Validate the response structure
    if (!parsed.items || !Array.isArray(parsed.items)) {
      throw new Error('Invalid response format from Gemini');
    }
    
    // Validate each item
    for (const item of parsed.items) {
      if (!item.item || typeof item.quantity !== 'number' || item.quantity <= 0) {
        throw new Error('Invalid item format in Gemini response');
      }
    }
    
    console.log('Gemini parsing successful');
    return parsed;
    
  } catch (error) {
    console.error('Gemini parsing failed:', error.message);
    // Fallback to regex parser
    const fallbackResult = fallbackParser(text);
    if (fallbackResult.items.length > 0) {
      console.log('Using fallback parser after Gemini failure');
      return fallbackResult;
    }
    throw new Error('Failed to parse input with both Gemini and fallback methods');
  }
}
