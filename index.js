const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const app = express();
app.use(express.json());

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// スマホ（MacroDroid）からの音声入力を受け取る正しい窓口
app.post('/api/macro-todo', async (req, res) => {
    const { text, secret } = req.body;
    
    // 合言葉チェック（大文字小文字を区別しない安全設計）
    if (!secret || secret.toLowerCase() !== 'remainder2026') {
        console.log('【警告】合言葉が一致しません:', secret);
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    console.log('【受信成功】スマホからタスクが届きました:', text);
    
    try {
        const channelId = process.env.DISCORD_CHANNEL_ID || '1238473210452394024'; 
        const channel = await client.channels.fetch(channelId);
        
        if (channel) {
            await channel.send(`🎯 **【スマホから追加】**\n${text}`);
            return res.status(200).json({ success: true });
        } else {
            throw new Error('チャンネルが見つかりません');
        }
    } catch (error) {
        console.error('Discord送信エラー:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});

client.once('ready', () => {
    console.log(`ログイン完了: じぞー#${client.user.tag} がオンラインになりました！`);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Web server listening on port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);
