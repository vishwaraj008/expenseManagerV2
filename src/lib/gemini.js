// lib/gemini.js
import fetch from 'node-fetch';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_TIMEOUT = 8000; // 8 seconds timeout to leave buffer for other operations

// Fallback regex parser for simple patterns
function fallbackParser(text, availableItems = []) {
  const validItems = availableItems.length > 0 ? availableItems : ['chai', 'chips', 'choti', 'connect', 'samosa'];
  const itemVariations = {
    'tea': 'chai',
    'chip': 'chips',
    'chais': 'chai',
    'samosas': 'samosa'
  };
  
  const patterns = [
    /(?:(\d+)\s+)?(\w+)/g,
    /(?:(\d+)\s*x\s*)?(\w+)/g,
    /(?:(\d+)\s*of\s*)?(\w+)/g
  ];
  
  const items = [];
  const foundItems = new Set();
  
  for (const pattern of patterns) {
    const matches = [...text.matchAll(pattern)];
    if (matches.length > 0) {
      for (const match of matches) {
        let quantity = parseInt(match[1]);
        let item = match[2].toLowerCase();
        
        // Handle item variations
        if (itemVariations[item]) {
          item = itemVariations[item];
        }
        
        // Only include valid items with quantity > 0
        if (validItems.includes(item) && !foundItems.has(item)) {
          if (isNaN(quantity) || quantity === null || quantity === undefined) {
            quantity = 1; // Default to 1 if no quantity specified
          } else if (quantity <= 0) {
            continue; // Skip items with 0 or negative quantity
          }
          items.push({ item, quantity });
          foundItems.add(item);
        }
      }
      break;
    }
  }
  
  return { items };
}

export async function parseInput(text, config = {}) {
  // Get available items from config
  const availableItems = Object.keys(config);
  
  // First try fallback parser for simple cases
  const fallbackResult = fallbackParser(text, availableItems);
  if (fallbackResult.items.length > 0) {
    console.log('Using fallback parser');
    return fallbackResult;
  }
  
  const itemsList = availableItems.join(', ');
  const itemPrices = availableItems.map(item => `${item} - ₹${config[item]}`).join('\n');
  
  const prompt = `
You are an intelligent expense tracking assistant. Analyze user messages to understand their intent and extract food item orders.

AVAILABLE ITEMS WITH PRICES:
${itemPrices}

AVAILABLE ITEMS LIST: ${itemsList}

INTENT UNDERSTANDING RULES:
Try understanding what user want to say. suppose user don't know how to interact clearly, so to understand user intent
1. ONLY extract items from the available list above
2. If user mentions an item NOT in the list, completely ignore it (don't include in response)
3. If quantity is specified as 0 than its ignored
4. If no quantity specified, assume quantity = 1
5. Handle natural language: "give me", "I want", "bring", "get me", etc.
6. Handle plurals and variations based on available items
7. Handle multilingual numbers (Hindi/English): "chaar" = 4, "paanch" = 5, "teen" = 3, "do" = 2, "ek" = 1, "chheh" = 6, "saat" = 7, "aath" = 8, "nau" = 9, "das" = 10
8. Handle English number words: "one" = 1, "two" = 2, "three" = 3, "four" = 4, "five" = 5, "six" = 6, "seven" = 7, "eight" = 8, "nine" = 9, "ten" = 10
9. Handle item variations: "tea" = "chai", "chips" can be "chip"

EXAMPLES:
"2 chai" → {"items": [{"item": "chai", "quantity": 2}]}
"chaar chai" → {"items": [{"item": "chai", "quantity": 4}]}
"five tea" → {"items": [{"item": "chai", "quantity": 5}]}
"teen samosa" → {"items": [{"item": "samosa", "quantity": 3}]}
"do chips aur ek chai" → {"items": [{"item": "chips", "quantity": 2}, {"item": "chai", "quantity": 1}]}
"get me chai" → {"items": [{"item": "chai", "quantity": 1}]}
"unknown_item and 2 chai" → {"items": [{"item": "chai", "quantity": 2}]} (unknown ignored)
"just checking" → {"items": []} (no valid items)

RESPONSE FORMAT: Return ONLY valid JSON with this exact structure:
{
  "items": [
    {"item": "chai", "quantity": 2},
    {"item": "samosa", "quantity": 1}
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
    
    // Validate each item and filter to only available items
    const validItems = [];
    for (const item of parsed.items) {
      if (item.item && typeof item.quantity === 'number' && item.quantity > 0 && availableItems.includes(item.item)) {
        validItems.push(item);
      }
    }
    
    console.log('Gemini parsing successful');
    return { items: validItems };
    
  } catch (error) {
    console.error('Gemini parsing failed:', error.message);
    // Fallback to regex parser with available items filter
    const fallbackResult = fallbackParser(text, availableItems);
    if (fallbackResult.items.length > 0) {
      console.log('Using fallback parser after Gemini failure');
      return fallbackResult;
    }
    throw new Error('Failed to parse input with both Gemini and fallback methods');
  }
}
