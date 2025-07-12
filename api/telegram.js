// api/telegram.js
import { getConfig, getUserData, setUserData, resetUserData, initializeConfig } from '../src/lib/redis.js';
import { parseInput } from '../src/lib/gemini.js';
import fetch from 'node-fetch';

const BOT_TOKEN = process.env.BOT_TOKEN;
const ALLOWED_USER_IDS = process.env.ALLOWED_USER_IDS?.split(',').map(id => parseInt(id.trim())) || [];

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
    const userId = body?.message?.from?.id;

    if (!chatId || !text || !userId) {
      return res.status(200).json({ ok: true });
    }

    // Check if user is authorized
    if (ALLOWED_USER_IDS.length > 0 && !ALLOWED_USER_IDS.includes(userId)) {
      await sendMessage(chatId, '🚫 Access denied. You are not authorized to use this bot.');
      return res.status(200).json({ ok: true });
    }

    console.log(`Processing message from chatId ${chatId}, userId ${userId}: ${text}`);

    // Handle start command
    if (text === '/start') {
      const config = await getConfig();
      const itemsList = Object.keys(config).map(item => `• ${item} - ₹${config[item]}`).join('\n');
      await sendMessageWithKeyboard(chatId, `👋 Welcome to your Daily Expense Bot!\n\nAvailable items:\n${itemsList}\n\nSend messages like:\n- "2 chai"\n- "1 samosa and 1 chips"\n- "get me connect"\n\nOr use the buttons below:`);
      return res.status(200).json({ ok: true });
    }

    // Handle total command (both slash command and button)
    if (text === '/total' || text === '📊 Total') {
      await handleTotal(chatId);
      return res.status(200).json({ ok: true });
    }

    // Handle checkout command (both slash command and button)
    if (text === '/checkout' || text === '🛍️ Checkout') {
      await handleCheckout(chatId);
      return res.status(200).json({ ok: true });
    }

    // Handle reset command (both slash command and button)
    if (text === '/reset' || text === '🔄 Reset') {
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
    // Get config from Redis first
    const config = await getConfig();
    
    // Parse input using Gemini LLM with config
    const { items } = await parseInput(text, config);
    
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
    await sendMessage(chatId, 'Could not understand. Try "2 chai" or "1 samosa".');
  }
}

async function handleTotal(chatId) {
  try {
    const config = await getConfig();
    const userData = await getUserData(chatId);
    
    if (Object.keys(userData).length === 0) {
      await sendMessage(chatId, 'No expenses recorded today.');
      return;
    }
    
    let totalMessage = 'Today\'s Expenses:\n\n';
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

async function handleCheckout(chatId) {
  try {
    const config = await getConfig();
    const userData = await getUserData(chatId);
    
    if (Object.keys(userData).length === 0) {
      await sendMessage(chatId, '🛍️ No items to checkout.');
      return;
    }
    
    let checkoutMessage = '🛍️ Checkout Summary:\n\n';
    let grandTotal = 0;
    
    for (const [item, quantity] of Object.entries(userData)) {
      const price = config[item] || 0;
      const cost = price * quantity;
      grandTotal += cost;
      checkoutMessage += `• ${quantity} x ${item} = ₹${cost}\n`;
    }
    
    checkoutMessage += `\n💵 Total Amount: ₹${grandTotal}\n\n✅ Order confirmed! Your items will be prepared.`;
    
    await sendMessage(chatId, checkoutMessage);
    
    // Reset user data after checkout
    await resetUserData(chatId);
    
  } catch (error) {
    console.error('Checkout error:', error);
    await sendMessage(chatId, '❌ Error processing checkout.');
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
  
  // Always include keyboard to keep it persistent
  const keyboard = {
    keyboard: [
      [{ text: '📊 Total' }, { text: '🛍️ Checkout' }],
      [{ text: '🔄 Reset' }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  };
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        chat_id: chatId, 
        text,
        parse_mode: 'HTML',
        reply_markup: keyboard
      })
    });
    
    if (!response.ok) {
      console.error('Telegram API error:', await response.text());
    }
  } catch (error) {
    console.error('Send message error:', error);
  }
}

async function sendMessageWithKeyboard(chatId, text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  
  const keyboard = {
    keyboard: [
      [{ text: '📊 Total' }, { text: '🛍️ Checkout' }],
      [{ text: '🔄 Reset' }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
    persistent: true
  };
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        chat_id: chatId, 
        text,
        parse_mode: 'HTML',
        reply_markup: keyboard
      })
    });
    
    if (!response.ok) {
      console.error('Telegram API error:', await response.text());
    }
  } catch (error) {
    console.error('Send message error:', error);
  }
}

// Also send keyboard with regular messages to keep it visible
async function sendMessageWithPersistentKeyboard(chatId, text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  
  const keyboard = {
    keyboard: [
      [{ text: '📊 Total' }, { text: '🛍️ Checkout' }],
      [{ text: '🔄 Reset' }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
    persistent: true
  };
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        chat_id: chatId, 
        text,
        parse_mode: 'HTML',
        reply_markup: keyboard
      })
    });
    
    if (!response.ok) {
      console.error('Telegram API error:', await response.text());
    }
  } catch (error) {
    console.error('Send message error:', error);
  }
}
