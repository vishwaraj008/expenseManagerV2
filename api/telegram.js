// api/telegram.js
import { getConfig, getUserData, setUserData, resetUserData, initializeConfig } from '../src/lib/redis.js';
import { parseInput } from '../src/lib/gemini.js';
import fetch from 'node-fetch';

const BOT_TOKEN = process.env.BOT_TOKEN;

export default async function handler(req, res) {
  // Set CORS headers for potential preflight requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // Initialize config on first run
    await initializeConfig();
    
    const body = req.body;
    const chatId = body?.message?.chat?.id;
    const text = body?.message?.text?.trim();

    if (!chatId || !text) {
      return res.status(200).json({ ok: true });
    }

    console.log(`Processing message from chatId ${chatId}: ${text}`);

    // Handle start command
    if (text === '/start') {
      await sendMessage(chatId, `👋 Welcome to your Daily Expense Bot!\n\nAvailable items:\n• chai - ₹10\n• chips - ₹10\n• choti - ₹10\n• connect - ₹15\n• samosa - ₹15\n\nSend messages like:\n- "2 chai"\n- "1 samosa and 1 chips"\n- "3 connect"\n\nUse /total to see your daily total\nUse /reset to reset your daily count`);
      return res.status(200).json({ ok: true });
    }

    // Handle total command
    if (text === '/total') {
      await handleTotal(chatId);
      return res.status(200).json({ ok: true });
    }

    // Handle reset command
    if (text === '/reset') {
      await handleReset(chatId);
      return res.status(200).json({ ok: true });
    }

    // Process expense input
    await processExpense(chatId, text);
    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function processExpense(chatId, text) {
  try {
    // Parse input using Gemini LLM
    const { items } = await parseInput(text);
    
    // Get config from Redis
    const config = await getConfig();
    
    // Get user data from Redis
    const userData = await getUserData(chatId);
    
    let totalAdded = '';
    let totalCost = 0;
    
    for (const { item, quantity } of items) {
      const itemLower = item.toLowerCase();
      
      if (!config[itemLower]) {
        totalAdded += `⚠️ Unknown item: ${item}\n`;
        continue;
      }
      
      userData[itemLower] = (userData[itemLower] || 0) + quantity;
      const cost = config[itemLower] * quantity;
      totalCost += cost;
      totalAdded += `✅ ${quantity} x ${item} (₹${cost})\n`;
    }
    
    // Save updated user data
    const saved = await setUserData(chatId, userData);
    
    if (totalAdded.trim()) {
      totalAdded += `\n💰 Total cost: ₹${totalCost}`;
      await sendMessage(chatId, totalAdded.trim());
    } else {
      await sendMessage(chatId, 'No known items found. Try "2 chai" or "1 samosa".');
    }
    
    if (!saved) {
      await sendMessage(chatId, '⚠️ Warning: Data may not have been saved properly.');
    }
    
  } catch (error) {
    console.error('LLM parse error:', error);
    await sendMessage(chatId, '❌ Could not understand. Try "2 chai" or "1 samosa".');
  }
}

async function handleTotal(chatId) {
  try {
    const config = await getConfig();
    const userData = await getUserData(chatId);
    
    if (Object.keys(userData).length === 0) {
      await sendMessage(chatId, '📊 No expenses recorded today.');
      return;
    }
    
    let totalMessage = '📊 Today\'s Expenses:\n\n';
    let grandTotal = 0;
    
    for (const [item, quantity] of Object.entries(userData)) {
      const price = config[item] || 0;
      const cost = price * quantity;
      grandTotal += cost;
      totalMessage += `• ${quantity} x ${item} = ₹${cost}\n`;
    }
    
    totalMessage += `\n💰 Grand Total: ₹${grandTotal}`;
    await sendMessage(chatId, totalMessage);
    
  } catch (error) {
    console.error('Total calculation error:', error);
    await sendMessage(chatId, '❌ Error calculating total.');
  }
}

async function handleReset(chatId) {
  try {
    const reset = await resetUserData(chatId);
    if (reset) {
      await sendMessage(chatId, '🔄 Your daily expenses have been reset.');
    } else {
      await sendMessage(chatId, '❌ Error resetting expenses.');
    }
  } catch (error) {
    console.error('Reset error:', error);
    await sendMessage(chatId, '❌ Error resetting expenses.');
  }
}

async function sendMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        chat_id: chatId, 
        text,
        parse_mode: 'HTML'
      })
    });
    
    if (!response.ok) {
      console.error('Telegram API error:', await response.text());
    }
  } catch (error) {
    console.error('Send message error:', error);
  }
}
