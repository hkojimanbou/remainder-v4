require('dotenv').config();
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { pool } = require('./db');
const calendar = require('./calendar');
const { startServer } = require('./web');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

async function showPendingList(channel) {
    try {
        const res = await pool.query("SELECT * FROM todos WHERE status = 'pending' ORDER BY created_at ASC");
        const pendingTodos = res.rows;

        if (pendingTodos.length === 0) {
            return channel.send("📝 現在、未予定のTODOはありません！");
        }

        const embed = new EmbedBuilder()
            .setTitle('📋 未予定TODO一覧')
            .setColor(0x0099FF)
            .setDescription('実行するか、取り止めるかを選んでください。');

        const messages = [];
        messages.push({ embeds: [embed] });

        for (const t of pendingTodos) {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`exec_${t.id}`).setLabel('▶ 実行').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`cancel_${t.id}`).setLabel('❌ 取止め').setStyle(ButtonStyle.Danger)
            );
            
            const timeStr = new Date(t.created_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            
            messages.push({
                content: `**#${t.id}** ${t.title} (登録: ${timeStr})`,
                components: [row]
            });
        }

        for (const msg of messages) {
            await channel.send(msg);
        }

    } catch (err) {
        console.error("DB Error:", err);
        channel.send("データベースエラーが発生しました。");
    }
}

async function showScheduledList(channel) {
    try {
        const res = await pool.query("SELECT * FROM todos WHERE status = 'scheduled' ORDER BY scheduled_at ASC");
        const scheduledTodos = res.rows;

        if (scheduledTodos.length === 0) {
            return channel.send("📅 現在、予定済みのTODOはありません！");
        }

        const embed = new EmbedBuilder()
            .setTitle('📅 予定済みTODO一覧')
            .setColor(0x00FF00)
            .setDescription('完了、リスケ、または取り止めを選んでください。');

        const messages = [];
        messages.push({ embeds: [embed] });

        for (const t of scheduledTodos) {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`done_${t.id}`).setLabel('✅ 完了').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`resched_${t.id}`).setLabel('🔄 リスケ').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`cancelsched_${t.id}`).setLabel('❌ 取止め').setStyle(ButtonStyle.Danger)
            );
            
            const timeStr = new Date(t.scheduled_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            
            messages.push({
                content: `**#${t.id}** ${t.title} (予定: ${timeStr})`,
                components: [row]
            });
        }

        for (const msg of messages) {
            await channel.send(msg);
        }

    } catch (err) {
        console.error("DB Error:", err);
        channel.send("データベースエラーが発生しました。");
    }
}

client.once('ready', () => {
    console.log(`ログイン完了: ${client.user.tag} がオンラインになりました！`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const text = message.content.trim();
    const lowerText = text.toLowerCase();
    
    if (lowerText.startsWith('!') || lowerText.startsWith('！')) {
        const match = text.match(/^[!！][\s　]*(.+)$/);
        if (match && match[1]) {
            const title = match[1].trim();
            if (title.toLowerCase() === 'list') {
                await showPendingList(message.channel);
                return;
            }
            if (title.toLowerCase() === 'scheduled' || title === 'まとめ') {
                await showScheduledList(message.channel);
                return;
            }
            if (title.toLowerCase() === 'analyze' || title === '分析') {
                const url = process.env.PUBLIC_URL || 'http://localhost:3000';
                await message.reply(`📊 じぞーの分析ページはこちらです：\n${url}`);
                return;
            }
            try {
                const res = await pool.query(
                    "INSERT INTO todos (title, status) VALUES ($1, 'pending') RETURNING *",
                    [title]
                );
                const newTodo = res.rows[0];
                
                await pool.query(
                    "INSERT INTO actions (todo_id, action_type) VALUES ($1, 'created')",
                    [newTodo.id]
                );

                try {
                    await message.react('✅');
                } catch (e) {
                    // リアクション失敗時は無応答でよい
                }
            } catch (err) {
                console.error(err);
            }
        }
        return;
    }
});

client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isButton()) {
            const customId = interaction.customId;

            if (customId.startsWith('exec_')) {
                const todoId = customId.split('_')[1];
                const modal = new ModalBuilder()
                    .setCustomId(`modal_exec_${todoId}`)
                    .setTitle('日時を設定して予定化');

                const datetimeInput = new TextInputBuilder()
                    .setCustomId('datetimeInput')
                    .setLabel('日時を12桁の数字で入力 (例: 202605101430)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMinLength(12)
                    .setMaxLength(12);

                const firstActionRow = new ActionRowBuilder().addComponents(datetimeInput);
                modal.addComponents(firstActionRow);
                await interaction.showModal(modal);
                return;
            }

            if (customId.startsWith('confirmexec_')) {
                const parts = customId.split('_');
                const todoId = parts[1];
                const inputStr = parts[2];

                await interaction.reply({ content: '⏳ Googleカレンダーに登録しています...', ephemeral: true });

                const year = inputStr.substring(0, 4);
                const month = inputStr.substring(4, 6);
                const day = inputStr.substring(6, 8);
                const hour = inputStr.substring(8, 10);
                const min = inputStr.substring(10, 12);
                const dateObj = new Date(year, parseInt(month) - 1, day, hour, min);

                const res = await pool.query("SELECT title FROM todos WHERE id = $1", [todoId]);
                if (res.rows.length === 0) {
                    return interaction.editReply('❌ TODOが見つかりません。');
                }
                const title = res.rows[0].title;

                const eventId = await calendar.addEvent(title, dateObj.toISOString());
                if (!eventId) {
                    return interaction.editReply('❌ Googleカレンダーの登録に失敗しました。');
                }

                await pool.query(
                    "UPDATE todos SET status = 'scheduled', scheduled_at = $1, calendar_event_id = $2 WHERE id = $3",
                    [dateObj.toISOString(), eventId, todoId]
                );
                await pool.query(
                    "INSERT INTO actions (todo_id, action_type, action_at) VALUES ($1, 'scheduled', CURRENT_TIMESTAMP)",
                    [todoId]
                );

                await interaction.editReply(`✅ Googleカレンダーに予定を登録し、予定済み一覧へ移動しました！`);
                return;
            }

            if (customId.startsWith('cancelexec_')) {
                await interaction.reply({ content: '予定化をキャンセルしました。', ephemeral: true });
                return;
            }

            if (customId.startsWith('cancel_')) {
                const todoId = customId.split('_')[1];
                await pool.query("UPDATE todos SET status = 'cancelled' WHERE id = $1", [todoId]);
                await pool.query(
                    "INSERT INTO actions (todo_id, action_type, action_at) VALUES ($1, 'cancelled', CURRENT_TIMESTAMP)",
                    [todoId]
                );
                await interaction.reply({ content: `🗑️ TODO #${todoId} を取り止めました。`, ephemeral: true });
                return;
            }

            // --- ここから Step 5 & 6 の処理 ---
            if (customId.startsWith('done_')) {
                const todoId = customId.split('_')[1];
                await pool.query("UPDATE todos SET status = 'done' WHERE id = $1", [todoId]);
                await pool.query("INSERT INTO actions (todo_id, action_type) VALUES ($1, 'done')", [todoId]);
                await interaction.reply({ content: `✅ TODO #${todoId} を「完了」にしました！お疲れ様です！`, ephemeral: true });
                return;
            }

            if (customId.startsWith('cancelsched_')) {
                const todoId = customId.split('_')[1];
                const res = await pool.query("SELECT calendar_event_id FROM todos WHERE id = $1", [todoId]);
                if (res.rows.length > 0 && res.rows[0].calendar_event_id) {
                    await calendar.deleteEvent(res.rows[0].calendar_event_id);
                }
                await pool.query("UPDATE todos SET status = 'cancelled' WHERE id = $1", [todoId]);
                await pool.query("INSERT INTO actions (todo_id, action_type) VALUES ($1, 'cancelled')", [todoId]);
                await interaction.reply({ content: `🗑️ TODO #${todoId} を取り止め、カレンダーからも削除しました。`, ephemeral: true });
                return;
            }

            if (customId.startsWith('resched_')) {
                const todoId = customId.split('_')[1];
                const modal = new ModalBuilder()
                    .setCustomId(`modal_resched_${todoId}`)
                    .setTitle('新しい日時を設定してリスケ');

                const datetimeInput = new TextInputBuilder()
                    .setCustomId('datetimeInput')
                    .setLabel('新しい日時を12桁の数字で入力')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMinLength(12)
                    .setMaxLength(12);

                const firstActionRow = new ActionRowBuilder().addComponents(datetimeInput);
                modal.addComponents(firstActionRow);
                await interaction.showModal(modal);
                return;
            }

            if (customId.startsWith('confirmresched_')) {
                const parts = customId.split('_');
                const todoId = parts[1];
                const inputStr = parts[2];

                await interaction.reply({ content: '⏳ Googleカレンダーを更新しています...', ephemeral: true });

                const year = inputStr.substring(0, 4);
                const month = inputStr.substring(4, 6);
                const day = inputStr.substring(6, 8);
                const hour = inputStr.substring(8, 10);
                const min = inputStr.substring(10, 12);
                const newDateObj = new Date(year, parseInt(month) - 1, day, hour, min);

                const res = await pool.query("SELECT title, calendar_event_id, scheduled_at FROM todos WHERE id = $1", [todoId]);
                if (res.rows.length === 0) {
                    return interaction.editReply('❌ TODOが見つかりません。');
                }
                const { title, calendar_event_id, scheduled_at } = res.rows[0];

                if (!calendar_event_id) {
                    return interaction.editReply('❌ 連携されたカレンダー情報が見つかりません。');
                }

                const success = await calendar.updateEvent(calendar_event_id, title, newDateObj.toISOString());
                if (!success) {
                    return interaction.editReply('❌ Googleカレンダーの更新に失敗しました。');
                }

                await pool.query(
                    "UPDATE todos SET scheduled_at = $1 WHERE id = $2",
                    [newDateObj.toISOString(), todoId]
                );
                await pool.query(
                    "INSERT INTO actions (todo_id, action_type, action_at, from_time, to_time) VALUES ($1, 'rescheduled', CURRENT_TIMESTAMP, $2, $3)",
                    [todoId, scheduled_at, newDateObj.toISOString()]
                );

                await interaction.editReply(`✅ Googleカレンダーの予定を新しい日時にリスケしました！`);
                return;
            }

            if (customId.startsWith('cancelresched_')) {
                await interaction.reply({ content: 'リスケをキャンセルしました。', ephemeral: true });
                return;
            }
        }

        if (interaction.isModalSubmit()) {
            if (interaction.customId.startsWith('modal_exec_') || interaction.customId.startsWith('modal_resched_')) {
                const isResched = interaction.customId.startsWith('modal_resched_');
                const todoId = interaction.customId.split('_')[2];
                const inputStr = interaction.fields.getTextInputValue('datetimeInput');
                
                if (!/^\d{12}$/.test(inputStr)) {
                    return interaction.reply({ content: '❌ フォーマットが間違っています。12桁の半角数字で入力してください。', ephemeral: true });
                }
                
                const year = inputStr.substring(0, 4);
                const month = inputStr.substring(4, 6);
                const day = inputStr.substring(6, 8);
                const hour = inputStr.substring(8, 10);
                const min = inputStr.substring(10, 12);
                
                const dateObj = new Date(year, parseInt(month) - 1, day, hour, min);
                if (isNaN(dateObj.getTime())) {
                    return interaction.reply({ content: '❌ 無効な日時です。', ephemeral: true });
                }
                
                const days = ['日', '月', '火', '水', '木', '金', '土'];
                const dayStr = days[dateObj.getDay()];
                
                const confirmText = isResched 
                    ? `📅 新しい日時を **${year}年${parseInt(month)}月${parseInt(day)}日（${dayStr}）${hour}:${min}** に変更してよいですか？`
                    : `📅 **${year}年${parseInt(month)}月${parseInt(day)}日（${dayStr}）${hour}:${min}** でよいですか？`;
                
                const prefix = isResched ? 'resched' : 'exec';
                
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`confirm${prefix}_${todoId}_${inputStr}`).setLabel('はい').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`cancel${prefix}_${todoId}`).setLabel('いいえ').setStyle(ButtonStyle.Secondary)
                );
                
                await interaction.reply({ content: confirmText, components: [row], ephemeral: true });
                return;
            }
        }
    } catch (err) {
        console.error("Interaction Error:", err);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: "エラーが発生しました。", ephemeral: true });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
startServer(process.env.PORT || 3000);
