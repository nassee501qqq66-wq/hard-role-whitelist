const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Config ───────────────────────────────────────────────────
const BOT_TOKEN        = 'MTQ3NjgxODc3MTk1MDgyOTU2OA.GDw6v9.KEzA5Rzb46MUGyQBQgjX8CMQFPfIhiSbdLEFGU';
const GUILD_ID         = '1474876236470812937';
const ROLE_GIVE        = '1476657256727711927';
const ROLE_REMOVE      = '1476657257583345860';
const WEBHOOK_PASS     = 'https://canary.discord.com/api/webhooks/1476822794514989056/ktr9SumLQ0FrQd7lCl1kAIVDt0AsarU8C4qOUJDTiYJUsc8FHdFEGZ0Fi8b-U4aWFd6c';
const WEBHOOK_FAIL     = 'https://canary.discord.com/api/webhooks/1476822856959528962/fC-CHGNfhxAn081gw6XTin8waeTstix0armkBkjJChfRtXDv6MkCocRnbj6IrZqgYH_m';
const MAX_ATTEMPTS     = 3;
const COOLDOWN_MINUTES = 10;
const COOLDOWN_MS      = COOLDOWN_MINUTES * 60 * 1000;
// ─────────────────────────────────────────────────────────────

const DISCORD_API = 'https://discord.com/api/v10';
const headers = {
  'Authorization': `Bot ${BOT_TOKEN}`,
  'Content-Type': 'application/json'
};

// ─── Cooldown Store ──────────────────────────────────────────
const attemptStore = {};

function getAttemptData(ip) {
  if (!attemptStore[ip]) attemptStore[ip] = { attempts: 0, cooldownUntil: null };
  const data = attemptStore[ip];
  if (data.cooldownUntil && Date.now() >= data.cooldownUntil) {
    data.attempts = 0;
    data.cooldownUntil = null;
  }
  return data;
}

// ─── Discord Helpers ─────────────────────────────────────────
async function findMember(username) {
  const res = await fetch(`${DISCORD_API}/guilds/${GUILD_ID}/members/search?query=${encodeURIComponent(username)}&limit=5`, { headers });
  if (!res.ok) return null;
  const members = await res.json();
  if (!members.length) return null;
  const lower = username.toLowerCase().replace('#', '');
  const match = members.find(m => {
    const tag = (m.user.username + (m.user.discriminator !== '0' ? '#' + m.user.discriminator : '')).toLowerCase();
    return tag.includes(lower) || m.user.username.toLowerCase() === lower;
  });
  return match || members[0];
}

async function sendWebhook(url, embed) {
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] })
  }).catch(e => console.error('Webhook error:', e));
}

// ─── Route: Check Cooldown ────────────────────────────────────
app.get('/api/cooldown', (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  const data = getAttemptData(ip);
  if (data.cooldownUntil && Date.now() < data.cooldownUntil) {
    const remaining = Math.ceil((data.cooldownUntil - Date.now()) / 1000);
    return res.json({ onCooldown: true, remaining, attempts: data.attempts });
  }
  return res.json({ onCooldown: false, attempts: data.attempts, maxAttempts: MAX_ATTEMPTS });
});

// ─── Route: Submit Quiz ───────────────────────────────────────
app.post('/api/whitelist', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  const { discord, score, passed } = req.body;

  if (!discord || score === undefined) {
    return res.status(400).json({ success: false, message: 'Missing fields' });
  }

  const data = getAttemptData(ip);

  // تحقق من الكولداون
  if (data.cooldownUntil && Date.now() < data.cooldownUntil) {
    const remaining = Math.ceil((data.cooldownUntil - Date.now()) / 1000);
    return res.status(429).json({
      success: false,
      cooldown: true,
      remaining,
      message: `You are on cooldown. Try again in ${Math.ceil(remaining / 60)} minutes.`
    });
  }

  // زيادة المحاولات فقط عند الفشل
  if (!passed) {
    data.attempts += 1;
    if (data.attempts >= MAX_ATTEMPTS) {
      data.cooldownUntil = Date.now() + COOLDOWN_MS;
      console.log(`⏳ Cooldown for IP ${ip} | Attempts: ${data.attempts}`);
    }

    const remaining = data.cooldownUntil ? Math.ceil((data.cooldownUntil - Date.now()) / 1000) : null;

    await sendWebhook(WEBHOOK_FAIL, {
      title: '❌ Failed Whitelist Application',
      color: 0xff4560,
      fields: [
        { name: '👤 Discord', value: discord, inline: true },
        { name: '📊 Score', value: `${score} / 6`, inline: true },
        { name: '🔁 Attempt', value: `${data.attempts} / ${MAX_ATTEMPTS}`, inline: true },
        { name: '⏳ Cooldown', value: data.cooldownUntil ? `${COOLDOWN_MINUTES} minutes applied` : 'Not yet', inline: true }
      ],
      timestamp: new Date().toISOString()
    });

    return res.json({
      success: false,
      passed: false,
      attempts: data.attempts,
      maxAttempts: MAX_ATTEMPTS,
      cooldown: !!data.cooldownUntil,
      remaining,
      message: data.cooldownUntil
        ? `You failed ${MAX_ATTEMPTS} times. Please wait ${COOLDOWN_MINUTES} minutes.`
        : `You failed. Attempt ${data.attempts}/${MAX_ATTEMPTS}.`
    });
  }

  // ─── نجح ─────────────────────────────────────────────────
  try {
    const member = await findMember(discord);
    if (!member) {
      return res.status(404).json({ success: false, message: 'User not found in Discord server. Make sure you joined the server first.' });
    }

    const userId = member.user.id;

    // اسحب الرتبة القديمة
    await fetch(`${DISCORD_API}/guilds/${GUILD_ID}/members/${userId}/roles/${ROLE_REMOVE}`, { method: 'DELETE', headers });

    // أعطِ الرتبة الجديدة
    const giveRes = await fetch(`${DISCORD_API}/guilds/${GUILD_ID}/members/${userId}/roles/${ROLE_GIVE}`, { method: 'PUT', headers });

    if (!giveRes.ok) {
      const err = await giveRes.json().catch(() => ({}));
      console.error('Error giving role:', err);
      return res.status(500).json({ success: false, message: 'Failed to assign role. Check bot permissions.' });
    }

    // Reset بعد النجاح
    data.attempts = 0;
    data.cooldownUntil = null;

    // ويب هوك النجاح
    await sendWebhook(WEBHOOK_PASS, {
      title: '✅ Passed Whitelist Application',
      color: 0x00e5a0,
      fields: [
        { name: '👤 Discord', value: discord, inline: true },
        { name: '🆔 User ID', value: userId, inline: true },
        { name: '📊 Score', value: `${score} / 6`, inline: true },
        { name: '🎭 Role', value: 'Whitelisted ✅', inline: true }
      ],
      timestamp: new Date().toISOString()
    });

    console.log(`✅ Whitelisted: ${discord} (${userId}) | Score: ${score}/6`);
    return res.json({ success: true, message: 'Role assigned successfully!', userId });

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Hard Role Whitelist Server running on port ${PORT}`);
});
